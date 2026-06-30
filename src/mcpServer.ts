import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GrippClient, GrippClientOptions } from "./grippClient.js";
import { GrippMcpError, toErrorPayload } from "./errors.js";
import { getEntityDetails, hasMethod, listClassSummaries, metadata, methodName, requireMethod } from "./metadata.js";
import { filterSchema, jsonValueSchema, optionsSchema } from "./toolSchemas.js";
import { JsonValue } from "./types.js";

export type CreateGrippMcpServerOptions = {
  clientOptions?: GrippClientOptions;
};

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toJsonArray(values: unknown[] | undefined): JsonValue[] {
  return (values ?? []) as JsonValue[];
}

async function withErrors(operation: () => Promise<unknown> | unknown) {
  try {
    return jsonText(await operation());
  } catch (error) {
    return jsonText(toErrorPayload(error));
  }
}

export function createGrippMcpServer(options: CreateGrippMcpServerOptions = {}) {
  const server = new McpServer({
    name: "gripp-mcp",
    version: "0.1.0"
  });

  function client() {
    return new GrippClient(options.clientOptions);
  }

  server.tool(
    "gripp_list_entities",
    "List available Gripp API entities, fields counts, and supported method names.",
    {},
    async () => withErrors(() => ({
      source: metadata.source,
      generatedAt: metadata.generatedAt,
      entities: listClassSummaries()
    }))
  );

  server.tool(
    "gripp_describe_entity",
    "Describe one Gripp API entity, including fields, references, enum values, methods, and examples.",
    {
      entity: z.string().describe("Gripp entity name, for example company, contact, invoice, project, task.")
    },
    async ({ entity }) => withErrors(() => getEntityDetails(entity))
  );

  server.tool(
    "gripp_get",
    "Retrieve Gripp entities with filters, paging, and ordering. Uses the entity.get API method.",
    {
      entity: z.string().describe("Gripp entity name, for example company or invoice."),
      filters: z.array(filterSchema).default([]).describe("Gripp filters. Use full field names like company.id."),
      options: optionsSchema.describe("Gripp paging and ordering options. maxresults is capped at 250.")
    },
    async ({ entity, filters, options }) => withErrors(async () => {
      requireMethod(entity, "get");
      const result = await client().call(methodName(entity, "get"), [filters as JsonValue, options as JsonValue]);
      return { result };
    })
  );

  server.tool(
    "gripp_getone",
    "Retrieve a single Gripp entity. Uses the entity.getone API method and returns the first matching item.",
    {
      entity: z.string().describe("Gripp entity name, for example company or invoice."),
      filters: z.array(filterSchema).default([]).describe("Gripp filters. Use full field names like company.id.")
    },
    async ({ entity, filters }) => withErrors(async () => {
      requireMethod(entity, "getone");
      const result = await client().call(methodName(entity, "getone"), [filters as JsonValue]);
      return { result };
    })
  );

  server.tool(
    "gripp_create",
    "Create a Gripp entity. Requires confirm=true because this writes to Gripp.",
    {
      entity: z.string().describe("Gripp entity name, for example company, contact, invoice, task, or tag."),
      fields: z.record(jsonValueSchema).describe("Field values for the new entity. Check gripp_describe_entity first."),
      confirm: z.literal(true).describe("Must be true to create data in Gripp.")
    },
    async ({ entity, fields, confirm }) => withErrors(async () => {
      requireMethod(entity, "create");
      const result = await client().call(methodName(entity, "create"), [fields as JsonValue], confirm);
      return { result };
    })
  );

  server.tool(
    "gripp_update",
    "Update a Gripp entity by ID. Requires confirm=true because this writes to Gripp.",
    {
      entity: z.string().describe("Gripp entity name, for example company, contact, invoice, task, or tag."),
      id: z.number().int().positive().describe("Database ID of the entity to update."),
      fields: z.record(jsonValueSchema).describe("Field values to update. Check gripp_describe_entity first."),
      confirm: z.literal(true).describe("Must be true to update data in Gripp.")
    },
    async ({ entity, id, fields, confirm }) => withErrors(async () => {
      requireMethod(entity, "update");
      const result = await client().call(methodName(entity, "update"), [id, fields as JsonValue], confirm);
      return { result };
    })
  );

  server.tool(
    "gripp_delete",
    "Delete a Gripp entity by ID. Requires confirm=true because this permanently changes Gripp data.",
    {
      entity: z.string().describe("Gripp entity name, for example tag or contact."),
      id: z.number().int().positive().describe("Database ID of the entity to delete."),
      confirm: z.literal(true).describe("Must be true to delete data from Gripp.")
    },
    async ({ entity, id, confirm }) => withErrors(async () => {
      requireMethod(entity, "delete");
      const result = await client().call(methodName(entity, "delete"), [id], confirm);
      return { result };
    })
  );

  server.tool(
    "gripp_call",
    "Call any Gripp API method by full method name. Non-read methods require confirm=true.",
    {
      method: z
        .string()
        .regex(/^[A-Za-z0-9_]+\\.[A-Za-z0-9_]+$/)
        .describe("Full Gripp method name, for example company.getCompanyByCOC or file.getContent."),
      params: z.array(jsonValueSchema).default([]).describe("Positional JSON-RPC params for the Gripp method."),
      confirm: z.boolean().default(false).describe("Required for methods that may modify Gripp data.")
    },
    async ({ method, params, confirm }) => withErrors(async () => {
      const [entity, apiMethod] = method.split(".");
      if (!hasMethod(entity, apiMethod)) {
        throw new GrippMcpError("unknown_method", "The Gripp docs metadata does not contain this method.", {
          method
        });
      }
      const result = await client().call(method, toJsonArray(params), confirm);
      return { result };
    })
  );

  server.tool(
    "gripp_batch",
    "Execute multiple Gripp API calls in one Gripp transaction. Non-read calls require confirm=true per item.",
    {
      calls: z
        .array(
          z.object({
            method: z
              .string()
              .regex(/^[A-Za-z0-9_]+\\.[A-Za-z0-9_]+$/)
              .describe("Full Gripp method name, for example company.get or tag.create."),
            params: z.array(jsonValueSchema).default([]).describe("Positional JSON-RPC params for this call."),
            confirm: z.boolean().default(false).describe("Required for methods that may modify Gripp data.")
          })
        )
        .min(1)
        .max(50)
        .describe("Batch of Gripp calls. Keep batches reasonably small to preserve agent usability.")
    },
    async ({ calls }) => withErrors(async () => {
      for (const call of calls) {
        const [entity, apiMethod] = call.method.split(".");
        if (!hasMethod(entity, apiMethod)) {
          throw new GrippMcpError("unknown_method", "The Gripp docs metadata does not contain this method.", {
            method: call.method
          });
        }
      }

      const result = await client().batch(
        calls.map((call) => ({
          method: call.method,
          params: toJsonArray(call.params),
          confirm: call.confirm
        }))
      );
      return { result };
    })
  );

  return server;
}

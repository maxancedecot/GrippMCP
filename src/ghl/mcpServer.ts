import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toErrorPayload } from "../errors.js";
import { jsonValueSchema } from "../toolSchemas.js";
import { JsonValue } from "../types.js";
import { GhlClient } from "./client.js";
import { getGhlTokenStoreMode } from "./tokenStore.js";
import { GhlApiMethod } from "./types.js";

export type CreateGhlMcpServerOptions = {
  installId: string;
};

const apiMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

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

async function withErrors(operation: () => Promise<unknown> | unknown) {
  try {
    return jsonText(await operation());
  } catch (error) {
    return jsonText(toErrorPayload(error));
  }
}

export function createGhlMcpServer(options: CreateGhlMcpServerOptions) {
  const server = new McpServer({
    name: "gohighlevel-mcp",
    version: "0.1.0"
  });
  const client = new GhlClient(options.installId);

  server.tool(
    "ghl_installation_status",
    "Show the GoHighLevel OAuth installation metadata for this MCP connection.",
    {},
    async () => withErrors(async () => ({
      tokenStore: getGhlTokenStoreMode(),
      installation: await client.status()
    }))
  );

  server.tool(
    "ghl_get_contact",
    "Retrieve one GoHighLevel contact by contact ID.",
    {
      contactId: z.string().describe("GoHighLevel contact ID.")
    },
    async ({ contactId }) => withErrors(async () => ({
      result: await client.call({
        method: "GET",
        path: `/contacts/${encodeURIComponent(contactId)}`
      })
    }))
  );

  server.tool(
    "ghl_search_contacts",
    "Search GoHighLevel contacts using the /contacts/search endpoint.",
    {
      body: z.record(jsonValueSchema).describe("Search request body. Include locationId and any HighLevel search filters.")
    },
    async ({ body }) => withErrors(async () => ({
      result: await client.call({
        method: "POST",
        path: "/contacts/search",
        body: body as JsonValue,
        readOnly: true
      })
    }))
  );

  server.tool(
    "ghl_create_contact",
    "Create a GoHighLevel contact. Requires confirm=true because this writes data.",
    {
      body: z.record(jsonValueSchema).describe("Create contact request body. Include locationId."),
      confirm: z.literal(true).describe("Must be true to create a contact.")
    },
    async ({ body, confirm }) => withErrors(async () => ({
      result: await client.call({
        method: "POST",
        path: "/contacts/",
        body: body as JsonValue,
        confirm
      })
    }))
  );

  server.tool(
    "ghl_update_contact",
    "Update a GoHighLevel contact. Requires confirm=true because this writes data.",
    {
      contactId: z.string().describe("GoHighLevel contact ID."),
      body: z.record(jsonValueSchema).describe("Contact fields to update."),
      confirm: z.literal(true).describe("Must be true to update a contact.")
    },
    async ({ contactId, body, confirm }) => withErrors(async () => ({
      result: await client.call({
        method: "PUT",
        path: `/contacts/${encodeURIComponent(contactId)}`,
        body: body as JsonValue,
        confirm
      })
    }))
  );

  server.tool(
    "ghl_search_opportunities",
    "Search GoHighLevel opportunities using the /opportunities/search endpoint.",
    {
      body: z.record(jsonValueSchema).describe("Search request body. Include locationId/location_id as required by your API version.")
    },
    async ({ body }) => withErrors(async () => ({
      result: await client.call({
        method: "POST",
        path: "/opportunities/search",
        body: body as JsonValue,
        readOnly: true
      })
    }))
  );

  server.tool(
    "ghl_api_call",
    "Call any relative GoHighLevel API path. Non-GET calls require confirm=true.",
    {
      method: apiMethodSchema.describe("HTTP method."),
      path: z.string().describe("Relative API path, for example /contacts/search or /opportunities/search."),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.undefined()])).default({}),
      body: jsonValueSchema.optional().describe("JSON request body for non-GET calls."),
      apiVersion: z.string().default("2021-07-28").describe("HighLevel Version header."),
      confirm: z.boolean().default(false).describe("Required for POST, PUT, PATCH, and DELETE.")
    },
    async ({ method, path, query, body, apiVersion, confirm }) => withErrors(async () => ({
      result: await client.call({
        method: method as GhlApiMethod,
        path,
        query,
        body: body as JsonValue | undefined,
        apiVersion,
        confirm
      })
    }))
  );

  return server;
}

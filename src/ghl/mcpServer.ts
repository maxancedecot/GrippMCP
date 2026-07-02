import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toErrorPayload } from "../errors.js";
import { jsonValueSchema } from "../toolSchemas.js";
import { JsonValue } from "../types.js";
import { GhlClient } from "./client.js";
import { createGhlLocationToken, getFreshGhlTokenRecord, getGhlAppId } from "./oauth.js";
import { getGhlTokenStoreMode, listGhlInstallations } from "./tokenStore.js";
import { GhlApiMethod } from "./types.js";

export type CreateGhlMcpServerOptions = {
  installId?: string;
};

const apiMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const installIdSchema = z
  .string()
  .optional()
  .describe("OAuth installation ID for the subaccount/location. Use ghl_list_installations to find it.");

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

  async function clientFor(installId: string | undefined) {
    return new GhlClient(await resolveInstallId(options.installId, installId));
  }

  server.tool(
    "ghl_list_installations",
    "List connected GoHighLevel OAuth installations/subaccounts available to this MCP.",
    {},
    async () => withErrors(async () => ({
      tokenStore: getGhlTokenStoreMode(),
      installations: listInstallationsForOutput(await listGhlInstallations())
    }))
  );

  server.tool(
    "ghl_installation_status",
    "Show the GoHighLevel OAuth installation metadata for one subaccount.",
    {
      installId: installIdSchema
    },
    async ({ installId }) => withErrors(async () => ({
      tokenStore: getGhlTokenStoreMode(),
      installation: await (await clientFor(installId)).status()
    }))
  );

  server.tool(
    "ghl_list_locations",
    "List/search GoHighLevel subaccounts visible to an agency/company OAuth installation. Visibility does not guarantee the app is installed on the location.",
    {
      companyInstallId: installIdSchema.describe("Company/Agency installation ID. Use ghl_list_installations to find a userType=Company install."),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.undefined()])).default({}).describe("Optional /locations/search query parameters.")
    },
    async ({ companyInstallId, query }) => withErrors(async () => ({
      result: await (await clientFor(companyInstallId)).call({
        method: "GET",
        path: "/locations/search",
        query,
        readOnly: true
      })
    }))
  );

  server.tool(
    "ghl_list_installed_locations",
    "List GoHighLevel locations where this Marketplace app is installed/authorized. Defaults to installed-only results; use this before ghl_connect_location.",
    {
      companyInstallId: installIdSchema.describe("Company/Agency installation ID. Use ghl_list_installations to find a userType=Company install."),
      appId: z.string().optional().describe("HighLevel Marketplace app/version ID. Defaults to GHL_APP_ID or the version_id in GHL_INSTALL_URL."),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean(), z.undefined()]))
        .default({})
        .describe("Optional /oauth/installedLocations query parameters. Defaults are skip=0, limit=100, isInstalled=true.")
    },
    async ({ companyInstallId, appId, query }) => withErrors(async () => {
      const resolvedCompanyInstallId = await resolveCompanyInstallId(companyInstallId);
      const companyRecord = await getFreshGhlTokenRecord(resolvedCompanyInstallId);
      if (companyRecord.userType !== "Company" || !companyRecord.companyId) {
        throw new Error("A Company/Agency OAuth installation is required to list installed locations.");
      }

      return {
        result: await (await clientFor(resolvedCompanyInstallId)).call({
          method: "GET",
          path: "/oauth/installedLocations",
          query: {
            skip: 0,
            limit: 100,
            isInstalled: true,
            ...query,
            companyId: companyRecord.companyId,
            appId: appId ?? getGhlAppId()
          },
          readOnly: true
        })
      };
    })
  );

  server.tool(
    "ghl_connect_location",
    "Create and store a Location token from an agency/company OAuth installation for one app-installed subaccount.",
    {
      companyInstallId: installIdSchema.describe("Company/Agency installation ID. Use ghl_list_installations to find a userType=Company install."),
      locationId: z.string().describe("Subaccount/location ID to connect. Use ghl_list_installed_locations to confirm the app is installed there.")
    },
    async ({ companyInstallId, locationId }) => withErrors(async () => ({
      installation: formatInstallationForOutput(await createGhlLocationToken(await resolveCompanyInstallId(companyInstallId), locationId))
    }))
  );

  server.tool(
    "ghl_get_contact",
    "Retrieve one GoHighLevel contact by contact ID.",
    {
      installId: installIdSchema,
      contactId: z.string().describe("GoHighLevel contact ID.")
    },
    async ({ installId, contactId }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
        method: "GET",
        path: `/contacts/${encodeURIComponent(contactId)}`
      })
    }))
  );

  server.tool(
    "ghl_search_contacts",
    "Search GoHighLevel contacts using the /contacts/search endpoint.",
    {
      installId: installIdSchema,
      body: z.record(jsonValueSchema).describe("Search request body. Include locationId and any HighLevel search filters.")
    },
    async ({ installId, body }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
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
      installId: installIdSchema,
      body: z.record(jsonValueSchema).describe("Create contact request body. Include locationId."),
      confirm: z.literal(true).describe("Must be true to create a contact.")
    },
    async ({ installId, body, confirm }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
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
      installId: installIdSchema,
      contactId: z.string().describe("GoHighLevel contact ID."),
      body: z.record(jsonValueSchema).describe("Contact fields to update."),
      confirm: z.literal(true).describe("Must be true to update a contact.")
    },
    async ({ installId, contactId, body, confirm }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
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
      installId: installIdSchema,
      body: z.record(jsonValueSchema).describe("Search request body. Include locationId/location_id as required by your API version.")
    },
    async ({ installId, body }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
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
      installId: installIdSchema,
      method: apiMethodSchema.describe("HTTP method."),
      path: z.string().describe("Relative API path, for example /contacts/search or /opportunities/search."),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.undefined()])).default({}),
      body: jsonValueSchema.optional().describe("JSON request body for non-GET calls."),
      apiVersion: z.string().default("2021-07-28").describe("HighLevel Version header."),
      confirm: z.boolean().default(false).describe("Required for POST, PUT, PATCH, and DELETE.")
    },
    async ({ installId, method, path, query, body, apiVersion, confirm }) => withErrors(async () => ({
      result: await (await clientFor(installId)).call({
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

async function resolveInstallId(defaultInstallId: string | undefined, providedInstallId: string | undefined) {
  if (providedInstallId) {
    return providedInstallId;
  }

  if (defaultInstallId) {
    return defaultInstallId;
  }

  const installations = await listGhlInstallations();
  if (installations.length === 1) {
    return installations[0]!.installId;
  }

  throw new Error(
    installations.length === 0
      ? "No GoHighLevel installations are connected yet. Open /api/connect/start and install at least one subaccount."
      : "Multiple GoHighLevel installations are connected. Call ghl_list_installations and pass the chosen installId."
  );
}

async function resolveCompanyInstallId(providedInstallId: string | undefined) {
  const installations = await listGhlInstallations();
  if (providedInstallId) {
    return providedInstallId;
  }

  const companyInstallations = installations.filter((installation) => installation.userType === "Company");
  if (companyInstallations.length === 1) {
    return companyInstallations[0]!.installId;
  }

  throw new Error(
    companyInstallations.length === 0
      ? "No Company/Agency OAuth installation is connected. Set GHL_OAUTH_USER_TYPE=Company and install with an agency admin."
      : "Multiple Company/Agency installations are connected. Pass companyInstallId from ghl_list_installations."
  );
}

function listInstallationsForOutput(
  installations: Array<{
    installId: string;
    expiresAt: number;
    scope?: string;
    userType?: string;
    companyId?: string;
    locationId?: string;
    userId?: string;
    createdAt: number;
    updatedAt: number;
  }>
) {
  return installations.map(formatInstallationForOutput);
}

function formatInstallationForOutput(installation: {
  installId: string;
  expiresAt: number;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    ...installation,
    expiresAt: new Date(installation.expiresAt).toISOString(),
    createdAt: new Date(installation.createdAt).toISOString(),
    updatedAt: new Date(installation.updatedAt).toISOString()
  };
}

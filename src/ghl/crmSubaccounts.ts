import { z } from "zod";
import { GhlClient } from "./client.js";
import { createGhlLocationToken, getGhlAppId } from "./oauth.js";
import type { GhlReadCall } from "./appointmentConversions.js";
import type { GhlInstallationSummary } from "./types.js";
import { GrippMcpError } from "../errors.js";
import { CrmPipelineLoadError } from "../crmPipelineErrors.js";

const id = z.string().trim().min(1).max(200);
const directoryResponse = z.object({ locations: z.array(z.object({
  id, name: z.string().trim(), companyId: id.optional()
})) });
export type AgencyCrmSubaccount = { id: string; name: string; companyInstallId: string; companyId: string };
export const readGhl: GhlReadCall = (input) => new GhlClient(input.installId).call({
  method: "GET", path: input.path, query: input.query, apiVersion: input.apiVersion, readOnly: true
});

export async function listAgencyCrmSubaccounts(installation: GhlInstallationSummary, call: GhlReadCall = readGhl) {
  if (installation.userType !== "Company" || !installation.companyId) throw new Error("Agency connection required");
  const accounts = new Map<string, AgencyCrmSubaccount>();
  for (let page = 0; page < 100; page++) {
    const { locations } = directoryResponse.parse(await call({
      installId: installation.installId, path: "/locations/search", apiVersion: "v3",
      query: { companyId: installation.companyId, skip: page * 100, limit: 100, order: "asc" }
    }));
    for (const location of locations) {
      if (location.companyId && location.companyId !== installation.companyId) throw new Error("Unexpected agency");
      if (accounts.has(location.id)) throw new Error("Repeated CRM directory page");
      accounts.set(location.id, { id: location.id, name: location.name,
        companyInstallId: installation.installId, companyId: installation.companyId });
    }
    if (locations.length < 100) return [...accounts.values()];
  }
  throw new Error("CRM directory pagination limit reached");
}

export async function connectAgencyCrmSubaccount(connection: {
  locationId: string; installId?: string; companyInstallId?: string; companyId?: string;
}, options: {
  call?: GhlReadCall; appId?: string;
  connectLocation?: (companyInstallId: string, locationId: string) => Promise<{ installId: string; locationId?: string }>;
} = {}) {
  if (!connection.companyInstallId || !connection.companyId) throw new Error("Agency connection required");
  try {
    const pageTokens = new Set<string>();
    let pageToken: string | undefined;
    let installed = false;
    for (let page = 0; page < 100; page++) {
      const response = z.object({ items: z.array(z.object({ _id: id, isInstalled: z.boolean() })),
        pagination: z.object({ hasNextPage: z.boolean().optional(), nextPageToken: z.string().nullish() }).optional()
      }).parse(await (options.call ?? readGhl)({
        installId: connection.companyInstallId, path: "/oauth/installed-locations", apiVersion: "v3",
        query: { companyId: connection.companyId, appId: options.appId ?? getGhlAppId(), locationId: connection.locationId,
          isInstalled: true, restrictToUserLocations: true, pageSize: 100, ...(pageToken ? { pageToken } : {}) }
      }));
      if (response.items.some((item) => item._id === connection.locationId && item.isInstalled)) { installed = true; break; }
      const next = response.pagination?.nextPageToken;
      if (response.pagination?.hasNextPage === false || (!response.pagination?.hasNextPage && !next)) break;
      if (!next || pageTokens.has(next) || page === 99) throw new Error("Incomplete CRM installation pagination");
      pageTokens.add(next); pageToken = next;
    }
    if (!installed) {
      throw new GrippMcpError("crm_app_not_installed", "App is not authorized for this CRM subaccount");
    }
  } catch (error) { throw new CrmPipelineLoadError("installation_check", error); }
  try {
    const record = await (options.connectLocation ?? createGhlLocationToken)(connection.companyInstallId, connection.locationId);
    if (record.locationId !== connection.locationId || record.installId !== connection.installId) throw new Error("Unexpected CRM installation");
    return { ...connection, installId: record.installId };
  } catch (error) { throw new CrmPipelineLoadError("location_connection", error); }
}

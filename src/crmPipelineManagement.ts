import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import { normalizeProjectPath } from "./projectPageGroups.js";
import { getJsonCacheMode, readJsonCache, writeJsonCache } from "./jsonCache.js";
import { listGhlInstallations } from "./ghl/tokenStore.js";
import { listGhlPipelines, type GhlReadCall } from "./ghl/appointmentConversions.js";
import { GhlClient } from "./ghl/client.js";
import type { GhlInstallationSummary } from "./ghl/types.js";
import type { CampaignSiteMapping } from "./campaignPerformance.js";

export const CRM_PIPELINE_MATCHES_KEY = "data-management:crm-pipeline-projects:v1";
const id = z.string().trim().min(1).max(200);
const projectPath = z.string().trim().min(1).max(1000)
  .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !isExcludedAnalyticsLink(path))
  .transform(normalizeProjectPath)
  .refine((path) => !/bedankt|thankyou|thank[\s_-]*you/i.test(decodeURIComponent(path)));
const matchSchema = z.object({
  siteId: id, sourcePath: projectPath, locationId: id, installId: id.optional(), pipelineId: id,
  pipelineName: z.string().max(1000)
}).strict();
export type CrmPipelineMatch = z.infer<typeof matchSchema>;
export type CrmConnection = { locationId: string; installId?: string; label: string };
export type CrmPipelineOption = { id: string; name: string };
type Store = { read<T>(key: string): Promise<T | null>; write(key: string, value: unknown): Promise<void> };
const defaultStore: Store = { read: readJsonCache, write: writeJsonCache };

export function parseCrmPipelineMatches(raw: unknown): CrmPipelineMatch[] {
  const matches = z.array(matchSchema).parse(raw ?? []);
  if (new Set(matches.map((match) => JSON.stringify([match.locationId, match.pipelineId]))).size !== matches.length) {
    throw new Error("A CRM pipeline can only map to one project");
  }
  return matches;
}

export async function readCrmPipelineMatches(store: Store = defaultStore) {
  return (await readRegistry(store)).matches;
}

export async function getCrmPipelineRevision(store: Store = defaultStore) {
  const registry = await readRegistry(store);
  return registry.revision ?? createHash("sha256").update(JSON.stringify(registry.matches)).digest("hex").slice(0, 16);
}

async function readRegistry(store: Store) {
  const raw = await store.read<unknown>(CRM_PIPELINE_MATCHES_KEY);
  if (raw === null || Array.isArray(raw)) return { matches: parseCrmPipelineMatches(raw), revision: undefined };
  const registry = z.object({ matches: z.unknown(), revision: z.string().uuid() }).strict().parse(raw);
  return { matches: parseCrmPipelineMatches(registry.matches), revision: registry.revision };
}

export async function listCrmConnections(options: {
  mappings?: CampaignSiteMapping[]; installations?: GhlInstallationSummary[]; resolveNames?: boolean; call?: GhlReadCall;
} = {}) {
  const installations = options.installations ?? await listGhlInstallations();
  const connections = new Map<string, CrmConnection>();
  for (const installation of installations) {
    if (!installation.locationId) continue;
    const connection = { locationId: installation.locationId, installId: installation.installId,
      label: `CRM-subaccount ${installation.locationId}` };
    connections.set(JSON.stringify([connection.locationId, connection.installId]), connection);
  }
  for (const mapping of options.mappings ?? []) {
    if (!mapping.ghl) continue;
    const config = mapping.ghl;
    const candidates = installations.filter((installation) => installation.locationId === config.locationId);
    const installId = config.installId ?? (candidates.length === 1 ? candidates[0].installId : undefined);
    const connection = { locationId: config.locationId, installId, label: `CRM-subaccount ${config.locationId} · ${mapping.siteId}` };
    connections.set(JSON.stringify([connection.locationId, connection.installId]), connection);
  }
  const result = [...connections.values()];
  if (options.resolveNames === false) return result;
  // Limit parallel lookups; one failed name must not hide the other accounts.
  for (let offset = 0; offset < result.length; offset += 4) {
    await Promise.all(result.slice(offset, offset + 4).map(async (connection) => {
      if (!connection.installId) return;
      try {
        const read: GhlReadCall = options.call ?? ((input) => new GhlClient(input.installId).call({
          method: "GET", path: input.path, apiVersion: input.apiVersion, readOnly: true
        }));
        const response = z.object({ location: z.object({ id, name: z.string().trim().min(1) }) }).parse(await read({
          installId: connection.installId, path: `/locations/${encodeURIComponent(connection.locationId)}`, apiVersion: "v3"
        }));
        if (response.location.id !== connection.locationId) throw new Error("Unexpected CRM subaccount");
        connection.label = response.location.name;
      } catch { /* Keep the account selectable when its name is unavailable. */ }
    }));
  }
  return result.sort((left, right) => left.label.localeCompare(right.label, "nl-BE"));
}

export async function loadCrmPipelines(input: { locationId: string; installId?: string }, options: {
  connections: CrmConnection[]; call?: GhlReadCall;
}) {
  const connection = requireConnection(input, options.connections);
  const pipelines = await listGhlPipelines(connection, options.call);
  return pipelines.map(({ id, name }) => ({ id, name })) satisfies CrmPipelineOption[];
}

export async function saveCrmPipelineMatches(input: unknown, options: {
  connections: CrmConnection[]; call?: GhlReadCall; store?: Store; pages?: { siteId: string; path: string }[];
}) {
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const selection = z.object({ siteId: id, sourcePath: projectPath, locationId: id, installId: id.optional(),
    pipelineIds: z.array(id).min(1).max(100).transform((ids) => [...new Set(ids)]) }).strict().parse(input);
  const pages = options.pages ?? (await import("./projectPageManagement.js").then((module) => module.getProjectPageManagementData())).pages;
  if (!pages.some((page) => page.siteId === selection.siteId && normalizeProjectPath(page.path) === selection.sourcePath)) {
    throw new Error("Unknown project page");
  }
  const pipelines = await loadCrmPipelines(selection, options);
  if (selection.pipelineIds.some((pipelineId) => !pipelines.some((pipeline) => pipeline.id === pipelineId))) {
    throw new Error("Unknown CRM pipeline");
  }
  const store = options.store ?? defaultStore;
  const current = await readCrmPipelineMatches(store);
  const selectedIds = new Set(selection.pipelineIds);
  const next = current.filter((match) => match.locationId !== selection.locationId || !selectedIds.has(match.pipelineId));
  const matches: CrmPipelineMatch[] = selection.pipelineIds.map((pipelineId) => ({
    siteId: selection.siteId, sourcePath: selection.sourcePath, locationId: selection.locationId,
    installId: selection.installId, pipelineId, pipelineName: pipelines.find((pipeline) => pipeline.id === pipelineId)!.name
  }));
  next.push(...matches);
  await store.write(CRM_PIPELINE_MATCHES_KEY, { matches: parseCrmPipelineMatches(next), revision: randomUUID() });
  return matches;
}

export async function deleteCrmPipelineMatch(locationIdInput: string, pipelineIdInput: string, store?: Store) {
  if (!store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const locationId = id.parse(locationIdInput), pipelineId = id.parse(pipelineIdInput);
  const target = store ?? defaultStore;
  const current = await readCrmPipelineMatches(target);
  await target.write(CRM_PIPELINE_MATCHES_KEY, {
    matches: current.filter((match) => match.locationId !== locationId || match.pipelineId !== pipelineId), revision: randomUUID()
  });
}

function requireConnection(input: { locationId: string; installId?: string }, connections: CrmConnection[]) {
  const locationId = id.parse(input.locationId), installId = id.optional().parse(input.installId);
  const connection = connections.find((item) => item.locationId === locationId && item.installId === installId);
  if (!connection) throw new Error("Unknown CRM connection");
  return connection;
}

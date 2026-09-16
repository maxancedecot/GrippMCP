import { z } from "zod";
import { GrippClient } from "./grippClient.js";
import { getJsonCacheMode, readJsonCache, readJsonCaches, writeJsonCache } from "./jsonCache.js";
import type { JsonValue } from "./types.js";

const identifier = z.number().int().positive();
const managerSchema = z.object({ id: identifier, name: z.string(), active: z.boolean() });
const projectSchema = z.object({ id: identifier, name: z.string(), clientId: identifier.nullable(), archived: z.boolean(), accountManagerId: identifier.nullable().default(null) });
const clientSchema = z.object({ id: identifier, name: z.string(), active: z.boolean(), accountManagerId: identifier.nullable(), website: z.string().default("") });
const catalogSchema = z.object({ clients: z.array(clientSchema), managers: z.array(managerSchema), projects: z.array(projectSchema), fetchedAt: z.string().datetime() });
const assignmentSchema = z.object({ clientId: identifier, managerId: identifier.nullable(), updatedAt: z.string().datetime() }).strict();
const CATALOG_KEY = "data-management:catalog:v2";
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const CATALOG_TTL = 5 * 60_000;
type RecordData = Record<string, unknown>;
type Catalog = z.infer<typeof catalogSchema>;
export type GrippDataCatalog = Catalog;
export type AccountManager = z.infer<typeof managerSchema>;
export type ClientAssignment = z.infer<typeof assignmentSchema>;
export type ManagedClient = z.infer<typeof clientSchema> & {
  projects: z.infer<typeof projectSchema>[];
  assignmentSource: "dashboard" | "gripp";
  updatedAt: string | null;
};
export type DataManagementData = {
  clients: ManagedClient[]; managers: AccountManager[]; unlinkedProjects: number;
  fetchedAt: string | null; canSave: boolean; error: string;
};
type Store = {
  read: typeof readJsonCache; readMany: typeof readJsonCaches; write: typeof writeJsonCache;
};
export type DataManagementOptions = {
  client?: Pick<GrippClient, "call">; store?: Store; now?: Date; force?: boolean; env?: Record<string, string | undefined>;
};
type Options = DataManagementOptions;
const defaultStore: Store = { read: readJsonCache, readMany: readJsonCaches, write: writeJsonCache };
export const clientAssignmentKey = (clientId: number) => `data-management:client-account-manager:v1:${identifier.parse(clientId)}`;

export async function getDataManagementData(options: Options = {}): Promise<DataManagementData> {
  try {
    const catalog = await loadCatalog(options);
    const store = options.store ?? defaultStore;
    const raw = await store.readMany<unknown>(catalog.clients.map((client) => clientAssignmentKey(client.id)));
    const clients = catalog.clients.map((client, index): ManagedClient => {
      const assignment = raw[index] === null ? null : assignmentSchema.parse(raw[index]);
      if (assignment && assignment.clientId !== client.id) throw new Error("Invalid assignment scope");
      return { ...client, accountManagerId: assignment ? assignment.managerId : client.accountManagerId,
        assignmentSource: assignment ? "dashboard" : "gripp", updatedAt: assignment?.updatedAt ?? null,
        projects: catalog.projects.filter((project) => project.clientId === client.id) };
    });
    const persistent = !!options.store || getJsonCacheMode() !== "memory";
    return { clients, managers: catalog.managers, fetchedAt: catalog.fetchedAt,
      unlinkedProjects: catalog.projects.filter((project) => project.clientId === null || !clients.some((client) => client.id === project.clientId)).length,
      canSave: persistent, error: persistent ? "" : "De opslag is niet beschikbaar. Koppelingen kunnen nog niet worden bewaard." };
  } catch {
    return { clients: [], managers: [], unlinkedProjects: 0, fetchedAt: null, canSave: false,
      error: "Klanten, projecten of accountmanagers konden niet worden geladen. Probeer opnieuw." };
  }
}

export async function saveClientAccountManager(input: unknown, options: Options = {}): Promise<ClientAssignment> {
  const { clientId, managerId } = z.object({ clientId: identifier, managerId: identifier.nullable() }).strict().parse(input);
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const catalog = await loadCatalog(options);
  if (!catalog.clients.some((client) => client.id === clientId)) throw new Error("Unknown client");
  if (managerId !== null && !catalog.managers.some((manager) => manager.id === managerId && manager.active)) throw new Error("Unknown or inactive manager");
  const assignment: ClientAssignment = { clientId, managerId, updatedAt: (options.now ?? new Date()).toISOString() };
  // Separate keys prevent simultaneous changes to different clients from overwriting one another.
  await (options.store ?? defaultStore).write(clientAssignmentKey(clientId), assignment);
  return assignment;
}

async function loadCatalog(options: Options): Promise<Catalog> {
  const store = options.store ?? defaultStore;
  const now = options.now ?? new Date();
  if (!options.force) {
    const cached = catalogSchema.safeParse(await store.read(CATALOG_KEY));
    if (cached.success) {
      const age = now.getTime() - Date.parse(cached.data.fetchedAt);
      if (age >= 0 && age < CATALOG_TTL) return cached.data;
    }
  }
  const env = options.env ?? process.env;
  const token = env.GRIPP_DASHBOARD_API_TOKEN?.trim();
  if (!options.client && !token) throw new Error("Missing Gripp connection");
  const client = options.client ?? new GrippClient({ token, timeoutMs: 12_000, maxRetries: 1 });
  const [companies, employees, projectRecords] = await Promise.all([
    fetchRecords(client, "company"), fetchRecords(client, "employee"), fetchRecords(client, "project")
  ]);
  const projects = projectRecords.map((record) => ({
    id: requiredId(field(record, "id")), name: displayName(record, "Project"),
    clientId: recordId(field(record, "company") ?? field(record, "company.id")), archived: isTrue(field(record, "archived")),
    accountManagerId: recordId(field(record, "accountmanager") ?? field(record, "accountmanager.id"))
  })).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "nl-BE"));
  const projectClientIds = new Set(projects.map((project) => project.clientId));
  const clients = companies.filter((record) => projectClientIds.has(requiredId(field(record, "id"))) || hasCustomerRole(field(record, "companyroles")))
    .map((record) => ({ id: requiredId(field(record, "id")), name: displayName(record, "Klant"), active: !isFalse(field(record, "active")),
      accountManagerId: recordId(field(record, "accountmanager") ?? field(record, "accountmanager.id")), website: text(field(record, "website")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "nl-BE"));
  const managers = employees.map((record) => ({ id: requiredId(field(record, "id")), name: displayName(record, "Medewerker"), active: !isFalse(field(record, "active")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "nl-BE"));
  const catalog = catalogSchema.parse({ clients, managers, projects, fetchedAt: now.toISOString() });
  // Cache only identifiers, names and relations; never raw Gripp records or personal details.
  await store.write(CATALOG_KEY, catalog);
  return catalog;
}

export async function getGrippDataCatalog(options: DataManagementOptions = {}): Promise<GrippDataCatalog> {
  return loadCatalog(options);
}

async function fetchRecords(client: Pick<GrippClient, "call">, entity: "company" | "employee" | "project") {
  const all: RecordData[] = [];
  const ids = new Set<number>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.call(`${entity}.get`, [[], {
      paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE }, orderings: [{ field: `${entity}.id`, direction: "asc" }]
    }] as JsonValue[]);
    const records = recordsFrom(result).map((record) => {
      const normalized = { ...record };
      for (const [key, value] of Object.entries(record)) if (key.startsWith(`${entity}.`)) normalized[key.slice(entity.length + 1)] = value;
      return normalized;
    });
    for (const record of records) {
      const id = requiredId(field(record, "id"));
      if (ids.has(id)) throw new Error("Incomplete Gripp pagination");
      ids.add(id); all.push(record);
    }
    if (records.length < PAGE_SIZE) return all;
  }
  throw new Error("Gripp pagination limit");
}

function asRecord(value: unknown): RecordData | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordData : null;
}
function recordsFrom(value: unknown): RecordData[] {
  if (Array.isArray(value)) return value.map((item) => { const record = asRecord(item); if (!record) throw new Error("Invalid Gripp record"); return record; });
  const record = asRecord(value);
  if (record) {
    for (const key of ["result", "data", "rows", "records", "items", "entities"]) if (key in record) return recordsFrom(record[key]);
    if (["id", "company.id", "employee.id", "project.id"].some((key) => record[key] !== undefined)) return [record];
  }
  throw new Error("Invalid Gripp response");
}
function field(record: RecordData, name: string): unknown {
  return record[name];
}
function scalar(value: unknown): unknown {
  const record = asRecord(value);
  return record ? scalar(record.value ?? record.id ?? record.displayvalue ?? null) : value;
}
function recordId(value: unknown): number | null {
  const raw = scalar(value);
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function requiredId(value: unknown): number {
  const id = recordId(value); if (id === null) throw new Error("Missing record ID"); return id;
}
function text(value: unknown) { const raw = scalar(value); return typeof raw === "string" ? raw.trim() : ""; }
function displayName(record: RecordData, fallback: string) {
  for (const key of ["companyname", "name", "screenname"]) { const name = text(field(record, key)); if (name) return name; }
  return ["firstname", "infix", "lastname"].map((key) => text(field(record, key))).filter(Boolean).join(" ") || `${fallback} ${requiredId(field(record, "id"))}`;
}
function isFalse(value: unknown) { const raw = scalar(value); return raw === false || raw === 0 || raw === "0" || raw === "false"; }
function isTrue(value: unknown) { const raw = scalar(value); return raw === true || raw === 1 || raw === "1" || raw === "true"; }
function hasCustomerRole(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCustomerRole);
  const record = asRecord(value);
  if (record) return Object.values(record).some(hasCustomerRole);
  return typeof value === "string" && value.toUpperCase().split(/[^A-Z]+/).includes("CUSTOMER");
}

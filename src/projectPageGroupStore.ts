import { createHash } from "node:crypto";
import { z } from "zod";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import { normalizeProjectPath, projectPageGroupsForSite, type ProjectPageGroup } from "./projectPageGroups.js";

const STORE_KEY = "data-management:project-page-groups:v1";
const localPath = z.string().trim().min(1).max(1000)
  .refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), "Use a local project path")
  .transform(normalizeProjectPath);
const savedGroupSchema = z.object({
  id: z.string().min(1).max(80),
  siteId: z.string().min(1).max(200),
  title: z.string().min(1).max(180),
  sourcePath: localPath,
  sourcePaths: z.array(localPath).min(2).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();
const registrySchema = z.object({ version: z.literal(1), groups: z.array(savedGroupSchema), updatedAt: z.string().datetime().optional() });
const inputSchema = z.object({
  siteId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(180),
  sourcePath: localPath,
  sourcePaths: z.array(localPath).min(2).max(20).transform((paths) => [...new Set(paths)])
}).strict().refine((group) => group.sourcePaths.includes(group.sourcePath), "Primary page must belong to the group");

type Store = { read<T>(key: string): Promise<T | null>; write(key: string, value: unknown): Promise<void> };
const defaultStore: Store = { read: readJsonCache, write: writeJsonCache };
export type SavedProjectPageGroup = z.infer<typeof savedGroupSchema>;
export type ResolvedProjectPageGroup = ProjectPageGroup & {
  id: string;
  siteId: string;
  managed: boolean;
  createdAt?: string;
  updatedAt?: string;
};
type Site = { id: string; url: string };
type Page = { siteId: string; path: string; title?: string };

export async function getProjectPageGroupsForSites(sites: Site[], options: { store?: Store } = {}): Promise<ResolvedProjectPageGroup[]> {
  const stored = await readRegistry(options.store ?? defaultStore);
  const siteIds = new Set(sites.map((site) => site.id));
  const presets = sites.flatMap((site) => projectPageGroupsForSite(site.url).map((group) => ({
    ...group,
    id: `preset:${createHash("sha256").update(`${site.id}:${group.sourcePath}`).digest("hex").slice(0, 20)}`,
    siteId: site.id,
    managed: false
  })));
  return [...presets, ...stored.groups.filter((group) => siteIds.has(group.siteId)).map((group) => ({ ...group, managed: true }))];
}

export async function saveProjectPageGroup(payload: unknown, options: {
  sites: Site[];
  pages: Page[];
  now?: Date;
  store?: Store;
}): Promise<ResolvedProjectPageGroup> {
  const input = inputSchema.parse(payload);
  const site = options.sites.find((item) => item.id === input.siteId);
  if (!site) throw new Error("Unknown project site");
  if (input.sourcePaths.length < 2 || input.sourcePaths.some((path) => isExcludedAnalyticsLink(path) || isThankYouPath(path))) {
    throw new Error("Project groups require at least two regular project pages");
  }
  const available = new Set(options.pages.filter((page) => page.siteId === input.siteId).map((page) => normalizeProjectPath(page.path)));
  if (input.sourcePaths.some((path) => !available.has(path))) throw new Error("Unknown project page");

  const store = options.store ?? defaultStore;
  const registry = await readRegistry(store);
  const existing = await getProjectPageGroupsForSites(options.sites, { store });
  if (existing.some((group) => group.siteId === input.siteId && group.sourcePaths.some((path) => input.sourcePaths.includes(path)))) {
    throw new Error("A project page can belong to only one group");
  }
  const now = (options.now ?? new Date()).toISOString();
  const group = savedGroupSchema.parse({
    ...input,
    id: createHash("sha256").update(`${input.siteId}:${[...input.sourcePaths].sort().join("|")}`).digest("hex").slice(0, 32),
    createdAt: now,
    updatedAt: now
  });
  registry.groups.push(group);
  registry.updatedAt = now;
  await store.write(STORE_KEY, registry);
  return { ...group, managed: true };
}

export async function deleteProjectPageGroup(groupId: string, options: { now?: Date; store?: Store } = {}): Promise<boolean> {
  const id = z.string().min(1).max(80).parse(groupId);
  const store = options.store ?? defaultStore;
  const registry = await readRegistry(store);
  const index = registry.groups.findIndex((group) => group.id === id);
  if (index < 0) return false;
  registry.groups.splice(index, 1);
  registry.updatedAt = (options.now ?? new Date()).toISOString();
  await store.write(STORE_KEY, registry);
  return true;
}

export async function getProjectPageGroupRevision(options: { store?: Store } = {}) {
  return (await readRegistry(options.store ?? defaultStore)).updatedAt ?? "0";
}

async function readRegistry(store: Store) {
  const parsed = registrySchema.safeParse(await store.read<unknown>(STORE_KEY));
  return parsed.success ? parsed.data : { version: 1 as const, groups: [] as SavedProjectPageGroup[] };
}

function isThankYouPath(path: string) {
  const normalized = path.toLowerCase();
  const spaced = normalized.replace(/%20|[_-]+/g, " ");
  return normalized.includes("thankyou") || spaced.includes("thank you") || normalized.includes("bedankt");
}

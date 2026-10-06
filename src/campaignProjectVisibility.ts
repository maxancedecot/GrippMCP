import { createHash } from "node:crypto";
import { z } from "zod";
import { deleteJsonCache, getJsonCacheMode, readJsonCaches, writeJsonCache } from "./jsonCache.js";
import { normalizeProjectPath } from "./projectPageGroups.js";
import { projectPageKey } from "./projectPageManagement.js";

type Project = { siteId: string; sourcePath: string };
const inputSchema = z.object({
  siteId: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(1000)
    .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"), "Use a local project path")
    .transform(normalizeProjectPath)
}).strict();
const recordSchema = inputSchema.extend({ hiddenAt: z.string().datetime() }).strict();
type Store = {
  readMany<T>(keys: string[]): Promise<(T | null)[]>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};
const defaultStore: Store = { readMany: readJsonCaches, write: writeJsonCache, delete: deleteJsonCache };
export type CampaignProjectVisibility = { hiddenKeys: Set<string>; canSave: boolean; error: string };
const cacheKey = (page: z.infer<typeof inputSchema>) =>
  `campaign-project-hidden:v1:${createHash("sha256").update(JSON.stringify([page.siteId, page.path])).digest("hex")}`;

export async function readCampaignProjectVisibility(projects: Project[], options: { store?: Store } = {}): Promise<CampaignProjectVisibility> {
  const canSave = !!options.store || getJsonCacheMode() !== "memory";
  try {
    const pages = [...new Map(projects.map((project) => {
      const page = inputSchema.parse({ siteId: project.siteId, path: project.sourcePath });
      return [projectPageKey(page), page] as const;
    })).values()];
    const records = await (options.store ?? defaultStore).readMany<unknown>(pages.map(cacheKey));
    if (records.length !== pages.length) throw new Error("Incomplete visibility response");
    const hiddenKeys = new Set<string>();
    for (let index = 0; index < records.length; index++) {
      if (records[index] === null) continue;
      const record = recordSchema.parse(records[index]);
      if (projectPageKey(record) !== projectPageKey(pages[index]!)) throw new Error("Invalid visibility scope");
      hiddenKeys.add(projectPageKey(record));
    }
    return { hiddenKeys, canSave, error: canSave ? "" : "Rijen kunnen momenteel niet worden verwijderd: permanente opslag is niet beschikbaar." };
  } catch {
    // Keep saved deletions from reappearing when storage cannot be checked.
    return { hiddenKeys: new Set(projects.map((project) => projectPageKey({ siteId: project.siteId, path: project.sourcePath }))), canSave: false,
      error: "De opgeslagen rijselectie kon niet worden geladen. Probeer opnieuw; de projecttabel is tijdelijk verborgen." };
  }
}

export async function setCampaignProjectHidden(input: unknown, hidden: boolean, options: { store?: Store; now?: Date } = {}): Promise<void> {
  const page = inputSchema.parse(input);
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage unavailable");
  const store = options.store ?? defaultStore;
  if (hidden) await store.write(cacheKey(page), { ...page, hiddenAt: (options.now ?? new Date()).toISOString() });
  else await store.delete(cacheKey(page));
}

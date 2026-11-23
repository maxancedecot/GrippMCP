import { createHash } from "node:crypto";
import { z } from "zod";
import { getJsonCacheMode, readJsonCaches, writeJsonCache } from "./jsonCache.js";
import { normalizeProjectPath } from "./projectPageGroups.js";
import { projectPageKey } from "./projectPageManagement.js";

type Project = { siteId: string; sourcePath: string; title: string };
const pageSchema = z.object({
  siteId: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(1000)
    .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"), "Use a local project path")
    .transform(normalizeProjectPath)
}).strict();
const titleSchema = z.string().trim().min(1).max(180).refine((title) => !/[\u0000-\u001f\u007f]/.test(title), "Use a single line title");
const inputSchema = pageSchema.extend({ title: titleSchema });
const recordSchema = inputSchema.extend({ updatedAt: z.string().datetime() });
type Store = { readMany<T>(keys: string[]): Promise<(T | null)[]>; write(key: string, value: unknown): Promise<void> };
const defaultStore: Store = { readMany: readJsonCaches, write: writeJsonCache };
export type CampaignProjectTitles = { names: Map<string, string>; canSave: boolean; error: string };
const cacheKey = (page: z.infer<typeof pageSchema>) =>
  `campaign-project-title:v1:${createHash("sha256").update(JSON.stringify([page.siteId, page.path])).digest("hex")}`;

export async function readCampaignProjectTitles(projects: Project[], options: { store?: Store } = {}): Promise<CampaignProjectTitles> {
  const canSave = !!options.store || getJsonCacheMode() !== "memory";
  try {
    const pages = [...new Map(projects.map((project) => {
      const page = pageSchema.parse({ siteId: project.siteId, path: project.sourcePath });
      return [projectPageKey(page), page] as const;
    })).values()];
    const records = await (options.store ?? defaultStore).readMany<unknown>(pages.map(cacheKey));
    if (records.length !== pages.length) throw new Error("Incomplete project titles response");
    const names = new Map<string, string>();
    for (let index = 0; index < records.length; index++) {
      if (records[index] === null) continue;
      const record = recordSchema.parse(records[index]);
      if (projectPageKey(record) !== projectPageKey(pages[index]!)) throw new Error("Invalid project title scope");
      names.set(projectPageKey(record), record.title);
    }
    return { names, canSave, error: canSave ? "" : "Projectnamen kunnen momenteel niet worden bewaard: permanente opslag is niet beschikbaar." };
  } catch {
    return { names: new Map(), canSave: false, error: "De opgeslagen projectnamen konden niet worden geladen. Probeer opnieuw." };
  }
}

export async function saveCampaignProjectTitle(input: unknown, options: { store?: Store; now?: Date } = {}): Promise<string> {
  const page = inputSchema.parse(input);
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage unavailable");
  await (options.store ?? defaultStore).write(cacheKey(page), { ...page, updatedAt: (options.now ?? new Date()).toISOString() });
  return page.title;
}

export function applyCampaignProjectTitles<T extends Project>(projects: T[], titles?: CampaignProjectTitles): T[] {
  return projects.map((project) => {
    const title = titles?.names.get(projectPageKey({ siteId: project.siteId, path: project.sourcePath }));
    return title ? { ...project, title } : project;
  });
}

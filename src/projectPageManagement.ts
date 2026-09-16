import { createHash } from "node:crypto";
import { z } from "zod";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import { projectPageGroup } from "./projectPageGroups.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, META_DISCOVERED_PROJECT_MATCHES_KEY, normalizeProjectPath, parseCampaignProjectMatches } from "./campaignProjects.js";
import { getGrippDataCatalog, type AccountManager, type DataManagementOptions, type GrippDataCatalog } from "./dataManagement.js";
import { getJsonCacheMode, readJsonCache, readJsonCaches, writeJsonCache } from "./jsonCache.js";
import { getSiteAnalyticsDashboardData, type SiteAnalyticsDashboardData } from "./siteAnalytics.js";

const localPath = z.string().min(1).max(1000).refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !isExcludedAnalyticsLink(value)).transform(normalizeProjectPath);
const pageSchema = z.object({ siteId: z.string().min(1).max(200), siteName: z.string(), path: localPath, title: z.string(), url: z.string().url() });
const assignmentSchema = z.object({ siteId: pageSchema.shape.siteId, path: localPath, managerId: z.number().int().positive().nullable(), updatedAt: z.string().datetime() }).strict();
const inventorySchema = z.object({ pages: z.array(pageSchema), fetchedAt: z.string().datetime() });
const INVENTORY_KEY = "data-management:project-pages:v2";
export type ProjectPage = z.infer<typeof pageSchema>;
export type ManagedProjectPage = ProjectPage & {
  key: string; accountManagerId: number | null; accountManagerName: string | null;
  clientName: string | null; grippProjectName: string | null;
  source: "gripp" | "manual" | "unmatched"; reason: string; needsAssignment: boolean;
};
export type ProjectPageManagementData = {
  pages: ManagedProjectPage[]; managers: AccountManager[]; fetchedAt: string | null; canSave: boolean; error: string;
};
type Options = DataManagementOptions & { pages?: ProjectPage[]; catalog?: GrippDataCatalog };
const defaultStore = { read: readJsonCache, readMany: readJsonCaches, write: writeJsonCache };

export function projectPageKey(page: Pick<ProjectPage, "siteId" | "path">) { return `${page.siteId}:${normalizeProjectPath(page.path)}`; }
export function pageAssignmentKey(page: Pick<ProjectPage, "siteId" | "path">) {
  return `data-management:page-account-manager:v1:${createHash("sha256").update(projectPageKey(page)).digest("hex")}`;
}

export async function getProjectPageManagementData(options: Options = {}): Promise<ProjectPageManagementData> {
  try {
    const [catalog, pages] = await Promise.all([options.catalog ?? getGrippDataCatalog(options), options.pages ?? loadProjectPages(options)]);
    const raw = await (options.store ?? defaultStore).readMany<unknown>(pages.map(pageAssignmentKey));
    const resolved = pages.map((page, index) => {
      const assignment = raw[index] === null ? null : assignmentSchema.parse(raw[index]);
      if (assignment && projectPageKey(assignment) !== projectPageKey(page)) throw new Error("Invalid page assignment scope");
      return resolveProjectPage(page, catalog, assignment?.managerId ?? null);
    });
    const canSave = !!options.store || getJsonCacheMode() !== "memory";
    return { pages: resolved, managers: catalog.managers, fetchedAt: catalog.fetchedAt, canSave,
      error: canSave ? "" : "De opslag is niet beschikbaar. Toewijzingen kunnen nog niet worden bewaard." };
  } catch {
    return { pages: [], managers: [], fetchedAt: null, canSave: false,
      error: "Projectpagina’s of Gripp-koppelingen konden niet worden geladen. Probeer opnieuw." };
  }
}

export async function saveProjectPageManager(input: unknown, options: Options = {}): Promise<ManagedProjectPage> {
  const { siteId, path, managerId } = assignmentSchema.omit({ updatedAt: true }).parse(input);
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const [catalog, pages] = await Promise.all([options.catalog ?? getGrippDataCatalog(options), options.pages ?? loadProjectPages(options)]);
  const page = pages.find((page) => projectPageKey(page) === projectPageKey({ siteId, path }));
  if (!page || isExcludedAnalyticsLink(page.url)) throw new Error("Unknown project page");
  if (managerId !== null && !catalog.managers.some((manager) => manager.id === managerId && manager.active)) throw new Error("Unknown or inactive manager");
  await (options.store ?? defaultStore).write(pageAssignmentKey(page), { siteId, path, managerId, updatedAt: (options.now ?? new Date()).toISOString() });
  return resolveProjectPage(page, catalog, managerId);
}

async function loadProjectPages(options: Options): Promise<ProjectPage[]> {
  const store = options.store ?? defaultStore;
  const now = options.now ?? new Date();
  if (!options.force) {
    const cached = inventorySchema.safeParse(await store.read(INVENTORY_KEY));
    if (cached.success && now.getTime() - Date.parse(cached.data.fetchedAt) >= 0 && now.getTime() - Date.parse(cached.data.fetchedAt) < 300_000) return cached.data.pages;
  }
  const dashboard = await getSiteAnalyticsDashboardData({ days: 90, now });
  if (dashboard.source.mode !== "live") throw new Error("No connected project pages");
  const [saved, discovered] = await store.readMany<unknown>([CAMPAIGN_PROJECT_MATCHES_KEY, META_DISCOVERED_PROJECT_MATCHES_KEY]);
  const matches = [...parseCampaignProjectMatches(saved), ...parseCampaignProjectMatches(discovered)];
  const pages = projectPagesFromDashboard(dashboard, matches.flatMap((match) => match.sourcePaths.map((path) => ({ siteId: match.siteId, path }))));
  await store.write(INVENTORY_KEY, { pages, fetchedAt: now.toISOString() });
  return pages;
}

export function projectPagesFromDashboard(dashboard: SiteAnalyticsDashboardData, savedPages: { siteId: string; path: string }[] = []): ProjectPage[] {
  const pages = new Map<string, ProjectPage>();
  const add = (siteId: string, path: string, title = "", explicit = false) => {
    const site = dashboard.sites.find((site) => site.id === siteId);
    if (!site || isExcludedAnalyticsLink(site.url) || isExcludedAnalyticsLink(path)) return;
    if (!explicit && isUtilityPage(path)) return;
    const group = projectPageGroup(site.url, path);
    const normalized = group?.sourcePath ?? normalizeProjectPath(path);
    const page = { siteId, siteName: site.name, path: normalized, title: group?.title || title || (normalized === "/" ? site.name : normalized), url: new URL(normalized, site.url).toString() };
    pages.set(projectPageKey(page), page);
  };
  for (const site of dashboard.sites) add(site.id, "/", site.name);
  for (const candidate of dashboard.cvrPageCandidates) {
    if (isProjectLandingPath(candidate.path) && !/(?:page not found|pagina niet gevonden|page introuvable)/i.test(candidate.title)) add(candidate.siteId, candidate.path, candidate.title);
  }
  for (const link of dashboard.cvrLinks) add(link.siteId, link.sourcePath, link.sourceTitle, true);
  for (const saved of savedPages) {
    const candidate = dashboard.cvrPageCandidates.find((page) => page.siteId === saved.siteId && normalizeProjectPath(page.path) === normalizeProjectPath(saved.path));
    if (!pages.has(projectPageKey(saved))) add(saved.siteId, saved.path, candidate?.title, true);
  }
  return [...pages.values()].sort((a, b) => a.siteName.localeCompare(b.siteName, "nl-BE") || a.path.localeCompare(b.path));
}

function isUtilityPage(path: string) {
  return /(?:thank.?you|bedankt|privacy|cookie|disclaimer|contact|voorwaarden|algemene-voorwaarden|wp-admin|wp-json|wp-login|feed|sitemap|robots\.txt)/i.test(path)
    || /\.(?:pdf|png|jpe?g|gif|svg|webp|css|js|xml|ico)(?:\?|$)/i.test(path);
}

function isProjectLandingPath(path: string) {
  const normalized = normalizeProjectPath(path);
  return /^\/(?:[a-z]{2}\/)?(?:home(?:-[a-z]{2,3})?|teaser(?:-[a-z]{2,3})?)?$/i.test(normalized)
    || /^\/(?:[a-z]{2}\/)?(?:project|projecten|aanbod|aanbod-list|realistatie-list|realisaties)\/[^/]+$/i.test(normalized)
    || /^\/home\/aanbod\/[^/]+$/i.test(normalized);
}

export function resolveProjectPage(page: ProjectPage, catalog: GrippDataCatalog, manualManagerId: number | null = null): ManagedProjectPage {
  const match = matchGrippPage(page, catalog);
  const managerId = manualManagerId ?? match.managerId;
  const manager = catalog.managers.find((manager) => manager.id === managerId && manager.active);
  const source = manager ? (manualManagerId !== null ? "manual" : "gripp") : "unmatched";
  return { ...page, key: projectPageKey(page), accountManagerId: manager?.id ?? null, accountManagerName: manager?.name ?? null,
    clientName: match.clientName, grippProjectName: match.projectName, source, needsAssignment: !manager,
    reason: manager ? source === "manual" ? "Handmatig toegewezen in dit dashboard" : "Automatisch gekoppeld via Gripp"
      : manualManagerId !== null ? "De handmatig toegewezen accountmanager is niet meer actief" : match.reason };
}

function matchGrippPage(page: ProjectPage, catalog: GrippDataCatalog) {
  const url = new URL(page.url);
  const signals = [page.title, page.path.split("?")[0], page.siteName, url.hostname.replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "")].map(normalizeName);
  const clients = new Map(catalog.clients.map((client) => [client.id, client]));
  type Candidate = { score: number; clientId: number | null; clientName: string | null; projectName: string | null; managerId: number | null; archived: boolean };
  const candidates: Candidate[] = catalog.projects.map((project) => {
    const client = project.clientId === null ? undefined : clients.get(project.clientId);
    return { score: nameScore(project.name, signals), clientId: client?.id ?? null, clientName: client?.name ?? null, projectName: project.name,
      managerId: client?.accountManagerId ?? project.accountManagerId, archived: project.archived };
  }).filter((candidate) => candidate.score > 0);
  for (const client of catalog.clients) {
    const exactHost = client.website && hostname(client.website) === url.hostname.replace(/^www\./, "").toLowerCase();
    const score = exactHost ? 85 : Math.min(80, nameScore(client.name, signals));
    if (score) candidates.push({ score, clientId: client.id, clientName: client.name, projectName: null, managerId: client.accountManagerId, archived: !client.active });
  }
  if (!candidates.length) return { managerId: null, clientName: null, projectName: null, reason: "Geen overeenkomend project of klant in Gripp gevonden" };
  candidates.sort((a, b) => b.score - a.score || Number(a.archived) - Number(b.archived));
  const best = candidates[0].score;
  const close = candidates.filter((candidate) => candidate.score >= best - 8);
  const active = close.filter((candidate) => !candidate.archived);
  const matches = active.length ? active : close;
  const managers = new Set(matches.map((candidate) => candidate.managerId));
  const names = [...new Set(matches.flatMap((candidate) => candidate.clientName ? [candidate.clientName] : []))];
  const result = { clientName: names.length ? names.join(" / ") : null, projectName: matches.find((candidate) => candidate.projectName)?.projectName ?? null };
  if (managers.size > 1) return { ...result, managerId: null, reason: "Meerdere mogelijke Gripp-koppelingen met verschillende accountmanagers" };
  const managerId = matches[0].managerId;
  if (managerId === null) return { ...result, managerId: null, reason: "Het gekoppelde project of de klant heeft geen accountmanager in Gripp" };
  if (!catalog.managers.some((manager) => manager.id === managerId && manager.active)) return { ...result, managerId: null, reason: "De accountmanager uit Gripp is niet meer actief of beschikbaar" };
  return { ...result, managerId, reason: "Automatisch gekoppeld via Gripp" };
}

const genericWords = new Set("de het een van voor en in op te aan bij the a nv bv bvba srl ltd be com nl fr eng www home nieuw nieuwbouw nieuwbouwproject project projecten residentie residence residential marketing onderhoud support campagne campagnes website design branding video renders render regie full prestaties construct development vastgoed real estate properties media".split(" "));
function normalizeName(value: string) {
  try { value = decodeURIComponent(value); } catch { /* Keep original text. */ }
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function distinctiveWords(value: string) { return normalizeName(value).split(" ").filter((word) => word.length > 1 && !/^\d+$/.test(word) && !genericWords.has(word)); }
function nameScore(name: string, signals: string[]) {
  const words = distinctiveWords(name);
  if (!words.length) return 0;
  const compact = words.join("");
  if (compact.length < 4) return 0;
  return Math.max(0, ...signals.map((signal) => {
    const tokens = distinctiveWords(signal);
    if (!tokens.length) return 0;
    if (tokens.join("") === compact) return 110;
    if (words.every((word) => tokens.includes(word))) return 100;
    // Support joined domain names, e.g. groenewandeling.be / Groene Wandeling.
    if (tokens.some((token) => token === compact)) return 95;
    // One spelling difference is only accepted for a long complete name.
    return compact.length >= 9 && oneEditApart(compact, tokens.join("")) ? 85 : 0;
  }));
}
function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a.slice(0, 3) !== b.slice(0, 3)) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function hostname(value: string) { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }

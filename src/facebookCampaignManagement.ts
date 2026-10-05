import { z } from "zod";
import { CAMPAIGN_PROJECT_MATCHES_KEY, normalizeProjectPath, parseCampaignProjectMatches, type CampaignProjectMatch } from "./campaignProjects.js";
import { getJsonCacheMode, readJsonCache, writeJsonCache } from "./jsonCache.js";
import { getProjectPageManagementData } from "./projectPageManagement.js";

const id = z.string().trim().min(1);
const numericId = id.regex(/^\d+$/);
const accountIdSchema = id.transform((value) => value.replace(/^act_/, "")).pipe(numericId);
const campaignSchema = z.object({ id: numericId, name: id, effective_status: id });
const responseSchema = z.object({ data: z.array(campaignSchema), paging: z.object({
  next: z.string().optional(), cursors: z.object({ after: id.optional() }).optional()
}).optional() });
const projectPath = id.refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), "Use a local project path")
  .transform(normalizeProjectPath);
export type FacebookCampaignOption = { id: string; name: string; status: string };
type MatchStore = { read<T>(key: string): Promise<T | null>; write(key: string, value: unknown): Promise<void> };
type StoreOptions = { store?: MatchStore; pages?: { siteId: string; path: string }[] };

export async function listFacebookCampaigns(accountIdInput: string, options: { env?: Partial<NodeJS.ProcessEnv>; fetchImpl?: typeof fetch } = {}) {
  const accountId = accountIdSchema.parse(accountIdInput);
  const env = options.env ?? process.env;
  if (!env.META_ADS_ACCESS_TOKEN) throw new Error("Facebook Ads is not configured");
  const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({ fields: "id,name,effective_status", limit: "100" });
  const campaigns = new Map<string, FacebookCampaignOption>();
  const cursors = new Set<string>();
  const signal = AbortSignal.timeout(45_000);
  for (let page = 0; page < 100; page++) {
    const response = await fetchImpl(`https://graph.facebook.com/${version}/act_${accountId}/campaigns?${params}`, {
      headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` }, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    });
    if (!response.ok) throw new Error("Facebook Ads request failed");
    const result = responseSchema.parse(await response.json());
    for (const campaign of result.data) {
      if (["DELETED", "ARCHIVED"].includes(campaign.effective_status)) continue;
      campaigns.set(campaign.id, { id: campaign.id, name: campaign.name, status: campaign.effective_status });
    }
    if (!result.paging?.next) return { accountId, campaigns: [...campaigns.values()].sort((a, b) => a.name.localeCompare(b.name, "nl-BE")) };
    const after = result.paging.cursors?.after;
    if (!after || cursors.has(after)) throw new Error("Incomplete Facebook campaign pagination");
    cursors.add(after);
    params.set("after", after);
  }
  throw new Error("Facebook campaign pagination limit reached");
}

export async function readFacebookCampaignMatches() {
  return parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY))
    .filter((match) => (match.channel ?? "facebook") === "facebook");
}

export async function saveFacebookCampaignMatches(input: unknown, options: StoreOptions = {}) {
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const selection = z.object({ siteId: id, accountId: accountIdSchema,
    campaignIds: z.array(numericId).min(1).max(100).transform((ids) => [...new Set(ids)]),
    sourcePath: projectPath }).strict().parse(input);
  const pages = options.pages ?? (await getProjectPageManagementData()).pages;
  if (!pages.some((page) => page.siteId === selection.siteId && normalizeProjectPath(page.path) === selection.sourcePath)) {
    throw new Error("Unknown project page");
  }
  const store = options.store ?? { read: readJsonCache, write: writeJsonCache };
  const current = parseCampaignProjectMatches(await store.read(CAMPAIGN_PROJECT_MATCHES_KEY));
  const selectedIds = new Set(selection.campaignIds);
  const next = current.filter((match) => !((match.channel ?? "facebook") === "facebook"
    && match.accountId === selection.accountId && selectedIds.has(match.campaignId)));
  const matches: CampaignProjectMatch[] = selection.campaignIds.map((campaignId) => ({
    channel: "facebook", siteId: selection.siteId, accountId: selection.accountId, campaignId, sourcePaths: [selection.sourcePath]
  }));
  next.push(...matches);
  parseCampaignProjectMatches(next);
  await store.write(CAMPAIGN_PROJECT_MATCHES_KEY, next);
  return matches;
}

export async function deleteFacebookCampaignMatch(accountIdInput: string, campaignIdInput: string, options: StoreOptions = {}) {
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const accountId = accountIdSchema.parse(accountIdInput), campaignId = numericId.parse(campaignIdInput);
  const store = options.store ?? { read: readJsonCache, write: writeJsonCache };
  const current = parseCampaignProjectMatches(await store.read(CAMPAIGN_PROJECT_MATCHES_KEY));
  await store.write(CAMPAIGN_PROJECT_MATCHES_KEY, current.filter((match) => !((match.channel ?? "facebook") === "facebook"
    && match.accountId === accountId && match.campaignId === campaignId)));
}

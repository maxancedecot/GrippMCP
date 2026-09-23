import { z } from "zod";
import { CAMPAIGN_PROJECT_MATCHES_KEY, normalizeProjectPath, parseCampaignProjectMatches, type CampaignProjectMatch } from "./campaignProjects.js";
import { getJsonCacheMode, readJsonCache, writeJsonCache } from "./jsonCache.js";
import { getSiteAnalyticsDashboardData } from "./siteAnalytics.js";

const id = z.string().trim().min(1);
const customerIdSchema = id.transform((value) => value.replace(/-/g, "")).pipe(id.regex(/^\d+$/));
const campaignSchema = z.object({ campaign: z.object({ id: id.regex(/^\d+$/), name: id, status: id.optional() }) });
export type GoogleCampaignOption = { id: string; name: string; status: string };

export async function listGoogleCampaigns(customerIdInput: string, options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}) {
  const customerId = customerIdSchema.parse(customerIdInput);
  const env = options.env ?? process.env;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) throw new Error("Google Ads is not configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN })
  });
  if (!tokenResponse.ok) throw new Error("OAuth failed");
  const token = z.object({ access_token: id }).parse(await tokenResponse.json());
  const version = z.string().regex(/^v\d+$/).parse(env.GOOGLE_ADS_API_VERSION ?? "v25");
  const headers: Record<string, string> = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
  if (env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = customerIdSchema.parse(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const response = await fetchImpl(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST", headers, cache: "no-store",
    body: JSON.stringify({ query: "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name" })
  });
  if (!response.ok) throw new Error("Google Ads request failed");
  const chunks = z.array(z.object({ results: z.array(campaignSchema).optional() })).parse(await response.json());
  return { customerId, campaigns: chunks.flatMap((chunk) => chunk.results ?? []).map(({ campaign }) => ({
    id: campaign.id, name: campaign.name, status: campaign.status ?? "UNKNOWN"
  })) satisfies GoogleCampaignOption[] };
}

export async function readGoogleCampaignMatches() {
  return parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY)).filter((match) => match.channel === "google");
}

export async function saveGoogleCampaignMatch(input: unknown) {
  if (getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const match = z.object({ channel: z.literal("google"), siteId: id, accountId: customerIdSchema,
    campaignId: id.regex(/^\d+$/), sourcePaths: z.array(id).length(1) }).parse(input);
  const dashboard = await getSiteAnalyticsDashboardData({ days: 90 });
  const path = normalizeProjectPath(match.sourcePaths[0]);
  const known = dashboard.cvrPageCandidates.some((page) => page.siteId === match.siteId && normalizeProjectPath(page.path) === path)
    || dashboard.cvrLinks.some((link) => link.siteId === match.siteId && normalizeProjectPath(link.sourcePath) === path);
  if (!known) throw new Error("Unknown project page");
  const current = parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY));
  const next = current.filter((item) => !(item.channel === "google" && item.accountId === match.accountId && item.campaignId === match.campaignId));
  next.push({ ...match, sourcePaths: [path] });
  await writeJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY, next);
  return parseCampaignProjectMatches(next).find((item) => item.channel === "google" && item.accountId === match.accountId && item.campaignId === match.campaignId)!;
}

export async function deleteGoogleCampaignMatch(accountIdInput: string, campaignId: string) {
  if (getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const accountId = customerIdSchema.parse(accountIdInput);
  id.regex(/^\d+$/).parse(campaignId);
  const current = parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY));
  const next = current.filter((item) => !(item.channel === "google" && item.accountId === accountId && item.campaignId === campaignId));
  await writeJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY, next);
}

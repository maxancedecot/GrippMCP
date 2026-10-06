import { z } from "zod";
import { CAMPAIGN_PROJECT_MATCHES_KEY, normalizeProjectPath, parseCampaignProjectMatches, type CampaignProjectMatch } from "./campaignProjects.js";
import { getJsonCacheMode, readJsonCache, writeJsonCache } from "./jsonCache.js";
import { getProjectPageManagementData } from "./projectPageManagement.js";

const id = z.string().trim().min(1);
const customerIdSchema = id.transform((value) => value.replace(/-/g, "")).pipe(id.regex(/^\d+$/));
const campaignSchema = z.object({ campaign: z.object({ id: id.regex(/^\d+$/), name: id, status: id.optional() }) });
export type GoogleCampaignOption = { id: string; name: string; status: string };
type MatchStore = { read<T>(key: string): Promise<T | null>; write(key: string, value: unknown): Promise<void> };
type ProjectPages = { siteId: string; path: string }[];
const projectPath = id.refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), "Use a local project path")
  .transform(normalizeProjectPath);

type GoogleRequestOptions = { env?: Partial<NodeJS.ProcessEnv>; fetchImpl?: typeof fetch; loginCustomerId?: string };
export type GoogleAdAccountOption = { id: string; name: string; status: string; loginCustomerId: string };
const accountSchema = z.object({ id: id.regex(/^\d+$/), descriptiveName: z.string().trim().optional(),
  manager: z.boolean().optional().default(false), status: id.optional() });

async function googleClient(options: GoogleRequestOptions) {
  const env = options.env ?? process.env;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) throw new Error("Google Ads is not configured");
  const version = z.string().regex(/^v\d+$/).parse(env.GOOGLE_ADS_API_VERSION ?? "v25");
  const loginCustomerId = customerIdSchema.optional().parse(options.loginCustomerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = async (url: string, init: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error("Google Ads request failed");
    return response.json();
  };
  const token = z.object({ access_token: id }).parse(await request("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN })
  }));
  const headers: Record<string, string> = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
  if (env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const search = async (customerId: string, query: string, loginId = loginCustomerId) => {
    const chunks = z.array(z.object({ results: z.array(z.unknown()).optional() })).parse(await request(
      `https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`, {
        method: "POST", headers: { ...headers, ...(loginId ? { "login-customer-id": loginId } : {}) },
        body: JSON.stringify({ query })
      }));
    return chunks.flatMap((chunk) => chunk.results ?? []);
  };
  return { search, loginCustomerId, accessible: async () => {
    // This endpoint lists directly accessible accounts and ignores login-customer-id.
    const data = z.object({ resourceNames: z.array(z.string().regex(/^customers\/\d+$/)).optional().default([]) }).parse(
      await request(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, { method: "GET", headers }));
    return [...new Set(data.resourceNames.map((name) => name.slice("customers/".length)))];
  } };
}

export async function listGoogleAdAccounts(options: GoogleRequestOptions = {}): Promise<GoogleAdAccountOption[]> {
  const client = await googleClient(options);
  const roots = client.loginCustomerId ? [client.loginCustomerId] : await client.accessible();
  const accounts = new Map<string, GoogleAdAccountOption>();
  for (const root of roots) {
    const rows = await client.search(root, "SELECT customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer", root);
    const customers = z.array(z.object({ customer: accountSchema })).parse(rows);
    if (customers.length !== 1 || customers[0].customer.id !== root) throw new Error("Invalid Google Ads customer response");
    const customer = customers[0].customer;
    // customer_client includes all direct and indirect clients; managers have no campaigns of their own.
    const clients = customer.manager
      ? z.array(z.object({ customerClient: accountSchema })).parse(await client.search(root,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.manager = FALSE", root)).map((row) => row.customerClient)
      : [customer];
    for (const account of clients) {
      if (account.manager) continue;
      if (!accounts.has(account.id) || account.id === root) accounts.set(account.id, {
        id: account.id, name: account.descriptiveName || `Google Ads-account ${account.id}`,
        status: account.status ?? "UNKNOWN", loginCustomerId: root
      });
    }
  }
  return [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name, "nl-BE") || a.id.localeCompare(b.id));
}

export async function listGoogleCampaigns(customerIdInput: string, options: GoogleRequestOptions = {}) {
  const customerId = customerIdSchema.parse(customerIdInput);
  const client = await googleClient(options);
  const rows = z.array(campaignSchema).parse(await client.search(customerId,
    "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name"));
  return { customerId, campaigns: rows.map(({ campaign }) => ({
    id: campaign.id, name: campaign.name, status: campaign.status ?? "UNKNOWN"
  })) satisfies GoogleCampaignOption[] };
}

export async function readGoogleCampaignMatches() {
  return parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY)).filter((match) => match.channel === "google");
}

export async function saveGoogleCampaignMatch(input: unknown) {
  const match = z.object({ channel: z.literal("google"), siteId: id, accountId: customerIdSchema, loginCustomerId: customerIdSchema.optional(),
    campaignId: id.regex(/^\d+$/), sourcePaths: z.array(id).length(1) }).parse(input);
  return (await saveGoogleCampaignMatches({ siteId: match.siteId, accountId: match.accountId,
    campaignIds: [match.campaignId], sourcePath: match.sourcePaths[0], ...(match.loginCustomerId ? { loginCustomerId: match.loginCustomerId } : {}) }))[0];
}

export async function saveGoogleCampaignMatches(input: unknown, options: { store?: MatchStore; pages?: ProjectPages } = {}) {
  if (!options.store && getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const selection = z.object({ siteId: id, accountId: customerIdSchema, loginCustomerId: customerIdSchema.optional(),
    campaignIds: z.array(id.regex(/^\d+$/)).min(1).max(100).transform((ids) => [...new Set(ids)]),
    sourcePath: projectPath }).strict().parse(input);
  const pages = options.pages ?? (await getProjectPageManagementData()).pages;
  const path = selection.sourcePath;
  const known = pages.some((page) => page.siteId === selection.siteId && normalizeProjectPath(page.path) === path);
  if (!known) throw new Error("Unknown project page");
  const store = options.store ?? { read: readJsonCache, write: writeJsonCache };
  const current = parseCampaignProjectMatches(await store.read(CAMPAIGN_PROJECT_MATCHES_KEY));
  const selectedIds = new Set(selection.campaignIds);
  const next = current.filter((item) => !(item.channel === "google" && item.accountId === selection.accountId && selectedIds.has(item.campaignId)));
  const matches: CampaignProjectMatch[] = selection.campaignIds.map((campaignId) => ({
    channel: "google", siteId: selection.siteId, accountId: selection.accountId, campaignId, sourcePaths: [path],
    ...(selection.loginCustomerId ? { loginCustomerId: selection.loginCustomerId } : {})
  }));
  next.push(...matches);
  parseCampaignProjectMatches(next);
  await store.write(CAMPAIGN_PROJECT_MATCHES_KEY, next);
  return matches;
}

export async function deleteGoogleCampaignMatch(accountIdInput: string, campaignId: string) {
  if (getJsonCacheMode() === "memory") throw new Error("Persistent storage is required");
  const accountId = customerIdSchema.parse(accountIdInput);
  id.regex(/^\d+$/).parse(campaignId);
  const current = parseCampaignProjectMatches(await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY));
  const next = current.filter((item) => !(item.channel === "google" && item.accountId === accountId && item.campaignId === campaignId));
  await writeJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY, next);
}

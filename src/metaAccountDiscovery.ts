import { createHash } from "node:crypto";
import { z } from "zod";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";
import { facebookDestinationUrls, matchCampaignPages } from "./campaignDestinations.js";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import type { CampaignProjectMatch } from "./campaignProjects.js";

const identifier = z.string().regex(/^\d+$/);
const accountSchema = z.object({ id: z.string().regex(/^act_\d+$/), name: z.string(), account_status: z.number() });
const campaignSchema = z.object({ id: identifier, name: z.string(), effective_status: z.string(), start_time: z.string().optional(), stop_time: z.string().optional() });
const measurement = z.coerce.number().finite().nonnegative();
const activitySchema = z.object({ campaign_id: identifier, campaign_name: z.string(), impressions: measurement, spend: measurement });
const adActivitySchema = z.object({ campaign_id: identifier, ad_id: identifier, impressions: measurement, spend: measurement });
const destinationSchema = z.object({ campaignId: identifier, name: z.string(), urls: z.array(z.string()) });
const cacheSchema = z.object({ checkedAt: z.number(), destinations: z.array(destinationSchema), liveCampaignCount: z.number(), unavailableCampaignCount: z.number().optional() });
const pagingSchema = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).optional() }).optional() }).optional();
const TTL_MS = 5 * 60_000;
type Site = { id: string; name: string; url: string };
type CachedDestinations = z.infer<typeof cacheSchema>;

function failureReason(error: unknown): string {
  if (error instanceof z.ZodError) {
    const field = error.issues[0]?.path.filter((part) => typeof part === "string" && /^[a-z_]+$/.test(part)).join(".");
    return field ? `ongeldig veld ${field}` : "ongeldig antwoord";
  }
  if (error instanceof Error) {
    const status = /^Meta HTTP ([45]\d{2})$/.exec(error.message)?.[1];
    if (status) return `HTTP ${status}`;
    if (error.name === "TimeoutError" || error.name === "AbortError") return "time-out";
    if (error.message === "Incomplete Meta pagination") return "onvolledige paginering";
  }
  return "niet beschikbaar";
}
export type MetaAccountSync = {
  state: "connected" | "unavailable" | "not_configured";
  checkedAt: string;
  message: string;
  accounts: { id: string; name: string; siteNames: string[]; campaignCount: number; message: string }[];
};

/** Discover only accounts accessible to the existing read-only Meta credential.
 * Account/campaign names never determine which website receives their metrics. */
export async function discoverMetaAccounts(options: {
  sites: Site[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now: Date;
  period?: { start: string; end: string };
  force?: boolean;
  cache?: boolean;
}): Promise<{ sync: MetaAccountSync; matches: CampaignProjectMatch[] }> {
  const { env, now } = options;
  const sync: MetaAccountSync = { state: "not_configured", checkedAt: now.toISOString(), message: "", accounts: [] };
  if (!env.META_ADS_ACCESS_TOKEN || env.META_ADS_AUTO_DISCOVERY === "false" || !options.sites.length) return { sync, matches: [] };
  const fetchImpl = options.fetchImpl ?? fetch;
  const useCache = options.cache ?? !options.fetchImpl;
  const signal = AbortSignal.timeout(90_000);
  // Schedule requests across all accounts, rather than letting a handful of
  // large historical catalogs consume the deadline before later accounts start.
  let activeRequests = 0;
  const waitingRequests: (() => void)[] = [];
  async function withRequestSlot<T>(load: () => Promise<T>): Promise<T> {
    if (activeRequests >= 12) await new Promise<void>((resolve) => waitingRequests.push(resolve));
    else activeRequests++;
    try { return await load(); }
    finally {
      const next = waitingRequests.shift();
      if (next) next();
      else activeRequests--;
    }
  }
  const tokenScope = createHash("sha256").update(env.META_ADS_ACCESS_TOKEN).digest("hex");
  const version = /^v\d+\.\d+$/.test(env.META_ADS_API_VERSION ?? "v26.0") ? env.META_ADS_API_VERSION ?? "v26.0" : null;
  async function list<T extends z.ZodTypeAny>(path: string, fields: string, schema: T, extra: Record<string, string> = {}): Promise<z.output<T>[]> {
    if (!version) throw new Error("Invalid Meta version");
    const params = new URLSearchParams({ fields, limit: "100", ...extra });
    const rows: z.output<T>[] = [];
    const cursors = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const response = await withRequestSlot(() => fetchImpl(`https://graph.facebook.com/${version}/${path}?${params}`, {
        headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` }, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      }));
      if (!response.ok) throw new Error(`Meta HTTP ${response.status}`);
      const result = z.object({ data: z.array(schema), paging: pagingSchema }).parse(await response.json());
      rows.push(...result.data);
      if (!result.paging?.next) return rows;
      const after = result.paging.cursors?.after;
      if (!after || cursors.has(after)) throw new Error("Incomplete Meta pagination");
      cursors.add(after);
      params.set("after", after);
    }
    throw new Error("Incomplete Meta pagination");
  }

  let accounts: z.infer<typeof accountSchema>[];
  try {
    // Always fresh: adding/revoking account access must not wait for a cached inventory.
    accounts = await list("me/adaccounts", "id,name,account_status", accountSchema);
    accounts = [...new Map(accounts.map((account) => [account.id, account])).values()];
  } catch {
    return { sync: { ...sync, state: "unavailable", message: "De Meta-accountlijst kon niet worden gesynchroniseerd. Bestaande dashboardkoppelingen blijven beschikbaar." }, matches: [] };
  }
  sync.state = "connected";
  const matches: CampaignProjectMatch[] = [];
  let failedAccounts = 0;
  const sites = options.sites.filter((site) => !isExcludedAnalyticsLink(site.url));
  // Separate per-account caches let a newly accessible account sync immediately.
  // Failures in one account must not block successful accounts.
  const results = await Promise.all(accounts.map(async (account) => {
    const accountId = account.id.slice(4);
    const cacheKey = options.period
      ? `meta-account-destinations:v2:${tokenScope}:${accountId}:${options.period.start}:${options.period.end}`
      : `meta-account-destinations:v1:${tokenScope}:${accountId}`;
    const parsed = cacheSchema.safeParse(useCache ? await readJsonCache(cacheKey).catch(() => null) : null);
    const cached = parsed.success ? parsed.data : null;
    const age = cached ? now.getTime() - cached.checkedAt : Infinity;
    let data: CachedDestinations | null = cached && age >= 0 && age < TTL_MS && !options.force ? cached : null;
    let message = "";
    if (!data) {
      try {
        const timeRange = options.period ? { time_range: JSON.stringify({ since: options.period.start, until: options.period.end }), time_increment: "all_days" } : null;
        const [catalog, measurements] = await Promise.allSettled([
          account.account_status === 1 || options.period
            ? list(`${account.id}/campaigns`, "id,name,effective_status,start_time,stop_time", campaignSchema, options.period ? {} : { effective_status: JSON.stringify(["ACTIVE"]) })
            : Promise.resolve([]),
          timeRange ? list(`${account.id}/insights`, "campaign_id,campaign_name,impressions,spend", activitySchema, { ...timeRange, level: "campaign" }) : Promise.resolve([])
        ]);
        if (catalog.status === "rejected" && (!options.period || measurements.status === "rejected")) throw catalog.reason;
        const campaigns = catalog.status === "fulfilled" ? catalog.value : [];
        const activity = measurements.status === "fulfilled" ? measurements.value : [];
        if (catalog.status === "rejected") message = `De campagnelijst kon niet volledig worden gecontroleerd (${failureReason(catalog.reason)}). Historisch geverifieerde koppelingen blijven beschikbaar.`;
        if (measurements.status === "rejected") message = `De periodeactiviteit kon niet worden gecontroleerd (${failureReason(measurements.reason)}). Lopende geverifieerde koppelingen blijven beschikbaar.`;
        const live = campaigns.filter((campaign) => account.account_status === 1 && campaign.name.toLowerCase().includes("ledoux") && campaign.effective_status === "ACTIVE"
          && (!campaign.start_time || Date.parse(campaign.start_time) <= now.getTime())
          && (!campaign.stop_time || Date.parse(campaign.stop_time) > now.getTime()));
        const names = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
        const eligible = new Map(live.map((campaign) => [campaign.id, { id: campaign.id, name: campaign.name, live: true, hasActivity: false }]));
        for (const row of activity) {
          // Current names take precedence, including renames away from Ledoux.
          const name = names.get(row.campaign_id) ?? row.campaign_name;
          if ((row.impressions > 0 || row.spend > 0) && name.toLowerCase().includes("ledoux") && !eligible.has(row.campaign_id)) {
            eligible.set(row.campaign_id, { id: row.campaign_id, name, live: false, hasActivity: true });
          }
        }
        // A paused campaign can still be linked with zero period spend. Its
        // accessible creatives establish the destination, not its name.
        if (options.period && measurements.status === "fulfilled") {
          for (const campaign of campaigns) {
            if (campaign.name.toLowerCase().includes("ledoux") && !eligible.has(campaign.id)) {
              eligible.set(campaign.id, { id: campaign.id, name: campaign.name, live: false, hasActivity: false });
            }
          }
        }
        // Recheck stopped campaigns against the ads delivered in this period;
        // a destination saved while live need not be their historical destination.
        const destinations = new Map((options.period ? [] : cached?.destinations ?? []).map((item) => [item.campaignId, item]));
        const selected = [...eligible.values()];
        let unavailableCampaignCount = 0;
        const campaignFailures = new Set<string>();
        for (let offset = 0; offset < selected.length; offset += 3) {
          await Promise.all(selected.slice(offset, offset + 3).map(async (campaign) => {
            try {
              let periodAds: Set<string> | null = null;
              if (!campaign.live && campaign.hasActivity && timeRange) {
                const rows = await list(`${campaign.id}/insights`, "ad_id,campaign_id,impressions,spend", adActivitySchema, { ...timeRange, level: "ad" });
                if (rows.some((row) => row.campaign_id !== campaign.id)) throw new Error("Unexpected historical campaign");
                periodAds = new Set(rows.filter((row) => row.impressions > 0 || row.spend > 0).map((row) => row.ad_id));
                if (!periodAds.size) throw new Error("Missing historical ad measurements");
              }
              const ads = await list(`${campaign.id}/ads`, "id,campaign_id,creative{object_story_spec{link_data{link,child_attachments{link}},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},object_url,link_url}",
                z.object({ id: identifier.optional(), campaign_id: identifier, creative: z.unknown().optional() }),
                { limit: "25", ...(campaign.live ? { filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]) } : {}) });
              if (ads.some((ad) => ad.campaign_id !== campaign.id)) throw new Error("Unexpected campaign");
              if (periodAds && [...periodAds].some((id) => !ads.some((ad) => ad.id === id))) throw new Error("Incomplete historical ad destinations");
              destinations.set(campaign.id, { campaignId: campaign.id, name: campaign.name,
                urls: [...new Set(ads.filter((ad) => !periodAds || (ad.id && periodAds.has(ad.id))).flatMap((ad) => facebookDestinationUrls(ad.creative)))].filter((url) => !isExcludedAnalyticsLink(url)) });
            } catch (error) {
              // An unavailable old creative must not hide working campaigns
              // in the same account. Reuse only a recent same-period check.
              unavailableCampaignCount++;
              campaignFailures.add(failureReason(error));
              const previous = cached?.destinations.find((item) => item.campaignId === campaign.id);
              if (previous && age >= 0 && age < 24 * 60 * 60_000) destinations.set(campaign.id, previous);
            }
          }));
        }
        if (unavailableCampaignCount) message = `Niet alle campagnebestemmingen konden worden gecontroleerd (${[...campaignFailures].join(", ")}). Andere gecontroleerde koppelingen blijven beschikbaar.`;
        data = { checkedAt: now.getTime(), destinations: [...destinations.values()], liveCampaignCount: live.length, unavailableCampaignCount };
        // Do not extend the age of links returned from a failed refresh.
        if (useCache && !message && !unavailableCampaignCount) await writeJsonCache(cacheKey, data).catch(() => undefined);
      } catch (error) {
        data = cached && age >= 0 && age < 24 * 60 * 60_000 ? cached : null;
        message = data ? `Meta reageert tijdelijk niet (${failureReason(error)}); bestemmingslinks uit de laatste geslaagde controle.` : `Campagnes konden niet worden gecontroleerd (${failureReason(error)}). Controleer de Meta-toegang of probeer opnieuw.`;
      }
    }
    const accountMatches: CampaignProjectMatch[] = [];
    const siteNames = new Set<string>();
    for (const destination of data?.destinations ?? []) {
      for (const site of sites) {
        const pages = matchCampaignPages(site.url, destination.urls, []);
        if (!pages.length) continue;
        siteNames.add(site.name);
        accountMatches.push({ channel: "facebook", siteId: site.id, accountId, campaignId: destination.campaignId, sourcePaths: pages.map((page) => page.path) });
      }
    }
    return { failed: !!message, matches: accountMatches, account: { id: accountId, name: account.name, siteNames: [...siteNames], campaignCount: data?.liveCampaignCount ?? 0,
      message: message || (accountMatches.length ? "" : account.account_status !== 1 ? "Advertentieaccount is niet actief." : !data?.destinations.length ? options.period ? "Geen Ledoux-campagne gevonden." : "Geen lopende campagne met ‘Ledoux’ in de naam." : "Geen bestemmingslink naar een gekoppelde website gevonden.") } };
  }));
  for (const result of results) { matches.push(...result.matches); sync.accounts.push(result.account); if (result.failed) failedAccounts++; }
  if (failedAccounts) sync.message = `${failedAccounts} van ${accounts.length} Meta-accounts konden niet volledig worden gecontroleerd. Bekijk de details bij Meta-accounts.`;
  sync.accounts.sort((a, b) => a.name.localeCompare(b.name));
  return { sync, matches };
}

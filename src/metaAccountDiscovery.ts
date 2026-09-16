import { createHash } from "node:crypto";
import { z } from "zod";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";
import { facebookDestinationUrls, matchCampaignPages } from "./campaignDestinations.js";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import type { CampaignProjectMatch } from "./campaignProjects.js";

const identifier = z.string().regex(/^\d+$/);
const accountSchema = z.object({ id: z.string().regex(/^act_\d+$/), name: z.string(), account_status: z.number() });
const campaignSchema = z.object({ id: identifier, name: z.string(), effective_status: z.string(), start_time: z.string().optional(), stop_time: z.string().optional() });
const destinationSchema = z.object({ campaignId: identifier, name: z.string(), urls: z.array(z.string()) });
const cacheSchema = z.object({ checkedAt: z.number(), destinations: z.array(destinationSchema), liveCampaignCount: z.number() });
const pagingSchema = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).optional() }).optional() }).optional();
const TTL_MS = 5 * 60_000;
type Site = { id: string; name: string; url: string };
type CachedDestinations = z.infer<typeof cacheSchema>;
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
  force?: boolean;
  cache?: boolean;
}): Promise<{ sync: MetaAccountSync; matches: CampaignProjectMatch[] }> {
  const { env, now } = options;
  const sync: MetaAccountSync = { state: "not_configured", checkedAt: now.toISOString(), message: "", accounts: [] };
  if (!env.META_ADS_ACCESS_TOKEN || env.META_ADS_AUTO_DISCOVERY === "false" || !options.sites.length) return { sync, matches: [] };
  const fetchImpl = options.fetchImpl ?? fetch;
  const useCache = options.cache ?? !options.fetchImpl;
  const signal = AbortSignal.timeout(45_000);
  const tokenScope = createHash("sha256").update(env.META_ADS_ACCESS_TOKEN).digest("hex");
  const version = /^v\d+\.\d+$/.test(env.META_ADS_API_VERSION ?? "v26.0") ? env.META_ADS_API_VERSION ?? "v26.0" : null;
  async function list<T extends z.ZodTypeAny>(path: string, fields: string, schema: T, extra: Record<string, string> = {}): Promise<z.output<T>[]> {
    if (!version) throw new Error("Invalid Meta version");
    const params = new URLSearchParams({ fields, limit: "100", ...extra });
    const rows: z.output<T>[] = [];
    const cursors = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const response = await fetchImpl(`https://graph.facebook.com/${version}/${path}?${params}`, {
        headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` }, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      });
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
  for (let offset = 0; offset < accounts.length; offset += 6) {
    const results = await Promise.all(accounts.slice(offset, offset + 6).map(async (account) => {
      const accountId = account.id.slice(4);
      const cacheKey = `meta-account-destinations:v1:${tokenScope}:${accountId}`;
      const parsed = cacheSchema.safeParse(useCache ? await readJsonCache(cacheKey).catch(() => null) : null);
      const cached = parsed.success ? parsed.data : null;
      const age = cached ? now.getTime() - cached.checkedAt : Infinity;
      let data: CachedDestinations | null = cached && age >= 0 && age < TTL_MS && !options.force ? cached : null;
      let message = "";
      if (!data) {
        try {
          const campaigns = account.account_status === 1 ? await list(`${account.id}/campaigns`, "id,name,effective_status,start_time,stop_time", campaignSchema, { effective_status: JSON.stringify(["ACTIVE"]) }) : [];
          const live = campaigns.filter((campaign) => campaign.name.toLowerCase().includes("ledoux") && campaign.effective_status === "ACTIVE"
            && (!campaign.start_time || Date.parse(campaign.start_time) <= now.getTime())
            && (!campaign.stop_time || Date.parse(campaign.stop_time) > now.getTime()));
          // Keep verified links for stopped campaigns, so period spend remains attributable.
          const destinations = new Map((cached?.destinations ?? []).map((item) => [item.campaignId, item]));
          for (const campaign of live) {
            const ads = await list(`${campaign.id}/ads`, "campaign_id,creative{object_story_spec{link_data{link,child_attachments{link}},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},object_url,link_url}",
              z.object({ campaign_id: identifier, creative: z.unknown().optional() }),
              { limit: "25", filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]) });
            if (ads.some((ad) => ad.campaign_id !== campaign.id)) throw new Error("Unexpected campaign");
            destinations.set(campaign.id, { campaignId: campaign.id, name: campaign.name,
              urls: [...new Set(ads.flatMap((ad) => facebookDestinationUrls(ad.creative)))].filter((url) => !isExcludedAnalyticsLink(url)) });
          }
          data = { checkedAt: now.getTime(), destinations: [...destinations.values()], liveCampaignCount: live.length };
          if (useCache) await writeJsonCache(cacheKey, data).catch(() => undefined);
        } catch {
          data = cached && age >= 0 && age < 24 * 60 * 60_000 ? cached : null;
          message = data ? "Meta reageert tijdelijk niet; bestemmingslinks uit de laatste geslaagde controle." : "Campagnes konden niet worden gecontroleerd. Controleer de Meta-toegang of probeer opnieuw.";
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
        message: message || (accountMatches.length ? "" : account.account_status !== 1 ? "Advertentieaccount is niet actief." : !data?.liveCampaignCount ? "Geen lopende campagne met ‘Ledoux’ in de naam." : "Geen bestemmingslink naar een gekoppelde website gevonden.") } };
    }));
    for (const result of results) { matches.push(...result.matches); sync.accounts.push(result.account); if (result.failed) failedAccounts++; }
  }
  if (failedAccounts) sync.message = `${failedAccounts} van ${accounts.length} Meta-accounts konden niet volledig worden gecontroleerd. Bekijk de details bij Meta-accounts.`;
  sync.accounts.sort((a, b) => a.name.localeCompare(b.name));
  return { sync, matches };
}

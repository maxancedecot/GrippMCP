import { z } from "zod";
import type { SiteAnalyticsDashboardData } from "./siteAnalytics.js";
import { cvrOverviewRowsFromLinks, type CvrOverviewRow } from "./siteAnalyticsConversions.js";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, campaignProjectOverview, parseCampaignProjectMatches, type CampaignProjectMatch } from "./campaignProjects.js";

export type CampaignSource<T> =
  | { state: "connected"; data: T; message: string }
  | { state: "not_configured" | "unavailable"; data: null; message: string };

export type AdCampaign = {
  id: string;
  name?: string;
  live: boolean | null;
  clicks: number;
  impressions: number;
  spend: number;
};
export type AdPerformance = { accountId: string; currency: string; campaigns: AdCampaign[] };
export type CampaignUniqueCtr = { id: string; name: string; reach: number; ctr: number | null };
export type UniqueCtrPerformance = { accountId: string; campaigns: CampaignUniqueCtr[]; ctr: number | null };
export type UniqueCtrSummary = { ctr: number | null; campaigns: number; unavailable: boolean };
export type CampaignPageMatch = {
  campaignId: string;
  pages: { url: string; path: string; title: string; hasConversionMapping: boolean }[];
};
export type WebsiteConversionPerformance = { siteId: string; count: number };
export type CampaignPerformanceRow = {
  siteId: string;
  name: string;
  url: string;
  google: CampaignSource<AdPerformance>;
  facebook: CampaignSource<AdPerformance>;
  facebookUniqueCtr: CampaignSource<UniqueCtrPerformance>;
  facebookCampaignPages: CampaignSource<CampaignPageMatch[]>;
  leads: CampaignSource<WebsiteConversionPerformance>;
  appointments: CampaignSource<WebsiteConversionPerformance>;
  websiteCvr: number | null;
  websiteVisitors: number;
  websiteConversions: number;
};

const id = z.string().trim().min(1);
const numericId = id.regex(/^\d+$/);
const googleId = id.transform((value) => value.replace(/-/g, "")).pipe(numericId);
const mappingSchema = z.object({
  siteId: id,
  google: z.object({ customerId: googleId, loginCustomerId: googleId.optional(), campaignIds: z.array(numericId).min(1).optional() }).strict().optional(),
  facebook: z.object({ adAccountId: id.transform((value) => value.replace(/^act_/, "")).pipe(numericId), campaignIds: z.array(numericId).min(1).optional() }).strict().optional(),
  // Accepted for existing configurations; dashboard conversions now come from WordPress.
  ghl: z.object({ locationId: id, installId: id.optional(), calendarIds: z.array(id).min(1).optional() }).strict().optional()
}).strict();
export type CampaignSiteMapping = z.infer<typeof mappingSchema>;
type FacebookUniqueScope = { adAccountId: string; campaigns: AdCampaign[] };
type CampaignDestinations = { campaignId: string; urls: string[] }[];
type CachedCampaignDestinations = { checkedAt: number; data: CampaignDestinations };
type Env = Record<string, string | undefined>;
type Options = {
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: Date;
  cacheCampaignPages?: boolean;
  projectMatches?: CampaignProjectMatch[];
};

const numeric = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const googleRow = z.object({
  customer: z.object({ currencyCode: id }).optional(),
  campaign: z.object({ id, status: id.optional(), primaryStatus: id.optional() }).optional(),
  metrics: z.object({ clicks: numeric.optional(), impressions: numeric.optional(), costMicros: numeric.optional() }).optional()
});
const metaCampaign = z.object({ id, name: id, effective_status: id, start_time: id.optional(), stop_time: id.optional() });
const metaInsight = z.object({ campaign_id: id, campaign_name: id, clicks: numeric.optional(), impressions: numeric, spend: numeric });
const metaUniqueInsight = z.object({ campaign_id: id, campaign_name: id, unique_link_clicks_ctr: numeric, reach: numeric });
const graphPaging = z.object({ next: z.string().optional(), cursors: z.object({ after: id.optional() }).optional() }).optional();
const MAX_PAGES = 100;

export function parseCampaignSiteMappings(raw: string | undefined): CampaignSiteMapping[] {
  const mappings = z.array(mappingSchema).parse(raw?.trim() ? JSON.parse(raw) : []);
  if (new Set(mappings.map((mapping) => mapping.siteId)).size !== mappings.length) {
    throw new Error("Elke site mag maar één accountkoppeling hebben.");
  }
  return mappings;
}

export async function getCampaignPerformance(dashboard: SiteAnalyticsDashboardData, options: Options = {}) {
  const env = options.env ?? process.env;
  let mappings: CampaignSiteMapping[];
  try {
    mappings = parseCampaignSiteMappings(env.CAMPAIGN_PERFORMANCE_SITES);
  } catch {
    return { rows: [] as CampaignPerformanceRow[], ...campaignProjectOverview(dashboard, []), facebookUniqueCtr: summarizeUniqueCtr([]), message: "De accountkoppelingen zijn ongeldig. Laat de dashboardbeheerder de configuratie nakijken." };
  }
  let projectMatches: CampaignProjectMatch[] = [], projectMessage = "";
  try {
    projectMatches = parseCampaignProjectMatches(options.projectMatches ?? (options.fetchImpl ? [] : await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY)));
  } catch {
    projectMessage = "De opgeslagen projectkoppelingen konden niet worden geladen. Alleen gecontroleerde advertentielinks worden gebruikt.";
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const signal = AbortSignal.timeout(45_000);
  const request = async (url: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await fetchImpl(url, {
      ...init, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    });
    // Never forward provider responses: they can contain tokens or contact details.
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    return response.json();
  };
  let googleToken: Promise<string> | undefined;
  const getGoogleToken = () => googleToken ??= (async () => {
    const token = z.object({ access_token: id }).parse(await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token", client_id: env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN!
      })
    }));
    return token.access_token;
  })();
  // Do not mix real account data with the WordPress demo sites.
  const sites = dashboard.source.mode === "live" ? dashboard.sites : [];
  const conversionRows = cvrOverviewRowsFromLinks(dashboard.cvrLinks);
  const rows: CampaignPerformanceRow[] = [];
  const uniqueCtrRequests = new Map<string, Promise<CampaignSource<UniqueCtrPerformance>>>();
  const destinationRequests = new Map<string, Promise<CampaignSource<CampaignDestinations>>>();
  // Bound concurrency across sites; each site's providers load independently.
  for (let offset = 0; offset < sites.length; offset += 3) {
    rows.push(...await Promise.all(sites.slice(offset, offset + 3).map(async (site) => {
      const mapping = mappings.find((item) => item.siteId === site.id);
      const explicitMatches = projectMatches.filter((match) => match.siteId === site.id && match.accountId === mapping?.facebook?.adAccountId);
      const facebookRequest = loadFacebook(mapping?.facebook);
      const [google, facebook, facebookUniqueCtr, destinations] = await Promise.all([
        loadGoogle(mapping?.google), facebookRequest, facebookRequest.then(loadCurrentFacebookUniqueCtr),
        facebookRequest.then((source) => loadFacebookDestinations(source.data ? {
          ...source, data: { ...source.data, campaigns: source.data.campaigns.filter((campaign) => !explicitMatches.some((match) => match.campaignId === campaign.id)) }
        } : source))
      ]);
      const siteProjects = conversionRows.filter((project) => project.siteId === site.id);
      const explicitPages = explicitMatches.filter((match) => facebook.data?.campaigns.some((campaign) => campaign.id === match.campaignId && campaign.live === true))
        .map((match) => ({ campaignId: match.campaignId,
          pages: matchCampaignPages(site.url, match.sourcePaths.map((path) => new URL(path, site.url).toString()), siteProjects) }));
      const facebookCampaignPages: CampaignSource<CampaignPageMatch[]> = destinations.data || explicitPages.length ? {
        state: "connected", message: destinations.state === "unavailable" ? "Niet alle nieuwe campagnes konden aan een projectpagina worden gekoppeld." : destinations.message,
        data: [...explicitPages, ...(destinations.data ?? []).map((campaign) => ({ campaignId: campaign.campaignId,
          pages: matchCampaignPages(site.url, campaign.urls, siteProjects) }))]
      } : destinations;
      // A verified destination on another website must not inherit this site's
      // CTR merely because both campaigns share an advertising account.
      const otherSiteCampaigns = new Set(destinations.data?.filter((campaign) => campaign.urls.length > 0
        && !facebookCampaignPages.data?.find((match) => match.campaignId === campaign.campaignId)?.pages.length).map((campaign) => campaign.campaignId));
      const scopedCampaigns = facebookUniqueCtr.data?.campaigns.filter((campaign) => !otherSiteCampaigns.has(campaign.id));
      const scopedUniqueCtr = facebookUniqueCtr.data && scopedCampaigns ? {
        ...facebookUniqueCtr,
        data: { ...facebookUniqueCtr.data, campaigns: scopedCampaigns, ctr: weightedCampaignCtr(scopedCampaigns) },
        message: facebookUniqueCtr.data.campaigns.length > 0 && scopedCampaigns.length === 0 ? "Geen lopende Ledoux-campagne voor deze website" : facebookUniqueCtr.message
      } : facebookUniqueCtr;
      return {
        siteId: site.id, name: site.name, url: site.url, google, facebook, facebookUniqueCtr: scopedUniqueCtr, facebookCampaignPages,
        leads: websiteConversions(site.id, "brochure"), appointments: websiteConversions(site.id, "appointment"),
        websiteCvr: site.cvrLinkCount > 0 && site.cvrSourceVisitors > 0 ? site.conversionRatePercent : null,
        websiteVisitors: site.cvrSourceVisitors, websiteConversions: site.cvrConversionVisitors
      };
    })));
  }
  // Use the same campaign measurements for website rows and totals. Deduplicate
  // campaign IDs across overlapping website mappings; never request account CTR.
  const facebookUniqueCtr = summarizeUniqueCtr(rows.map((row) => row.facebookUniqueCtr)
    .filter((source) => source.state !== "not_configured"));
  return {
    rows, facebookUniqueCtr, ...campaignProjectOverview(dashboard, rows),
    message: dashboard.source.mode === "demo"
      ? "Verbind eerst een website via de trackingcode of WordPress-plugin en koppel daarna de advertentieaccounts."
      : projectMessage
  };

  function loadCurrentFacebookUniqueCtr(source: CampaignSource<AdPerformance>): Promise<CampaignSource<UniqueCtrPerformance>> {
    if (!source.data) return Promise.resolve({ state: source.state, data: null, message: source.message });
    return loadFacebookUniqueCtr({ adAccountId: source.data.accountId, campaigns: source.data.campaigns.filter((campaign) => campaign.live === true) });
  }

  function loadFacebookDestinations(source: CampaignSource<AdPerformance>): Promise<CampaignSource<CampaignDestinations>> {
    if (!source.data) return Promise.resolve({ state: source.state, data: null, message: source.message });
    const campaignIds = source.data.campaigns.filter((campaign) => campaign.live === true).map((campaign) => campaign.id).sort();
    if (campaignIds.length === 0) return Promise.resolve({ state: "connected", data: [], message: "" });
    const key = JSON.stringify([source.data.accountId, campaignIds]);
    let pending = destinationRequests.get(key);
    if (!pending) {
      const cacheKey = `campaign-destinations:v1:${source.data.accountId}:${campaignIds.join(",")}`;
      const useCache = options.cacheCampaignPages ?? !options.fetchImpl;
      pending = (async () => {
        const cached = useCache ? await readJsonCache<CachedCampaignDestinations>(cacheKey).catch(() => null) : null;
        const age = cached ? now.getTime() - cached.checkedAt : Infinity;
        if (cached && age >= 0 && age < 15 * 60_000) return { state: "connected" as const, data: cached.data, message: "" };
        const result = await safely(async () => {
          const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
          const destinations = new Map(campaignIds.map((id) => [id, new Set<string>()]));
          // Query the campaign node directly: account-wide ad filtering is slow
          // on large accounts. Bound concurrency and read every campaign page.
          for (let offset = 0; offset < campaignIds.length; offset += 3) {
            await Promise.all(campaignIds.slice(offset, offset + 3).map(async (campaignId) => {
              const params = new URLSearchParams({
                fields: "campaign_id,creative{object_story_spec{link_data{link,child_attachments{link}},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},object_url,link_url}", limit: "25",
                filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }])
              });
              for (let page = 0; ; page++) {
                if (page === MAX_PAGES) throw new Error("Pagination limit");
                const result = z.object({ data: z.array(z.object({ campaign_id: id, creative: z.unknown().optional() })), paging: graphPaging }).parse(await request(
                  `https://graph.facebook.com/${version}/${campaignId}/ads?${params}`,
                  { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }
                ));
                for (const ad of result.data) {
                  if (ad.campaign_id !== campaignId) throw new Error("Unexpected campaign destination");
                  for (const url of facebookDestinationUrls(ad.creative)) destinations.get(campaignId)!.add(url);
                }
                if (!result.paging?.next) break;
                const after = result.paging.cursors?.after;
                if (!after || after === params.get("after")) throw new Error("Incomplete pagination");
                params.set("after", after);
              }
            }));
          }
          return [...destinations].map(([campaignId, urls]) => ({ campaignId, urls: [...urls] }));
        }, "De projectpagina van de campagne kon niet worden gecontroleerd.");
        if (useCache && result.data) await writeJsonCache(cacheKey, { checkedAt: now.getTime(), data: result.data }).catch(() => undefined);
        if (!result.data && cached && age >= 0 && age < 24 * 60 * 60_000) return {
          state: "connected" as const, data: cached.data,
          message: "Projectlinks uit de laatst geslaagde controle; Meta reageert tijdelijk niet."
        };
        return result;
      })();
      destinationRequests.set(key, pending);
    }
    return pending;
  }

  function loadFacebookUniqueCtr(config: FacebookUniqueScope): Promise<CampaignSource<UniqueCtrPerformance>> {
    if (!env.META_ADS_ACCESS_TOKEN) return Promise.resolve(missing("Facebook Ads is nog niet gekoppeld."));
    const campaignIds = [...new Set(config.campaigns.map((campaign) => campaign.id))].sort();
    // An empty live selection must never become an unfiltered account query.
    if (campaignIds.length === 0) return Promise.resolve({
      state: "connected", data: { accountId: config.adAccountId, campaigns: [], ctr: null },
      message: "Geen lopende Ledoux-campagne"
    });
    const key = JSON.stringify([config.adAccountId, campaignIds]);
    let pending = uniqueCtrRequests.get(key);
    if (!pending) {
      pending = safely(async () => {
        const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
        const params = new URLSearchParams({
          fields: "campaign_id,campaign_name,unique_link_clicks_ctr,reach", level: "campaign", time_increment: "all_days", limit: "100",
          time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }),
          filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }])
        });
        const insights = new Map<string, z.infer<typeof metaUniqueInsight>>();
        for (let page = 0; ; page++) {
          if (page === MAX_PAGES) throw new Error("Pagination limit");
          const result = z.object({ data: z.array(metaUniqueInsight), paging: graphPaging }).parse(await request(
            `https://graph.facebook.com/${version}/act_${config.adAccountId}/insights?${params}`,
            { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }
          ));
          for (const row of result.data) {
            if (!campaignIds.includes(row.campaign_id) || insights.has(row.campaign_id)) throw new Error("Unexpected or repeated campaign insight");
            insights.set(row.campaign_id, row);
          }
          if (!result.paging?.next) break;
          const after = result.paging.cursors?.after;
          if (!after || after === params.get("after")) throw new Error("Incomplete pagination");
          params.set("after", after);
        }
        const campaigns = config.campaigns.map((campaign): CampaignUniqueCtr => {
          const row = insights.get(campaign.id);
          if (!campaign.name || (!row && campaign.impressions > 0)) throw new Error("Missing campaign measurement");
          return { id: campaign.id, name: campaign.name, reach: row?.reach ?? 0,
            ctr: row && row.reach > 0 ? row.unique_link_clicks_ctr : null };
        });
        return { accountId: config.adAccountId, campaigns, ctr: weightedCampaignCtr(campaigns) };
      }, "Facebook unieke link-CTR kon niet worden geladen. Probeer opnieuw of kies een kortere periode.");
      uniqueCtrRequests.set(key, pending);
    }
    return pending;
  }

  async function loadGoogle(config: CampaignSiteMapping["google"]): Promise<CampaignSource<AdPerformance>> {
    if (!config || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return missing("Google Ads is nog niet gekoppeld.");
    }
    return safely(async () => {
      const version = z.string().regex(/^v\d+$/).parse(env.GOOGLE_ADS_API_VERSION ?? "v25");
      const headers: Record<string, string> = { Authorization: `Bearer ${await getGoogleToken()}`, "Content-Type": "application/json" };
      if (env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
      const loginId = config.loginCustomerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
      if (loginId) headers["login-customer-id"] = googleId.parse(loginId);
      const query = async (text: string) => {
        const chunks = z.array(z.object({ results: z.array(googleRow).optional() })).parse(await request(
          `https://googleads.googleapis.com/${version}/customers/${config.customerId}/googleAds:searchStream`,
          { method: "POST", headers, body: JSON.stringify({ query: text }) }
        ));
        return chunks.flatMap((chunk) => chunk.results ?? []);
      };
      const filter = config.campaignIds ? `campaign.id IN (${config.campaignIds.join(",")})` : "campaign.status != 'REMOVED'";
      const [account, statuses, metrics] = await Promise.all([
        query("SELECT customer.currency_code FROM customer LIMIT 1"),
        query(`SELECT campaign.id, campaign.status, campaign.primary_status FROM campaign WHERE ${filter}`),
        query(`SELECT campaign.id, metrics.clicks, metrics.impressions, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${dashboard.period.start}' AND '${dashboard.period.end}'${config.campaignIds ? ` AND ${filter}` : ""}`)
      ]);
      const currency = currencyCode(account[0]?.customer?.currencyCode);
      const campaigns = new Map<string, AdCampaign>();
      for (const row of statuses) {
        if (!row.campaign) throw new Error("Missing campaign");
        const { id: campaignId, status, primaryStatus } = row.campaign;
        campaigns.set(campaignId, {
          id: campaignId, clicks: 0, impressions: 0, spend: 0,
          live: status !== "ENABLED" ? false
            : !primaryStatus || ["UNKNOWN", "UNSPECIFIED"].includes(primaryStatus) ? null
            : ["ELIGIBLE", "LIMITED", "LEARNING"].includes(primaryStatus)
        });
      }
      for (const row of metrics) {
        if (!row.campaign || !row.metrics) throw new Error("Missing metrics");
        const campaign = campaigns.get(row.campaign.id) ?? { id: row.campaign.id, live: false, clicks: 0, impressions: 0, spend: 0 };
        campaign.clicks += row.metrics.clicks ?? 0;
        campaign.impressions += row.metrics.impressions ?? 0;
        campaign.spend += (row.metrics.costMicros ?? 0) / 1_000_000;
        campaigns.set(campaign.id, campaign);
      }
      if (config.campaignIds?.some((campaignId) => !campaigns.has(campaignId))) throw new Error("Campaign mapping not found");
      return { accountId: config.customerId, currency, campaigns: [...campaigns.values()] };
    }, "Google Ads kon niet worden geladen. Controleer de accountkoppeling en toegangsrechten.");
  }

  async function loadFacebook(config: CampaignSiteMapping["facebook"]): Promise<CampaignSource<AdPerformance>> {
    if (!config || !env.META_ADS_ACCESS_TOKEN) return missing("Facebook Ads is nog niet gekoppeld.");
    return safely(async () => {
      const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
      const graph = async (path: string, params: Record<string, string>) => request(
        `https://graph.facebook.com/${version}/${path}?${new URLSearchParams(params)}`,
        { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }
      );
      const list = async <T extends z.ZodTypeAny>(path: string, params: Record<string, string>, schema: T): Promise<z.output<T>[]> => {
        const rows: z.output<T>[] = [];
        let after: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = z.object({ data: z.array(schema), paging: graphPaging }).parse(await graph(path, { ...params, limit: "100", ...(after ? { after } : {}) }));
          rows.push(...result.data);
          if (!result.paging?.next) return rows;
          const next = result.paging.cursors?.after;
          if (!next || next === after) throw new Error("Incomplete pagination");
          after = next;
        }
        throw new Error("Pagination limit");
      };
      const accountPath = `act_${config.adAccountId}`;
      const [account, statuses, metrics] = await Promise.all([
        graph(accountPath, { fields: "currency,account_status" }).then((value) => z.object({ currency: id, account_status: numeric }).parse(value)),
        list(`${accountPath}/campaigns`, { fields: "id,name,effective_status,start_time,stop_time" }, metaCampaign),
        list(`${accountPath}/insights`, {
          fields: "campaign_id,campaign_name,clicks,impressions,spend", level: "campaign",
          time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }),
          ...(config.campaignIds ? { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: config.campaignIds }]) } : {})
        }, metaInsight)
      ]);
      const campaigns = new Map<string, AdCampaign>();
      const currentNames = new Map(statuses.map((campaign) => [campaign.id, campaign.name]));
      const knownIds = new Set([...currentNames.keys(), ...metrics.map((row) => row.campaign_id)]);
      for (const campaign of statuses) {
        if (config.campaignIds && !config.campaignIds.includes(campaign.id)) continue;
        if (!isLedouxCampaign(campaign.name)) continue;
        const start = campaign.start_time ? Date.parse(campaign.start_time) : -Infinity;
        const end = campaign.stop_time ? Date.parse(campaign.stop_time) : Infinity;
        if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Invalid campaign schedule");
        campaigns.set(campaign.id, {
          id: campaign.id, name: campaign.name, live: account.account_status === 1 && campaign.effective_status === "ACTIVE" && start <= now.getTime() && end > now.getTime(),
          clicks: 0, impressions: 0, spend: 0
        });
      }
      for (const row of metrics) {
        if (config.campaignIds && !config.campaignIds.includes(row.campaign_id)) continue;
        // Current names take precedence; historical-only rows must also identify a Ledoux campaign.
        if (!isLedouxCampaign(currentNames.get(row.campaign_id) ?? row.campaign_name)) continue;
        const campaign = campaigns.get(row.campaign_id) ?? { id: row.campaign_id, name: row.campaign_name, live: false, clicks: 0, impressions: 0, spend: 0 };
        campaign.clicks += row.clicks ?? 0;
        campaign.impressions += row.impressions;
        campaign.spend += row.spend;
        campaigns.set(campaign.id, campaign);
      }
      if (config.campaignIds?.some((campaignId) => !knownIds.has(campaignId))) throw new Error("Campaign mapping not found");
      return { accountId: config.adAccountId, currency: currencyCode(account.currency), campaigns: [...campaigns.values()] };
    }, "Facebook Ads kon niet worden geladen. Controleer de accountkoppeling en toegangsrechten.");
  }

  function websiteConversions(siteId: string, column: "brochure" | "appointment"): CampaignSource<WebsiteConversionPerformance> {
    const projects = conversionRows.filter((row) => row.siteId === siteId);
    if (projects.length === 0) return missing("Koppel de bedankpagina’s in Websiteprestaties om leads en afspraken te meten.");
    return {
      state: "connected", message: "",
      data: { siteId, count: projects.reduce((sum, row) => sum + row[column].visitors, 0) }
    };
  }
}

function isLedouxCampaign(name: string) {
  return name.toLowerCase().includes("ledoux");
}

function facebookDestinationUrls(creative: unknown): string[] {
  if (!creative || typeof creative !== "object" || Array.isArray(creative)) return [];
  const record = creative as Record<string, unknown>;
  const urls = ["link", "website_url", "object_url", "link_url"].flatMap((key) => typeof record[key] === "string" ? [record[key] as string] : []);
  // Read only destination fields, never match against ad copy or image URLs.
  for (const key of ["object_story_spec", "link_data", "video_data", "template_data", "call_to_action", "value", "child_attachments", "asset_feed_spec", "link_urls"]) {
    const value = record[key];
    for (const child of Array.isArray(value) ? value : [value]) urls.push(...facebookDestinationUrls(child));
  }
  return urls;
}

function matchCampaignPages(siteUrl: string, destinations: string[], projects: CvrOverviewRow[]): CampaignPageMatch["pages"] {
  const site = new URL(siteUrl);
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  const pagePath = (url: URL) => (url.pathname.replace(/\/+$/, "") || "/")
    + (url.searchParams.has("p_slug") ? `?${new URLSearchParams({ p_slug: url.searchParams.get("p_slug")! })}` : "");
  const pages = new Map<string, CampaignPageMatch["pages"][number]>();
  const sitePath = site.pathname.replace(/\/+$/, "");
  for (const destination of destinations) {
    let url: URL;
    try { url = new URL(destination); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port !== site.port || host(url) !== host(site)) continue;
    if (sitePath && url.pathname !== sitePath && !url.pathname.startsWith(`${sitePath}/`)) continue;
    const path = pagePath(url);
    const project = projects.find((candidate) => pagePath(new URL(candidate.sourcePath, site)) === path);
    // Keep project selectors; remove tracking parameters and URL fragments.
    url.search = "";
    if (path.includes("?")) url.search = path.slice(path.indexOf("?"));
    url.hash = "";
    pages.set(path, { url: url.toString(), path, title: project?.sourceTitle || path, hasConversionMapping: !!project });
  }
  return [...pages.values()];
}

function missing<T>(message: string): CampaignSource<T> {
  return { state: "not_configured", data: null, message };
}

async function safely<T>(load: () => Promise<T>, message: string): Promise<CampaignSource<T>> {
  try {
    return { state: "connected", data: await load(), message: "" };
  } catch {
    return { state: "unavailable", data: null, message };
  }
}

function currencyCode(value: unknown) {
  const code = z.string().regex(/^[A-Z]{3}$/).parse(value);
  new Intl.NumberFormat("nl-BE", { style: "currency", currency: code });
  return code;
}

export function summarizeAds(sources: CampaignSource<AdPerformance>[]) {
  const campaigns = new Map<string, AdCampaign>();
  const spendByCurrency = new Map<string, number>();
  let connected = 0;
  for (const source of sources) {
    if (!source.data) continue;
    connected++;
    if (!spendByCurrency.has(source.data.currency)) spendByCurrency.set(source.data.currency, 0);
    for (const campaign of source.data.campaigns) {
      const key = `${source.data.accountId}:${campaign.id}`;
      if (campaigns.has(key)) continue;
      campaigns.set(key, campaign);
      spendByCurrency.set(source.data.currency, (spendByCurrency.get(source.data.currency) ?? 0) + campaign.spend);
    }
  }
  const values = [...campaigns.values()];
  const clicks = values.reduce((sum, campaign) => sum + campaign.clicks, 0);
  const impressions = values.reduce((sum, campaign) => sum + campaign.impressions, 0);
  return {
    connected, total: sources.length, liveCount: values.filter((campaign) => campaign.live === true).length,
    unknownCount: values.filter((campaign) => campaign.live === null).length, campaignCount: values.length,
    ctr: connected > 0 && impressions > 0 ? clicks / impressions * 100 : null,
    spend: [...spendByCurrency].map(([currency, amount]) => ({ currency, amount }))
  };
}

export function summarizeWebsiteConversions(sources: CampaignSource<WebsiteConversionPerformance>[]) {
  const sites = new Map<string, number>();
  let connected = 0;
  for (const source of sources) {
    if (!source.data) continue;
    connected++;
    sites.set(source.data.siteId, source.data.count);
  }
  return { connected, total: sources.length, count: connected > 0 ? [...sites.values()].reduce((sum, count) => sum + count, 0) : null };
}

function weightedCampaignCtr(campaigns: CampaignUniqueCtr[]): number | null {
  const measured = campaigns.filter((campaign) => campaign.reach > 0);
  if (measured.length === 0 || measured.some((campaign) => campaign.ctr === null)) return null;
  if (measured.length === 1) return measured[0].ctr;
  const reach = measured.reduce((sum, campaign) => sum + campaign.reach, 0);
  return measured.reduce((sum, campaign) => sum + campaign.ctr! * campaign.reach, 0) / reach;
}

// Campaign rates are weighted by campaign reach, not a deduplicated audience.
// The same campaign appearing under multiple websites contributes only once.
export function summarizeUniqueCtr(sources: CampaignSource<UniqueCtrPerformance>[]): UniqueCtrSummary {
  const unavailable = sources.some((source) => source.state !== "connected");
  const campaigns = new Map<string, CampaignUniqueCtr>();
  for (const source of sources) {
    if (!source.data) continue;
    for (const campaign of source.data.campaigns) campaigns.set(`${source.data.accountId}:${campaign.id}`, campaign);
  }
  return {
    campaigns: campaigns.size, unavailable,
    ctr: unavailable ? null : weightedCampaignCtr([...campaigns.values()])
  };
}

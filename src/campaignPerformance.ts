import { z } from "zod";
import { facebookDestinationUrls, matchCampaignPages } from "./campaignDestinations.js";
import { discoverMetaAccounts, type MetaAccountSync } from "./metaAccountDiscovery.js";
import type { SiteAnalyticsDashboardData } from "./siteAnalytics.js";
import { cvrOverviewRowsFromLinks } from "./siteAnalyticsConversions.js";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, META_DISCOVERED_PROJECT_MATCHES_KEY, campaignProjectOverview, normalizeProjectPath, parseCampaignProjectMatches, type CampaignProjectMatch } from "./campaignProjects.js";
import { ghlAppointmentsByPipeline, type GhlReadCall } from "./ghl/appointmentConversions.js";

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
export type CampaignLinkCtr = { id: string; name: string; impressions: number; ctr: number | null };
export type LinkCtrPerformance = { accountId: string; campaigns: CampaignLinkCtr[]; ctr: number | null };
export type LinkCtrSummary = { ctr: number | null; campaigns: number; unavailable: boolean };
export type CampaignPageMatch = {
  campaignId: string;
  pages: { url: string; path: string; title: string; hasConversionMapping: boolean }[];
};
export type WebsiteConversionPerformance = { siteId: string; count: number };
export type FacebookAccountPerformance = {
  facebook: CampaignSource<AdPerformance>;
  facebookLinkCtr: CampaignSource<LinkCtrPerformance>;
  facebookCampaignPages: CampaignSource<CampaignPageMatch[]>;
};
export type CampaignPerformanceRow = {
  siteId: string;
  name: string;
  url: string;
  google: CampaignSource<AdPerformance>;
  googleCampaignPages: CampaignSource<CampaignPageMatch[]>;
  facebook: CampaignSource<AdPerformance>;
  facebookLinkCtr: CampaignSource<LinkCtrPerformance>;
  facebookCampaignPages: CampaignSource<CampaignPageMatch[]>;
  facebookAccounts?: FacebookAccountPerformance[];
  leads: CampaignSource<WebsiteConversionPerformance>;
  appointments: CampaignSource<WebsiteConversionPerformance>;
  websiteCvr: number | null;
  websiteVisitors: number;
  websiteConversions: number;
};

const id = z.string().trim().min(1);
const numericId = id.regex(/^\d+$/);
const googleId = id.transform((value) => value.replace(/-/g, "")).pipe(numericId);
const googleCampaignNameProject = z.object({
  campaignNameIncludes: id,
  sourcePath: id.refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), "Use a local project path")
    .transform(normalizeProjectPath)
}).strict();
const mappingSchema = z.object({
  siteId: id,
  google: z.object({ customerId: googleId, loginCustomerId: googleId.optional(), campaignIds: z.array(numericId).min(1).optional(),
    campaignNameProjects: z.array(googleCampaignNameProject).min(1).optional() }).strict().optional(),
  facebook: z.object({ adAccountId: id.transform((value) => value.replace(/^act_/, "")).pipe(numericId), campaignIds: z.array(numericId).min(1).optional() }).strict().optional(),
  ghl: z.object({ locationId: id, installId: id.optional(), pipelineIds: z.array(id).min(1).optional(),
    pipelineProjects: z.array(z.object({ pipelineId: id, sourcePath: id })).optional(), calendarIds: z.array(id).min(1).optional() }).strict().optional()
}).strict();
export type CampaignSiteMapping = z.infer<typeof mappingSchema>;
type FacebookAccountScope = NonNullable<CampaignSiteMapping["facebook"]> & { requiredCampaignIds?: string[] };
type FacebookLinkScope = { adAccountId: string; campaigns: AdCampaign[] };
type CampaignDestinations = { campaignId: string; urls: string[] }[];
type CachedCampaignDestinations = { checkedAt: number; data: CampaignDestinations };
type Env = Record<string, string | undefined>;
type Options = {
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: Date;
  cacheCampaignPages?: boolean;
  projectMatches?: CampaignProjectMatch[];
  forceMetaSync?: boolean;
  discoverySites?: { id: string; name: string; url: string }[];
  ghlCall?: GhlReadCall;
};

const numeric = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const googleRow = z.object({
  customer: z.object({ currencyCode: id }).optional(),
  campaign: z.object({ id, name: id.optional(), status: id.optional(), primaryStatus: id.optional() }).optional(),
  metrics: z.object({ clicks: numeric.optional(), impressions: numeric.optional(), costMicros: numeric.optional() }).optional()
});
const googleDestinationRow = z.object({
  campaign: z.object({ id: numericId }),
  adGroupAd: z.object({ ad: z.object({ finalUrls: z.array(id).optional(), finalMobileUrls: z.array(id).optional() }) }).optional(),
  assetGroup: z.object({ finalUrls: z.array(id).optional(), finalMobileUrls: z.array(id).optional() }).optional()
});
const metaCampaign = z.object({ id, name: id, effective_status: id, start_time: id.optional(), stop_time: id.optional() });
const metaInsight = z.object({ campaign_id: id, campaign_name: id, clicks: numeric.optional(), impressions: numeric, spend: numeric });
const metaLinkInsight = z.object({ campaign_id: id, campaign_name: id, inline_link_click_ctr: numeric, impressions: numeric });
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
    return { metaSync: undefined as MetaAccountSync | undefined, rows: [] as CampaignPerformanceRow[], ...campaignProjectOverview(dashboard, []), facebookLinkCtr: summarizeLinkCtr([]), message: "De accountkoppelingen zijn ongeldig. Laat de dashboardbeheerder de configuratie nakijken." };
  }
  let projectMatches: CampaignProjectMatch[] = [], projectMessage = "";
  try {
    projectMatches = parseCampaignProjectMatches(options.projectMatches ?? (options.fetchImpl ? [] : await readJsonCache(CAMPAIGN_PROJECT_MATCHES_KEY)));
  } catch {
    projectMessage = "De opgeslagen projectkoppelingen konden niet worden geladen. Alleen gecontroleerde advertentielinks worden gebruikt.";
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  // Do not discover real ad accounts when the dashboard is in demo mode.
  const sites = dashboard.source.mode === "live" ? dashboard.sites : [];
  const discovery = await discoverMetaAccounts({ sites: sites.length ? options.discoverySites ?? sites : [], env, now,
    fetchImpl: options.fetchImpl, force: options.forceMetaSync });
  const savedMatches = new Set(projectMatches.map((match) => `${match.channel ?? "facebook"}:${match.siteId}:${match.accountId}:${match.campaignId}`));
  projectMatches.push(...discovery.matches.filter((match) => !savedMatches.has(`facebook:${match.siteId}:${match.accountId}:${match.campaignId}`)));
  // Also expose verified pages to Data management without querying Meta from that tab.
  if (!options.fetchImpl && discovery.sync.state === "connected" && !discovery.sync.message) {
    await writeJsonCache(META_DISCOVERED_PROJECT_MATCHES_KEY, discovery.matches).catch(() => undefined);
  }
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
  const conversionRows = cvrOverviewRowsFromLinks(dashboard.cvrLinks);
  const ghlProjects = await getGhlProjectAppointments(dashboard, { env, ghlCall: options.ghlCall, mappings });
  const rows: CampaignPerformanceRow[] = [];
  const linkCtrRequests = new Map<string, Promise<CampaignSource<LinkCtrPerformance>>>();
  const destinationRequests = new Map<string, Promise<CampaignSource<CampaignDestinations>>>();
  const facebookRequests = new Map<string, Promise<CampaignSource<AdPerformance>>>();
  // A website can receive campaigns from several accessible Meta accounts.
  for (let offset = 0; offset < sites.length; offset += 3) {
    rows.push(...await Promise.all(sites.slice(offset, offset + 3).map(async (site) => {
      const mapping = mappings.find((item) => item.siteId === site.id);
      const scopes = new Map<string, FacebookAccountScope>();
      if (mapping?.facebook) scopes.set(mapping.facebook.adAccountId, { ...mapping.facebook, requiredCampaignIds: mapping.facebook.campaignIds });
      for (const match of discovery.matches.filter((match) => match.siteId === site.id)) {
        const scope = scopes.get(match.accountId);
        if (!scope) scopes.set(match.accountId, { adAccountId: match.accountId, campaignIds: [match.campaignId], requiredCampaignIds: [] });
        else if (scope.campaignIds) scope.campaignIds = [...new Set([...scope.campaignIds, match.campaignId])];
      }
      const googleMatches = projectMatches.filter((match) => match.channel === "google" && match.siteId === site.id && match.accountId === mapping?.google?.customerId);
      const googleRequest = loadGoogle(mapping?.google);
      const [google, facebookAccounts, appointments] = await Promise.all([
        googleRequest,
        Promise.all((scopes.size ? [...scopes.values()] : [undefined]).map((scope) => facebookForSite(site, scope))),
        loadGhlAppointments(site.id, mapping?.ghl, ghlProjects)
      ]);
      const siteProjects = conversionRows.filter((project) => project.siteId === site.id);
      const googleExplicitPages = googleMatches.filter((match) => google.data?.campaigns.some((campaign) => campaign.id === match.campaignId))
        .map((match) => ({ campaignId: match.campaignId,
          pages: matchCampaignPages(site.url, match.sourcePaths.map((path) => new URL(path, site.url).toString()), siteProjects) }));
      const googleNamePages = (mapping?.google?.campaignNameProjects ?? []).flatMap((rule) =>
        (google.data?.campaigns ?? []).filter((campaign) => campaign.name?.toLocaleLowerCase().includes(rule.campaignNameIncludes.toLocaleLowerCase()))
          .map((campaign) => ({ campaignId: campaign.id,
            pages: matchCampaignPages(site.url, [new URL(rule.sourcePath, site.url).toString()], siteProjects) })));
      const fixedGoogleIds = [...new Set([...googleMatches.map((match) => match.campaignId), ...googleNamePages.map((match) => match.campaignId)])];
      const googleDestinations = await loadGoogleDestinations(mapping?.google, google, fixedGoogleIds);
      const googleCampaignPages: CampaignSource<CampaignPageMatch[]> = googleDestinations.data || googleExplicitPages.length || googleNamePages.length ? {
        state: "connected", message: googleDestinations.state === "unavailable" ? "Niet alle Google-campagnes konden aan een projectpagina worden gekoppeld." : "",
        data: [...googleExplicitPages, ...googleNamePages, ...(googleDestinations.data ?? []).map((campaign) => ({ campaignId: campaign.campaignId,
          pages: matchCampaignPages(site.url, campaign.urls, siteProjects) }))]
      } : googleDestinations;
      return {
        siteId: site.id, name: site.name, url: site.url, google, googleCampaignPages, ...facebookAccounts[0], facebookAccounts,
        leads: websiteConversions(site.id, "brochure"), appointments,
        websiteCvr: site.cvrLinkCount > 0 && site.cvrSourceVisitors > 0 ? site.conversionRatePercent : null,
        websiteVisitors: site.cvrSourceVisitors, websiteConversions: site.cvrConversionVisitors
      };
    })));
  }
  // Use the same campaign measurements for website rows and totals. Deduplicate
  // campaign IDs across overlapping website mappings; never request account CTR.
  const facebookLinkCtr = summarizeLinkCtr(rows.flatMap((row) => facebookAccountSources(row).map((account) => account.facebookLinkCtr))
    .filter((source) => source.state !== "not_configured"));
  for (const account of discovery.sync.accounts) {
    const configuredSites = (options.discoverySites ?? sites).filter((site) => mappings.some((mapping) => mapping.siteId === site.id && mapping.facebook?.adAccountId === account.id));
    account.siteNames = [...new Set([...account.siteNames, ...configuredSites.map((site) => site.name)])];
  }
  return {
    rows, facebookLinkCtr, metaSync: discovery.sync, ...campaignProjectOverview(dashboard, rows, ghlProjects.counts),
    message: dashboard.source.mode === "demo"
      ? "Verbind eerst een website via de trackingcode of WordPress-plugin en koppel daarna de advertentieaccounts."
      : projectMessage
  };

  async function facebookForSite(site: SiteAnalyticsDashboardData["sites"][number], config: FacebookAccountScope | undefined): Promise<FacebookAccountPerformance> {
    const key = JSON.stringify(config);
    if (!facebookRequests.has(key)) facebookRequests.set(key, loadFacebook(config));
    const facebook = await facebookRequests.get(key)!;
    const explicitMatches = projectMatches.filter((match) => (match.channel ?? "facebook") === "facebook" && match.siteId === site.id && match.accountId === config?.adAccountId);
    const [facebookLinkCtr, destinations] = await Promise.all([
      loadPeriodFacebookLinkCtr(facebook),
      loadFacebookDestinations(facebook.data ? { ...facebook, data: { ...facebook.data,
        campaigns: facebook.data.campaigns.filter((campaign) => !explicitMatches.some((match) => match.campaignId === campaign.id)) } } : facebook)
    ]);
    const siteProjects = conversionRows.filter((project) => project.siteId === site.id);
    const explicitPages = explicitMatches.filter((match) => facebook.data?.campaigns.some((campaign) => campaign.id === match.campaignId))
      .map((match) => ({ campaignId: match.campaignId,
        pages: matchCampaignPages(site.url, match.sourcePaths.map((path) => new URL(path, site.url).toString()), siteProjects) }));
    const facebookCampaignPages: CampaignSource<CampaignPageMatch[]> = destinations.data || explicitPages.length ? {
      state: "connected", message: destinations.state === "unavailable" ? "Niet alle nieuwe campagnes konden aan een projectpagina worden gekoppeld." : destinations.message,
      data: [...explicitPages, ...(destinations.data ?? []).map((campaign) => ({ campaignId: campaign.campaignId,
        pages: matchCampaignPages(site.url, campaign.urls, siteProjects) }))]
    } : destinations;
    const otherSiteCampaigns = new Set(destinations.data?.filter((campaign) => campaign.urls.length > 0
      && !facebookCampaignPages.data?.find((match) => match.campaignId === campaign.campaignId)?.pages.length).map((campaign) => campaign.campaignId));
    const scopedCampaigns = facebookLinkCtr.data?.campaigns.filter((campaign) => !otherSiteCampaigns.has(campaign.id));
    const scopedLinkCtr = facebookLinkCtr.data && scopedCampaigns ? {
      ...facebookLinkCtr, data: { ...facebookLinkCtr.data, campaigns: scopedCampaigns, ctr: weightedCampaignCtr(scopedCampaigns) },
      message: facebookLinkCtr.data.campaigns.length > 0 && scopedCampaigns.length === 0 ? "Geen Ledoux-campagne voor deze website in de gekozen periode" : facebookLinkCtr.message
    } : facebookLinkCtr;
    return { facebook, facebookLinkCtr: scopedLinkCtr, facebookCampaignPages };
  }

  function loadPeriodFacebookLinkCtr(source: CampaignSource<AdPerformance>): Promise<CampaignSource<LinkCtrPerformance>> {
    if (!source.data) return Promise.resolve({ state: source.state, data: null, message: source.message });
    return loadFacebookLinkCtr({ adAccountId: source.data.accountId, campaigns: source.data.campaigns.filter((campaign) => campaign.live === true || campaign.impressions > 0 || campaign.spend > 0) });
  }

  function loadFacebookDestinations(source: CampaignSource<AdPerformance>): Promise<CampaignSource<CampaignDestinations>> {
    if (!source.data) return Promise.resolve({ state: source.state, data: null, message: source.message });
    const campaigns = source.data.campaigns.filter((campaign) => campaign.live === true || campaign.impressions > 0 || campaign.spend > 0);
    const campaignIds = campaigns.map((campaign) => campaign.id).sort();
    const historicalIds = campaigns.filter((campaign) => campaign.live !== true).map((campaign) => campaign.id).sort();
    if (campaignIds.length === 0) return Promise.resolve({ state: "connected", data: [], message: "" });
    const key = JSON.stringify([source.data.accountId, campaignIds, historicalIds, dashboard.period.start, dashboard.period.end]);
    let pending = destinationRequests.get(key);
    if (!pending) {
      const cacheKey = `campaign-destinations:v2:${source.data.accountId}:${campaignIds.join(",")}:${historicalIds.join(",")}:${dashboard.period.start}:${dashboard.period.end}`;
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
              const periodAds = historicalIds.includes(campaignId) ? await historicalAdIds(campaignId, version) : null;
              const foundAds = new Set<string>();
              const params = new URLSearchParams({
                fields: "id,campaign_id,creative{object_story_spec{link_data{link,child_attachments{link}},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},object_url,link_url}", limit: "25",
                ...(periodAds ? {} : { filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]) })
              });
              for (let page = 0; ; page++) {
                if (page === MAX_PAGES) throw new Error("Pagination limit");
                const result = z.object({ data: z.array(z.object({ id: numericId.optional(), campaign_id: id, creative: z.unknown().optional() })), paging: graphPaging }).parse(await request(
                  `https://graph.facebook.com/${version}/${campaignId}/ads?${params}`,
                  { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }
                ));
                for (const ad of result.data) {
                  if (ad.campaign_id !== campaignId) throw new Error("Unexpected campaign destination");
                  if (periodAds) {
                    if (!ad.id) throw new Error("Missing historical ad ID");
                    if (!periodAds.has(ad.id)) continue;
                    foundAds.add(ad.id);
                  }
                  for (const url of facebookDestinationUrls(ad.creative)) destinations.get(campaignId)!.add(url);
                }
                if (!result.paging?.next) break;
                const after = result.paging.cursors?.after;
                if (!after || after === params.get("after")) throw new Error("Incomplete pagination");
                params.set("after", after);
              }
              if (periodAds && [...periodAds].some((adId) => !foundAds.has(adId))) throw new Error("Incomplete historical ad destinations");
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

  async function historicalAdIds(campaignId: string, version: string): Promise<Set<string>> {
    const params = new URLSearchParams({ fields: "ad_id,campaign_id,impressions,spend", level: "ad", limit: "100",
      time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }) });
    const ids = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = z.object({ data: z.array(z.object({ ad_id: numericId, campaign_id: numericId, impressions: numeric, spend: numeric })), paging: graphPaging })
        .parse(await request(`https://graph.facebook.com/${version}/${campaignId}/insights?${params}`, { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }));
      for (const ad of result.data) {
        if (ad.campaign_id !== campaignId) throw new Error("Unexpected historical campaign");
        if (ad.impressions > 0 || ad.spend > 0) ids.add(ad.ad_id);
      }
      if (!result.paging?.next) {
        if (!ids.size) throw new Error("Missing historical ad measurements");
        return ids;
      }
      const after = result.paging.cursors?.after;
      if (!after || after === params.get("after")) throw new Error("Incomplete historical ad pagination");
      params.set("after", after);
    }
    throw new Error("Historical ad pagination limit");
  }

  function loadFacebookLinkCtr(config: FacebookLinkScope): Promise<CampaignSource<LinkCtrPerformance>> {
    if (!env.META_ADS_ACCESS_TOKEN) return Promise.resolve(missing("Facebook Ads is nog niet gekoppeld."));
    const campaignIds = [...new Set(config.campaigns.map((campaign) => campaign.id))].sort();
    // An empty period/live selection must never become an unfiltered account query.
    if (campaignIds.length === 0) return Promise.resolve({
      state: "connected", data: { accountId: config.adAccountId, campaigns: [], ctr: null },
      message: "Geen Ledoux-campagne met vertoningen in deze periode"
    });
    const key = JSON.stringify([config.adAccountId, campaignIds]);
    let pending = linkCtrRequests.get(key);
    if (!pending) {
      pending = safely(async () => {
        const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
        const params = new URLSearchParams({
          fields: "campaign_id,campaign_name,inline_link_click_ctr,impressions", level: "campaign", time_increment: "all_days", limit: "100",
          time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }),
          filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }])
        });
        const insights = new Map<string, z.infer<typeof metaLinkInsight>>();
        for (let page = 0; ; page++) {
          if (page === MAX_PAGES) throw new Error("Pagination limit");
          const result = z.object({ data: z.array(metaLinkInsight), paging: graphPaging }).parse(await request(
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
        const campaigns = config.campaigns.map((campaign): CampaignLinkCtr => {
          const row = insights.get(campaign.id);
          if (!campaign.name || (!row && campaign.impressions > 0)) throw new Error("Missing campaign measurement");
          return { id: campaign.id, name: campaign.name, impressions: row?.impressions ?? 0,
            ctr: row && row.impressions > 0 ? row.inline_link_click_ctr : null };
        });
        return { accountId: config.adAccountId, campaigns, ctr: weightedCampaignCtr(campaigns) };
      }, "Facebook link-CTR kon niet worden geladen. Probeer opnieuw of kies een kortere periode.");
      linkCtrRequests.set(key, pending);
    }
    return pending;
  }

  async function googleQuery<T extends z.ZodTypeAny>(config: NonNullable<CampaignSiteMapping["google"]>, text: string, schema: T): Promise<z.output<T>[]> {
    const version = z.string().regex(/^v\d+$/).parse(env.GOOGLE_ADS_API_VERSION ?? "v25");
    const headers: Record<string, string> = { Authorization: `Bearer ${await getGoogleToken()}`, "Content-Type": "application/json" };
    if (env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const loginId = config.loginCustomerId ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (loginId) headers["login-customer-id"] = googleId.parse(loginId);
    const chunks = z.array(z.object({ results: z.array(schema).optional() })).parse(await request(
      `https://googleads.googleapis.com/${version}/customers/${config.customerId}/googleAds:searchStream`,
      { method: "POST", headers, body: JSON.stringify({ query: text }) }
    ));
    return chunks.flatMap((chunk) => chunk.results ?? []);
  }

  async function loadGoogleDestinations(config: CampaignSiteMapping["google"], source: CampaignSource<AdPerformance>, matchedIds: string[]): Promise<CampaignSource<CampaignDestinations>> {
    if (!source.data) return { state: source.state, data: null, message: source.message };
    const campaignIds = source.data.campaigns.map((campaign) => campaign.id).filter((id) => !matchedIds.includes(id));
    if (!campaignIds.length) return { state: "connected", data: [], message: "" };
    return safely(async () => {
      if (!config) throw new Error("Missing Google account");
      const filter = `campaign.id IN (${campaignIds.map((value) => numericId.parse(value)).join(",")})`;
      const [ads, groups] = await Promise.all([
        googleQuery(config, `SELECT campaign.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.final_mobile_urls FROM ad_group_ad WHERE ${filter} AND ad_group_ad.status != 'REMOVED'`, googleDestinationRow),
        googleQuery(config, `SELECT campaign.id, asset_group.final_urls, asset_group.final_mobile_urls FROM asset_group WHERE ${filter} AND asset_group.status != 'REMOVED'`, googleDestinationRow)
      ]);
      const destinations = new Map(campaignIds.map((id) => [id, new Set<string>()]));
      for (const row of [...ads, ...groups]) {
        const urls = destinations.get(row.campaign.id);
        if (!urls) throw new Error("Unexpected Google campaign destination");
        const destination = row.adGroupAd?.ad ?? row.assetGroup;
        if (!destination) throw new Error("Missing Google destination fields");
        for (const url of [...destination.finalUrls ?? [], ...destination.finalMobileUrls ?? []]) urls.add(url);
      }
      return [...destinations].map(([campaignId, urls]) => ({ campaignId, urls: [...urls] }));
    }, "De projectpagina’s van Google Ads konden niet worden gecontroleerd.");
  }

  async function loadGoogle(config: CampaignSiteMapping["google"]): Promise<CampaignSource<AdPerformance>> {
    if (!config || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_REFRESH_TOKEN) {
      return missing("Google Ads is nog niet gekoppeld.");
    }
    return safely(async () => {
      const query = (text: string) => googleQuery(config, text, googleRow);
      const filter = config.campaignIds ? `campaign.id IN (${config.campaignIds.join(",")})` : "campaign.status != 'REMOVED'";
      const [account, statuses, metrics] = await Promise.all([
        query("SELECT customer.currency_code FROM customer LIMIT 1"),
        query(`SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status FROM campaign WHERE ${filter}`),
        query(`SELECT campaign.id, campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${dashboard.period.start}' AND '${dashboard.period.end}'${config.campaignIds ? ` AND ${filter}` : ""}`)
      ]);
      const currency = currencyCode(account[0]?.customer?.currencyCode);
      const campaigns = new Map<string, AdCampaign>();
      for (const row of statuses) {
        if (!row.campaign) throw new Error("Missing campaign");
        const { id: campaignId, status, primaryStatus } = row.campaign;
        campaigns.set(campaignId, {
          id: campaignId, name: row.campaign.name, clicks: 0, impressions: 0, spend: 0,
          live: status !== "ENABLED" ? false
            : !primaryStatus || ["UNKNOWN", "UNSPECIFIED"].includes(primaryStatus) ? null
            : ["ELIGIBLE", "LIMITED", "LEARNING"].includes(primaryStatus)
        });
      }
      for (const row of metrics) {
        if (!row.campaign || !row.metrics) throw new Error("Missing metrics");
        const campaign = campaigns.get(row.campaign.id) ?? { id: row.campaign.id, name: row.campaign.name, live: false, clicks: 0, impressions: 0, spend: 0 };
        campaign.clicks += row.metrics.clicks ?? 0;
        campaign.impressions += row.metrics.impressions ?? 0;
        campaign.spend += (row.metrics.costMicros ?? 0) / 1_000_000;
        campaigns.set(campaign.id, campaign);
      }
      if (config.campaignIds?.some((campaignId) => !campaigns.has(campaignId))) throw new Error("Campaign mapping not found");
      return { accountId: config.customerId, currency, campaigns: [...campaigns.values()] };
    }, "Google Ads kon niet worden geladen. Controleer de accountkoppeling en toegangsrechten.");
  }

  async function loadFacebook(config: FacebookAccountScope | undefined): Promise<CampaignSource<AdPerformance>> {
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
      if ((config.requiredCampaignIds ?? config.campaignIds)?.some((campaignId) => !knownIds.has(campaignId))) throw new Error("Campaign mapping not found");
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

  async function loadGhlAppointments(siteId: string, config: CampaignSiteMapping["ghl"], result: GhlProjectAppointments): Promise<CampaignSource<WebsiteConversionPerformance>> {
    if (!config) return websiteConversions(siteId, "appointment");
    if (result.errors.has(siteId)) return { state: "unavailable", data: null, message: "Afspraken konden niet uit GoHighLevel worden geladen." };
    return { state: "connected", message: "", data: { siteId,
      count: [...result.counts].filter(([key]) => key.startsWith(`${siteId}:`)).reduce((sum, [, count]) => sum + count, 0) } };
  }
}

export type GhlProjectAppointments = { counts: Map<string, number>; errors: Set<string> };
export async function getGhlProjectAppointments(dashboard: SiteAnalyticsDashboardData, options: {
  env?: Env; ghlCall?: GhlReadCall; mappings?: CampaignSiteMapping[];
} = {}): Promise<GhlProjectAppointments> {
  const mappings = options.mappings ?? parseCampaignSiteMappings((options.env ?? process.env).CAMPAIGN_PERFORMANCE_SITES);
  const projects = cvrOverviewRowsFromLinks(dashboard.cvrLinks, dashboard.projectPageGroups ?? []);
  const counts = new Map<string, number>(), errors = new Set<string>();
  await Promise.all(dashboard.sites.map(async (site) => {
    const config = mappings.find((mapping) => mapping.siteId === site.id)?.ghl;
    if (!config) return;
    try {
      const pipelines = await ghlAppointmentsByPipeline(config, dashboard.period, options.ghlCall);
      for (const pipeline of pipelines) {
        const explicit = config.pipelineProjects?.find((item) => item.pipelineId === pipeline.pipelineId)?.sourcePath;
        const pipelineKey = projectNameKey(pipeline.pipelineName);
        const candidates = projects.filter((project) => project.siteId === site.id && (explicit
          ? normalizeProjectPath(project.sourcePath) === normalizeProjectPath(explicit)
          : pipelineKey.length > 0 && projectNameKey(project.sourceTitle) === pipelineKey));
        if (candidates.length === 1) counts.set(`${site.id}:${normalizeProjectPath(candidates[0]!.sourcePath)}`, pipeline.count);
      }
    } catch { errors.add(site.id); }
  }));
  return { counts, errors };
}

function projectNameKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(?:pipeline|project|residentie|residence|nieuwbouw)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function isLedouxCampaign(name: string) {
  return name.toLowerCase().includes("ledoux");
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

export function facebookAccountSources(row: CampaignPerformanceRow): FacebookAccountPerformance[] {
  return row.facebookAccounts ?? [row];
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

function weightedCampaignCtr(campaigns: CampaignLinkCtr[]): number | null {
  const measured = campaigns.filter((campaign) => campaign.impressions > 0);
  if (measured.length === 0 || measured.some((campaign) => campaign.ctr === null)) return null;
  if (measured.length === 1) return measured[0].ctr;
  const impressions = measured.reduce((sum, campaign) => sum + campaign.impressions, 0);
  return measured.reduce((sum, campaign) => sum + campaign.ctr! * campaign.impressions, 0) / impressions;
}

// Link CTR uses impressions, matching the Ads Manager link click-through rate.
// The same campaign appearing under multiple websites contributes only once.
export function summarizeLinkCtr(sources: CampaignSource<LinkCtrPerformance>[]): LinkCtrSummary {
  const unavailable = sources.some((source) => source.state !== "connected");
  const campaigns = new Map<string, CampaignLinkCtr>();
  for (const source of sources) {
    if (!source.data) continue;
    for (const campaign of source.data.campaigns) campaigns.set(`${source.data.accountId}:${campaign.id}`, campaign);
  }
  return {
    campaigns: campaigns.size, unavailable,
    ctr: unavailable ? null : weightedCampaignCtr([...campaigns.values()])
  };
}

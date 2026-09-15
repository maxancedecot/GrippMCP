import { z } from "zod";
import { getFreshGhlTokenRecord } from "./ghl/oauth.js";
import type { GhlTokenRecord } from "./ghl/types.js";
import type { SiteAnalyticsDashboardData, SiteAnalyticsPeriod } from "./siteAnalytics.js";

export type CampaignSource<T> =
  | { state: "connected"; data: T; message: string }
  | { state: "not_configured" | "unavailable"; data: null; message: string };

export type AdCampaign = {
  id: string;
  live: boolean | null;
  clicks: number;
  impressions: number;
  spend: number;
};
export type AdPerformance = { accountId: string; currency: string; campaigns: AdCampaign[] };
export type UniqueCtrPerformance = { accountId: string; uniqueClicks: number; reach: number; ctr: number | null };
export type UniqueCtrSummary = { ctr: number | null; accounts: number; unavailable: boolean };
export type CrmPerformance = { locationId: string; ids: string[] };
export type CampaignPerformanceRow = {
  siteId: string;
  name: string;
  url: string;
  google: CampaignSource<AdPerformance>;
  facebook: CampaignSource<AdPerformance>;
  facebookUniqueCtr: CampaignSource<UniqueCtrPerformance>;
  leads: CampaignSource<CrmPerformance>;
  appointments: CampaignSource<CrmPerformance>;
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
  ghl: z.object({ locationId: id, installId: id.optional(), calendarIds: z.array(id).min(1).optional() }).strict().optional()
}).strict();
export type CampaignSiteMapping = z.infer<typeof mappingSchema>;
type Env = Record<string, string | undefined>;
type Options = {
  env?: Env;
  fetchImpl?: typeof fetch;
  getGhlToken?: (installId: string) => Promise<GhlTokenRecord>;
  now?: Date;
};

const numeric = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite().nonnegative());
const googleRow = z.object({
  customer: z.object({ currencyCode: id }).optional(),
  campaign: z.object({ id, status: id.optional(), primaryStatus: id.optional() }).optional(),
  metrics: z.object({ clicks: numeric.optional(), impressions: numeric.optional(), costMicros: numeric.optional() }).optional()
});
const metaCampaign = z.object({ id, effective_status: id, start_time: id.optional(), stop_time: id.optional() });
const metaInsight = z.object({ campaign_id: id, clicks: numeric.optional(), impressions: numeric, spend: numeric });
const metaUniqueInsight = z.object({ unique_ctr: numeric, unique_clicks: numeric, reach: numeric });
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
    return { rows: [] as CampaignPerformanceRow[], facebookUniqueCtr: summarizeUniqueCtr([]), message: "De accountkoppelingen zijn ongeldig. Laat de dashboardbeheerder de configuratie nakijken." };
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
  const ghlTokens = new Map<string, Promise<GhlTokenRecord>>();
  const getGhlToken = (installId: string) => {
    let token = ghlTokens.get(installId);
    if (!token) {
      token = (options.getGhlToken ?? getFreshGhlTokenRecord)(installId);
      ghlTokens.set(installId, token);
    }
    return token;
  };
  // Do not mix real account data with the WordPress demo sites.
  const sites = dashboard.source.mode === "live" ? dashboard.sites : [];
  const rows: CampaignPerformanceRow[] = [];
  const uniqueCtrRequests = new Map<string, Promise<CampaignSource<UniqueCtrPerformance>>>();
  // Bound concurrency across sites; each site's providers load independently.
  for (let offset = 0; offset < sites.length; offset += 3) {
    rows.push(...await Promise.all(sites.slice(offset, offset + 3).map(async (site) => {
      const mapping = mappings.find((item) => item.siteId === site.id);
      const [google, facebook, facebookUniqueCtr, crm] = await Promise.all([
        loadGoogle(mapping?.google), loadFacebook(mapping?.facebook), loadFacebookUniqueCtr(mapping?.facebook), loadCrm(mapping?.ghl)
      ]);
      return {
        siteId: site.id, name: site.name, url: site.url, google, facebook, facebookUniqueCtr, ...crm,
        websiteCvr: site.cvrLinkCount > 0 && site.cvrSourceVisitors > 0 ? site.conversionRatePercent : null,
        websiteVisitors: site.cvrSourceVisitors, websiteConversions: site.cvrConversionVisitors
      };
    })));
  }
  // Unique people cannot be added across campaigns or overlapping website scopes.
  // Ask Meta for each account's union of the visible campaign selections instead.
  const accountScopes = new Map<string, NonNullable<CampaignSiteMapping["facebook"]>>();
  for (const site of sites) {
    const config = mappings.find((mapping) => mapping.siteId === site.id)?.facebook;
    if (!config || !env.META_ADS_ACCESS_TOKEN) continue;
    const existing = accountScopes.get(config.adAccountId);
    accountScopes.set(config.adAccountId, !existing ? config : {
      adAccountId: config.adAccountId,
      ...(existing.campaignIds && config.campaignIds
        ? { campaignIds: [...new Set([...existing.campaignIds, ...config.campaignIds])] } : {})
    });
  }
  const facebookUniqueCtr = summarizeUniqueCtr(await Promise.all([...accountScopes.values()].map(loadFacebookUniqueCtr)));
  return {
    rows, facebookUniqueCtr,
    message: dashboard.source.mode === "demo"
      ? "Verbind eerst een website via de WordPress-plugin en koppel daarna de advertentieaccounts en CRM-locatie."
      : ""
  };

  function loadFacebookUniqueCtr(config: CampaignSiteMapping["facebook"]): Promise<CampaignSource<UniqueCtrPerformance>> {
    if (!config || !env.META_ADS_ACCESS_TOKEN) return Promise.resolve(missing("Facebook Ads is nog niet gekoppeld."));
    const campaignIds = config.campaignIds ? [...new Set(config.campaignIds)].sort() : undefined;
    const key = JSON.stringify([config.adAccountId, campaignIds]);
    let pending = uniqueCtrRequests.get(key);
    if (!pending) {
      pending = safely(async () => {
        const version = z.string().regex(/^v\d+\.\d+$/).parse(env.META_ADS_API_VERSION ?? "v26.0");
        const params = new URLSearchParams({
          fields: "unique_ctr,unique_clicks,reach", level: "account", time_increment: "all_days",
          time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }),
          ...(campaignIds ? { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]) } : {})
        });
        const result = z.object({ data: z.array(metaUniqueInsight).max(1), paging: graphPaging }).parse(await request(
          `https://graph.facebook.com/${version}/act_${config.adAccountId}/insights?${params}`,
          { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }
        ));
        if (result.paging?.next) throw new Error("Unique metrics must cover the whole selection in one row");
        const row = result.data[0];
        return { accountId: config.adAccountId, uniqueClicks: row?.unique_clicks ?? 0, reach: row?.reach ?? 0,
          ctr: row && row.reach > 0 ? row.unique_ctr : null };
      }, "Facebook unieke CTR kon niet worden geladen. Probeer opnieuw of kies een kortere periode.");
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
        list(`${accountPath}/campaigns`, { fields: "id,effective_status,start_time,stop_time" }, metaCampaign),
        list(`${accountPath}/insights`, {
          fields: "campaign_id,clicks,impressions,spend", level: "campaign",
          time_range: JSON.stringify({ since: dashboard.period.start, until: dashboard.period.end }),
          ...(config.campaignIds ? { filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: config.campaignIds }]) } : {})
        }, metaInsight)
      ]);
      const campaigns = new Map<string, AdCampaign>();
      for (const campaign of statuses) {
        if (config.campaignIds && !config.campaignIds.includes(campaign.id)) continue;
        const start = campaign.start_time ? Date.parse(campaign.start_time) : -Infinity;
        const end = campaign.stop_time ? Date.parse(campaign.stop_time) : Infinity;
        if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Invalid campaign schedule");
        campaigns.set(campaign.id, {
          id: campaign.id, live: account.account_status === 1 && campaign.effective_status === "ACTIVE" && start <= now.getTime() && end > now.getTime(),
          clicks: 0, impressions: 0, spend: 0
        });
      }
      for (const row of metrics) {
        if (config.campaignIds && !config.campaignIds.includes(row.campaign_id)) continue;
        const campaign = campaigns.get(row.campaign_id) ?? { id: row.campaign_id, live: false, clicks: 0, impressions: 0, spend: 0 };
        campaign.clicks += row.clicks ?? 0;
        campaign.impressions += row.impressions;
        campaign.spend += row.spend;
        campaigns.set(campaign.id, campaign);
      }
      if (config.campaignIds?.some((campaignId) => !campaigns.has(campaignId))) throw new Error("Campaign mapping not found");
      return { accountId: config.adAccountId, currency: currencyCode(account.currency), campaigns: [...campaigns.values()] };
    }, "Facebook Ads kon niet worden geladen. Controleer de accountkoppeling en toegangsrechten.");
  }

  async function loadCrm(config: CampaignSiteMapping["ghl"]): Promise<{ leads: CampaignSource<CrmPerformance>; appointments: CampaignSource<CrmPerformance> }> {
    if (!config) return { leads: missing("GoHighLevel is nog niet gekoppeld."), appointments: missing("GoHighLevel is nog niet gekoppeld.") };
    const token = getGhlToken(config.installId ?? config.locationId);
    const call = async (path: string, body?: unknown) => {
      const record = await token;
      if (record.locationId !== config.locationId) throw new Error("A matching location installation is required");
      return request(`https://services.leadconnectorhq.com${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${record.accessToken}`, Version: env.GHL_CAMPAIGN_API_VERSION ?? "2021-07-28", "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    };
    const { start, end } = campaignPeriodBounds(dashboard.period);
    const [leads, appointments] = await Promise.all([
      safely(async () => {
        const ids = new Set<string>();
        const seen = new Set<string>();
        for (let page = 1; page <= MAX_PAGES; page++) {
          const result = z.object({
            contacts: z.array(z.object({ id, dateAdded: id })), total: numeric
          }).parse(await call("/contacts/search", {
            locationId: config.locationId, page, pageLimit: 100,
            filters: [{ field: "dateAdded", operator: "range", value: { gte: new Date(start).toISOString(), lte: new Date(end).toISOString() } }],
            sort: [{ field: "dateAdded", direction: "asc" }]
          }));
          const before = seen.size;
          for (const contact of result.contacts) {
            seen.add(contact.id);
            const date = Date.parse(contact.dateAdded);
            if (!Number.isFinite(date)) throw new Error("Invalid contact date");
            if (date >= start && date <= end) ids.add(contact.id);
          }
          if (seen.size >= result.total) return { locationId: config.locationId, ids: [...ids] };
          if (seen.size === before) throw new Error("Incomplete contact pagination");
        }
        throw new Error("Contact pagination limit");
      }, "Leads konden niet worden geladen. Controleer de CRM-koppeling en contactrechten."),
      safely(async () => {
        const calendars = config.calendarIds ?? z.object({ calendars: z.array(z.object({ id })) })
          .parse(await call(`/calendars/?${new URLSearchParams({ locationId: config.locationId })}`)).calendars.map((calendar) => calendar.id);
        const ids = new Set<string>();
        for (const calendarId of new Set(calendars)) {
          const result = z.object({ events: z.array(z.object({ id, startTime: id, appointmentStatus: id.optional(), contactId: id.optional() })) })
            .parse(await call(`/calendars/events?${new URLSearchParams({ locationId: config.locationId, calendarId, startTime: String(start), endTime: String(end) })}`));
          for (const event of result.events) {
            if (!event.contactId) continue; // Blocked calendar slots are not appointments.
            if (!event.appointmentStatus) throw new Error("Missing appointment status");
            const date = Date.parse(event.startTime);
            if (!Number.isFinite(date)) throw new Error("Invalid appointment date");
            if (date >= start && date <= end && !["cancelled", "canceled", "invalid"].includes(event.appointmentStatus.toLowerCase())) ids.add(event.id);
          }
        }
        return { locationId: config.locationId, ids: [...ids] };
      }, "Afspraken konden niet worden geladen. Controleer de CRM-koppeling en agendarechten.")
    ]);
    return { leads, appointments };
  }
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

// Brussels midnight, including the 23/25-hour days at the DST boundaries.
export function campaignPeriodBounds(period: Pick<SiteAnalyticsPeriod, "start" | "end">) {
  const midnight = (date: string) => {
    const target = Date.parse(`${date}T00:00:00Z`);
    let value = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
      }).formatToParts(value).map((part) => [part.type, part.value]));
      const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      value += target - local;
    }
    return value;
  };
  const nextDay = new Date(Date.parse(`${period.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: midnight(period.start), end: midnight(nextDay) - 1 };
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

export function summarizeCrm(sources: CampaignSource<CrmPerformance>[]) {
  const ids = new Set<string>();
  let connected = 0;
  for (const source of sources) {
    if (!source.data) continue;
    connected++;
    source.data.ids.forEach((item) => ids.add(`${source.data.locationId}:${item}`));
  }
  return { connected, total: sources.length, count: connected > 0 ? ids.size : null };
}

// Each input covers one account's complete selection, deduplicated by Meta.
// Across accounts this is a weighted rate, not a globally deduplicated audience.
export function summarizeUniqueCtr(sources: CampaignSource<UniqueCtrPerformance>[]): UniqueCtrSummary {
  const unavailable = sources.some((source) => source.state !== "connected");
  const values = sources.flatMap((source) => source.data ? [source.data] : []);
  const reach = values.reduce((sum, value) => sum + value.reach, 0);
  const uniqueClicks = values.reduce((sum, value) => sum + value.uniqueClicks, 0);
  return {
    accounts: sources.length, unavailable,
    ctr: unavailable || reach === 0 ? null : values.length === 1 ? values[0].ctr : uniqueClicks / reach * 100
  };
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readJsonCache, writeJsonCache } from "./jsonCache.js";

export type SiteAnalyticsConfiguredSite = {
  id: string;
  name: string;
  url: string;
  token: string;
};

export type SiteAnalyticsPublicSite = Omit<SiteAnalyticsConfiguredSite, "token">;

export type SiteAnalyticsRegistrationResult = {
  site: SiteAnalyticsPublicSite;
  siteToken: string;
};

export type SiteAnalyticsSource = {
  mode: "live" | "demo";
  message: string;
};

export type SiteAnalyticsPeriod = {
  days: number;
  start: string;
  end: string;
  label: string;
};

export type SiteAnalyticsMetricSummary = {
  pageViews: number;
  uniqueVisitors: number;
  sessions: number;
  avgTimeOnPageSeconds: number;
  avgScrollPercent: number;
};

export type SiteAnalyticsSiteSummary = SiteAnalyticsPublicSite &
  SiteAnalyticsMetricSummary & {
    cvrSourceVisitors: number;
    cvrConversionVisitors: number;
    cvrLinkCount: number;
    conversionRatePercent: number;
    lastSeenAt?: string;
  };

export type SiteAnalyticsDailyRow = {
  date: string;
  label: string;
  pageViews: number;
  uniqueVisitors: number;
  sessions: number;
};

export type SiteAnalyticsPageRow = {
  siteId: string;
  siteName: string;
  path: string;
  title: string;
  pageViews: number;
  uniqueVisitors: number;
  sessions: number;
  avgTimeOnPageSeconds: number;
  avgScrollPercent: number;
};

export type SiteAnalyticsReferrerRow = {
  source: string;
  pageViews: number;
  sessions: number;
};

export type SiteAnalyticsCvrLink = {
  id: string;
  siteId: string;
  sourcePath: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SiteAnalyticsCvrPageCandidate = {
  siteId: string;
  siteName: string;
  path: string;
  title: string;
  uniqueVisitors: number;
  pageViews: number;
};

export type SiteAnalyticsCvrLinkRow = SiteAnalyticsCvrLink & {
  siteName: string;
  sourceTitle: string;
  sourceVisitors: number;
  sourcePageViews: number;
  targetTitle: string;
  targetVisitors: number;
  targetPageViews: number;
  conversionRatePercent: number;
};

export type SiteAnalyticsDashboardData = {
  source: SiteAnalyticsSource;
  period: SiteAnalyticsPeriod;
  sites: SiteAnalyticsSiteSummary[];
  selectedSiteId?: string;
  totals: SiteAnalyticsMetricSummary;
  dailyRows: SiteAnalyticsDailyRow[];
  pageRows: SiteAnalyticsPageRow[];
  referrerRows: SiteAnalyticsReferrerRow[];
  cvrPageCandidates: SiteAnalyticsCvrPageCandidate[];
  cvrLinks: SiteAnalyticsCvrLinkRow[];
  lastUpdated: string;
};

export type SiteAnalyticsDashboardOptions = {
  days?: number;
  siteId?: string;
  now?: Date;
};

type SiteAnalyticsEventType = "page_view" | "engagement" | "scroll";

type NormalizedSiteAnalyticsEvent = {
  type: SiteAnalyticsEventType;
  siteId: string;
  pageKey: string;
  pageTitle: string;
  pageUrl: string;
  referrerSource: string;
  visitorHash: string;
  sessionHash: string;
  pageViewHash: string;
  activeTimeMsDelta: number;
  scrollPercent?: number;
  receivedAt: string;
};

type DailySiteAnalyticsData = {
  version: 1;
  siteId: string;
  date: string;
  totals: {
    pageViews: number;
    engagementMs: number;
  };
  visitors: string[];
  sessions: string[];
  pages: Record<string, DailyPageAnalyticsData>;
  referrers: Record<string, DailyReferrerAnalyticsData>;
  lastEventAt?: string;
};

type SiteAnalyticsRegisteredSite = SiteAnalyticsConfiguredSite & {
  installationHash: string;
  createdAt: string;
  updatedAt: string;
};

type SiteAnalyticsRegistryData = {
  version: 1;
  sites: SiteAnalyticsRegisteredSite[];
  updatedAt?: string;
};

type SiteAnalyticsCvrLinkData = {
  version: 1;
  links: SiteAnalyticsCvrLink[];
  updatedAt?: string;
};

type DailyPageAnalyticsData = {
  path: string;
  title: string;
  url: string;
  views: number;
  visitors: string[];
  sessions: string[];
  engagementMs: number;
  scrollByView: Record<string, number>;
};

type DailyReferrerAnalyticsData = {
  source: string;
  views: number;
  sessions: string[];
};

type DashboardAccumulator = {
  pageViews: number;
  visitors: Set<string>;
  sessions: Set<string>;
  engagementMs: number;
  scrollSamples: number[];
};

type SiteAccumulator = DashboardAccumulator & {
  site: SiteAnalyticsPublicSite;
  cvrSourceVisitors: Set<string>;
  cvrConversionVisitors: Set<string>;
  cvrLinkCount: number;
  lastSeenAt?: string;
};

type PageAccumulator = DashboardAccumulator & {
  siteId: string;
  siteName: string;
  path: string;
  title: string;
};

type ReferrerAccumulator = {
  source: string;
  pageViews: number;
  sessions: Set<string>;
};

type DailyAccumulator = {
  date: string;
  label: string;
  pageViews: number;
  visitors: Set<string>;
  sessions: Set<string>;
};

const SITE_ANALYTICS_VERSION = 1;
const SITE_ANALYTICS_CACHE_PREFIX = `site-analytics:v${SITE_ANALYTICS_VERSION}`;
const SITE_ANALYTICS_REGISTRY_CACHE_KEY = `${SITE_ANALYTICS_CACHE_PREFIX}:registry`;
const SITE_ANALYTICS_CVR_LINKS_CACHE_KEY = `${SITE_ANALYTICS_CACHE_PREFIX}:cvr-links`;
const DEFAULT_DASHBOARD_DAYS = 30;
const MAX_DASHBOARD_DAYS = 90;
const MAX_STRING_LENGTH = 300;
const MAX_TITLE_LENGTH = 180;
const MAX_ENGAGEMENT_DELTA_MS = 60 * 60 * 1000;
const IGNORED_PAGE_QUERY_PARAMS = new Set([
  "_ga",
  "_gl",
  "fbclid",
  "gbraid",
  "gclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ttclid",
  "utm_campaign",
  "utm_content",
  "utm_creative_format",
  "utm_id",
  "utm_marketing_tactic",
  "utm_medium",
  "utm_source",
  "utm_term",
  "wbraid"
]);

const dateFormatter = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit",
  month: "short"
});

const dateTimeFormatter = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function getConfiguredSiteAnalyticsSites(): SiteAnalyticsConfiguredSite[] {
  const fromJson = sitesFromJsonEnv(process.env.SITE_ANALYTICS_SITES);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const fallbackSite = siteFromRecord({
    id: process.env.SITE_ANALYTICS_SITE_ID,
    name: process.env.SITE_ANALYTICS_SITE_NAME,
    url: process.env.SITE_ANALYTICS_SITE_URL,
    token: process.env.SITE_ANALYTICS_SITE_TOKEN
  });

  return fallbackSite ? [fallbackSite] : [];
}

export async function getSiteAnalyticsSites(): Promise<SiteAnalyticsConfiguredSite[]> {
  const configuredSites = getConfiguredSiteAnalyticsSites();
  const registeredSites = await readRegisteredSiteAnalyticsSites();

  return mergeConfiguredAndRegisteredSites(configuredSites, registeredSites);
}

export async function getPublicSiteAnalyticsSites(): Promise<SiteAnalyticsPublicSite[]> {
  return (await getSiteAnalyticsSites()).map(({ token: _token, ...site }) => site);
}

export async function verifySiteAnalyticsToken(siteId: string, token: string) {
  const normalizedSiteId = normalizeIdentifier(siteId);
  const site = (await getSiteAnalyticsSites()).find((candidate) => candidate.id === normalizedSiteId);
  if (!site || !token) {
    return false;
  }

  return safeEqual(hashSecret(token), hashSecret(site.token));
}

export function verifySiteAnalyticsRegistrationToken(token: string) {
  const requiredToken = normalizeString(process.env.SITE_ANALYTICS_REGISTRATION_TOKEN, 500);
  if (!requiredToken) {
    return true;
  }

  return Boolean(token) && safeEqual(hashSecret(token), hashSecret(requiredToken));
}

export async function registerSiteAnalyticsSite(payload: unknown, options: { now?: Date } = {}): Promise<SiteAnalyticsRegistrationResult> {
  const registration = normalizeSiteAnalyticsRegistration(payload);
  const now = (options.now ?? new Date()).toISOString();
  const registry = await readSiteAnalyticsRegistry();
  const existingIndex = registry.sites.findIndex((site) => site.installationHash === registration.installationHash);
  const existingSite = existingIndex >= 0 ? registry.sites[existingIndex] : undefined;
  const site: SiteAnalyticsRegisteredSite = existingSite
    ? {
        ...existingSite,
        name: registration.name,
        url: registration.url,
        updatedAt: now
      }
    : {
        id: registration.id,
        name: registration.name,
        url: registration.url,
        token: randomBytes(32).toString("hex"),
        installationHash: registration.installationHash,
        createdAt: now,
        updatedAt: now
      };

  if (existingIndex >= 0) {
    registry.sites[existingIndex] = site;
  } else {
    registry.sites.push(site);
  }
  registry.updatedAt = now;

  await writeJsonCache(SITE_ANALYTICS_REGISTRY_CACHE_KEY, registry);

  return {
    site: publicSiteFromConfiguredSite(site),
    siteToken: site.token
  };
}

export async function deleteRegisteredSiteAnalyticsSite(siteId: string, token: string): Promise<boolean> {
  const normalizedSiteId = normalizeIdentifier(siteId);
  if (!normalizedSiteId || !token) {
    return false;
  }

  const registry = await readSiteAnalyticsRegistry();
  const existingIndex = registry.sites.findIndex((site) => site.id === normalizedSiteId);
  const site = existingIndex >= 0 ? registry.sites[existingIndex] : undefined;
  if (!site || !safeEqual(hashSecret(token), hashSecret(site.token))) {
    return false;
  }

  registry.sites.splice(existingIndex, 1);
  registry.updatedAt = new Date().toISOString();
  await writeJsonCache(SITE_ANALYTICS_REGISTRY_CACHE_KEY, registry);

  return true;
}

export async function upsertSiteAnalyticsCvrLink(payload: unknown, options: { now?: Date } = {}): Promise<SiteAnalyticsCvrLink> {
  const normalizedLink = normalizeSiteAnalyticsCvrLink(payload);
  const siteExists = (await getSiteAnalyticsSites()).some((site) => site.id === normalizedLink.siteId);
  if (!siteExists) {
    throw new Error("Onbekende site voor CVR-koppeling.");
  }

  const now = (options.now ?? new Date()).toISOString();
  const registry = await readSiteAnalyticsCvrLinkData();
  const existingIndex = registry.links.findIndex((link) => link.id === normalizedLink.id);
  const existingLink = existingIndex >= 0 ? registry.links[existingIndex] : undefined;
  const link: SiteAnalyticsCvrLink = {
    id: normalizedLink.id,
    siteId: normalizedLink.siteId,
    sourcePath: normalizedLink.sourcePath,
    targetPath: normalizedLink.targetPath,
    createdAt: existingLink?.createdAt ?? now,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    registry.links[existingIndex] = link;
  } else {
    registry.links.push(link);
  }
  registry.updatedAt = now;

  await writeJsonCache(SITE_ANALYTICS_CVR_LINKS_CACHE_KEY, registry);

  return link;
}

export async function deleteSiteAnalyticsCvrLink(linkId: string): Promise<boolean> {
  const normalizedLinkId = normalizeString(linkId, 80);
  if (!normalizedLinkId) {
    return false;
  }

  const registry = await readSiteAnalyticsCvrLinkData();
  const existingIndex = registry.links.findIndex((link) => link.id === normalizedLinkId);
  if (existingIndex < 0) {
    return false;
  }

  registry.links.splice(existingIndex, 1);
  registry.updatedAt = new Date().toISOString();
  await writeJsonCache(SITE_ANALYTICS_CVR_LINKS_CACHE_KEY, registry);

  return true;
}

export async function recordSiteAnalyticsEvent(payload: unknown): Promise<{ accepted: true }> {
  const event = normalizeSiteAnalyticsEvent(payload);
  const daily = await readDailySiteAnalyticsData(event.siteId, event.receivedAt);
  applySiteAnalyticsEvent(daily, event);
  await writeJsonCache(dailySiteAnalyticsCacheKey(event.siteId, daily.date), daily);

  return { accepted: true };
}

export async function getSiteAnalyticsDashboardData(options: SiteAnalyticsDashboardOptions = {}): Promise<SiteAnalyticsDashboardData> {
  const now = options.now ?? new Date();
  const days = normalizeDashboardDays(options.days);
  const period = siteAnalyticsPeriod(days, now);
  const configuredSites = await getSiteAnalyticsSites();
  const publicSites = configuredSites.map(({ token: _token, ...site }) => site);
  const selectedSiteId = normalizeOptionalIdentifier(options.siteId);
  const selectedSites = selectedSiteId ? publicSites.filter((site) => site.id === selectedSiteId) : publicSites;

  if (configuredSites.length === 0) {
    return createDemoSiteAnalyticsDashboardData(period, selectedSiteId, now);
  }

  const siteList = selectedSiteId && selectedSites.length === 0 ? publicSites : selectedSites;
  const dateKeys = dateKeysForPeriod(period);
  const dailyRows = new Map<string, DailyAccumulator>();
  const siteAccumulators = new Map<string, SiteAccumulator>();
  const pageAccumulators = new Map<string, PageAccumulator>();
  const referrerAccumulators = new Map<string, ReferrerAccumulator>();
  const totals = emptyDashboardAccumulator();

  for (const site of siteList) {
    siteAccumulators.set(site.id, emptySiteAccumulator(site));
  }

  for (const date of dateKeys) {
    dailyRows.set(date, {
      date,
      label: dateFormatter.format(dateFromKey(date)),
      pageViews: 0,
      visitors: new Set<string>(),
      sessions: new Set<string>()
    });
  }

  for (const site of siteList) {
    for (const date of dateKeys) {
      const daily = await readJsonCache<DailySiteAnalyticsData>(dailySiteAnalyticsCacheKey(site.id, date));
      if (!isDailySiteAnalyticsData(daily)) {
        continue;
      }

      mergeDailySiteAnalyticsData(daily, site, totals, siteAccumulators, pageAccumulators, referrerAccumulators, dailyRows);
    }
  }

  const pageRows = Array.from(pageAccumulators.values())
    .map(pageRowFromAccumulator)
    .sort((left, right) => right.pageViews - left.pageViews || right.uniqueVisitors - left.uniqueVisitors || left.path.localeCompare(right.path))
    .slice(0, 50);
  const sitesById = new Map(siteList.map((site) => [site.id, site]));
  const storedCvrLinks = (await readSiteAnalyticsCvrLinkData()).links.filter((link) => sitesById.has(link.siteId));
  ensureCvrLinkPageCandidates(storedCvrLinks, sitesById, pageAccumulators);
  applyCvrLinksToSiteAccumulators(storedCvrLinks, siteAccumulators, pageAccumulators);
  const cvrPageCandidates = Array.from(pageAccumulators.values())
    .map(cvrPageCandidateFromAccumulator)
    .sort(sortCvrPageCandidates);
  const cvrLinks = storedCvrLinks
    .map((link) => cvrLinkRowFromLink(link, sitesById, pageAccumulators))
    .sort((left, right) => left.siteName.localeCompare(right.siteName) || right.sourceVisitors - left.sourceVisitors || left.sourcePath.localeCompare(right.sourcePath));
  const referrerRows = Array.from(referrerAccumulators.values())
    .map((referrer) => ({
      source: referrer.source,
      pageViews: referrer.pageViews,
      sessions: referrer.sessions.size
    }))
    .sort((left, right) => right.pageViews - left.pageViews || left.source.localeCompare(right.source))
    .slice(0, 30);
  const siteRows = Array.from(siteAccumulators.values())
    .map(siteRowFromAccumulator)
    .sort((left, right) => right.pageViews - left.pageViews || left.name.localeCompare(right.name));
  const latestEventAt = siteRows.map((site) => site.lastSeenAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const sourceMessage =
    totals.pageViews === 0
      ? "Geen gegevens verzameld in deze periode."
      : "";

  return {
    source: {
      mode: "live",
      message: sourceMessage
    },
    period,
    sites: siteRows,
    selectedSiteId: selectedSiteId && publicSites.some((site) => site.id === selectedSiteId) ? selectedSiteId : undefined,
    totals: summaryFromAccumulator(totals),
    dailyRows: Array.from(dailyRows.values()).map((row) => ({
      date: row.date,
      label: row.label,
      pageViews: row.pageViews,
      uniqueVisitors: row.visitors.size,
      sessions: row.sessions.size
    })),
    pageRows,
    referrerRows,
    cvrPageCandidates,
    cvrLinks,
    lastUpdated: latestEventAt ? dateTimeFormatter.format(new Date(latestEventAt)) : dateTimeFormatter.format(now)
  };
}

function sitesFromJsonEnv(value: string | undefined) {
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const sites = parsed.map(siteFromRecord).filter((site): site is SiteAnalyticsConfiguredSite => Boolean(site));
  const byId = new Map<string, SiteAnalyticsConfiguredSite>();
  for (const site of sites) {
    byId.set(site.id, site);
  }

  return Array.from(byId.values());
}

async function readRegisteredSiteAnalyticsSites() {
  return (await readSiteAnalyticsRegistry()).sites;
}

async function readSiteAnalyticsRegistry(): Promise<SiteAnalyticsRegistryData> {
  const cached = await readJsonCache<SiteAnalyticsRegistryData>(SITE_ANALYTICS_REGISTRY_CACHE_KEY);
  if (isSiteAnalyticsRegistryData(cached)) {
    return {
      version: SITE_ANALYTICS_VERSION,
      sites: cached.sites.map(registeredSiteFromRecord).filter((site): site is SiteAnalyticsRegisteredSite => Boolean(site)),
      updatedAt: normalizeString(cached.updatedAt, 40) || undefined
    };
  }

  return {
    version: SITE_ANALYTICS_VERSION,
    sites: []
  };
}

async function readSiteAnalyticsCvrLinkData(): Promise<SiteAnalyticsCvrLinkData> {
  const cached = await readJsonCache<SiteAnalyticsCvrLinkData>(SITE_ANALYTICS_CVR_LINKS_CACHE_KEY);
  if (isSiteAnalyticsCvrLinkData(cached)) {
    return {
      version: SITE_ANALYTICS_VERSION,
      links: cached.links.map(cvrLinkFromRecord).filter((link): link is SiteAnalyticsCvrLink => Boolean(link)),
      updatedAt: normalizeString(cached.updatedAt, 40) || undefined
    };
  }

  return {
    version: SITE_ANALYTICS_VERSION,
    links: []
  };
}

function isSiteAnalyticsRegistryData(value: unknown): value is SiteAnalyticsRegistryData {
  const record = asRecord(value);
  if (record?.version !== SITE_ANALYTICS_VERSION || !Array.isArray(record.sites)) {
    return false;
  }

  return true;
}

function isSiteAnalyticsCvrLinkData(value: unknown): value is SiteAnalyticsCvrLinkData {
  const record = asRecord(value);
  if (record?.version !== SITE_ANALYTICS_VERSION || !Array.isArray(record.links)) {
    return false;
  }

  return true;
}

function mergeConfiguredAndRegisteredSites(
  configuredSites: SiteAnalyticsConfiguredSite[],
  registeredSites: SiteAnalyticsRegisteredSite[]
) {
  const sitesById = new Map<string, SiteAnalyticsConfiguredSite>();
  for (const site of configuredSites) {
    sitesById.set(site.id, site);
  }
  for (const site of registeredSites) {
    if (!sitesById.has(site.id)) {
      sitesById.set(site.id, site);
    }
  }

  return Array.from(sitesById.values());
}

function siteFromRecord(value: unknown): SiteAnalyticsConfiguredSite | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeIdentifier(stringFrom(record.id));
  const token = normalizeString(record.token, 500);
  if (!id || !token) {
    return null;
  }

  return {
    id,
    name: normalizeString(record.name, 120) || id,
    url: normalizeSiteUrl(stringFrom(record.url)) || "",
    token
  };
}

function registeredSiteFromRecord(value: unknown): SiteAnalyticsRegisteredSite | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const site = siteFromRecord(record);
  const installationHash = normalizeString(record.installationHash, 128);
  if (!site || !installationHash) {
    return null;
  }

  return {
    ...site,
    installationHash,
    createdAt: normalizeString(record.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: normalizeString(record.updatedAt, 40) || new Date(0).toISOString()
  };
}

function cvrLinkFromRecord(value: unknown): SiteAnalyticsCvrLink | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const siteId = normalizeIdentifier(stringFrom(record.siteId ?? record.site_id));
  const sourcePath = normalizePagePath(stringFrom(record.sourcePath ?? record.source_path));
  const targetPath = normalizePagePath(stringFrom(record.targetPath ?? record.target_path));
  const id = normalizeString(record.id, 80) || cvrLinkId(siteId, sourcePath, targetPath);
  if (!siteId || !sourcePath || !targetPath || sourcePath === targetPath || !isCvrThankYouPath(targetPath)) {
    return null;
  }

  return {
    id,
    siteId,
    sourcePath,
    targetPath,
    createdAt: normalizeString(record.createdAt, 40) || new Date(0).toISOString(),
    updatedAt: normalizeString(record.updatedAt, 40) || new Date(0).toISOString()
  };
}

function normalizeSiteAnalyticsRegistration(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Payload d'enregistrement invalide.");
  }

  const url = normalizeHttpSiteUrl(stringFrom(record.site_url ?? record.siteUrl ?? record.url));
  const installationId = normalizeString(record.installation_id ?? record.installationId, 300);
  if (!url || !installationId) {
    throw new Error("Payload d'enregistrement incomplet.");
  }

  const installationHash = createHash("sha256").update(`${url}:${installationId}`).digest("hex");
  const name = normalizeString(record.site_name ?? record.siteName ?? record.name, 120) || siteNameFromUrl(url);

  return {
    id: siteIdForRegistration(url, installationHash),
    name,
    url,
    installationHash
  };
}

function normalizeSiteAnalyticsCvrLink(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("CVR-koppeling is ongeldig.");
  }

  const siteId = normalizeIdentifier(stringFrom(record.site_id ?? record.siteId));
  const sourcePath = normalizePagePath(stringFrom(record.source_path ?? record.sourcePath));
  const targetPath = normalizePagePath(stringFrom(record.target_path ?? record.targetPath));
  if (!siteId || !sourcePath || !targetPath) {
    throw new Error("CVR-koppeling is onvolledig.");
  }
  if (sourcePath === targetPath) {
    throw new Error("Bron- en doelpagina moeten verschillend zijn.");
  }
  if (!isCvrThankYouPath(targetPath)) {
    throw new Error("De doelpagina moet thankyou, thank-you, thank you of bedankt in het pad bevatten.");
  }

  return {
    id: cvrLinkId(siteId, sourcePath, targetPath),
    siteId,
    sourcePath,
    targetPath
  };
}

function normalizeSiteAnalyticsEvent(payload: unknown): NormalizedSiteAnalyticsEvent {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Payload analytique invalide.");
  }

  const siteId = normalizeIdentifier(stringFrom(record.site_id ?? record.siteId));
  const type = normalizeEventType(stringFrom(record.event_type ?? record.eventType ?? record.type));
  const visitorId = normalizeString(record.visitor_id ?? record.visitorId, 200);
  const sessionId = normalizeString(record.session_id ?? record.sessionId, 200);
  const pageViewId = normalizeString(record.page_view_id ?? record.pageViewId, 200);
  const pageUrl = normalizeString(record.page_url ?? record.pageUrl, 800);
  const pageKey = normalizeEventPagePath(stringFrom(record.path), pageUrl);

  if (!siteId || !type || !visitorId || !sessionId || !pageViewId || !pageKey) {
    throw new Error("Payload analytique incomplet.");
  }

  const source = normalizeReferrerSource(
    stringFrom(record.source),
    stringFrom(record.medium),
    stringFrom(record.referrer),
    pageUrl
  );
  const activeTimeMsDelta = clampNumber(numberFrom(record.active_time_ms_delta ?? record.activeTimeMsDelta ?? record.time_on_page_ms), 0, MAX_ENGAGEMENT_DELTA_MS);
  const scrollPercentValue = record.scroll_percent ?? record.scrollPercent;
  const scrollPercent = scrollPercentValue === undefined || scrollPercentValue === null
    ? undefined
    : clampNumber(numberFrom(scrollPercentValue), 0, 100);
  const receivedAt = new Date().toISOString();

  return {
    type,
    siteId,
    pageKey,
    pageTitle: normalizeString(record.page_title ?? record.pageTitle ?? record.title, MAX_TITLE_LENGTH) || pageKey,
    pageUrl,
    referrerSource: source,
    visitorHash: hashIdentity(siteId, visitorId),
    sessionHash: hashIdentity(siteId, sessionId),
    pageViewHash: hashIdentity(siteId, pageViewId),
    activeTimeMsDelta,
    scrollPercent,
    receivedAt
  };
}

async function readDailySiteAnalyticsData(siteId: string, receivedAt: string): Promise<DailySiteAnalyticsData> {
  const date = dateKeyForDate(new Date(receivedAt));
  const cached = await readJsonCache<DailySiteAnalyticsData>(dailySiteAnalyticsCacheKey(siteId, date));
  if (isDailySiteAnalyticsData(cached)) {
    return cached;
  }

  return {
    version: SITE_ANALYTICS_VERSION,
    siteId,
    date,
    totals: {
      pageViews: 0,
      engagementMs: 0
    },
    visitors: [],
    sessions: [],
    pages: {},
    referrers: {}
  };
}

function applySiteAnalyticsEvent(daily: DailySiteAnalyticsData, event: NormalizedSiteAnalyticsEvent) {
  daily.lastEventAt = event.receivedAt;
  pushUnique(daily.visitors, event.visitorHash);
  pushUnique(daily.sessions, event.sessionHash);

  const page = daily.pages[event.pageKey] ?? {
    path: event.pageKey,
    title: event.pageTitle,
    url: event.pageUrl,
    views: 0,
    visitors: [],
    sessions: [],
    engagementMs: 0,
    scrollByView: {}
  };
  page.title = event.pageTitle || page.title;
  page.url = event.pageUrl || page.url;
  pushUnique(page.visitors, event.visitorHash);
  pushUnique(page.sessions, event.sessionHash);

  if (event.type === "page_view") {
    daily.totals.pageViews += 1;
    page.views += 1;
    const referrer = daily.referrers[event.referrerSource] ?? {
      source: event.referrerSource,
      views: 0,
      sessions: []
    };
    referrer.views += 1;
    pushUnique(referrer.sessions, event.sessionHash);
    daily.referrers[event.referrerSource] = referrer;
  }

  if (event.activeTimeMsDelta > 0) {
    daily.totals.engagementMs += event.activeTimeMsDelta;
    page.engagementMs += event.activeTimeMsDelta;
  }

  if (event.scrollPercent !== undefined) {
    page.scrollByView[event.pageViewHash] = Math.max(page.scrollByView[event.pageViewHash] ?? 0, event.scrollPercent);
  }

  daily.pages[event.pageKey] = page;
}

function mergeDailySiteAnalyticsData(
  daily: DailySiteAnalyticsData,
  site: SiteAnalyticsPublicSite,
  totals: DashboardAccumulator,
  siteAccumulators: Map<string, SiteAccumulator>,
  pageAccumulators: Map<string, PageAccumulator>,
  referrerAccumulators: Map<string, ReferrerAccumulator>,
  dailyAccumulators: Map<string, DailyAccumulator>
) {
  const siteAccumulator = siteAccumulators.get(site.id) ?? emptySiteAccumulator(site);
  const dailyAccumulator = dailyAccumulators.get(daily.date);

  totals.pageViews += daily.totals.pageViews;
  siteAccumulator.pageViews += daily.totals.pageViews;
  totals.engagementMs += daily.totals.engagementMs;
  siteAccumulator.engagementMs += daily.totals.engagementMs;

  for (const visitor of daily.visitors) {
    totals.visitors.add(visitor);
    siteAccumulator.visitors.add(visitor);
    dailyAccumulator?.visitors.add(visitor);
  }
  for (const session of daily.sessions) {
    totals.sessions.add(session);
    siteAccumulator.sessions.add(session);
    dailyAccumulator?.sessions.add(session);
  }
  if (dailyAccumulator) {
    dailyAccumulator.pageViews += daily.totals.pageViews;
  }
  if (daily.lastEventAt && (!siteAccumulator.lastSeenAt || daily.lastEventAt > siteAccumulator.lastSeenAt)) {
    siteAccumulator.lastSeenAt = daily.lastEventAt;
  }

  for (const page of Object.values(daily.pages)) {
    const key = pageAccumulatorKey(site.id, page.path);
    const pageAccumulator = pageAccumulators.get(key) ?? {
      ...emptyDashboardAccumulator(),
      siteId: site.id,
      siteName: site.name,
      path: page.path,
      title: page.title
    };
    pageAccumulator.pageViews += page.views;
    pageAccumulator.engagementMs += page.engagementMs;
    pageAccumulator.title = page.title || pageAccumulator.title;
    for (const visitor of page.visitors) {
      pageAccumulator.visitors.add(visitor);
    }
    for (const session of page.sessions) {
      pageAccumulator.sessions.add(session);
    }
    for (const scroll of Object.values(page.scrollByView)) {
      pageAccumulator.scrollSamples.push(scroll);
      siteAccumulator.scrollSamples.push(scroll);
      totals.scrollSamples.push(scroll);
    }
    pageAccumulators.set(key, pageAccumulator);
  }

  for (const referrer of Object.values(daily.referrers)) {
    const referrerAccumulator = referrerAccumulators.get(referrer.source) ?? {
      source: referrer.source,
      pageViews: 0,
      sessions: new Set<string>()
    };
    referrerAccumulator.pageViews += referrer.views;
    for (const session of referrer.sessions) {
      referrerAccumulator.sessions.add(session);
    }
    referrerAccumulators.set(referrer.source, referrerAccumulator);
  }

  siteAccumulators.set(site.id, siteAccumulator);
}

function ensureCvrLinkPageCandidates(
  links: SiteAnalyticsCvrLink[],
  sitesById: Map<string, SiteAnalyticsPublicSite>,
  pageAccumulators: Map<string, PageAccumulator>
) {
  for (const link of links) {
    const site = sitesById.get(link.siteId);
    if (!site) {
      continue;
    }

    for (const path of [link.sourcePath, link.targetPath]) {
      const key = pageAccumulatorKey(link.siteId, path);
      if (!pageAccumulators.has(key)) {
        pageAccumulators.set(key, {
          ...emptyDashboardAccumulator(),
          siteId: link.siteId,
          siteName: site.name,
          path,
          title: path
        });
      }
    }
  }
}

function applyCvrLinksToSiteAccumulators(
  links: SiteAnalyticsCvrLink[],
  siteAccumulators: Map<string, SiteAccumulator>,
  pageAccumulators: Map<string, PageAccumulator>
) {
  for (const link of links) {
    const siteAccumulator = siteAccumulators.get(link.siteId);
    if (!siteAccumulator) {
      continue;
    }

    siteAccumulator.cvrLinkCount += 1;
    const sourcePage = pageAccumulators.get(pageAccumulatorKey(link.siteId, link.sourcePath));
    const targetPage = pageAccumulators.get(pageAccumulatorKey(link.siteId, link.targetPath));

    for (const visitor of sourcePage?.visitors ?? []) {
      siteAccumulator.cvrSourceVisitors.add(visitor);
    }
    for (const visitor of targetPage?.visitors ?? []) {
      siteAccumulator.cvrConversionVisitors.add(visitor);
    }
  }
}

function cvrPageCandidateFromAccumulator(accumulator: PageAccumulator): SiteAnalyticsCvrPageCandidate {
  return {
    siteId: accumulator.siteId,
    siteName: accumulator.siteName,
    path: accumulator.path,
    title: accumulator.title,
    uniqueVisitors: accumulator.visitors.size,
    pageViews: accumulator.pageViews
  };
}

function cvrLinkRowFromLink(
  link: SiteAnalyticsCvrLink,
  sitesById: Map<string, SiteAnalyticsPublicSite>,
  pageAccumulators: Map<string, PageAccumulator>
): SiteAnalyticsCvrLinkRow {
  const sourcePage = pageAccumulators.get(pageAccumulatorKey(link.siteId, link.sourcePath));
  const targetPage = pageAccumulators.get(pageAccumulatorKey(link.siteId, link.targetPath));
  const sourceVisitors = sourcePage?.visitors.size ?? 0;
  const targetVisitors = targetPage?.visitors.size ?? 0;

  return {
    ...link,
    siteName: sitesById.get(link.siteId)?.name ?? link.siteId,
    sourceTitle: sourcePage?.title || link.sourcePath,
    sourceVisitors,
    sourcePageViews: sourcePage?.pageViews ?? 0,
    targetTitle: targetPage?.title || link.targetPath,
    targetVisitors,
    targetPageViews: targetPage?.pageViews ?? 0,
    conversionRatePercent: conversionRatePercent(targetVisitors, sourceVisitors)
  };
}

function sortCvrPageCandidates(left: SiteAnalyticsCvrPageCandidate, right: SiteAnalyticsCvrPageCandidate) {
  return (
    left.siteName.localeCompare(right.siteName) ||
    right.uniqueVisitors - left.uniqueVisitors ||
    right.pageViews - left.pageViews ||
    left.path.localeCompare(right.path)
  );
}

function summaryFromAccumulator(accumulator: DashboardAccumulator): SiteAnalyticsMetricSummary {
  return {
    pageViews: accumulator.pageViews,
    uniqueVisitors: accumulator.visitors.size,
    sessions: accumulator.sessions.size,
    avgTimeOnPageSeconds: accumulator.pageViews > 0 ? accumulator.engagementMs / accumulator.pageViews / 1000 : 0,
    avgScrollPercent:
      accumulator.scrollSamples.length > 0
        ? accumulator.scrollSamples.reduce((total, value) => total + value, 0) / accumulator.scrollSamples.length
        : 0
  };
}

function siteRowFromAccumulator(accumulator: SiteAccumulator): SiteAnalyticsSiteSummary {
  const cvrSourceVisitors = accumulator.cvrSourceVisitors.size;
  const cvrConversionVisitors = accumulator.cvrConversionVisitors.size;

  return {
    ...accumulator.site,
    ...summaryFromAccumulator(accumulator),
    cvrSourceVisitors,
    cvrConversionVisitors,
    cvrLinkCount: accumulator.cvrLinkCount,
    conversionRatePercent: conversionRatePercent(cvrConversionVisitors, cvrSourceVisitors),
    lastSeenAt: accumulator.lastSeenAt
  };
}

function pageRowFromAccumulator(accumulator: PageAccumulator): SiteAnalyticsPageRow {
  return {
    siteId: accumulator.siteId,
    siteName: accumulator.siteName,
    path: accumulator.path,
    title: accumulator.title,
    ...summaryFromAccumulator(accumulator)
  };
}

function emptyDashboardAccumulator(): DashboardAccumulator {
  return {
    pageViews: 0,
    visitors: new Set<string>(),
    sessions: new Set<string>(),
    engagementMs: 0,
    scrollSamples: []
  };
}

function emptySiteAccumulator(site: SiteAnalyticsPublicSite): SiteAccumulator {
  return {
    ...emptyDashboardAccumulator(),
    site,
    cvrSourceVisitors: new Set<string>(),
    cvrConversionVisitors: new Set<string>(),
    cvrLinkCount: 0
  };
}

function isDailySiteAnalyticsData(value: unknown): value is DailySiteAnalyticsData {
  const record = asRecord(value);
  return (
    record?.version === SITE_ANALYTICS_VERSION &&
    typeof record.siteId === "string" &&
    typeof record.date === "string" &&
    asRecord(record.totals) !== undefined &&
    Array.isArray(record.visitors) &&
    Array.isArray(record.sessions) &&
    asRecord(record.pages) !== undefined &&
    asRecord(record.referrers) !== undefined
  );
}

function createDemoSiteAnalyticsDashboardData(
  period: SiteAnalyticsPeriod,
  selectedSiteId: string | undefined,
  now: Date
): SiteAnalyticsDashboardData {
  const demoSites: SiteAnalyticsPublicSite[] = [
    { id: "studio", name: "Hoofdstudio", url: "https://studio.example" },
    { id: "shop", name: "WordPress-shop", url: "https://shop.example" },
    { id: "blog", name: "Contentblog", url: "https://blog.example" }
  ];
  const activeSites = selectedSiteId ? demoSites.filter((site) => site.id === selectedSiteId) : demoSites;
  const sites = activeSites.length > 0 ? activeSites : demoSites;
  const dailyRows = dateKeysForPeriod(period).map((date, index) => {
    const base = 80 + index * 7;
    return {
      date,
      label: dateFormatter.format(dateFromKey(date)),
      pageViews: sites.reduce((total, _site, siteIndex) => total + base + siteIndex * 26 + ((index + siteIndex) % 4) * 18, 0),
      uniqueVisitors: sites.reduce((total, _site, siteIndex) => total + Math.round((base + siteIndex * 18) * 0.58), 0),
      sessions: sites.reduce((total, _site, siteIndex) => total + Math.round((base + siteIndex * 18) * 0.72), 0)
    };
  });
  const totalPageViews = dailyRows.reduce((total, row) => total + row.pageViews, 0);
  const totalVisitors = dailyRows.reduce((total, row) => total + row.uniqueVisitors, 0);
  const totalSessions = dailyRows.reduce((total, row) => total + row.sessions, 0);
  const cvrBySite = new Map([
    ["studio", { sources: 780, conversions: 52, links: 2 }],
    ["shop", { sources: 870, conversions: 63, links: 2 }],
    ["blog", { sources: 960, conversions: 74, links: 1 }]
  ]);
  const siteRows = sites.map((site, index) => ({
    ...site,
    pageViews: Math.round(totalPageViews / sites.length + index * 340),
    uniqueVisitors: Math.round(totalVisitors / sites.length + index * 120),
    sessions: Math.round(totalSessions / sites.length + index * 160),
    avgTimeOnPageSeconds: 52 + index * 9,
    avgScrollPercent: 61 + index * 7,
    cvrSourceVisitors: cvrBySite.get(site.id)?.sources ?? 0,
    cvrConversionVisitors: cvrBySite.get(site.id)?.conversions ?? 0,
    cvrLinkCount: cvrBySite.get(site.id)?.links ?? 0,
    conversionRatePercent: conversionRatePercent(cvrBySite.get(site.id)?.conversions ?? 0, cvrBySite.get(site.id)?.sources ?? 0),
    lastSeenAt: now.toISOString()
  }));
  const cvrPageCandidates = [
    { siteId: "studio", siteName: "Hoofdstudio", path: "/project-webdesign", title: "Project webdesign", uniqueVisitors: 420, pageViews: 642 },
    { siteId: "studio", siteName: "Hoofdstudio", path: "/project-seo", title: "Project SEO", uniqueVisitors: 360, pageViews: 510 },
    { siteId: "studio", siteName: "Hoofdstudio", path: "/bedankt-aanvraag", title: "Bedankt aanvraag", uniqueVisitors: 52, pageViews: 68 },
    { siteId: "shop", siteName: "WordPress-shop", path: "/project-shop", title: "Project shop", uniqueVisitors: 530, pageViews: 790 },
    { siteId: "shop", siteName: "WordPress-shop", path: "/thankyou-offerte", title: "Thankyou offerte", uniqueVisitors: 63, pageViews: 84 },
    { siteId: "blog", siteName: "Contentblog", path: "/project-content", title: "Project content", uniqueVisitors: 412, pageViews: 590 },
    { siteId: "blog", siteName: "Contentblog", path: "/bedankt-content", title: "Bedankt content", uniqueVisitors: 74, pageViews: 96 }
  ].filter((row) => !selectedSiteId || row.siteId === selectedSiteId);
  const cvrLinks: SiteAnalyticsCvrLinkRow[] = [
    {
      id: "demo-studio-webdesign-bedankt",
      siteId: "studio",
      siteName: "Hoofdstudio",
      sourcePath: "/project-webdesign",
      sourceTitle: "Project webdesign",
      sourceVisitors: 420,
      sourcePageViews: 642,
      targetPath: "/bedankt-aanvraag",
      targetTitle: "Bedankt aanvraag",
      targetVisitors: 52,
      targetPageViews: 68,
      conversionRatePercent: conversionRatePercent(52, 420),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: "demo-shop-project-thankyou",
      siteId: "shop",
      siteName: "WordPress-shop",
      sourcePath: "/project-shop",
      sourceTitle: "Project shop",
      sourceVisitors: 530,
      sourcePageViews: 790,
      targetPath: "/thankyou-offerte",
      targetTitle: "Thankyou offerte",
      targetVisitors: 63,
      targetPageViews: 84,
      conversionRatePercent: conversionRatePercent(63, 530),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    },
    {
      id: "demo-blog-content-bedankt",
      siteId: "blog",
      siteName: "Contentblog",
      sourcePath: "/project-content",
      sourceTitle: "Project content",
      sourceVisitors: 412,
      sourcePageViews: 590,
      targetPath: "/bedankt-content",
      targetTitle: "Bedankt content",
      targetVisitors: 74,
      targetPageViews: 96,
      conversionRatePercent: conversionRatePercent(74, 412),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
  ].filter((row) => !selectedSiteId || row.siteId === selectedSiteId);

  return {
    source: {
      mode: "demo",
      message: "Demogegevens zichtbaar. Installeer de WordPress-plugin vanuit dit dashboard om je eerste site te verbinden."
    },
    period,
    sites: siteRows,
    selectedSiteId: selectedSiteId && demoSites.some((site) => site.id === selectedSiteId) ? selectedSiteId : undefined,
    totals: {
      pageViews: siteRows.reduce((total, site) => total + site.pageViews, 0),
      uniqueVisitors: siteRows.reduce((total, site) => total + site.uniqueVisitors, 0),
      sessions: siteRows.reduce((total, site) => total + site.sessions, 0),
      avgTimeOnPageSeconds: 68,
      avgScrollPercent: 72
    },
    dailyRows,
    pageRows: [
      { siteId: "studio", siteName: "Hoofdstudio", path: "/", title: "Home", pageViews: 1830, uniqueVisitors: 1112, sessions: 1270, avgTimeOnPageSeconds: 64, avgScrollPercent: 76 },
      { siteId: "shop", siteName: "WordPress-shop", path: "/producten", title: "Producten", pageViews: 1264, uniqueVisitors: 812, sessions: 940, avgTimeOnPageSeconds: 82, avgScrollPercent: 69 },
      { siteId: "blog", siteName: "Contentblog", path: "/blog", title: "Artikelen", pageViews: 1088, uniqueVisitors: 744, sessions: 802, avgTimeOnPageSeconds: 95, avgScrollPercent: 81 },
      { siteId: "studio", siteName: "Hoofdstudio", path: "/contact", title: "Contact", pageViews: 642, uniqueVisitors: 420, sessions: 458, avgTimeOnPageSeconds: 47, avgScrollPercent: 58 }
    ].filter((row) => !selectedSiteId || row.siteId === selectedSiteId),
    referrerRows: [
      { source: "google / organic", pageViews: 3120, sessions: 2290 },
      { source: "Direct", pageViews: 1460, sessions: 1184 },
      { source: "linkedin.com", pageViews: 688, sessions: 522 },
      { source: "newsletter / email", pageViews: 476, sessions: 390 }
    ],
    cvrPageCandidates,
    cvrLinks,
    lastUpdated: dateTimeFormatter.format(now)
  };
}

function siteAnalyticsPeriod(days: number, now: Date): SiteAnalyticsPeriod {
  const end = dateKeyForDate(now);
  const start = dateKeyForDate(addDays(now, -(days - 1)));
  return {
    days,
    start,
    end,
    label: `Laatste ${days} dagen`
  };
}

function dateKeysForPeriod(period: SiteAnalyticsPeriod) {
  const keys: string[] = [];
  let cursor = dateFromKey(period.start);
  const end = dateFromKey(period.end);

  while (cursor <= end) {
    keys.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return keys;
}

function normalizeDashboardDays(days: number | undefined) {
  if (!days || !Number.isFinite(days)) {
    return DEFAULT_DASHBOARD_DAYS;
  }

  return Math.max(1, Math.min(MAX_DASHBOARD_DAYS, Math.round(days)));
}

function normalizeEventType(value: string | undefined): SiteAnalyticsEventType | "" {
  return value === "page_view" || value === "engagement" || value === "scroll" ? value : "";
}

function normalizeIdentifier(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function normalizeOptionalIdentifier(value: string | undefined) {
  const normalized = normalizeIdentifier(value);
  return normalized || undefined;
}

function normalizeString(value: unknown, maxLength = MAX_STRING_LENGTH) {
  return stringFrom(value)?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) ?? "";
}

function normalizeSiteUrl(value: string | undefined) {
  const raw = normalizeString(value, 500);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw.replace(/\/$/, "");
  }
}

function normalizeHttpSiteUrl(value: string | undefined) {
  const raw = normalizeString(value, 500);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }

    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function siteNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") || "Site WordPress";
  } catch {
    return "Site WordPress";
  }
}

function siteIdForRegistration(siteUrl: string, installationHash: string) {
  let slugSource = "wordpress-site";
  try {
    slugSource = new URL(siteUrl).hostname.replace(/^www\./, "").replace(/\./g, "-");
  } catch {
    slugSource = siteUrl;
  }

  const slug = normalizeIdentifier(slugSource) || "wordpress-site";
  return normalizeIdentifier(`${slug}-${installationHash.slice(0, 10)}`);
}

function publicSiteFromConfiguredSite(site: SiteAnalyticsConfiguredSite): SiteAnalyticsPublicSite {
  const { token: _token, ...publicSite } = site;
  return publicSite;
}

function normalizeEventPagePath(path: string | undefined, pageUrl: string) {
  const normalizedPageUrl = normalizePagePath(pageUrl);
  if (normalizedPageUrl) {
    return normalizedPageUrl;
  }

  return normalizePagePath(path);
}

function normalizePagePath(value: string | undefined) {
  const raw = normalizeString(value, 800);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw, "https://site-analytics.local");
    const pathname = (url.pathname || "/").replace(/\/{2,}/g, "/");
    const query = normalizedPageQuery(url.searchParams);
    return query ? `${pathname}?${query}` : pathname;
  } catch {
    return "";
  }
}

function normalizedPageQuery(params: URLSearchParams) {
  const entries: Array<[string, string]> = [];

  params.forEach((value, key) => {
    const normalizedKey = normalizeString(key, 80);
    if (!normalizedKey || IGNORED_PAGE_QUERY_PARAMS.has(normalizedKey.toLowerCase())) {
      return;
    }

    const normalizedValue = normalizeString(value, 240);
    if (!normalizedValue) {
      return;
    }

    entries.push([normalizedKey, normalizedValue]);
  });

  entries.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    query.append(key, value);
  }

  return query.toString();
}

function normalizeReferrerSource(source: string | undefined, medium: string | undefined, referrer: string | undefined, pageUrl: string) {
  const sourceValue = normalizeString(source, 80).toLowerCase();
  const mediumValue = normalizeString(medium, 80).toLowerCase();
  if (sourceValue) {
    return mediumValue ? `${sourceValue} / ${mediumValue}` : sourceValue;
  }

  const referrerValue = normalizeString(referrer, 500);
  if (!referrerValue) {
    return "Direct";
  }

  try {
    const referrerUrl = new URL(referrerValue);
    const pageHost = hostFromUrl(pageUrl);
    if (pageHost && referrerUrl.host === pageHost) {
      return "Interne";
    }

    return referrerUrl.host.replace(/^www\./, "");
  } catch {
    return referrerValue.slice(0, 80);
  }
}

function dailySiteAnalyticsCacheKey(siteId: string, date: string) {
  return `${SITE_ANALYTICS_CACHE_PREFIX}:${siteId}:${date}`;
}

function pageAccumulatorKey(siteId: string, path: string) {
  return `${siteId}:${path}`;
}

function cvrLinkId(siteId: string, sourcePath: string, targetPath: string) {
  return createHash("sha256").update(`${siteId}:${sourcePath}:${targetPath}`).digest("hex").slice(0, 24);
}

function isCvrThankYouPath(path: string) {
  const normalized = normalizePagePath(path).toLowerCase();
  const spaced = normalized.replace(/%20|[_-]+/g, " ");
  return normalized.includes("thankyou") || spaced.includes("thank you") || normalized.includes("bedankt");
}

function conversionRatePercent(conversions: number, sources: number) {
  return sources > 0 ? (conversions / sources) * 100 : 0;
}

function hashIdentity(siteId: string, value: string) {
  return createHash("sha256").update(`${siteId}:${value}`).digest("hex").slice(0, 24);
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: Buffer, right: Buffer) {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function dateKeyForDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return 0;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

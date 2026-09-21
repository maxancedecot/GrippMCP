import test from "node:test";
import { dashboardToday } from "../src/dashboardPeriod.js";
import assert from "node:assert/strict";
import { getCampaignPerformance } from "../src/campaignPerformance.js";
import { cvrOverviewRowsFromLinks } from "../src/siteAnalyticsConversions.js";
import { readJsonCache, writeJsonCache } from "../src/jsonCache.js";
import { isExcludedAnalyticsLink } from "../src/analyticsPageFilter.js";
import {
  deleteRegisteredSiteAnalyticsSite,
  deleteSiteAnalyticsCvrLink,
  getConfiguredSiteAnalyticsSites,
  getPublicSiteAnalyticsSites,
  getSiteAnalyticsDashboardData,
  registerSiteAnalyticsSite,
  recordSiteAnalyticsEvent,
  type SiteAnalyticsDashboardData,
  upsertSiteAnalyticsCvrLink,
  verifySiteAnalyticsToken
} from "../src/siteAnalytics.js";

test("site analytics reads configured sites and validates tokens", async () => {
  await withSiteAnalyticsEnv("token-check", "secret-token", async () => {
    const sites = getConfiguredSiteAnalyticsSites();

    assert.equal(sites.length, 1);
    assert.equal(sites[0].id, "token-check");
    assert.equal(sites[0].name, "Token Check");
    assert.equal(await verifySiteAnalyticsToken("token-check", "secret-token"), true);
    assert.equal(await verifySiteAnalyticsToken("token-check", "wrong-token"), false);
    assert.equal(await verifySiteAnalyticsToken("unknown", "secret-token"), false);
  });
});

test("tooling links are excluded case-insensitively, including encoded URLs and query parameters", () => {
  for (const url of ["https://example.com/?preview=1", "/ELEMENTOR/test", "https://sites.leadconnectorhq.com/home", "/wordpress", "/%70review/test"]) {
    assert.equal(isExcludedAnalyticsLink(url), true);
  }
  assert.equal(isExcludedAnalyticsLink("https://ankerrui-antwerpen.be/home"), false);
});

test("excluded future events do not pollute published pages or totals", async () => {
  const siteId = `filtered-events-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    for (const [index, path] of ["/", "/?preview=true", "/?elementor=100", "/wordpress/test", "/leadconnector/test"].entries()) {
      await recordSiteAnalyticsEvent({ site_id: siteId, event_type: "page_view", visitor_id: `visitor-${index}`, session_id: `session-${index}`,
        page_view_id: `view-${index}`, page_url: `https://example.com${path}`, path, page_title: "WordPress-powered real project" });
    }
    const data = await getSiteAnalyticsDashboardData({ siteId, days: 1 });
    assert.equal(data.totals.pageViews, 1);
    assert.equal(data.totals.uniqueVisitors, 1);
    assert.deepEqual(data.pageRows.map((page) => page.path), ["/"]);
  });
});

test("historical excluded pages are hidden and removed from totals without deleting stored data", async () => {
  const siteId = `filtered-history-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    const date = dashboardToday();
    const key = `site-analytics:v1:${siteId}:${date}`;
    const makePage = (path: string, visitor: string) => ({ path, title: path, url: `https://example.com${path}`, views: 1,
      visitors: [visitor], sessions: [visitor], engagementMs: 1000, scrollByView: { [visitor]: 50 } });
    const stored = { version: 1, siteId, date, totals: { pageViews: 2, engagementMs: 2000 }, visitors: ["valid", "preview"], sessions: ["valid", "preview"],
      pages: { "/": makePage("/", "valid"), "/?elementor=1": makePage("/?elementor=1", "preview") },
      referrers: { source: { source: "google", views: 2, sessions: ["valid", "preview"] } } };
    await writeJsonCache(key, stored);
    const data = await getSiteAnalyticsDashboardData({ siteId, days: 1 });
    assert.deepEqual(data.pageRows.map((page) => page.path), ["/"]);
    assert.equal(data.cvrPageCandidates.length, 1);
    assert.equal(data.totals.pageViews, 1);
    assert.equal(data.totals.uniqueVisitors, 1);
    assert.equal(data.totals.sessions, 1);
    assert.equal(data.dailyRows[0].pageViews, 1);
    assert.equal(data.referrerRows.reduce((sum, row) => sum + row.pageViews, 0), 1);
    assert.deepEqual(await readJsonCache(key), stored);
  });
});

test("whole sites on excluded hosts are absent from website metrics", async () => {
  await withSiteAnalyticsEnv(`blocked-host-${Date.now()}`, "event-token", async () => {
    process.env.SITE_ANALYTICS_SITES = JSON.stringify([{ id: "blocked-host", name: "Leadconnector", url: "https://sites.leadconnectorhq.com", token: "event-token" }]);
    const data = await getSiteAnalyticsDashboardData({ days: 1 });
    assert.equal(data.sites.some((site) => site.id === "blocked-host"), false);
    assert.equal(data.source.mode, "live");
  });
});

test("site analytics auto-registers sites and validates generated tokens", async () => {
  await withSiteAnalyticsMemory(async () => {
    const unique = Date.now();
    const registration = await registerSiteAnalyticsSite(
      {
        site_url: `https://client-${unique}.example`,
        site_name: "Client Auto",
        installation_id: `install-${unique}`
      },
      { now: new Date("2026-01-01T10:00:00.000Z") }
    );
    const sites = await getPublicSiteAnalyticsSites();

    assert.equal(registration.site.name, "Client Auto");
    assert.match(registration.site.id, /^client-[0-9]+-example-[a-f0-9]{10}$/);
    assert.equal(sites.some((site) => site.id === registration.site.id), true);
    assert.equal(await verifySiteAnalyticsToken(registration.site.id, registration.siteToken), true);
    assert.equal(await verifySiteAnalyticsToken(registration.site.id, "wrong-token"), false);
    assert.equal(await deleteRegisteredSiteAnalyticsSite(registration.site.id, "wrong-token"), false);
    assert.equal(await deleteRegisteredSiteAnalyticsSite(registration.site.id, registration.siteToken), true);
    assert.equal((await getPublicSiteAnalyticsSites()).some((site) => site.id === registration.site.id), false);
  });
});

test("site analytics formats dashboard timestamps in Brussels time", async () => {
  await withSiteAnalyticsMemory(async () => {
    const dashboard = await getSiteAnalyticsDashboardData({
      days: 7,
      now: new Date("2026-07-01T10:00:00.000Z")
    });

    assert.match(dashboard.lastUpdated, /12:00/);
  });
});

test("site analytics records page views, sessions, referrers, time, and scroll", async () => {
  const siteId = `site-analytics-test-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    await recordSiteAnalyticsEvent({
      site_id: siteId,
      event_type: "page_view",
      visitor_id: "visitor-1",
      session_id: "session-1",
      page_view_id: "page-view-1",
      page_url: "https://example.com/about?utm_source=google",
      path: "/about",
      page_title: "About",
      referrer: "https://www.google.com/search?q=example",
      source: "google",
      medium: "organic",
      scroll_percent: 0
    });
    await recordSiteAnalyticsEvent({
      site_id: siteId,
      event_type: "engagement",
      visitor_id: "visitor-1",
      session_id: "session-1",
      page_view_id: "page-view-1",
      page_url: "https://example.com/about?utm_source=google",
      path: "/about",
      page_title: "About",
      active_time_ms_delta: 42000,
      scroll_percent: 80
    });

    const dashboard = await getSiteAnalyticsDashboardData({ days: 7, siteId });
    const page = dashboard.pageRows.find((row) => row.path === "/about");
    const referrer = dashboard.referrerRows.find((row) => row.source === "google / organic");

    assert.equal(dashboard.source.mode, "live");
    assert.equal(dashboard.totals.pageViews, 1);
    assert.equal(dashboard.totals.uniqueVisitors, 1);
    assert.equal(dashboard.totals.sessions, 1);
    assert.equal(Math.round(dashboard.totals.avgTimeOnPageSeconds), 42);
    assert.equal(Math.round(dashboard.totals.avgScrollPercent), 80);
    assert.equal(page?.pageViews, 1);
    assert.equal(page?.uniqueVisitors, 1);
    assert.equal(Math.round(page?.avgTimeOnPageSeconds ?? 0), 42);
    assert.equal(Math.round(page?.avgScrollPercent ?? 0), 80);
    assert.equal(page?.path, "/about");
    assert.equal(referrer?.pageViews, 1);
    assert.equal(referrer?.sessions, 1);
  });
});

test("site analytics calculates CVR from linked project and thank-you pages", async () => {
  const siteId = `site-analytics-cvr-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    for (const visitor of ["visitor-project-1", "visitor-project-2", "visitor-project-3"]) {
      await recordSiteAnalyticsEvent({
        site_id: siteId,
        event_type: "page_view",
        visitor_id: visitor,
        session_id: `session-${visitor}`,
        page_view_id: `page-view-${visitor}`,
        page_url: "https://example.com/projectnaam1",
        path: "/projectnaam1",
        page_title: "Projectnaam 1"
      });
    }
    for (const visitor of ["visitor-project-1", "visitor-project-2"]) {
      await recordSiteAnalyticsEvent({
        site_id: siteId,
        event_type: "page_view",
        visitor_id: visitor,
        session_id: `session-${visitor}`,
        page_view_id: `page-view-bedankt-crollet-${visitor}`,
        page_url: "https://example.com/bedankt-afspraak/?p_slug=crollet",
        path: "/bedankt-afspraak/",
        page_title: "Bedankt project"
      });
    }
    await recordSiteAnalyticsEvent({
      site_id: siteId,
      event_type: "page_view",
      visitor_id: "visitor-project-3",
      session_id: "session-visitor-project-3",
      page_view_id: "page-view-bedankt-andere",
      page_url: "https://example.com/bedankt-afspraak/?p_slug=ander-project",
      path: "/bedankt-afspraak/",
      page_title: "Bedankt ander project"
    });
    for (const visitor of ["visitor-project-2", "visitor-project-3"]) {
      await recordSiteAnalyticsEvent({
        site_id: siteId,
        event_type: "page_view",
        visitor_id: visitor,
        session_id: `session-${visitor}`,
        page_view_id: `page-view-thankyou-brochure-${visitor}`,
        page_url: "https://example.com/thankyou-brochure/?p_slug=crollet",
        path: "/thankyou-brochure/",
        page_title: "Thankyou brochure"
      });
    }

    const dashboardBeforeLink = await getSiteAnalyticsDashboardData({ days: 7, siteId });
    const siteBeforeLink = dashboardBeforeLink.sites.find((row) => row.id === siteId);

    assert.equal(siteBeforeLink?.cvrLinkCount, 0);
    assert.equal(siteBeforeLink?.cvrSourceVisitors, 0);
    assert.equal(siteBeforeLink?.cvrConversionVisitors, 0);
    assert.equal(siteBeforeLink?.conversionRatePercent, 0);
    await assert.rejects(
      upsertSiteAnalyticsCvrLink({
        site_id: siteId,
        source_path: "/projectnaam1",
        target_path: "/gewone-confirmatie?p_slug=crollet"
      }),
      /doelpagina moet thankyou/
    );

    const link = await upsertSiteAnalyticsCvrLink(
      {
        site_id: siteId,
        source_path: "https://example.com/projectnaam1",
        target_path: "https://example.com/bedankt-afspraak/?p_slug=crollet"
      },
      { now: new Date("2026-01-01T10:00:00.000Z") }
    );
    const secondLink = await upsertSiteAnalyticsCvrLink(
      {
        site_id: siteId,
        source_path: "https://example.com/projectnaam1",
        target_path: "https://example.com/thankyou-brochure/?p_slug=crollet"
      },
      { now: new Date("2026-01-01T10:05:00.000Z") }
    );
    const dashboard = await getSiteAnalyticsDashboardData({ days: 7, siteId });
    const site = dashboard.sites.find((row) => row.id === siteId);
    const cvrLink = dashboard.cvrLinks.find((row) => row.id === link.id);
    const secondCvrLink = dashboard.cvrLinks.find((row) => row.id === secondLink.id);
    const sourceLinks = dashboard.cvrLinks.filter((row) => row.sourcePath === "/projectnaam1");

    assert.equal(site?.cvrLinkCount, 2);
    assert.equal(site?.cvrSourceVisitors, 3);
    assert.equal(site?.cvrConversionVisitors, 3);
    assert.equal(Math.round((site?.conversionRatePercent ?? 0) * 10) / 10, 100);
    assert.equal(sourceLinks.length, 2);
    const overview = cvrOverviewRowsFromLinks(dashboard.cvrLinks);
    const campaigns = await getCampaignPerformance(dashboard, { env: {} });
    assert.equal(overview[0].brochure.visitors, 2);
    assert.equal(overview[0].appointment.visitors, 2);
    assert.equal(campaigns.rows[0].leads.data?.count, 2);
    assert.equal(campaigns.rows[0].appointments.data?.count, 2);

    assert.deepEqual(
      sourceLinks.map((row) => row.targetPath).sort(),
      ["/bedankt-afspraak/?p_slug=crollet", "/thankyou-brochure/?p_slug=crollet"]
    );
    assert.equal(cvrLink?.sourceVisitors, 3);
    assert.equal(cvrLink?.targetVisitors, 2);
    assert.equal(Math.round((cvrLink?.conversionRatePercent ?? 0) * 10) / 10, 66.7);
    assert.equal(secondCvrLink?.sourceVisitors, 3);
    assert.equal(secondCvrLink?.targetVisitors, 2);
    assert.equal(Math.round((secondCvrLink?.conversionRatePercent ?? 0) * 10) / 10, 66.7);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/projectnaam1"), true);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/bedankt-afspraak/?p_slug=crollet"), true);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/bedankt-afspraak/?p_slug=ander-project"), true);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/thankyou-brochure/?p_slug=crollet"), true);
    assert.equal(await deleteSiteAnalyticsCvrLink(link.id), true);
    assert.equal(await deleteSiteAnalyticsCvrLink(secondLink.id), true);
  });
});

async function withSiteAnalyticsEnv<T>(siteId: string, token: string, callback: () => T | Promise<T>): Promise<T> {
  const previousSites = process.env.SITE_ANALYTICS_SITES;
  const previousCacheStore = process.env.JSON_CACHE_STORE;

  process.env.JSON_CACHE_STORE = "memory";
  process.env.SITE_ANALYTICS_SITES = JSON.stringify([
    {
      id: siteId,
      name: "Token Check",
      url: "https://example.com",
      token
    }
  ]);

  try {
    return await callback();
  } finally {
    if (previousSites === undefined) {
      delete process.env.SITE_ANALYTICS_SITES;
    } else {
      process.env.SITE_ANALYTICS_SITES = previousSites;
    }

    if (previousCacheStore === undefined) {
      delete process.env.JSON_CACHE_STORE;
    } else {
      process.env.JSON_CACHE_STORE = previousCacheStore;
    }
  }
}

async function withSiteAnalyticsMemory<T>(callback: () => T | Promise<T>): Promise<T> {
  const previousSites = process.env.SITE_ANALYTICS_SITES;
  const previousSingleSiteId = process.env.SITE_ANALYTICS_SITE_ID;
  const previousSingleSiteName = process.env.SITE_ANALYTICS_SITE_NAME;
  const previousSingleSiteUrl = process.env.SITE_ANALYTICS_SITE_URL;
  const previousSingleSiteToken = process.env.SITE_ANALYTICS_SITE_TOKEN;
  const previousCacheStore = process.env.JSON_CACHE_STORE;

  process.env.JSON_CACHE_STORE = "memory";
  delete process.env.SITE_ANALYTICS_SITES;
  delete process.env.SITE_ANALYTICS_SITE_ID;
  delete process.env.SITE_ANALYTICS_SITE_NAME;
  delete process.env.SITE_ANALYTICS_SITE_URL;
  delete process.env.SITE_ANALYTICS_SITE_TOKEN;

  try {
    return await callback();
  } finally {
    if (previousSites === undefined) {
      delete process.env.SITE_ANALYTICS_SITES;
    } else {
      process.env.SITE_ANALYTICS_SITES = previousSites;
    }
    if (previousSingleSiteId === undefined) {
      delete process.env.SITE_ANALYTICS_SITE_ID;
    } else {
      process.env.SITE_ANALYTICS_SITE_ID = previousSingleSiteId;
    }
    if (previousSingleSiteName === undefined) {
      delete process.env.SITE_ANALYTICS_SITE_NAME;
    } else {
      process.env.SITE_ANALYTICS_SITE_NAME = previousSingleSiteName;
    }
    if (previousSingleSiteUrl === undefined) {
      delete process.env.SITE_ANALYTICS_SITE_URL;
    } else {
      process.env.SITE_ANALYTICS_SITE_URL = previousSingleSiteUrl;
    }
    if (previousSingleSiteToken === undefined) {
      delete process.env.SITE_ANALYTICS_SITE_TOKEN;
    } else {
      process.env.SITE_ANALYTICS_SITE_TOKEN = previousSingleSiteToken;
    }
    if (previousCacheStore === undefined) {
      delete process.env.JSON_CACHE_STORE;
    } else {
      process.env.JSON_CACHE_STORE = previousCacheStore;
    }
  }
}


test("custom website periods filter visitors and project conversions at inclusive date boundaries", async () => {
  const siteId = `custom-period-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    const now = new Date();
    const today = dashboardToday(now);
    const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
    for (const path of ["/project", "/bedankt-brochure"]) {
      await recordSiteAnalyticsEvent({ site_id: siteId, event_type: "page_view", visitor_id: "date-visitor", session_id: "date-session",
        page_view_id: `view-${path}`, page_url: `https://example.com${path}`, path, page_title: path });
    }
    await upsertSiteAnalyticsCvrLink({ site_id: siteId, source_path: "/project", target_path: "/bedankt-brochure" });
    const current = await getSiteAnalyticsDashboardData({ siteId, start: today, end: today, now });
    const historical = await getSiteAnalyticsDashboardData({ siteId, start: yesterday, end: yesterday, now });
    const inclusive = await getSiteAnalyticsDashboardData({ siteId, start: yesterday, end: today, now });
    assert.equal(current.totals.uniqueVisitors, 1);
    assert.equal(historical.totals.uniqueVisitors, 0);
    assert.equal(inclusive.totals.uniqueVisitors, 1);
    assert.deepEqual(historical.dailyRows.map((row) => row.date), [yesterday]);
    assert.deepEqual(inclusive.dailyRows.map((row) => row.date), [yesterday, today]);
    assert.equal(cvrOverviewRowsFromLinks(current.cvrLinks)[0].brochure.visitors, 1);
    assert.equal(cvrOverviewRowsFromLinks(historical.cvrLinks)[0].brochure.visitors, 0);
  });
});

test("Brusselskaai groups language pages using unique visitors and conversion visitors within the selected period", async () => {
  const siteId = `brusselskaai-group-${Date.now()}`;
  await withSiteAnalyticsEnv(siteId, "event-token", async () => {
    process.env.SITE_ANALYTICS_SITES = JSON.stringify([{ id: siteId, name: "Brusselskaai", url: "https://www.brusselskaai.be", token: "event-token" }]);
    const today = dashboardToday();
    const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
    const pages = [
      ["/", "shared"], ["/", "nl"], ["/home-fr/", "shared"], ["/home-fr", "fr"],
      ["/home-eng/", "shared"], ["/home-eng", "eng"], ["/teaser-fr/", "fr"], ["/teaser-eng/", "eng"],
      ["/bedankt-brochure", "shared"], ["/bedankt-brochure-fr", "shared"], ["/bedankt-brochure-fr", "fr"],
      ["/bedankt-afspraak", "nl"], ["/contact", "contact-only"], ["/home-fr/?p_slug=other", "other-project"]
    ];
    for (const [index, [path, visitor]] of pages.entries()) {
      await recordSiteAnalyticsEvent({ site_id: siteId, event_type: "page_view", visitor_id: visitor, session_id: visitor,
        page_view_id: `group-view-${index}`, page_url: `https://www.brusselskaai.be${path}`, path, page_title: path });
    }
    const before = await getSiteAnalyticsDashboardData({ siteId, start: today, end: today });
    assert.deepEqual(groupMetrics(before), [{ siteId, sourcePath: "/", visitors: 4, leads: null, appointments: null }]);
    for (const [source, target] of [["/", "/bedankt-brochure"], ["/home-fr/", "/bedankt-brochure-fr"], ["/home-eng", "/bedankt-brochure"], ["/", "/bedankt-afspraak"]]) {
      await upsertSiteAnalyticsCvrLink({ site_id: siteId, source_path: source, target_path: target });
    }
    const current = await getSiteAnalyticsDashboardData({ siteId, start: today, end: today });
    assert.deepEqual(groupMetrics(current), [{ siteId, sourcePath: "/", visitors: 4, leads: 2, appointments: 1 }]);
    assert.deepEqual(current.pageRows, before.pageRows, "Individual website measurements remain available");
    const result = await getCampaignPerformance(current, { env: {} });
    const project = result.projects.find((project) => project.key === `${siteId}:/`)!;
    assert.equal(result.projects.length, 1);
    assert.deepEqual([project.title, project.visitors, project.leads, project.appointments, project.cvr], ["Brusselskaai", 4, 2, 1, 75]);
    const historical = await getSiteAnalyticsDashboardData({ siteId, start: yesterday, end: yesterday });
    assert.deepEqual(groupMetrics(historical), [{ siteId, sourcePath: "/", visitors: 0, leads: 0, appointments: 0 }]);
    for (const link of current.cvrLinks) await deleteSiteAnalyticsCvrLink(link.id);
  });
});

function groupMetrics(dashboard: SiteAnalyticsDashboardData) {
  return dashboard.projectPageGroups?.map(({ siteId, sourcePath, visitors, leads, appointments }) => ({
    siteId, sourcePath, visitors, leads, appointments
  }));
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteRegisteredSiteAnalyticsSite,
  deleteSiteAnalyticsCvrLink,
  getConfiguredSiteAnalyticsSites,
  getPublicSiteAnalyticsSites,
  getSiteAnalyticsDashboardData,
  registerSiteAnalyticsSite,
  recordSiteAnalyticsEvent,
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
    const dashboard = await getSiteAnalyticsDashboardData({ days: 7, siteId });
    const site = dashboard.sites.find((row) => row.id === siteId);
    const cvrLink = dashboard.cvrLinks.find((row) => row.id === link.id);

    assert.equal(site?.cvrLinkCount, 1);
    assert.equal(site?.cvrSourceVisitors, 3);
    assert.equal(site?.cvrConversionVisitors, 2);
    assert.equal(Math.round((site?.conversionRatePercent ?? 0) * 10) / 10, 66.7);
    assert.equal(cvrLink?.sourceVisitors, 3);
    assert.equal(cvrLink?.targetVisitors, 2);
    assert.equal(Math.round((cvrLink?.conversionRatePercent ?? 0) * 10) / 10, 66.7);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/projectnaam1"), true);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/bedankt-afspraak/?p_slug=crollet"), true);
    assert.equal(dashboard.cvrPageCandidates.some((page) => page.path === "/bedankt-afspraak/?p_slug=ander-project"), true);
    assert.equal(await deleteSiteAnalyticsCvrLink(link.id), true);
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

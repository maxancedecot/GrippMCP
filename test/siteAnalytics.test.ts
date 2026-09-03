import test from "node:test";
import assert from "node:assert/strict";
import {
  getConfiguredSiteAnalyticsSites,
  getSiteAnalyticsDashboardData,
  recordSiteAnalyticsEvent,
  verifySiteAnalyticsToken
} from "../src/siteAnalytics.js";

test("site analytics reads configured sites and validates tokens", async () => {
  await withSiteAnalyticsEnv("token-check", "secret-token", () => {
    const sites = getConfiguredSiteAnalyticsSites();

    assert.equal(sites.length, 1);
    assert.equal(sites[0].id, "token-check");
    assert.equal(sites[0].name, "Token Check");
    assert.equal(verifySiteAnalyticsToken("token-check", "secret-token"), true);
    assert.equal(verifySiteAnalyticsToken("token-check", "wrong-token"), false);
    assert.equal(verifySiteAnalyticsToken("unknown", "secret-token"), false);
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
    assert.equal(referrer?.pageViews, 1);
    assert.equal(referrer?.sessions, 1);
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

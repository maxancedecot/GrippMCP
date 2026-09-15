import test from "node:test";
import assert from "node:assert/strict";
import { collectBrowserAnalytics, browserAnalyticsOptions } from "../src/browserAnalytics.js";
import { getCampaignPerformance } from "../src/campaignPerformance.js";
import { deleteRegisteredSiteAnalyticsSite, getPublicSiteAnalyticsSites, getSiteAnalyticsDashboardData, registerSiteAnalyticsSite, registerBrowserSiteAnalyticsSite, upsertSiteAnalyticsCvrLink } from "../src/siteAnalytics.js";

process.env.JSON_CACHE_STORE = "memory";
process.env.SITE_ANALYTICS_SITES = "[]";
const baseEvent = { project: "ledoux", event_type: "page_view", visitor_id: "v1", session_id: "s1", page_view_id: "p1", page_title: "Project" };
function request(origin: string, event: Record<string, unknown> = {}) {
  return new Request("https://dashboard.example/api/site-analytics/browser", {
    method: "POST", headers: { Origin: origin, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ ...baseEvent, page_url: `${origin}/project`, ...event })
  });
}

test("browser measurements register one site per domain and feed brochure, appointment and CVR counts", async () => {
  const origin = "https://browser-conversions.example";
  const first = await collectBrowserAnalytics(request(origin, { page_url: `${origin}/project?email=private@example.com&utm_source=facebook#secret`, source: "facebook", medium: "paid" }));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), origin);
  assert.deepEqual(await first.json(), { ok: true });
  const site = (await getPublicSiteAnalyticsSites()).find((site) => site.url === origin)!;
  assert.ok(site);
  assert.equal(await deleteRegisteredSiteAnalyticsSite(site.id, "ledoux"), false);
  assert.equal((await collectBrowserAnalytics(request(origin, { visitor_id: "v2", session_id: "s2", page_view_id: "p2" }))).status, 200);
  for (const [path, visitor] of [["brochure", "v1"], ["brochure", "v1"], ["afspraak", "v2"]]) {
    assert.equal((await collectBrowserAnalytics(request(origin, {
      page_url: `${origin}/bedankt-${path}?p_slug=project&email=private@example.com`, visitor_id: visitor, page_view_id: `p-${path}-${Math.random()}`
    }))).status, 200);
  }
  for (const path of ["brochure", "afspraak"]) await upsertSiteAnalyticsCvrLink({
    site_id: site.id, source_path: "/project", target_path: `/bedankt-${path}?p_slug=project`
  });
  const dashboard = await getSiteAnalyticsDashboardData({ days: 7, siteId: site.id });
  assert.equal(dashboard.sites.length, 1);
  assert.equal(dashboard.sites[0].uniqueVisitors, 2);
  assert.equal(dashboard.sites[0].conversionRatePercent, 100);
  assert.doesNotMatch(JSON.stringify(dashboard), /private@example|#secret|utm_source/);
  const campaigns = await getCampaignPerformance(dashboard, { env: {} });
  assert.equal(campaigns.rows[0].leads.data?.count, 1);
  assert.equal(campaigns.rows[0].appointments.data?.count, 1);
  assert.equal((await collectBrowserAnalytics(request("https://www.browser-conversions.example"))).status, 200);
  assert.equal((await getPublicSiteAnalyticsSites()).filter((site) => site.url.includes("browser-conversions.example")).length, 1);
});

test("header tracking reuses an existing WordPress site's ID without exposing or replacing its token", async () => {
  const registered = await registerSiteAnalyticsSite({ site_url: "https://existing-browser.example", site_name: "Existing", installation_id: "wordpress-installation" });
  await upsertSiteAnalyticsCvrLink({ site_id: registered.site.id, source_path: "/project", target_path: "/bedankt-brochure" });
  const response = await collectBrowserAnalytics(request("https://existing-browser.example"));
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), new RegExp(registered.siteToken));
  const dashboard = await getSiteAnalyticsDashboardData({ siteId: registered.site.id, days: 7 });
  assert.equal(dashboard.sites[0].pageViews, 1);
  assert.equal(dashboard.cvrLinks.length, 1);
  const again = await registerSiteAnalyticsSite({ site_url: registered.site.url, installation_id: "wordpress-installation" });
  assert.equal(again.siteToken, registered.siteToken);
});

test("a browser cannot submit another domain or use arbitrary site IDs or administration fields", async () => {
  const before = (await getPublicSiteAnalyticsSites()).length;
  for (const override of [
    { page_url: "https://another.example/project" }, { site_id: "known-site" }, { site_token: "secret" },
    { project: "other" }, { event_type: "delete" }, { active_time_ms_delta: 1000000 }, { scroll_percent: 101 }
  ]) {
    const response = await collectBrowserAnalytics(request("https://invalid-input.example", override));
    assert.ok([400, 403].includes(response.status));
  }
  assert.equal((await getPublicSiteAnalyticsSites()).length, before);
});

test("the browser collector rejects local, insecure and malformed origins and preview pages", async () => {
  for (const origin of ["null", "http://site.example", "https://localhost", "https://127.0.0.1", "https://site.example:8443", "https://site.example/path", "https://app.gohighlevel.com"]) {
    const response = await collectBrowserAnalytics(request(origin));
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  }
  const preview = await collectBrowserAnalytics(request("https://preview.example", { page_url: "https://preview.example/v2/preview/page-id" }));
  assert.equal(preview.status, 400);
  const invalidJson = new Request("https://dashboard.example/api/site-analytics/browser", { method: "POST", headers: { Origin: "https://site.example" }, body: "not JSON" });
  assert.equal((await collectBrowserAnalytics(invalidJson)).status, 400);
  assert.equal((await collectBrowserAnalytics(request("https://site.example", { page_title: "x".repeat(9000) }))).status, 413);
});

test("only a page view creates a site and CORS grants no deletion method or credential headers", async () => {
  const origin = "https://engagement-only.example";
  assert.equal((await collectBrowserAnalytics(request(origin, { event_type: "engagement" }))).status, 409);
  assert.equal((await getPublicSiteAnalyticsSites()).some((site) => site.url === origin), false);
  const options = browserAnalyticsOptions(new Request("https://dashboard.example/api/site-analytics/browser", { method: "OPTIONS", headers: { Origin: origin } }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(options.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.equal(options.headers.get("Access-Control-Allow-Credentials"), null);
});


test("browser registration stays stable and its private installation cannot be recovered with a public project name", async () => {
  const origin = "https://browser-private-registration.example";
  const first = await registerBrowserSiteAnalyticsSite(origin);
  const again = await registerBrowserSiteAnalyticsSite(origin);
  // Registration identity is stable; refreshing it may advance updatedAt.
  assert.deepEqual({ id: again.id, name: again.name, url: again.url }, { id: first.id, name: first.name, url: first.url });
  assert.equal("token" in first, false);
  const guessed = await registerSiteAnalyticsSite({ site_url: origin, installation_id: "browser-header-v1" });
  assert.notEqual(guessed.site.id, first.id);
  assert.equal(await deleteRegisteredSiteAnalyticsSite(first.id, guessed.siteToken), false);
});

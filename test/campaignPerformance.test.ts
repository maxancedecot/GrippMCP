import test from "node:test";
import assert from "node:assert/strict";
import {
  getCampaignPerformance, parseCampaignSiteMappings, summarizeAds, summarizeWebsiteConversions, summarizeUniqueCtr,
  type AdPerformance, type CampaignSiteMapping, type CampaignSource
} from "../src/campaignPerformance.js";
import { cvrOverviewRowsFromLinks } from "../src/siteAnalyticsConversions.js";
import type { SiteAnalyticsCvrLinkRow, SiteAnalyticsDashboardData } from "../src/siteAnalytics.js";

const period = { days: 7, start: "2026-09-08", end: "2026-09-14", label: "Laatste 7 dagen" };
function dashboard(siteIds = ["site-a"]): SiteAnalyticsDashboardData {
  const totals = { pageViews: 100, uniqueVisitors: 60, sessions: 70, avgTimeOnPageSeconds: 20, avgScrollPercent: 50 };
  return {
    source: { mode: "live", message: "" }, period, totals,
    sites: siteIds.map((id) => ({ id, name: id, url: `https://${id}.example`, ...totals,
      cvrSourceVisitors: 50, cvrConversionVisitors: 5, cvrLinkCount: 1, conversionRatePercent: 10 })),
    dailyRows: [], pageRows: [], referrerRows: [], cvrPageCandidates: [], cvrLinks: [], lastUpdated: "14/09/2026"
  };
}
function environment(mappings: CampaignSiteMapping[], extra: Record<string, string> = {}) {
  return { CAMPAIGN_PERFORMANCE_SITES: JSON.stringify(mappings), ...extra };
}
const googleCredentials = { GOOGLE_ADS_CLIENT_ID: "client", GOOGLE_ADS_CLIENT_SECRET: "secret", GOOGLE_ADS_REFRESH_TOKEN: "refresh" };
const response = (value: unknown) => Response.json(value);
function connected<T>(data: T): CampaignSource<T> { return { state: "connected", data, message: "" }; }
function conversionLink(siteId: string, targetPath: string, visitors: number, sourcePath = "/project", targetTitle = "Bedankt"): SiteAnalyticsCvrLinkRow {
  return {
    id: `${siteId}:${sourcePath}:${targetPath}`, siteId, siteName: siteId, sourcePath, sourceTitle: sourcePath,
    targetPath, targetTitle, createdAt: "2026-09-01", updatedAt: "2026-09-01",
    sourceVisitors: 50, sourcePageViews: 80, targetVisitors: visitors, targetPageViews: visitors * 3,
    conversionRatePercent: visitors / 50 * 100, dailySeries: []
  };
}

test("campaign mappings reject ambiguous sites, empty scopes and unsafe IDs", () => {
  assert.throws(() => parseCampaignSiteMappings('[{"siteId":"a"},{"siteId":"a"}]'));
  assert.throws(() => parseCampaignSiteMappings('[{"siteId":"a","google":{"customerId":"123 OR 1=1"}}]'));
  assert.throws(() => parseCampaignSiteMappings('[{"siteId":"a","facebook":{"adAccountId":"123","campaignIds":[]}}]'));
  assert.equal(parseCampaignSiteMappings('[{"siteId":"a","google":{"customerId":"123-456-7890"}}]')[0].google?.customerId, "1234567890");
});

test("unconfigured providers never fetch and do not invent zeros or live statuses", async () => {
  const { rows } = await getCampaignPerformance(dashboard(), { env: {}, fetchImpl: async () => { throw new Error("Unexpected request"); } });
  assert.equal(rows[0].google.state, "not_configured");
  assert.equal(rows[0].facebook.data, null);
  assert.equal(rows[0].leads.data, null);
  assert.equal(rows[0].websiteCvr, 10);
  assert.equal(summarizeAds([rows[0].google]).ctr, null);
  assert.equal(summarizeWebsiteConversions([rows[0].leads]).count, null);
});

test("campaign tab never attaches live accounts to demo website data", async () => {
  const data = dashboard();
  data.source.mode = "demo";
  const result = await getCampaignPerformance(data, {
    env: environment([{ siteId: "site-a", google: { customerId: "123" } }], googleCredentials),
    fetchImpl: async () => { assert.fail("Demo must not request live account data"); }
  });
  assert.equal(result.rows.length, 0);
  assert.match(result.message, /Verbind eerst/);
});

test("Google separates present delivery status from period metrics and includes historical removed spend", async () => {
  const queries: string[] = [];
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", google: { customerId: "123", loginCustomerId: "456" } }], googleCredentials),
    fetchImpl: async (input, init) => {
      if (String(input).includes("oauth2")) return response({ access_token: "access" });
      assert.equal(new Headers(init?.headers).get("login-customer-id"), "456");
      const query = JSON.parse(String(init?.body)).query as string;
      queries.push(query);
      if (query.includes("FROM customer")) return response([{ results: [{ customer: { currencyCode: "EUR" } }] }]);
      if (query.includes("primary_status")) return response([{ results: [
        { campaign: { id: "1", status: "ENABLED", primaryStatus: "ELIGIBLE" } },
        { campaign: { id: "2", status: "ENABLED", primaryStatus: "PENDING" } },
        { campaign: { id: "3", status: "PAUSED", primaryStatus: "PAUSED" } }
      ] }]);
      return response([
        { results: [{ campaign: { id: "1" }, metrics: { clicks: "10", impressions: "100", costMicros: "12500000" } }] },
        { results: [{ campaign: { id: "4" }, metrics: { clicks: "10", impressions: "900", costMicros: "7500000" } }] }
      ]);
    }
  });
  assert.equal(result.rows[0].google.state, "connected");
  const summary = summarizeAds([result.rows[0].google]);
  assert.equal(summary.liveCount, 1);
  assert.equal(summary.ctr, 2);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 20 }]);
  assert.match(queries.find((query) => query.includes("metrics.clicks"))!, /BETWEEN '2026-09-08' AND '2026-09-14'/);
  assert.doesNotMatch(queries.find((query) => query.includes("primary_status"))!, /segments.date/);
});

test("Facebook follows cursors on a fixed host, filters campaigns and honors schedules", async () => {
  const visited: string[] = [];
  const result = await getCampaignPerformance(dashboard(), {
    now: new Date("2026-09-14T12:00:00Z"),
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds: ["1", "2", "4", "5"] } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      visited.push(url.toString());
      assert.equal(url.hostname, "graph.facebook.com");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
      if (url.pathname.endsWith("/campaigns")) return response({ data: [
        { id: "1", effective_status: "ACTIVE" },
        { id: "2", effective_status: "ACTIVE", start_time: "2026-09-15T00:00:00Z" },
        { id: "3", effective_status: "ACTIVE" },
        { id: "4", effective_status: "PAUSED" },
        { id: "5", effective_status: "ACTIVE", stop_time: "2026-09-13T00:00:00Z" }
      ] });
      if (url.pathname.endsWith("/insights")) {
        assert.deepEqual(JSON.parse(url.searchParams.get("time_range")!), { since: period.start, until: period.end });
        if (url.searchParams.get("level") === "account") {
          assert.equal(url.searchParams.get("time_increment"), "all_days");
          assert.equal(url.searchParams.get("fields"), "unique_link_clicks_ctr,reach");
          assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), [{ field: "campaign.id", operator: "IN", value: ["1"] }]);
          return response({ data: [{ unique_link_clicks_ctr: "10", reach: "200", unique_ctr: "25", unique_clicks: "50" }] });
        }
        if (!url.searchParams.has("after")) return response({ data: [
          { campaign_id: "1", clicks: "10", impressions: "100", spend: "5" }
        ], paging: { next: "https://unexpected.example/steal?access_token=secret", cursors: { after: "second" } } });
        return response({ data: [
          { campaign_id: "2", clicks: "20", impressions: "900", spend: "15" },
          { campaign_id: "3", clicks: "1000", impressions: "1000", spend: "1000" }
        ] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebook.state, "connected");
  const summary = summarizeAds([result.rows[0].facebook]);
  assert.equal(summary.liveCount, 1);
  assert.equal(summary.ctr, 3);
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 10);
  assert.equal(result.facebookUniqueCtr.ctr, 10);
  assert.equal(visited.filter((url) => new URL(url).searchParams.get("level") === "account").length, 1);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 20 }]);
  assert.equal(visited.filter((url) => url.includes("after=second")).length, 1);
});

test("unique CTR totals union only running campaigns across overlapping sites and weight distinct accounts by reach", async () => {
  const selections: string[] = [];
  const result = await getCampaignPerformance(dashboard(["a", "b", "c", "duplicate"]), {
    env: environment([
      { siteId: "a", facebook: { adAccountId: "123", campaignIds: ["1", "2", "4"] } },
      { siteId: "b", facebook: { adAccountId: "123", campaignIds: ["2", "3", "4"] } },
      { siteId: "c", facebook: { adAccountId: "456" } },
      { siteId: "duplicate", facebook: { adAccountId: "123", campaignIds: ["4", "2", "1"] } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: url.pathname.includes("act_456")
        ? [{ id: "9", effective_status: "ACTIVE" }]
        : [...["1", "2", "3"].map((id) => ({ id, effective_status: "ACTIVE" })), { id: "4", effective_status: "PAUSED" }] });
      if (url.searchParams.get("level") === "campaign") return response({ data: [] });
      if (url.searchParams.get("level") === "account") {
        assert.ok(url.searchParams.has("filtering"), "Every unique CTR query must select running campaign IDs");
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value.join(",");
        selections.push(`${url.pathname}:${ids}`);
        const metrics = {
          "1,2": { unique_link_clicks_ctr: "20", reach: "150" },
          "2,3": { unique_link_clicks_ctr: "20", reach: "200" },
          "1,2,3": { unique_link_clicks_ctr: "15", reach: "300" },
          "9": { unique_link_clicks_ctr: "10", reach: "50" }
        };
        return response({ data: [metrics[ids as keyof typeof metrics]] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 20);
  assert.equal(result.rows[1].facebookUniqueCtr.data?.ctr, 20);
  assert.ok(Math.abs(result.facebookUniqueCtr.ctr! - 50 / 350 * 100) < 0.000001);
  assert.equal(result.facebookUniqueCtr.accounts, 2);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(selections.length, 4); // Duplicate and account-total scopes reuse the same requests.
  assert.ok(selections.some((selection) => selection.endsWith(":1,2,3")));
});

test("a whole-account website filters to running campaigns and includes narrower scopes only once", async () => {
  const scopes: (string | null)[] = [];
  const result = await getCampaignPerformance(dashboard(["filtered", "all"]), {
    env: environment([
      { siteId: "filtered", facebook: { adAccountId: "123", campaignIds: ["1"] } },
      { siteId: "all", facebook: { adAccountId: "123" } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: [
        { id: "1", effective_status: "ACTIVE" }, { id: "2", effective_status: "ACTIVE" }, { id: "3", effective_status: "PAUSED" }
      ] });
      if (url.searchParams.get("level") === "campaign") return response({ data: [] });
      if (url.searchParams.get("level") === "account") {
        scopes.push(url.searchParams.get("filtering"));
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value;
        return response({ data: [{ unique_link_clicks_ctr: ids.length === 1 ? "5" : "8", reach: "100" }] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.facebookUniqueCtr.ctr, 8);
  assert.equal(result.facebookUniqueCtr.accounts, 1);
  assert.equal(scopes.length, 2);
  assert.ok(scopes.every((scope) => scope !== null));
  assert.deepEqual(scopes.map((scope) => JSON.parse(scope!)[0].value), [["1"], ["1", "2"]]);
});

test("missing unique link metrics never fall back to all-click CTR or break Facebook spend", async () => {
  for (const uniqueResponse of [
    { data: [{ reach: "100", unique_ctr: "10", unique_clicks: "10", ctr: "20", clicks: "20" }] },
    { data: [{ reach: "100", unique_clicks: "10" }] },
    { data: [{ reach: "100", unique_link_clicks_ctr: "10" }], paging: { next: "https://example.com/next" } },
    { error: "private-provider-response" }
  ]) {
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("level") === "account") return response(uniqueResponse);
        if (url.searchParams.get("level") === "campaign") return response({ data: [{ campaign_id: "1", clicks: "15", impressions: "100", spend: "20" }] });
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", effective_status: "ACTIVE" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "connected");
    assert.deepEqual(summarizeAds([result.rows[0].facebook]).spend, [{ currency: "EUR", amount: 20 }]);
    assert.equal(result.rows[0].facebookUniqueCtr.state, "unavailable");
    assert.equal(result.facebookUniqueCtr.ctr, null);
    assert.equal(result.facebookUniqueCtr.unavailable, true);
    assert.doesNotMatch(JSON.stringify(result), /private-provider-response|secret/);
  }
});

test("unique CTR preserves Meta's rate, shows no rate without reach and rejects incomplete totals", () => {
  assert.equal(summarizeUniqueCtr([]).ctr, null);
  assert.equal(summarizeUniqueCtr([connected({ accountId: "123", reach: 0, ctr: null })]).ctr, null);
  assert.equal(summarizeUniqueCtr([connected({ accountId: "123", reach: 3, ctr: 33.333333 })]).ctr, 33.333333);
  assert.equal(summarizeUniqueCtr([
    connected({ accountId: "123", reach: 100, ctr: 10 }),
    { state: "unavailable", data: null, message: "Unavailable" }
  ]).ctr, null);
});

test("Meta can return no insights for a connected account without inventing a zero unique CTR", async () => {
  let uniqueRequests = 0;
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      if (new URL(String(input)).searchParams.get("level") === "account") uniqueRequests++;
      return response(String(input).includes("/insights?") || String(input).includes("/campaigns?")
        ? { data: [] } : { currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.state, "connected");
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, null);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(result.facebookUniqueCtr.ctr, null);
  assert.equal(result.rows[0].facebookUniqueCtr.message, "Geen lopende campagne");
  assert.equal(uniqueRequests, 0);
});

test("no running campaigns never triggers an unfiltered unique CTR query, even with historical clicks", async () => {
  for (const scenario of [
    { account_status: 1, campaign: { id: "1", effective_status: "PAUSED" } },
    { account_status: 1, campaign: { id: "1", effective_status: "ACTIVE", start_time: "2026-09-15T00:00:00Z" } },
    { account_status: 1, campaign: { id: "1", effective_status: "ACTIVE", stop_time: "2026-09-13T00:00:00Z" } },
    { account_status: 2, campaign: { id: "1", effective_status: "ACTIVE" } }
  ]) {
    const result = await getCampaignPerformance(dashboard(), {
      now: new Date("2026-09-14T12:00:00Z"),
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.notEqual(url.searchParams.get("level"), "account", "An empty running selection must not fetch account insights");
        if (url.pathname.endsWith("/campaigns")) return response({ data: [scenario.campaign] });
        if (url.pathname.endsWith("/insights")) return response({ data: [{ campaign_id: "1", clicks: "500", impressions: "1000", spend: "50" }] });
        return response({ currency: "EUR", account_status: scenario.account_status });
      }
    });
    assert.equal(result.rows[0].facebookUniqueCtr.state, "connected");
    assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, null);
    assert.equal(result.rows[0].facebookUniqueCtr.message, "Geen lopende campagne");
    assert.equal(result.facebookUniqueCtr.ctr, null);
    assert.equal(result.facebookUniqueCtr.unavailable, false);
  }
});

test("unavailable campaign status blocks unique CTR instead of including unrelated account campaigns", async () => {
  const result = await getCampaignPerformance(dashboard(["known", "unknown"]), {
    env: environment([
      { siteId: "known", facebook: { adAccountId: "123", campaignIds: ["1"] } },
      { siteId: "unknown", facebook: { adAccountId: "456" } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return url.pathname.includes("act_456")
        ? new Response("private-provider-error", { status: 503 })
        : response({ data: [{ id: "1", effective_status: "ACTIVE" }] });
      if (url.searchParams.get("level") === "account") {
        assert.ok(url.pathname.includes("act_123"), "Unknown status must not trigger a unique CTR request");
        return response({ data: [{ unique_link_clicks_ctr: "10", reach: "100" }] });
      }
      if (url.searchParams.get("level") === "campaign") return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 10);
  assert.equal(result.rows[1].facebookUniqueCtr.state, "unavailable");
  assert.equal(result.facebookUniqueCtr.accounts, 2);
  assert.equal(result.facebookUniqueCtr.ctr, null);
  assert.equal(result.facebookUniqueCtr.unavailable, true);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-error/);
});

test("ad provider failures do not block existing website conversions or expose secrets", async () => {
  const data = dashboard();
  data.cvrLinks = [conversionLink("site-a", "/bedankt-brochure", 4), conversionLink("site-a", "/bedankt-afspraak", 2)];
  const result = await getCampaignPerformance(data, {
    env: environment([{ siteId: "site-a", google: { customerId: "123" }, ghl: { locationId: "legacy-location" } }], googleCredentials),
    fetchImpl: async (input) => {
      assert.match(String(input), /google/); // A legacy CRM mapping must not request contacts or calendars.
      return response({ error: "secret-token" });
    }
  });
  assert.equal(result.rows[0].google.state, "unavailable");
  assert.equal(result.rows[0].leads.data?.count, 4);
  assert.equal(result.rows[0].appointments.data?.count, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|legacy-location/);
});

test("campaign conversions match Brochure and Afspraak across projects and sites without CRM", async () => {
  const data = dashboard(["a", "b"]);
  data.cvrLinks = [
    conversionLink("a", "/thankyou-brochure", 3),
    conversionLink("a", "/bedankt-afspraak", 2),
    conversionLink("a", "/bedankt-download", 4, "/project-2", "BRÓCHURE gedownload"),
    conversionLink("b", "/thankyou-brochure", 8),
    conversionLink("b", "/bedankt", 5)
  ];
  const websiteRows = cvrOverviewRowsFromLinks(data.cvrLinks);
  const result = await getCampaignPerformance(data, { env: {}, fetchImpl: async () => { assert.fail("No provider needed"); } });
  for (const row of result.rows) {
    const projects = websiteRows.filter((project) => project.siteId === row.siteId);
    assert.equal(row.leads.data?.count, projects.reduce((sum, project) => sum + project.brochure.visitors, 0));
    assert.equal(row.appointments.data?.count, projects.reduce((sum, project) => sum + project.appointment.visitors, 0));
  }
  assert.deepEqual(result.rows.map((row) => [row.leads.data?.count, row.appointments.data?.count]), [[7, 2], [8, 5]]);
  assert.equal(summarizeWebsiteConversions(result.rows.map((row) => row.leads)).count, 15);
  assert.equal(summarizeWebsiteConversions(result.rows.map((row) => row.appointments)).count, 7);
  assert.equal(websiteRows[0].sourceVisitors, 50); // Two conversion types do not duplicate the source visitors.
});

test("conversion counts use only the selected site's provided period measurements", async () => {
  const data = dashboard(["a"]);
  data.selectedSiteId = "a";
  data.cvrLinks = [conversionLink("a", "/bedankt-brochure", 2), conversionLink("b", "/bedankt-brochure", 99)];
  const first = await getCampaignPerformance(data, { env: {} });
  assert.equal(summarizeWebsiteConversions(first.rows.map((row) => row.leads)).count, 2);
  data.period = { ...period, days: 30, start: "2026-08-16" };
  data.cvrLinks = [conversionLink("a", "/bedankt-brochure", 12)];
  const second = await getCampaignPerformance(data, { env: {} });
  assert.equal(summarizeWebsiteConversions(second.rows.map((row) => row.leads)).count, 12);
});

test("mapped pages with no conversions show zero, while sites without page mappings remain missing", async () => {
  const data = dashboard(["mapped", "missing"]);
  data.cvrLinks = [conversionLink("mapped", "/bedankt-brochure", 0)];
  const { rows } = await getCampaignPerformance(data, { env: {} });
  assert.equal(rows[0].leads.data?.count, 0);
  assert.equal(rows[0].appointments.data?.count, 0); // Matches the empty Afspraak column in Websiteprestaties.
  assert.equal(rows[1].leads.state, "not_configured");
  assert.equal(rows[1].appointments.data, null);
  assert.deepEqual(summarizeWebsiteConversions(rows.map((row) => row.leads)), { connected: 1, total: 2, count: 0 });
});

test("summaries deduplicate shared accounts and repeated sites and keep different currencies separate", () => {
  const ads: AdPerformance = { accountId: "123", currency: "EUR", campaigns: [{ id: "1", live: true, clicks: 1, impressions: 100, spend: 10 }] };
  const summary = summarizeAds([connected(ads), connected(ads), connected({ ...ads, accountId: "456", currency: "USD" })]);
  assert.equal(summary.liveCount, 2);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 10 }, { currency: "USD", amount: 10 }]);
  assert.equal(summarizeWebsiteConversions([connected({ siteId: "a", count: 4 }), connected({ siteId: "a", count: 4 }), connected({ siteId: "b", count: 3 })]).count, 7);
});

test("invalid configuration is explained without exposing raw configuration", async () => {
  const result = await getCampaignPerformance(dashboard(), { env: { CAMPAIGN_PERFORMANCE_SITES: "secret invalid JSON" } });
  assert.match(result.message, /ongeldig/);
  assert.doesNotMatch(result.message, /secret/);
});

test("an unmeasured website has no fabricated conversion rate", async () => {
  const data = dashboard();
  data.sites[0].cvrSourceVisitors = 0;
  const result = await getCampaignPerformance(data, { env: {} });
  assert.equal(result.rows[0].websiteCvr, null);
});

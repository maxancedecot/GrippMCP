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
function isUniqueRequest(url: URL) {
  const unique = url.searchParams.get("fields")?.split(",").includes("unique_link_clicks_ctr") ?? false;
  if (unique) assert.equal(url.searchParams.get("level"), "campaign");
  return unique;
}
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
        { id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" },
        { id: "2", name: "Ledoux campagne", effective_status: "ACTIVE", start_time: "2026-09-15T00:00:00Z" },
        { id: "3", name: "Ledoux campagne", effective_status: "ACTIVE" },
        { id: "4", name: "Ledoux campagne", effective_status: "PAUSED" },
        { id: "5", name: "Ledoux campagne", effective_status: "ACTIVE", stop_time: "2026-09-13T00:00:00Z" }
      ] });
      if (url.pathname.endsWith("/insights")) {
        assert.deepEqual(JSON.parse(url.searchParams.get("time_range")!), { since: period.start, until: period.end });
        if (isUniqueRequest(url)) {
          assert.equal(url.searchParams.get("time_increment"), "all_days");
          assert.equal(url.searchParams.get("fields"), "campaign_id,campaign_name,unique_link_clicks_ctr,reach");
          assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), [{ field: "campaign.id", operator: "IN", value: ["1"] }]);
          return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", unique_link_clicks_ctr: "10", reach: "200", unique_ctr: "25", unique_clicks: "50" }] });
        }
        if (!url.searchParams.has("after")) return response({ data: [
          { campaign_id: "1", campaign_name: "Ledoux campagne", clicks: "10", impressions: "100", spend: "5" }
        ], paging: { next: "https://unexpected.example/steal?access_token=secret", cursors: { after: "second" } } });
        return response({ data: [
          { campaign_id: "2", campaign_name: "Ledoux campagne", clicks: "20", impressions: "900", spend: "15" },
          { campaign_id: "3", campaign_name: "Ledoux campagne", clicks: "1000", impressions: "1000", spend: "1000" }
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
  assert.equal(visited.filter((url) => isUniqueRequest(new URL(url))).length, 1);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 20 }]);
  assert.equal(visited.filter((url) => url.includes("after=second")).length, 1);
});

test("CTR matches individual campaign IDs across overlapping websites and totals weight each campaign once", async () => {
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
        ? [{ id: "9", name: "Ledoux campagne", effective_status: "ACTIVE" }]
        : [...["1", "2", "3"].map((id) => ({ id, name: "Ledoux campagne", effective_status: "ACTIVE" })), { id: "4", name: "Ledoux campagne", effective_status: "PAUSED" }] });
      if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [] });
      if (isUniqueRequest(url)) {
        assert.ok(url.searchParams.has("filtering"), "Every unique CTR query must select running campaign IDs");
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value as string[];
        selections.push(`${url.pathname}:${ids.join(",")}`);
        const metrics = {
          "1": { unique_link_clicks_ctr: "10", reach: "100" },
          "2": { unique_link_clicks_ctr: "20", reach: "200" },
          "3": { unique_link_clicks_ctr: "30", reach: "300" },
          "9": { unique_link_clicks_ctr: "40", reach: "50" }
        };
        // Deliberately identical names and reversed response order: IDs determine the match.
        return response({ data: ids.toReversed().map((id) => ({ campaign_id: id, campaign_name: "Ledoux campagne", ...metrics[id as keyof typeof metrics] })) });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 5000 / 300);
  assert.equal(result.rows[1].facebookUniqueCtr.data?.ctr, 26);
  assert.deepEqual(result.rows[0].facebookUniqueCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 10 }, { id: "2", ctr: 20 }]);
  assert.equal(result.facebookUniqueCtr.ctr, 16000 / 650);
  assert.equal(result.facebookUniqueCtr.campaigns, 4);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(selections.length, 3); // Duplicate scopes reuse the same request; no account-total request.
  assert.ok(selections.every((selection) => !selection.endsWith(":1,2,3")));
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
        { id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" }, { id: "2", name: "Ledoux campagne", effective_status: "ACTIVE" }, { id: "3", name: "Ledoux campagne", effective_status: "PAUSED" }
      ] });
      if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [] });
      if (isUniqueRequest(url)) {
        scopes.push(url.searchParams.get("filtering"));
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value;
        return response({ data: ids.map((id: string) => ({ campaign_id: id, campaign_name: "Ledoux campagne", unique_link_clicks_ctr: id === "1" ? "5" : "11", reach: "100" })) });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.facebookUniqueCtr.ctr, 8);
  assert.equal(result.facebookUniqueCtr.campaigns, 2);
  assert.equal(scopes.length, 2);
  assert.ok(scopes.every((scope) => scope !== null));
  assert.deepEqual(scopes.map((scope) => JSON.parse(scope!)[0].value), [["1"], ["1", "2"]]);
});

test("missing unique link metrics never fall back to all-click CTR or break Facebook spend", async () => {
  for (const uniqueResponse of [
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", reach: "100", unique_ctr: "10", unique_clicks: "10", ctr: "20", clicks: "20" }] },
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", reach: "100", unique_clicks: "10" }] },
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", reach: "100", unique_link_clicks_ctr: "10" }], paging: { next: "https://example.com/next" } },
    { error: "private-provider-response" }
  ]) {
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (isUniqueRequest(url)) return response(uniqueResponse);
        if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", clicks: "15", impressions: "100", spend: "20" }] });
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" }] });
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
  const measurement = (reach: number, ctr: number | null) => connected({ accountId: "123", ctr, campaigns: [{ id: "1", name: "Ledoux campagne", reach, ctr }] });
  assert.equal(summarizeUniqueCtr([]).ctr, null);
  assert.equal(summarizeUniqueCtr([measurement(0, null)]).ctr, null);
  assert.equal(summarizeUniqueCtr([measurement(3, 33.333333)]).ctr, 33.333333);
  assert.equal(summarizeUniqueCtr([measurement(100, null)]).ctr, null);
  assert.equal(summarizeUniqueCtr([
    measurement(100, 10),
    { state: "unavailable", data: null, message: "Unavailable" }
  ]).ctr, null);
});

test("Meta can return no insights for a connected account without inventing a zero unique CTR", async () => {
  let uniqueRequests = 0;
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      if (isUniqueRequest(new URL(String(input)))) uniqueRequests++;
      return response(String(input).includes("/insights?") || String(input).includes("/campaigns?")
        ? { data: [] } : { currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.state, "connected");
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, null);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(result.facebookUniqueCtr.ctr, null);
  assert.equal(result.rows[0].facebookUniqueCtr.message, "Geen lopende Ledoux-campagne");
  assert.equal(uniqueRequests, 0);
});

test("no running campaigns never triggers an unfiltered unique CTR query, even with historical clicks", async () => {
  for (const scenario of [
    { account_status: 1, campaign: { id: "1", name: "Ledoux campagne", effective_status: "PAUSED" } },
    { account_status: 1, campaign: { id: "1", name: "Ledoux campagne", effective_status: "ACTIVE", start_time: "2026-09-15T00:00:00Z" } },
    { account_status: 1, campaign: { id: "1", name: "Ledoux campagne", effective_status: "ACTIVE", stop_time: "2026-09-13T00:00:00Z" } },
    { account_status: 2, campaign: { id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" } }
  ]) {
    const result = await getCampaignPerformance(dashboard(), {
      now: new Date("2026-09-14T12:00:00Z"),
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(isUniqueRequest(url), false, "An empty running selection must not fetch CTR insights");
        if (url.pathname.endsWith("/campaigns")) return response({ data: [scenario.campaign] });
        if (url.pathname.endsWith("/insights")) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", clicks: "500", impressions: "1000", spend: "50" }] });
        return response({ currency: "EUR", account_status: scenario.account_status });
      }
    });
    assert.equal(result.rows[0].facebookUniqueCtr.state, "connected");
    assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, null);
    assert.equal(result.rows[0].facebookUniqueCtr.message, "Geen lopende Ledoux-campagne");
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
        : response({ data: [{ id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" }] });
      if (isUniqueRequest(url)) {
        assert.ok(url.pathname.includes("act_123"), "Unknown status must not trigger a unique CTR request");
        return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", unique_link_clicks_ctr: "10", reach: "100" }] });
      }
      if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 10);
  assert.equal(result.rows[1].facebookUniqueCtr.state, "unavailable");
  assert.equal(result.facebookUniqueCtr.campaigns, 1);
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

test("Facebook includes only Ledoux names for status, spend and unique link CTR within the website mapping", async () => {
  const metrics = [
    { campaign_id: "1", campaign_name: "Ledoux | Current", clicks: "5", impressions: "100", spend: "10" },
    { campaign_id: "2", campaign_name: "Another agency", clicks: "100", impressions: "100", spend: "100" },
    { campaign_id: "3", campaign_name: "LEDOUX | Paused", clicks: "10", impressions: "100", spend: "20" },
    { campaign_id: "4", campaign_name: "Project by LeDoUx", clicks: "15", impressions: "100", spend: "30" },
    { campaign_id: "5", campaign_name: "Ledoux | Old name", clicks: "100", impressions: "100", spend: "100" },
    { campaign_id: "6", campaign_name: "Other historical campaign", clicks: "100", impressions: "100", spend: "100" },
    { campaign_id: "8", campaign_name: "Ledoux | Other website", clicks: "1000", impressions: "1000", spend: "1000" }
  ];
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds: ["1", "2", "3", "4", "5", "6"] } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) {
        assert.ok(url.searchParams.get("fields")!.split(",").includes("name"));
        return response({ data: [
          { id: "1", name: "ledoux | Current", effective_status: "ACTIVE" },
          { id: "2", name: "Another agency", effective_status: "ACTIVE" },
          { id: "3", name: "LEDOUX | Paused", effective_status: "PAUSED" },
          { id: "5", name: "Renamed for another agency", effective_status: "ACTIVE" },
          { id: "8", name: "Ledoux | Other website", effective_status: "ACTIVE" }
        ] });
      }
      if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) {
        assert.ok(url.searchParams.get("fields")!.split(",").includes("campaign_name"));
        return response({ data: metrics });
      }
      if (isUniqueRequest(url)) {
        assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!)[0].value, ["1"]);
        return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", unique_link_clicks_ctr: "4", reach: "100" }] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebook.state, "connected");
  assert.deepEqual(result.rows[0].facebook.data?.campaigns.map((campaign) => campaign.id), ["1", "3", "4"]);
  const summary = summarizeAds([result.rows[0].facebook]);
  assert.equal(summary.liveCount, 1);
  assert.equal(summary.campaignCount, 3);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 60 }]);
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 4);
  assert.equal(result.facebookUniqueCtr.ctr, 4);
});

test("a valid Facebook mapping without Ledoux campaigns stays connected and never broadens unique CTR", async () => {
  for (const campaignIds of [undefined, ["1"]]) {
    const { rows, facebookUniqueCtr } = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(isUniqueRequest(url), false);
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Other agency", effective_status: "ACTIVE" }] });
        if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Other agency", clicks: "100", impressions: "100", spend: "100" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(rows[0].facebook.state, "connected");
    assert.deepEqual(rows[0].facebook.data?.campaigns, []);
    assert.deepEqual(summarizeAds([rows[0].facebook]).spend, [{ currency: "EUR", amount: 0 }]);
    assert.equal(rows[0].facebookUniqueCtr.message, "Geen lopende Ledoux-campagne");
    assert.equal(facebookUniqueCtr.unavailable, false);
    assert.equal(facebookUniqueCtr.ctr, null);
  }
});

test("missing Facebook names or unknown mapped IDs cannot bypass the Ledoux filter", async () => {
  for (const scenario of ["campaign-name", "insight-name", "unknown-id"]) {
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds: [scenario === "unknown-id" ? "2" : "1"] } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(isUniqueRequest(url), false);
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", ...(scenario === "campaign-name" ? {} : { name: "Ledoux" }), effective_status: "ACTIVE" }] });
        if (url.searchParams.get("level") === "campaign" && !isUniqueRequest(url)) return response({ data: [{ campaign_id: "1", ...(scenario === "insight-name" ? {} : { campaign_name: "Ledoux" }), clicks: "10", impressions: "100", spend: "20" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "unavailable", scenario);
    assert.equal(result.rows[0].facebookUniqueCtr.state, "unavailable", scenario);
    assert.equal(result.facebookUniqueCtr.ctr, null);
  }
});

test("campaign unique CTR follows pagination and keeps each campaign's exact Meta rate", async () => {
  const uniquePages: string[] = [];
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "graph.facebook.com");
      assert.notEqual(url.searchParams.get("level"), "account");
      if (url.pathname.endsWith("/campaigns")) return response({ data: ["1", "2"].map((id) => ({ id, name: `Ledoux ${id}`, effective_status: "ACTIVE" })) });
      if (isUniqueRequest(url)) {
        uniquePages.push(url.searchParams.get("after") ?? "first");
        return response(url.searchParams.has("after")
          ? { data: [{ campaign_id: "1", campaign_name: "Ledoux 1", reach: "3", unique_link_clicks_ctr: "33.333333" }] }
          : { data: [{ campaign_id: "2", campaign_name: "Ledoux 2", reach: "200", unique_link_clicks_ctr: "7.123456" }], paging: { next: "https://untrusted.example/next", cursors: { after: "page-2" } } });
      }
      if (url.pathname.endsWith("/insights") || url.pathname.endsWith("/ads")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.deepEqual(uniquePages, ["first", "page-2"]);
  assert.deepEqual(result.rows[0].facebookUniqueCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 33.333333 }, { id: "2", ctr: 7.123456 }]);
  assert.equal(result.facebookUniqueCtr.ctr, (3 * 33.333333 + 200 * 7.123456) / 203);
});

test("unknown, repeated or missing campaign measurements do not become an account CTR or false zero", async () => {
  for (const scenario of ["unknown", "duplicate", "missing-with-impressions", "no-activity"]) {
    const metric = { campaign_id: "1", campaign_name: "Ledoux", reach: "100", unique_link_clicks_ctr: "5" };
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux", effective_status: "ACTIVE" }] });
        if (isUniqueRequest(url)) return response({ data: scenario === "unknown" ? [{ ...metric, campaign_id: "2" }] : scenario === "duplicate" ? [metric, metric] : [] });
        if (url.pathname.endsWith("/insights")) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux", impressions: scenario === "no-activity" ? "0" : "100", spend: "1" }] });
        if (url.pathname.endsWith("/ads")) return response({ data: [] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "connected");
    assert.equal(result.rows[0].facebookUniqueCtr.state, scenario === "no-activity" ? "connected" : "unavailable", scenario);
    assert.equal(result.facebookUniqueCtr.ctr, null);
    if (scenario === "no-activity") assert.deepEqual(result.rows[0].facebookUniqueCtr.data?.campaigns, [{ id: "1", name: "Ledoux", reach: 0, ctr: null }]);
  }
});

test("campaigns match their own landing pages to website projects, stripping tracking and preserving project selectors", async () => {
  const data = dashboard();
  data.cvrLinks = [conversionLink("site-a", "/bedankt", 2, "/project-one/"), conversionLink("site-a", "/bedankt", 4, "/?p_slug=project-two")];
  const result = await getCampaignPerformance(data, {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: ["1", "2", "3"].map((id) => ({ id, name: "Ledoux identical name", effective_status: "ACTIVE" })) });
      if (isUniqueRequest(url)) return response({ data: ["1", "2", "3"].map((id) => ({ campaign_id: id, campaign_name: "Ledoux identical name", reach: "100", unique_link_clicks_ctr: id })) });
      if (url.pathname.endsWith("/ads")) {
        assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!)[0].value, ["1", "2", "3"]);
        if (url.searchParams.has("after")) return response({ data: [{ campaign_id: "2", creative: { asset_feed_spec: { link_urls: [{ website_url: "https://site-a.example/?utm_campaign=Ledoux&p_slug=project-two#form" }, { website_url: "https://site-a.example/?p_slug=project-three" }] } } }] });
        return response({ data: [
          { campaign_id: "1", creative: { object_story_spec: { link_data: { link: "https://www.site-a.example/project-one/?fbclid=private#form", message: "https://site-a.example/wrong-project", child_attachments: [{ link: "https://site-a.example/project-one/?utm_source=facebook" }] } } } },
          { campaign_id: "3", creative: { object_story_spec: { video_data: { call_to_action: { value: { link: "https://different-site.example/project-one/" } } } }, link_url: "javascript:alert(1)", object_url: "https://site-a.example.untrusted.example/project-one/" } }
        ], paging: { next: "https://untrusted.example", cursors: { after: "more-ads" } } });
      }
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  const matches = result.rows[0].facebookCampaignPages;
  assert.equal(matches.state, "connected");
  assert.deepEqual(matches.data?.map((match) => ({ id: match.campaignId, paths: match.pages.map((page) => page.path), measured: match.pages.map((page) => page.hasConversionMapping) })), [
    { id: "1", paths: ["/project-one"], measured: [true] },
    { id: "2", paths: ["/?p_slug=project-two", "/?p_slug=project-three"], measured: [true, false] },
    { id: "3", paths: [], measured: [] }
  ]);
  assert.doesNotMatch(JSON.stringify(matches), /fbclid|utm_|#form|private|javascript|wrong-project|untrusted/);
  assert.deepEqual(result.rows[0].facebookUniqueCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 1 }, { id: "2", ctr: 2 }]);
  assert.equal(result.facebookUniqueCtr.ctr, 1.5);
});

test("unavailable ad destinations leave campaign CTR available without inventing a project match", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux", effective_status: "ACTIVE" }] });
      if (isUniqueRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux", unique_link_clicks_ctr: "5", reach: "100" }] });
      if (url.pathname.endsWith("/ads")) return new Response("private-destination-error", { status: 503 });
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 5);
  assert.equal(result.rows[0].facebookCampaignPages.state, "unavailable");
  assert.equal(result.rows[0].facebookCampaignPages.data, null);
  assert.doesNotMatch(JSON.stringify(result), /private-destination-error/);
});

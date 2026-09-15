import test from "node:test";
import assert from "node:assert/strict";
import {
  getCampaignPerformance, parseCampaignSiteMappings, summarizeAds, summarizeWebsiteConversions, summarizeLinkCtr,
  type AdPerformance, type CampaignSiteMapping, type CampaignSource
} from "../src/campaignPerformance.js";
import { cvrOverviewRowsFromLinks } from "../src/siteAnalyticsConversions.js";
import { parseCampaignProjectMatches } from "../src/campaignProjects.js";
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
function isLinkCtrRequest(url: URL) {
  const linkCtr = url.searchParams.get("fields")?.split(",").includes("inline_link_click_ctr") ?? false;
  if (linkCtr) assert.equal(url.searchParams.get("level"), "campaign");
  return linkCtr;
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

test("saved project matches require scoped campaign IDs and local project paths", () => {
  const match = { siteId: "site-a", accountId: "123", campaignId: "456", sourcePaths: ["/home/?utm_source=facebook&p_slug=one", "/home?p_slug=one"] };
  assert.deepEqual(parseCampaignProjectMatches([match])[0].sourcePaths, ["/home?p_slug=one"]);
  assert.throws(() => parseCampaignProjectMatches([match, match]));
  for (const sourcePaths of [[], ["https://other.example/home"], ["//other.example/home"], ["/\\other.example/home"]]) {
    assert.throws(() => parseCampaignProjectMatches([{ ...match, sourcePaths }]));
  }
  assert.equal(parseCampaignProjectMatches([match, { ...match, siteId: "site-b" }]).length, 2);
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
        if (isLinkCtrRequest(url)) {
          assert.equal(url.searchParams.get("time_increment"), "all_days");
          assert.equal(url.searchParams.get("fields"), "campaign_id,campaign_name,inline_link_click_ctr,impressions");
          assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), [{ field: "campaign.id", operator: "IN", value: ["1"] }]);
          return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", inline_link_click_ctr: "10", impressions: "200", unique_ctr: "25", unique_clicks: "50" }] });
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
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, 10);
  assert.equal(result.facebookLinkCtr.ctr, 10);
  assert.equal(visited.filter((url) => isLinkCtrRequest(new URL(url))).length, 1);
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
      if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [] });
      if (isLinkCtrRequest(url)) {
        assert.ok(url.searchParams.has("filtering"), "Every link CTR query must select running campaign IDs");
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value as string[];
        selections.push(`${url.pathname}:${ids.join(",")}`);
        const metrics = {
          "1": { inline_link_click_ctr: "10", impressions: "100" },
          "2": { inline_link_click_ctr: "20", impressions: "200" },
          "3": { inline_link_click_ctr: "30", impressions: "300" },
          "9": { inline_link_click_ctr: "40", impressions: "50" }
        };
        // Deliberately identical names and reversed response order: IDs determine the match.
        return response({ data: ids.toReversed().map((id) => ({ campaign_id: id, campaign_name: "Ledoux campagne", ...metrics[id as keyof typeof metrics] })) });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, 5000 / 300);
  assert.equal(result.rows[1].facebookLinkCtr.data?.ctr, 26);
  assert.deepEqual(result.rows[0].facebookLinkCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 10 }, { id: "2", ctr: 20 }]);
  assert.equal(result.facebookLinkCtr.ctr, 16000 / 650);
  assert.equal(result.facebookLinkCtr.campaigns, 4);
  assert.equal(result.facebookLinkCtr.unavailable, false);
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
      if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [] });
      if (isLinkCtrRequest(url)) {
        scopes.push(url.searchParams.get("filtering"));
        const ids = JSON.parse(url.searchParams.get("filtering")!)[0].value;
        return response({ data: ids.map((id: string) => ({ campaign_id: id, campaign_name: "Ledoux campagne", inline_link_click_ctr: id === "1" ? "5" : "11", impressions: "100" })) });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.facebookLinkCtr.ctr, 8);
  assert.equal(result.facebookLinkCtr.campaigns, 2);
  assert.equal(scopes.length, 2);
  assert.ok(scopes.every((scope) => scope !== null));
  assert.deepEqual(scopes.map((scope) => JSON.parse(scope!)[0].value), [["1"], ["1", "2"]]);
});

test("missing link metrics never fall back to all-click CTR or break Facebook spend", async () => {
  for (const linkCtrResponse of [
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", impressions: "100", unique_link_clicks_ctr: "5", unique_ctr: "10", unique_clicks: "10", ctr: "20", clicks: "20" }] },
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", impressions: "100", unique_clicks: "10" }] },
    { data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", impressions: "100", inline_link_click_ctr: "10" }], paging: { next: "https://example.com/next" } },
    { error: "private-provider-response" }
  ]) {
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (isLinkCtrRequest(url)) return response(linkCtrResponse);
        if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", clicks: "15", impressions: "100", spend: "20" }] });
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux campagne", effective_status: "ACTIVE" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "connected");
    assert.deepEqual(summarizeAds([result.rows[0].facebook]).spend, [{ currency: "EUR", amount: 20 }]);
    assert.equal(result.rows[0].facebookLinkCtr.state, "unavailable");
    assert.equal(result.facebookLinkCtr.ctr, null);
    assert.equal(result.facebookLinkCtr.unavailable, true);
    assert.doesNotMatch(JSON.stringify(result), /private-provider-response|secret/);
  }
});

test("link CTR preserves Meta's rate, shows no rate without impressions and rejects incomplete totals", () => {
  const measurement = (impressions: number, ctr: number | null) => connected({ accountId: "123", ctr, campaigns: [{ id: "1", name: "Ledoux campagne", impressions, ctr }] });
  assert.equal(summarizeLinkCtr([]).ctr, null);
  assert.equal(summarizeLinkCtr([measurement(0, null)]).ctr, null);
  assert.equal(summarizeLinkCtr([measurement(3, 33.333333)]).ctr, 33.333333);
  assert.equal(summarizeLinkCtr([measurement(100, null)]).ctr, null);
  assert.equal(summarizeLinkCtr([
    measurement(100, 10),
    { state: "unavailable", data: null, message: "Unavailable" }
  ]).ctr, null);
});

test("Meta can return no insights for a connected account without inventing a zero link CTR", async () => {
  let linkCtrRequests = 0;
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      if (isLinkCtrRequest(new URL(String(input)))) linkCtrRequests++;
      return response(String(input).includes("/insights?") || String(input).includes("/campaigns?")
        ? { data: [] } : { currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookLinkCtr.state, "connected");
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, null);
  assert.equal(result.facebookLinkCtr.unavailable, false);
  assert.equal(result.facebookLinkCtr.ctr, null);
  assert.equal(result.rows[0].facebookLinkCtr.message, "Geen lopende Ledoux-campagne");
  assert.equal(linkCtrRequests, 0);
});

test("no running campaigns never triggers an unfiltered link CTR query, even with historical clicks", async () => {
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
        assert.equal(isLinkCtrRequest(url), false, "An empty running selection must not fetch CTR insights");
        if (url.pathname.endsWith("/campaigns")) return response({ data: [scenario.campaign] });
        if (url.pathname.endsWith("/insights")) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", clicks: "500", impressions: "1000", spend: "50" }] });
        return response({ currency: "EUR", account_status: scenario.account_status });
      }
    });
    assert.equal(result.rows[0].facebookLinkCtr.state, "connected");
    assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, null);
    assert.equal(result.rows[0].facebookLinkCtr.message, "Geen lopende Ledoux-campagne");
    assert.equal(result.facebookLinkCtr.ctr, null);
    assert.equal(result.facebookLinkCtr.unavailable, false);
  }
});

test("unavailable campaign status blocks link CTR instead of including unrelated account campaigns", async () => {
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
      if (isLinkCtrRequest(url)) {
        assert.ok(url.pathname.includes("act_123"), "Unknown status must not trigger a link CTR request");
        return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", inline_link_click_ctr: "10", impressions: "100" }] });
      }
      if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, 10);
  assert.equal(result.rows[1].facebookLinkCtr.state, "unavailable");
  assert.equal(result.facebookLinkCtr.campaigns, 1);
  assert.equal(result.facebookLinkCtr.ctr, null);
  assert.equal(result.facebookLinkCtr.unavailable, true);
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

test("Facebook includes only Ledoux names for status, spend and link CTR within the website mapping", async () => {
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
      if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) {
        assert.ok(url.searchParams.get("fields")!.split(",").includes("campaign_name"));
        return response({ data: metrics });
      }
      if (isLinkCtrRequest(url)) {
        assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!)[0].value, ["1"]);
        return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux campagne", inline_link_click_ctr: "4", impressions: "100" }] });
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
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, 4);
  assert.equal(result.facebookLinkCtr.ctr, 4);
});

test("a valid Facebook mapping without Ledoux campaigns stays connected and never broadens link CTR", async () => {
  for (const campaignIds of [undefined, ["1"]]) {
    const { rows, facebookLinkCtr } = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(isLinkCtrRequest(url), false);
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Other agency", effective_status: "ACTIVE" }] });
        if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Other agency", clicks: "100", impressions: "100", spend: "100" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(rows[0].facebook.state, "connected");
    assert.deepEqual(rows[0].facebook.data?.campaigns, []);
    assert.deepEqual(summarizeAds([rows[0].facebook]).spend, [{ currency: "EUR", amount: 0 }]);
    assert.equal(rows[0].facebookLinkCtr.message, "Geen lopende Ledoux-campagne");
    assert.equal(facebookLinkCtr.unavailable, false);
    assert.equal(facebookLinkCtr.ctr, null);
  }
});

test("missing Facebook names or unknown mapped IDs cannot bypass the Ledoux filter", async () => {
  for (const scenario of ["campaign-name", "insight-name", "unknown-id"]) {
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds: [scenario === "unknown-id" ? "2" : "1"] } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(isLinkCtrRequest(url), false);
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", ...(scenario === "campaign-name" ? {} : { name: "Ledoux" }), effective_status: "ACTIVE" }] });
        if (url.searchParams.get("level") === "campaign" && !isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "1", ...(scenario === "insight-name" ? {} : { campaign_name: "Ledoux" }), clicks: "10", impressions: "100", spend: "20" }] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "unavailable", scenario);
    assert.equal(result.rows[0].facebookLinkCtr.state, "unavailable", scenario);
    assert.equal(result.facebookLinkCtr.ctr, null);
  }
});

test("campaign link CTR follows pagination and keeps each campaign's exact Meta rate", async () => {
  const linkCtrPages: string[] = [];
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "graph.facebook.com");
      assert.notEqual(url.searchParams.get("level"), "account");
      if (url.pathname.endsWith("/campaigns")) return response({ data: ["1", "2"].map((id) => ({ id, name: `Ledoux ${id}`, effective_status: "ACTIVE" })) });
      if (isLinkCtrRequest(url)) {
        linkCtrPages.push(url.searchParams.get("after") ?? "first");
        return response(url.searchParams.has("after")
          ? { data: [{ campaign_id: "1", campaign_name: "Ledoux 1", impressions: "3", inline_link_click_ctr: "33.333333" }] }
          : { data: [{ campaign_id: "2", campaign_name: "Ledoux 2", impressions: "200", inline_link_click_ctr: "7.123456" }], paging: { next: "https://untrusted.example/next", cursors: { after: "page-2" } } });
      }
      if (url.pathname.endsWith("/insights") || url.pathname.endsWith("/ads")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.deepEqual(linkCtrPages, ["first", "page-2"]);
  assert.deepEqual(result.rows[0].facebookLinkCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 33.333333 }, { id: "2", ctr: 7.123456 }]);
  assert.equal(result.facebookLinkCtr.ctr, (3 * 33.333333 + 200 * 7.123456) / 203);
});

test("unknown, repeated or missing campaign measurements do not become an account CTR or false zero", async () => {
  for (const scenario of ["unknown", "duplicate", "missing-with-impressions", "no-activity"]) {
    const metric = { campaign_id: "1", campaign_name: "Ledoux", impressions: "100", inline_link_click_ctr: "5" };
    const result = await getCampaignPerformance(dashboard(), {
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux", effective_status: "ACTIVE" }] });
        if (isLinkCtrRequest(url)) return response({ data: scenario === "unknown" ? [{ ...metric, campaign_id: "2" }] : scenario === "duplicate" ? [metric, metric] : [] });
        if (url.pathname.endsWith("/insights")) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux", impressions: scenario === "no-activity" ? "0" : "100", spend: "1" }] });
        if (url.pathname.endsWith("/ads")) return response({ data: [] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebook.state, "connected");
    assert.equal(result.rows[0].facebookLinkCtr.state, scenario === "no-activity" ? "connected" : "unavailable", scenario);
    assert.equal(result.facebookLinkCtr.ctr, null);
    if (scenario === "no-activity") assert.deepEqual(result.rows[0].facebookLinkCtr.data?.campaigns, [{ id: "1", name: "Ledoux", impressions: 0, ctr: null }]);
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
      if (isLinkCtrRequest(url)) return response({ data: ["1", "2", "3"].map((id) => ({ campaign_id: id, campaign_name: "Ledoux identical name", impressions: "100", inline_link_click_ctr: id })) });
      if (url.pathname.endsWith("/ads")) {
        assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), [{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]);
        assert.equal(url.hostname, "graph.facebook.com");
        const campaignId = url.pathname.split("/")[2];
        if (campaignId === "2") return response(url.searchParams.has("after")
          ? { data: [{ campaign_id: "2", creative: { asset_feed_spec: { link_urls: [{ website_url: "https://site-a.example/?utm_campaign=Ledoux&p_slug=project-two#form" }, { website_url: "https://site-a.example/?p_slug=project-three" }] } } }] }
          : { data: [], paging: { next: "https://untrusted.example", cursors: { after: "more-ads" } } });
        if (campaignId === "1") return response({ data: [{ campaign_id: "1", creative: { object_story_spec: { link_data: { link: "https://www.site-a.example/project-one/?fbclid=private#form", message: "https://site-a.example/wrong-project", child_attachments: [{ link: "https://site-a.example/project-one/?utm_source=facebook" }] } } } }] });
        assert.equal(campaignId, "3");
        return response({ data: [{ campaign_id: "3", creative: { object_story_spec: { video_data: { call_to_action: { value: { link: "https://different-site.example/project-one/" } } } }, link_url: "javascript:alert(1)", object_url: "https://site-a.example.untrusted.example/project-one/" } }] });
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
  assert.deepEqual(result.rows[0].facebookLinkCtr.data?.campaigns.map(({ id, ctr }) => ({ id, ctr })), [{ id: "1", ctr: 1 }, { id: "2", ctr: 2 }]);
  assert.equal(result.facebookLinkCtr.ctr, 1.5);
});

test("unavailable ad destinations leave campaign CTR available without inventing a project match", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux", effective_status: "ACTIVE" }] });
      if (isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux", inline_link_click_ctr: "5", impressions: "100" }] });
      if (url.pathname.endsWith("/ads")) return new Response("private-destination-error", { status: 503 });
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookLinkCtr.data?.ctr, 5);
  assert.equal(result.rows[0].facebookCampaignPages.state, "unavailable");
  assert.equal(result.rows[0].facebookCampaignPages.data, null);
  assert.doesNotMatch(JSON.stringify(result), /private-destination-error/);
});

test("cached project destinations survive a temporary Meta failure while CTR and status stay live", async () => {
  const previousStore = process.env.JSON_CACHE_STORE;
  process.env.JSON_CACHE_STORE = "memory";
  try {
    let adRequests = 0, metricRequests = 0, active = true;
    const base = Date.parse("2026-09-15T12:00:00Z");
    const load = (minutes: number) => getCampaignPerformance(dashboard(), {
      now: new Date(base + minutes * 60_000), cacheCampaignPages: true,
      env: environment([{ siteId: "site-a", facebook: { adAccountId: "998877" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "9988771", name: "Ledoux project", effective_status: active ? "ACTIVE" : "PAUSED" }] });
        if (isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "9988771", campaign_name: "Ledoux project", inline_link_click_ctr: ++metricRequests, impressions: "100" }] });
        if (url.pathname.endsWith("/ads")) return ++adRequests === 1
          ? response({ data: [{ campaign_id: "9988771", creative: { link_url: "https://site-a.example/project/" } }] })
          : new Response("temporary-provider-error", { status: 503 });
        if (url.pathname.endsWith("/insights")) return response({ data: [] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    const first = (await load(0)).rows[0];
    const fresh = (await load(5)).rows[0];
    assert.equal(adRequests, 1);
    assert.equal(fresh.facebookLinkCtr.data?.ctr, 2);
    assert.deepEqual(fresh.facebookCampaignPages.data, first.facebookCampaignPages.data);
    const fallback = (await load(16)).rows[0];
    assert.equal(adRequests, 2);
    assert.equal(fallback.facebookLinkCtr.data?.ctr, 3);
    assert.deepEqual(fallback.facebookCampaignPages.data, first.facebookCampaignPages.data);
    assert.match(fallback.facebookCampaignPages.message, /laatst geslaagde controle/);
    assert.equal((await load(24 * 60 + 1)).rows[0].facebookCampaignPages.state, "unavailable");
    active = false;
    const paused = (await load(6)).rows[0];
    assert.deepEqual(paused.facebookLinkCtr.data?.campaigns, []);
    assert.deepEqual(paused.facebookCampaignPages.data, []);
    assert.equal(paused.facebookLinkCtr.data?.ctr, null);
  } finally {
    if (previousStore === undefined) delete process.env.JSON_CACHE_STORE;
    else process.env.JSON_CACHE_STORE = previousStore;
  }
});

test("saved campaign matches join the exact project counters and keep shared campaigns from duplicating project totals", async () => {
  const data = dashboard(["site-a", "site-b"]);
  data.cvrLinks = [
    conversionLink("site-a", "/bedankt-brochure", 10, "/project-one/"),
    conversionLink("site-a", "/bedankt-afspraak", 3, "/project-one/"),
    conversionLink("site-a", "/bedankt-brochure", 2, "/project-two/"),
    conversionLink("site-a", "/bedankt-afspraak", 1, "/project-two/"),
    conversionLink("site-b", "/bedankt-brochure", 9, "/project-one/")
  ];
  let adRequests = 0;
  const result = await getCampaignPerformance(data, {
    env: environment([
      { siteId: "site-a", facebook: { adAccountId: "123", campaignIds: ["1", "2", "3"] } },
      { siteId: "site-b", facebook: { adAccountId: "456", campaignIds: ["1"] } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    projectMatches: [
      { siteId: "site-a", accountId: "123", campaignId: "1", sourcePaths: ["/project-one"] },
      { siteId: "site-a", accountId: "123", campaignId: "2", sourcePaths: ["/project-one/"] },
      { siteId: "site-a", accountId: "123", campaignId: "3", sourcePaths: ["/project-one/", "/project-two/"] },
      { siteId: "site-b", accountId: "456", campaignId: "1", sourcePaths: ["/project-one/"] },
      { siteId: "invisible-site", accountId: "123", campaignId: "1", sourcePaths: ["/wrong-project/"] }
    ],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const ids = url.pathname.includes("act_456") ? ["1"] : ["1", "2", "3"];
      if (url.pathname.endsWith("/campaigns")) return response({ data: ids.map((id) => ({ id, name: `Ledoux ${id}`, effective_status: "ACTIVE" })) });
      if (isLinkCtrRequest(url)) return response({ data: ids.map((id) => ({ campaign_id: id, campaign_name: `Ledoux ${id}`, inline_link_click_ctr: Number(id) * 2.123456, impressions: "100" })) });
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      if (url.pathname.endsWith("/ads")) { adRequests++; return new Response("Meta unavailable", { status: 503 }); }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(adRequests, 0, "Saved project matches do not depend on another ad-link request");
  assert.deepEqual(result.unmatchedCampaigns, []);
  assert.equal(result.projects.length, 3);
  const first = result.projects.find((project) => project.key === "site-a:/project-one")!;
  assert.deepEqual([first.visitors, first.leads, first.appointments, first.cvr], [50, 10, 3, 26]);
  assert.deepEqual(first.campaigns.map((campaign) => [campaign.id, campaign.ctr, campaign.projectCount]), [["1", 2.123456, 1], ["2", 4.246912, 1], ["3", 6.370368, 2]]);
  assert.equal(result.projects.find((project) => project.key === "site-b:/project-one")?.leads, 9);
  assert.equal(result.projects.reduce((sum, project) => sum + (project.leads ?? 0), 0), 21);
});

test("homepage aliases persist by campaign ID without guessing other projects or using paused campaigns", async () => {
  const data = dashboard();
  data.cvrLinks = [conversionLink("site-a", "/bedankt", 3, "/home"), conversionLink("site-a", "/bedankt", 0, "/other-project")];
  const result = await getCampaignPerformance(data, {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    projectMatches: [
      { siteId: "site-a", accountId: "123", campaignId: "1", sourcePaths: ["/home"] },
      { siteId: "site-a", accountId: "123", campaignId: "2", sourcePaths: ["/other-project"] },
      { siteId: "site-a", accountId: "999", campaignId: "3", sourcePaths: ["/other-project"] }
    ],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: ["1", "2", "3"].map((id) => ({ id, name: "Ledoux same project name", effective_status: id === "2" ? "PAUSED" : "ACTIVE" })) });
      if (isLinkCtrRequest(url)) return response({ data: ["1", "3"].map((id) => ({ campaign_id: id, campaign_name: "Ledoux", inline_link_click_ctr: "5.5", impressions: "100" })) });
      if (url.pathname.endsWith("/ads")) { assert.match(url.pathname, /\/3\/ads$/); return response({ data: [] }); }
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.projects.find((project) => project.key === "site-a:/home")?.campaigns[0].id, "1");
  assert.deepEqual(result.projects.find((project) => project.key === "site-a:/other-project")?.campaigns, []);
  assert.deepEqual(result.unmatchedCampaigns.map((campaign) => campaign.campaignId), ["3"]);
});

test("a linked landing page without conversion setup does not inherit website leads, appointments or CVR", async () => {
  const data = dashboard();
  data.cvrLinks = [conversionLink("site-a", "/bedankt-brochure", 25, "/existing-project")];
  data.cvrPageCandidates = [{ siteId: "site-a", siteName: "site-a", path: "/new-project/", title: "New project", uniqueVisitors: 12, pageViews: 30 }];
  const result = await getCampaignPerformance(data, {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    projectMatches: [{ siteId: "site-a", accountId: "123", campaignId: "1", sourcePaths: ["/new-project/"] }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux new project", effective_status: "ACTIVE" }] });
      if (isLinkCtrRequest(url)) return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux new project", inline_link_click_ctr: "2", impressions: "100" }] });
      if (url.pathname.endsWith("/insights")) return response({ data: [] });
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  const project = result.projects.find((project) => project.key === "site-a:/new-project")!;
  assert.equal(project.title, "New project");
  assert.equal(project.visitors, 12);
  assert.deepEqual([project.leads, project.appointments, project.cvr], [null, null, null]);
  assert.equal(project.campaigns[0].ctr, 2);
  assert.equal(result.rows[0].leads.data?.count, 25);
});

test("Ads Manager link CTR and both ad providers use the exact custom date range", async () => {
  for (const range of [{ start: "2026-08-01", end: "2026-08-31" }, { start: "2026-09-08", end: "2026-09-08" }]) {
    const data = dashboard();
    data.period = { ...period, ...range };
    const checked: string[] = [];
    const result = await getCampaignPerformance(data, {
      now: new Date("2026-09-15T12:00:00Z"),
      env: environment([{ siteId: "site-a", google: { customerId: "456" }, facebook: { adAccountId: "123" } }],
        { ...googleCredentials, META_ADS_ACCESS_TOKEN: "secret" }),
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === "oauth2.googleapis.com") return response({ access_token: "access" });
        if (url.hostname === "googleads.googleapis.com") {
          const query = JSON.parse(String(init?.body)).query as string;
          if (query.includes("FROM customer")) return response([{ results: [{ customer: { currencyCode: "EUR" } }] }]);
          if (query.includes("primary_status")) return response([{ results: [{ campaign: { id: "2", status: "ENABLED", primaryStatus: "ELIGIBLE" } }] }]);
          assert.ok(query.includes(`BETWEEN '${range.start}' AND '${range.end}'`));
          checked.push("google");
          return response([{ results: [{ campaign: { id: "2" }, metrics: { clicks: "10", impressions: "100", costMicros: "0" } }] }]);
        }
        if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", name: "Ledoux Crollet", effective_status: "ACTIVE" }] });
        if (url.pathname.endsWith("/insights")) {
          assert.deepEqual(JSON.parse(url.searchParams.get("time_range")!), { since: range.start, until: range.end });
          assert.equal(url.searchParams.get("level"), "campaign");
          if (isLinkCtrRequest(url)) {
            checked.push("facebook-link-ctr");
            assert.equal(url.searchParams.get("fields"), "campaign_id,campaign_name,inline_link_click_ctr,impressions");
            assert.equal(url.searchParams.get("time_increment"), "all_days");
            return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux Crollet", inline_link_click_ctr: "1.694141",
              inline_link_clicks: "371", impressions: "21899", reach: "14018", unique_link_clicks_ctr: "2.411186", ctr: "4.5" }] });
          }
          checked.push("facebook-spend");
          return response({ data: [{ campaign_id: "1", campaign_name: "Ledoux Crollet", impressions: "21899", spend: "20" }] });
        }
        if (url.pathname.endsWith("/ads")) return response({ data: [] });
        return response({ currency: "EUR", account_status: 1 });
      }
    });
    assert.equal(result.rows[0].facebookLinkCtr.data?.campaigns[0].ctr, 1.694141);
    assert.equal(result.facebookLinkCtr.ctr, 1.694141);
    assert.equal(summarizeAds([result.rows[0].google]).ctr, 10);
    assert.deepEqual(checked.sort(), ["facebook-link-ctr", "facebook-spend", "google"]);
  }
});

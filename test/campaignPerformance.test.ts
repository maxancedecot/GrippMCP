import test from "node:test";
import assert from "node:assert/strict";
import {
  campaignPeriodBounds, getCampaignPerformance, parseCampaignSiteMappings, summarizeAds, summarizeCrm, summarizeUniqueCtr,
  type AdPerformance, type CampaignSiteMapping, type CampaignSource
} from "../src/campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "../src/siteAnalytics.js";

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
const token = async (installId: string) => ({
  installId, locationId: installId, accessToken: "private-token", refreshToken: "refresh", tokenType: "Bearer",
  expiresAt: Date.now() + 3600_000, createdAt: 0, updatedAt: 0
});

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
  assert.equal(summarizeCrm([rows[0].leads]).count, null);
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
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123", campaignIds: ["1", "2"] } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      visited.push(url.toString());
      assert.equal(url.hostname, "graph.facebook.com");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
      if (url.pathname.endsWith("/campaigns")) return response({ data: [
        { id: "1", effective_status: "ACTIVE" },
        { id: "2", effective_status: "ACTIVE", start_time: "2026-09-15T00:00:00Z" },
        { id: "3", effective_status: "ACTIVE" }
      ] });
      if (url.pathname.endsWith("/insights")) {
        assert.deepEqual(JSON.parse(url.searchParams.get("time_range")!), { since: period.start, until: period.end });
        if (url.searchParams.get("level") === "account") {
          assert.equal(url.searchParams.get("time_increment"), "all_days");
          assert.equal(url.searchParams.get("fields"), "unique_ctr,unique_clicks,reach");
          assert.deepEqual(JSON.parse(url.searchParams.get("filtering")!), [{ field: "campaign.id", operator: "IN", value: ["1", "2"] }]);
          return response({ data: [{ unique_ctr: "10", unique_clicks: "20", reach: "200" }] });
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

test("unique CTR totals use Meta's union of overlapping campaigns and weight distinct accounts by reach", async () => {
  const selections: string[] = [];
  const result = await getCampaignPerformance(dashboard(["a", "b", "c", "duplicate"]), {
    env: environment([
      { siteId: "a", facebook: { adAccountId: "123", campaignIds: ["1", "2"] } },
      { siteId: "b", facebook: { adAccountId: "123", campaignIds: ["2", "3"] } },
      { siteId: "c", facebook: { adAccountId: "456" } },
      { siteId: "duplicate", facebook: { adAccountId: "123", campaignIds: ["2", "1"] } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: ["1", "2", "3"].map((id) => ({ id, effective_status: "ACTIVE" })) });
      if (url.searchParams.get("level") === "campaign") return response({ data: [] });
      if (url.searchParams.get("level") === "account") {
        const ids = url.searchParams.has("filtering") ? JSON.parse(url.searchParams.get("filtering")!)[0].value.join(",") : "all";
        selections.push(`${url.pathname}:${ids}`);
        const metrics = {
          "1,2": { unique_ctr: "20", unique_clicks: "30", reach: "150" },
          "2,3": { unique_ctr: "20", unique_clicks: "40", reach: "200" },
          "1,2,3": { unique_ctr: "15", unique_clicks: "45", reach: "300" },
          all: { unique_ctr: "10", unique_clicks: "5", reach: "50" }
        };
        return response({ data: [metrics[ids as keyof typeof metrics]] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, 20);
  assert.equal(result.rows[1].facebookUniqueCtr.data?.ctr, 20);
  assert.equal(result.facebookUniqueCtr.ctr, 50 / 350 * 100);
  assert.equal(result.facebookUniqueCtr.accounts, 2);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(selections.length, 4); // Duplicate and account-total scopes reuse the same requests.
  assert.ok(selections.some((selection) => selection.endsWith(":1,2,3")));
});

test("a whole-account website includes narrower scopes once in the unique CTR total", async () => {
  const scopes: (string | null)[] = [];
  const result = await getCampaignPerformance(dashboard(["filtered", "all"]), {
    env: environment([
      { siteId: "filtered", facebook: { adAccountId: "123", campaignIds: ["1"] } },
      { siteId: "all", facebook: { adAccountId: "123" } }
    ], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/campaigns")) return response({ data: [{ id: "1", effective_status: "ACTIVE" }] });
      if (url.searchParams.get("level") === "campaign") return response({ data: [] });
      if (url.searchParams.get("level") === "account") {
        scopes.push(url.searchParams.get("filtering"));
        return response({ data: [{ unique_ctr: url.searchParams.has("filtering") ? "5" : "8", unique_clicks: "8", reach: "100" }] });
      }
      return response({ currency: "EUR", account_status: 1 });
    }
  });
  assert.equal(result.facebookUniqueCtr.ctr, 8);
  assert.equal(result.facebookUniqueCtr.accounts, 1);
  assert.equal(scopes.length, 2);
  assert.equal(scopes.filter((scope) => scope === null).length, 1);
});

test("missing unique metrics never fall back to ordinary CTR or break Facebook spend", async () => {
  for (const uniqueResponse of [
    { data: [{ reach: "100", unique_clicks: "10" }] },
    { data: [{ reach: "100", unique_clicks: "10", unique_ctr: "10" }], paging: { next: "https://example.com/next" } },
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
  assert.equal(summarizeUniqueCtr([connected({ accountId: "123", uniqueClicks: 0, reach: 0, ctr: null })]).ctr, null);
  assert.equal(summarizeUniqueCtr([connected({ accountId: "123", uniqueClicks: 1, reach: 3, ctr: 33.333333 })]).ctr, 33.333333);
  assert.equal(summarizeUniqueCtr([
    connected({ accountId: "123", uniqueClicks: 10, reach: 100, ctr: 10 }),
    { state: "unavailable", data: null, message: "Unavailable" }
  ]).ctr, null);
});

test("Meta can return no insights for a connected account without inventing a zero unique CTR", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", facebook: { adAccountId: "123" } }], { META_ADS_ACCESS_TOKEN: "secret" }),
    fetchImpl: async (input) => response(String(input).includes("/insights?") || String(input).includes("/campaigns?")
      ? { data: [] } : { currency: "EUR", account_status: 1 })
  });
  assert.equal(result.rows[0].facebookUniqueCtr.state, "connected");
  assert.equal(result.rows[0].facebookUniqueCtr.data?.ctr, null);
  assert.equal(result.facebookUniqueCtr.unavailable, false);
  assert.equal(result.facebookUniqueCtr.ctr, null);
});

test("provider failures are isolated and upstream secrets never reach the dashboard", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", google: { customerId: "123" }, ghl: { locationId: "location" } }], googleCredentials),
    getGhlToken: token,
    fetchImpl: async (input) => {
      if (String(input).includes("google")) return response({ error: "secret-token" });
      if (String(input).includes("contacts/search")) return response({ contacts: [], total: 0 });
      return response({ calendars: [] });
    }
  });
  assert.equal(result.rows[0].google.state, "unavailable");
  assert.equal(result.rows[0].leads.state, "connected");
  assert.equal(result.rows[0].appointments.state, "connected");
  assert.doesNotMatch(JSON.stringify(result), /secret-token|private-token/);
});

test("CRM counts new contacts over all pages and excludes canceled appointments and blocked slots", async () => {
  const dates = ["2026-09-07T22:00:00Z", "2026-09-14T21:59:59Z", "2026-09-14T22:00:00Z"];
  const pages: number[] = [];
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", ghl: { locationId: "location", calendarIds: ["calendar-a", "calendar-b"] } }]),
    getGhlToken: token,
    fetchImpl: async (input, init) => {
      if (String(input).includes("contacts/search")) {
        const body = JSON.parse(String(init?.body));
        pages.push(body.page);
        assert.equal(body.filters[0].value.gte, "2026-09-07T22:00:00.000Z");
        return response(body.page === 1
          ? { contacts: [{ id: "a", dateAdded: dates[0] }], total: 3 }
          : { contacts: [{ id: "b", dateAdded: dates[1] }, { id: "c", dateAdded: dates[2] }], total: 3 });
      }
      return response({ events: [
        { id: "a", contactId: "a", startTime: dates[0], appointmentStatus: "confirmed" },
        { id: "b", contactId: "b", startTime: dates[1], appointmentStatus: "cancelled" },
        { id: "c", contactId: "c", startTime: dates[2], appointmentStatus: "confirmed" },
        { id: "block", startTime: dates[0] }
      ] });
    }
  });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(result.rows[0].leads.data?.ids, ["a", "b"]);
  assert.deepEqual(result.rows[0].appointments.data?.ids, ["a"]);
});

test("CRM rejects a token belonging to another location", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", ghl: { locationId: "location", installId: "another" } }]),
    getGhlToken: token, fetchImpl: async () => { assert.fail("Wrong-location tokens must not be used"); }
  });
  assert.equal(result.rows[0].leads.state, "unavailable");
  assert.equal(result.rows[0].appointments.state, "unavailable");
});

test("incomplete pagination produces unavailable data instead of an understated lead total", async () => {
  const result = await getCampaignPerformance(dashboard(), {
    env: environment([{ siteId: "site-a", ghl: { locationId: "location" } }]), getGhlToken: token,
    fetchImpl: async (input) => response(String(input).includes("contacts/search")
      ? { contacts: [{ id: "same", dateAdded: "2026-09-10T00:00:00Z" }], total: 2 }
      : { calendars: [] })
  });
  assert.equal(result.rows[0].leads.state, "unavailable");
  assert.equal(result.rows[0].appointments.state, "connected");
});

test("Brussels reporting days handle summer and winter clock changes", () => {
  const spring = campaignPeriodBounds({ start: "2026-03-29", end: "2026-03-29" });
  const autumn = campaignPeriodBounds({ start: "2026-10-25", end: "2026-10-25" });
  assert.equal(spring.end - spring.start + 1, 23 * 3600_000);
  assert.equal(autumn.end - autumn.start + 1, 25 * 3600_000);
});

test("summaries deduplicate shared accounts and CRM records and keep different currencies separate", () => {
  const ads: AdPerformance = { accountId: "123", currency: "EUR", campaigns: [{ id: "1", live: true, clicks: 1, impressions: 100, spend: 10 }] };
  const summary = summarizeAds([connected(ads), connected(ads), connected({ ...ads, accountId: "456", currency: "USD" })]);
  assert.equal(summary.liveCount, 2);
  assert.deepEqual(summary.spend, [{ currency: "EUR", amount: 10 }, { currency: "USD", amount: 10 }]);
  assert.equal(summarizeCrm([connected({ locationId: "a", ids: ["1", "2"] }), connected({ locationId: "a", ids: ["2", "3"] })]).count, 3);
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

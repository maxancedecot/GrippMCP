import test from "node:test";
import assert from "node:assert/strict";
import { listGoogleCampaigns, saveGoogleCampaignMatches } from "../src/googleCampaignManagement.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, type CampaignProjectMatch } from "../src/campaignProjects.js";
import { projectPagesFromDashboard } from "../src/projectPageManagement.js";
import type { SiteAnalyticsDashboardData } from "../src/siteAnalytics.js";

test("data management loads Google campaigns with normalized customer IDs", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const result = await listGoogleCampaigns("536-578-3098", {
    env: { GOOGLE_ADS_CLIENT_ID: "client", GOOGLE_ADS_CLIENT_SECRET: "secret", GOOGLE_ADS_REFRESH_TOKEN: "refresh", GOOGLE_ADS_API_VERSION: "v25" },
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).includes("oauth2")) return Response.json({ access_token: "access" });
      return Response.json([{ results: [{ campaign: { id: "10", name: "Ledoux x Graanmolenhof: LOCAL", status: "ENABLED" } }] }]);
    }
  });
  assert.equal(result.customerId, "5365783098");
  assert.deepEqual(result.campaigns, [{ id: "10", name: "Ledoux x Graanmolenhof: LOCAL", status: "ENABLED" }]);
  assert.match(calls[1].url, /customers\/5365783098\/googleAds:searchStream/);
  assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, "Bearer access");
});

test("data management rejects unsafe Google customer IDs before fetching", async () => {
  let fetched = false;
  await assert.rejects(listGoogleCampaigns("536 OR 1=1", { env: {}, fetchImpl: async () => { fetched = true; return Response.json({}); } }));
  assert.equal(fetched, false);
});

test("three Google campaigns are assigned to one project in a single write", async () => {
  let saved: CampaignProjectMatch[] = [
    { channel: "google", siteId: "immogra", accountId: "123", campaignId: "2", sourcePaths: ["/other"] },
    { channel: "facebook", siteId: "immogra", accountId: "999", campaignId: "8", sourcePaths: ["/other"] }
  ];
  let writes = 0;
  const store = {
    async read<T>(key: string) { assert.equal(key, CAMPAIGN_PROJECT_MATCHES_KEY); return structuredClone(saved) as T; },
    async write(key: string, value: unknown) { assert.equal(key, CAMPAIGN_PROJECT_MATCHES_KEY); writes += 1; saved = structuredClone(value as CampaignProjectMatch[]); }
  };
  const pages = [{ siteId: "immogra", path: "/groene-wandeling" }];
  const matches = await saveGoogleCampaignMatches({ siteId: "immogra", accountId: "123", campaignIds: ["1", "2", "3"], sourcePath: "/groene-wandeling/" }, { store, pages });
  assert.equal(writes, 1);
  assert.deepEqual(matches.map((match) => match.campaignId), ["1", "2", "3"]);
  assert.deepEqual(saved.filter((match) => match.channel === "google").map((match) => [match.campaignId, match.sourcePaths[0]]),
    [["1", "/groene-wandeling"], ["2", "/groene-wandeling"], ["3", "/groene-wandeling"]]);
  assert.deepEqual(saved.find((match) => match.channel === "facebook")?.sourcePaths, ["/other"]);

  await assert.rejects(saveGoogleCampaignMatches({ siteId: "immogra", accountId: "123", campaignIds: ["4"], sourcePath: "/missing" }, { store, pages }));
  assert.equal(writes, 1);
});

test("adding campaigns keeps existing project links and other accounts, and deduplicates the selection", async () => {
  let saved: CampaignProjectMatch[] = [
    { channel: "google", siteId: "immogra", accountId: "123", campaignId: "1", sourcePaths: ["/project"] },
    { channel: "google", siteId: "immogra", accountId: "999", campaignId: "2", sourcePaths: ["/other"] },
    { channel: "google", siteId: "immogra", accountId: "123", campaignId: "3", sourcePaths: ["/other"] }
  ];
  const store = {
    async read<T>() { return structuredClone(saved) as T; },
    async write(_key: string, value: unknown) { saved = structuredClone(value as CampaignProjectMatch[]); }
  };
  const matches = await saveGoogleCampaignMatches({ siteId: "immogra", accountId: "1-2-3", campaignIds: ["2", "3", "2"], sourcePath: "/project/" },
    { store, pages: [{ siteId: "immogra", path: "/project" }] });
  assert.deepEqual(matches.map((match) => match.campaignId), ["2", "3"]);
  assert.deepEqual(saved.filter((match) => match.accountId === "123").map((match) => [match.campaignId, match.sourcePaths]),
    [["1", ["/project"]], ["2", ["/project"]], ["3", ["/project"]]]);
  assert.deepEqual(saved.find((match) => match.accountId === "999")?.sourcePaths, ["/other"]);
});

test("campaigns can target the managed primary page even when only a language variant has analytics", async () => {
  const metrics = { pageViews: 10, uniqueVisitors: 5, sessions: 5, avgTimeOnPageSeconds: 20, avgScrollPercent: 50 };
  const dashboard: SiteAnalyticsDashboardData = {
    source: { mode: "live", message: "" }, period: { days: 90, start: "2026-07-01", end: "2026-09-28", label: "90 dagen" }, totals: metrics,
    sites: [{ id: "brusselskaai", name: "Brusselskaai", url: "https://brusselskaai.be", ...metrics,
      cvrSourceVisitors: 0, cvrConversionVisitors: 0, cvrLinkCount: 0, conversionRatePercent: 0 }],
    cvrPageCandidates: [{ siteId: "brusselskaai", siteName: "Brusselskaai", path: "/home-fr", title: "Accueil", uniqueVisitors: 5, pageViews: 10 }],
    dailyRows: [], pageRows: [], referrerRows: [], cvrLinks: [], lastUpdated: ""
  };
  const pages = projectPagesFromDashboard(dashboard);
  let saved: unknown;
  const store = { async read<T>() { return null as T | null; }, async write(_key: string, value: unknown) { saved = value; } };
  const result = await saveGoogleCampaignMatches({ siteId: "brusselskaai", accountId: "123", campaignIds: ["1", "2"], sourcePath: "/" }, { store, pages });
  assert.deepEqual(result.map((match) => match.sourcePaths), [["/"], ["/"]]);
  assert.deepEqual(saved, result);
});

test("invalid campaign selections and project scopes are rejected without writing", async () => {
  let writes = 0;
  const store = { async read<T>() { return null as T | null; }, async write() { writes += 1; } };
  const pages = [{ siteId: "immogra", path: "/project" }];
  const selection = { siteId: "immogra", accountId: "123", campaignIds: ["1"], sourcePath: "/project" };
  for (const override of [
    { campaignIds: [] }, { campaignIds: Array.from({ length: 101 }, (_, index) => String(index + 1)) },
    { campaignIds: ["invalid"] }, { siteId: "other-site" },
    { sourcePath: "https://example.com/project" }, { sourcePath: "//example.com/project" }
  ]) {
    await assert.rejects(saveGoogleCampaignMatches({ ...selection, ...override }, { store, pages }));
  }
  assert.equal(writes, 0);
});

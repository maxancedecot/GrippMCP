import test from "node:test";
import assert from "node:assert/strict";
import { listGoogleAdAccounts, listGoogleCampaigns, saveGoogleCampaignMatches } from "../src/googleCampaignManagement.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, parseCampaignProjectMatches, type CampaignProjectMatch } from "../src/campaignProjects.js";
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


const credentials = { GOOGLE_ADS_CLIENT_ID: "client", GOOGLE_ADS_CLIENT_SECRET: "secret", GOOGLE_ADS_REFRESH_TOKEN: "refresh", GOOGLE_ADS_DEVELOPER_TOKEN: "developer" };

test("Google account selector combines direct advertisers and all manager descendants, deduplicating by customer ID", async () => {
  const visited: string[] = [];
  const accounts = await listGoogleAdAccounts({ env: credentials, fetchImpl: async (input, init) => {
    const url = String(input);
    if (url.includes("oauth2")) return Response.json({ access_token: "access" });
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer access");
    assert.equal(headers["developer-token"], "developer");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    if (url.endsWith(":listAccessibleCustomers")) {
      assert.equal(init?.method, "GET");
      assert.equal(headers["login-customer-id"], undefined);
      return Response.json({ resourceNames: ["customers/900", "customers/123", "customers/900"] });
    }
    const root = url.match(/customers\/(\d+)\//)![1];
    assert.equal(headers["login-customer-id"], root);
    const query = JSON.parse(String(init?.body)).query as string;
    visited.push(`${root}:${query.includes("FROM customer_client") ? "clients" : "customer"}`);
    if (query.includes("FROM customer_client")) {
      assert.match(query, /customer_client.manager = FALSE/);
      assert.doesNotMatch(query, /level/);
      return Response.json([
        { results: [
          { customerClient: { id: "456", descriptiveName: "Zulu", status: "SUSPENDED" } },
          { customerClient: { id: "901", descriptiveName: "Nested manager", manager: true } }
        ] },
        { results: [
          { customerClient: { id: "123", descriptiveName: "Alpha via manager", status: "ENABLED" } },
          { customerClient: { id: "789", descriptiveName: " ", manager: false } }
        ] }
      ]);
    }
    return Response.json([{ results: [{ customer: { id: root, descriptiveName: root === "900" ? "Manager" : "Alpha", manager: root === "900", status: "ENABLED" } }] }]);
  } });
  assert.deepEqual(visited, ["900:customer", "900:clients", "123:customer"]);
  assert.deepEqual(accounts, [
    { id: "123", name: "Alpha", status: "ENABLED", loginCustomerId: "123" },
    { id: "789", name: "Google Ads-account 789", status: "UNKNOWN", loginCustomerId: "900" },
    { id: "456", name: "Zulu", status: "SUSPENDED", loginCustomerId: "900" }
  ]);
});

test("configured Google manager scopes account selection without requiring directly accessible customer listing", async () => {
  const urls: string[] = [];
  const accounts = await listGoogleAdAccounts({ env: { ...credentials, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "9-0-0", GOOGLE_ADS_API_VERSION: "v24" }, fetchImpl: async (input, init) => {
    const url = String(input); urls.push(url);
    if (url.includes("oauth2")) return Response.json({ access_token: "access" });
    assert.match(url, /v24\/customers\/900\//);
    assert.equal((init?.headers as Record<string, string>)["login-customer-id"], "900");
    const query = JSON.parse(String(init?.body)).query as string;
    return Response.json([{ results: query.includes("FROM customer_client")
      ? [{ customerClient: { id: "123", descriptiveName: "Project account", status: "ENABLED" } }]
      : [{ customer: { id: "900", manager: true } }] }]);
  } });
  assert.deepEqual(accounts, [{ id: "123", name: "Project account", status: "ENABLED", loginCustomerId: "900" }]);
  assert.equal(urls.length, 3);
});

test("Google account selection handles an empty connection and managers without advertisers", async () => {
  for (const manager of [false, true]) {
    const accounts = await listGoogleAdAccounts({ env: credentials, fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2")) return Response.json({ access_token: "access" });
      if (url.endsWith(":listAccessibleCustomers")) return Response.json(manager ? { resourceNames: ["customers/900"] } : {});
      const query = JSON.parse(String(init?.body)).query as string;
      return Response.json(query.includes("FROM customer_client") ? [] : [{ results: [{ customer: { id: "900", manager: true } }] }]);
    } });
    assert.deepEqual(accounts, []);
  }
});

test("Google account listing validates configuration before making requests", async () => {
  for (const env of [{}, { ...credentials, GOOGLE_ADS_API_VERSION: "../evil" }, { ...credentials, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "123 OR 1=1" }]) {
    let fetched = false;
    await assert.rejects(listGoogleAdAccounts({ env, fetchImpl: async () => { fetched = true; return Response.json({}); } }));
    assert.equal(fetched, false);
  }
});

test("Google account listing fails safely for malformed responses and late permission failures", async () => {
  for (const invalid of ["resource", "customer", "child", "http"]) {
    await assert.rejects(listGoogleAdAccounts({ env: credentials, fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2")) return Response.json({ access_token: "access" });
      if (url.endsWith(":listAccessibleCustomers")) return Response.json({ resourceNames: invalid === "resource" ? ["https://evil.example/123"] : ["customers/900"] });
      const query = JSON.parse(String(init?.body)).query as string;
      if (!query.includes("FROM customer_client")) return Response.json([{ results: [{ customer: { id: invalid === "customer" ? "999" : "900", manager: true } }] }]);
      if (invalid === "http") return Response.json({ error: "Private provider detail" }, { status: 403 });
      return Response.json([{ results: [{ customerClient: { id: "123" } }] }, { results: [{ customerClient: { id: "../unsafe" } }] }]);
    } }));
  }
});

test("loading Google campaigns uses the selected account's manager instead of the configured default", async () => {
  let requests = 0;
  const result = await listGoogleCampaigns("1-2-3", { env: { ...credentials, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "888" }, loginCustomerId: "9-0-0", fetchImpl: async (input, init) => {
    requests++;
    if (String(input).includes("oauth2")) return Response.json({ access_token: "access" });
    assert.match(String(input), /customers\/123\//);
    assert.equal((init?.headers as Record<string, string>)["login-customer-id"], "900");
    return Response.json([{ results: [{ campaign: { id: "10", name: "Project campaign" } }] }]);
  } });
  assert.equal(requests, 2);
  assert.equal(result.campaigns[0].status, "UNKNOWN");
});

test("Google project links persist the selected manager and reject invalid manager IDs", async () => {
  let saved: unknown, writes = 0;
  const store = { async read<T>() { return null as T | null; }, async write(_key: string, value: unknown) { saved = value; writes++; } };
  const pages = [{ siteId: "site-a", path: "/project" }];
  const input = { siteId: "site-a", accountId: "1-2-3", loginCustomerId: "9-0-0", campaignIds: ["10", "11"], sourcePath: "/project" };
  const matches = await saveGoogleCampaignMatches(input, { store, pages });
  assert.deepEqual(matches.map((match) => match.loginCustomerId), ["900", "900"]);
  assert.deepEqual(parseCampaignProjectMatches(saved), matches);
  await assert.rejects(saveGoogleCampaignMatches({ ...input, loginCustomerId: "900/evil" }, { store, pages }));
  assert.equal(writes, 1);
  assert.throws(() => parseCampaignProjectMatches([{ ...matches[0], channel: "facebook" }]));
});

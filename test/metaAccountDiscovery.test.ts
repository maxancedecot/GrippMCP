import test from "node:test";
import assert from "node:assert/strict";
import { discoverMetaAccounts } from "../src/metaAccountDiscovery.js";

process.env.JSON_CACHE_STORE = "memory";
const sites = [{ id: "one", name: "One", url: "https://one.example" }, { id: "two", name: "Two", url: "https://two.example/project" }];
const now = new Date("2026-09-16T12:00:00Z");
const response = (value: unknown) => Response.json(value);
const account = (id: string) => ({ id: `act_${id}`, name: `Account ${id}`, account_status: 1 });
const campaign = (id: string) => ({ id, name: "Ledoux project", effective_status: "ACTIVE" });
const ad = (id: string, url: string) => ({ campaign_id: id, creative: { object_story_spec: { link_data: { link: url } } } });

test("Meta discovery paginates on the fixed host and matches destination URLs without name guesses", async () => {
  const visited: URL[] = [];
  const result = await discoverMetaAccounts({ sites, now, env: { META_ADS_ACCESS_TOKEN: "token" }, fetchImpl: async (input, init) => {
    const url = new URL(String(input)); visited.push(url);
    assert.equal(url.hostname, "graph.facebook.com");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
    if (url.pathname.endsWith("/me/adaccounts")) return !url.searchParams.has("after")
      ? response({ data: [account("1")], paging: { next: "https://untrusted.example/token", cursors: { after: "second" } } })
      : response({ data: [account("2")] });
    if (url.pathname.endsWith("/campaigns")) return response({ data: [campaign(url.pathname.includes("act_1") ? "10" : "20"), { ...campaign("99"), name: "Other campaign" }] });
    if (url.pathname.endsWith("/10/ads")) return response({ data: [ad("10", "https://www.one.example/project/?utm_source=meta&p_slug=a"), ad("10", "https://one.example/?elementor-preview=2"), ad("10", "https://one.example.evil.test/"), ad("10", "https://two.example/outside")] });
    if (url.pathname.endsWith("/20/ads")) return response({ data: [ad("20", "https://two.example/project/new")] });
    assert.fail(`Unexpected request ${url.pathname}`);
  } });
  assert.deepEqual(result.matches.map((match) => [match.siteId, match.accountId, match.campaignId, match.sourcePaths]), [["one", "1", "10", ["/project?p_slug=a"]], ["two", "2", "20", ["/project/new"]]]);
  assert.equal(result.sync.accounts.length, 2);
  assert.equal(visited.filter((url) => url.pathname.endsWith("/me/adaccounts")).length, 2);
});

test("new accounts sync immediately while cached accounts refresh after five minutes or on demand", async () => {
  let accountIds = ["1"], live = true, destination = "/old", scans = 0;
  const options = { sites, now, cache: true, env: { META_ADS_ACCESS_TOKEN: "cache-test-token" }, fetchImpl: async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: accountIds.map(account) });
    if (url.pathname.endsWith("/campaigns")) { scans++; return response({ data: live ? [campaign(url.pathname.includes("act_1") ? "10" : "20")] : [] }); }
    const id = url.pathname.includes("/10/") ? "10" : "20";
    return response({ data: [ad(id, `https://one.example${destination}`)] });
  } };
  await discoverMetaAccounts(options);
  accountIds = ["1", "2"];
  let result = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 60_000) });
  assert.equal(scans, 2, "existing account reused, new account checked immediately");
  assert.equal(result.matches.length, 2);
  destination = "/new";
  result = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 120_000), force: true });
  assert.equal(scans, 4);
  assert.ok(result.matches.every((match) => match.sourcePaths[0] === "/new"));
  live = false;
  result = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 8 * 60_000) });
  assert.equal(scans, 6);
  assert.equal(result.matches.length, 2, "stopped campaigns retain their verified destination");
  assert.equal(result.sync.accounts[0].campaignCount, 0);
  accountIds = ["1"];
  result = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 9 * 60_000) });
  assert.equal(result.matches.length, 1, "revoked account cannot reappear from cache");
});

test("failed account discovery is visible and cannot reuse another credential's destinations", async () => {
  const options = { sites, now, cache: true, env: { META_ADS_ACCESS_TOKEN: "old-credential" }, fetchImpl: async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: [account("1")] });
    if (url.pathname.endsWith("/campaigns")) return response({ data: [campaign("10")] });
    return response({ data: [ad("10", "https://one.example/project")] });
  } };
  await discoverMetaAccounts(options);
  const failingFetch: typeof fetch = async (input) => String(input).includes("me/adaccounts") ? response({ data: [account("1")] }) : new Response("denied", { status: 403 });
  const stale = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 6 * 60_000), fetchImpl: failingFetch });
  assert.equal(stale.matches.length, 1);
  assert.match(stale.sync.accounts[0].message, /laatste geslaagde/);
  const expired = await discoverMetaAccounts({ ...options, now: new Date(now.getTime() + 25 * 60 * 60_000), fetchImpl: failingFetch });
  assert.equal(expired.matches.length, 0);
  const rotated = await discoverMetaAccounts({ ...options, env: { META_ADS_ACCESS_TOKEN: "new-credential" }, fetchImpl: failingFetch });
  assert.equal(rotated.matches.length, 0);
  assert.match(rotated.sync.accounts[0].message, /niet worden gecontroleerd/);
  const unavailable = await discoverMetaAccounts({ ...options, fetchImpl: async () => new Response("denied", { status: 403 }) });
  assert.equal(unavailable.sync.state, "unavailable");
  assert.equal(unavailable.matches.length, 0);
});

test("one inaccessible account does not block others and incomplete pagination fails visibly", async () => {
  const result = await discoverMetaAccounts({ sites, now, env: { META_ADS_ACCESS_TOKEN: "partial" }, fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: [account("1"), account("2")] });
    if (url.pathname.includes("act_1")) return new Response("denied", { status: 403 });
    if (url.pathname.endsWith("/campaigns")) return response({ data: [campaign("20")] });
    return response({ data: [ad("20", "https://one.example/project")] });
  } });
  assert.equal(result.matches.length, 1);
  assert.match(result.sync.accounts[0].message, /niet worden gecontroleerd/);
  const incomplete = await discoverMetaAccounts({ sites, now, env: { META_ADS_ACCESS_TOKEN: "partial" }, fetchImpl: async () => response({ data: [account("1")], paging: { next: "https://graph.facebook.com/next" } }) });
  assert.equal(incomplete.sync.state, "unavailable");
  assert.equal(incomplete.matches.length, 0);
});

test("period discovery finds paused and historical-only campaigns even in inactive accounts, using only delivered ads", async () => {
  const period = { start: "2026-09-08", end: "2026-09-14" };
  const result = await discoverMetaAccounts({ sites, now, period, env: { META_ADS_ACCESS_TOKEN: "period" }, fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: [{ ...account("1"), account_status: 2 }] });
    if (url.pathname.endsWith("/campaigns")) {
      assert.equal(url.searchParams.has("effective_status"), false);
      return response({ data: [{ ...campaign("10"), name: "Ledoux Englebert", effective_status: "PAUSED" },
        { ...campaign("20"), name: "Renamed away" }, { ...campaign("30"), effective_status: "PAUSED" }] });
    }
    if (url.searchParams.get("level") === "campaign") return response({ data: ["10", "20", "30", "40", "50"].map((id) => ({
      campaign_id: id, campaign_name: id === "50" ? "Other campaign" : "Ledoux old name", impressions: id === "30" ? "0" : "100", spend: "0"
    })) });
    if (url.pathname.endsWith("/insights")) {
      assert.deepEqual(JSON.parse(url.searchParams.get("time_range")!), { since: period.start, until: period.end });
      const id = url.pathname.split("/").at(-2)!;
      assert.ok(["10", "40"].includes(id), "only period-active campaigns need delivered-ad insights");
      return response({ data: [{ ad_id: `${id}1`, campaign_id: id, impressions: "100", spend: "0" }] });
    }
    if (url.pathname.endsWith("/ads")) {
      const id = url.pathname.split("/").at(-2)!;
      assert.ok(["10", "30", "40"].includes(id), "do not scan renamed or non-Ledoux campaigns");
      assert.equal(url.searchParams.has("filtering"), false);
      if (id === "30") return response({ data: [{ ...ad(id, "https://one.example/quiet-project"), id: "301" }] });
      return response({ data: [{ ...ad(id, "https://one.example/englebert"), id: `${id}1` },
        { ...ad(id, "https://two.example/project/wrong-period"), id: `${id}2` }] });
    }
    assert.fail(`Unexpected request ${url.pathname}`);
  } });
  assert.equal(result.sync.message, "");
  assert.equal(result.sync.accounts[0].campaignCount, 0);
  assert.deepEqual(result.matches.sort((a, b) => a.campaignId.localeCompare(b.campaignId)).map((match) => [match.campaignId, match.siteId, match.sourcePaths]),
    [["10", "one", ["/englebert"]], ["30", "one", ["/quiet-project"]], ["40", "one", ["/englebert"]]]);
});

test("period discovery caches are isolated by date range and missing historical creatives cannot invent matches", async () => {
  let scans = 0, missing = false;
  const options = { sites, now, cache: true, env: { META_ADS_ACCESS_TOKEN: "period-cache" }, fetchImpl: async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: [account("1")] });
    if (url.pathname.endsWith("/campaigns")) { scans++; return response({ data: [{ ...campaign("10"), effective_status: "PAUSED" }] }); }
    if (url.searchParams.get("level") === "campaign") return response({ data: [{ campaign_id: "10", campaign_name: "Ledoux Englebert", impressions: "100", spend: "10" }] });
    if (url.searchParams.get("level") === "ad") {
      const range = JSON.parse(url.searchParams.get("time_range")!);
      return response({ data: [{ ad_id: range.since === "2026-09-08" ? "1" : "2", campaign_id: "10", impressions: "100", spend: "10" }] });
    }
    return response({ data: (missing ? ["3"] : ["1", "2"]).map((id) => ({ ...ad("10", `https://one.example/project-${id}`), id })) });
  } };
  const firstPeriod = { start: "2026-09-08", end: "2026-09-14" };
  const first = await discoverMetaAccounts({ ...options, period: firstPeriod });
  assert.deepEqual(first.matches[0].sourcePaths, ["/project-1"]);
  const second = await discoverMetaAccounts({ ...options, period: { start: "2026-08-24", end: "2026-08-30" } });
  assert.deepEqual(second.matches[0].sourcePaths, ["/project-2"]);
  await discoverMetaAccounts({ ...options, period: firstPeriod });
  assert.equal(scans, 2, "same period reused, different period rechecked");
  missing = true;
  const broken = await discoverMetaAccounts({ ...options, period: { start: "2026-08-01", end: "2026-08-07" } });
  assert.equal(broken.matches.length, 0);
  assert.match(broken.sync.message, /niet volledig/);
  assert.doesNotMatch(JSON.stringify(broken), /project-3/);
});

test("an unavailable old campaign does not hide verified campaigns in the same account", async () => {
  const result = await discoverMetaAccounts({ sites, now, period: { start: "2026-09-08", end: "2026-09-14" }, env: { META_ADS_ACCESS_TOKEN: "isolated" }, fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/me/adaccounts")) return response({ data: [account("1")] });
    if (url.pathname.endsWith("/campaigns")) return response({ data: [campaign("10"), { ...campaign("20"), effective_status: "PAUSED" }] });
    if (url.pathname.endsWith("/insights")) return response({ data: [] });
    if (url.pathname.endsWith("/20/ads")) return new Response("private provider detail", { status: 403 });
    return response({ data: [ad("10", "https://one.example/working")] });
  } });
  assert.deepEqual(result.matches.map((match) => match.campaignId), ["10"]);
  assert.match(result.sync.accounts[0].message, /1 campagnebestemmingen/);
  assert.match(result.sync.message, /niet volledig/);
  assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
});

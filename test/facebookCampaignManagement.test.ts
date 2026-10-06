import test from "node:test";
import assert from "node:assert/strict";
import { deleteFacebookCampaignMatch, listFacebookAdAccounts, listFacebookCampaigns, saveFacebookCampaignMatches } from "../src/facebookCampaignManagement.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, type CampaignProjectMatch } from "../src/campaignProjects.js";

function fixture(initial: CampaignProjectMatch[] = []) {
  let saved = structuredClone(initial), writes = 0;
  const store = {
    async read<T>(key: string) { assert.equal(key, CAMPAIGN_PROJECT_MATCHES_KEY); return structuredClone(saved) as T; },
    async write(key: string, value: unknown) { assert.equal(key, CAMPAIGN_PROJECT_MATCHES_KEY); writes++; saved = structuredClone(value as CampaignProjectMatch[]); }
  };
  return { store, pages: [{ siteId: "site", path: "/project" }], saved: () => saved, writes: () => writes };
}

test("Facebook campaign loading accepts act_ IDs, includes paused campaigns and follows cursors on a fixed host", async () => {
  const calls: URL[] = [];
  const result = await listFacebookCampaigns(" act_123 ", {
    env: { META_ADS_ACCESS_TOKEN: "secret" },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input)); calls.push(url);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret");
      assert.equal(init?.redirect, "error");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(url.hostname, "graph.facebook.com");
      assert.match(url.pathname, /\/act_123\/campaigns$/);
      return Response.json(url.searchParams.has("after") ? { data: [
        { id: "2", name: "Alpha paused", effective_status: "PAUSED" },
        { id: "3", name: "Archived", effective_status: "ARCHIVED" }
      ] } : { data: [{ id: "1", name: "Zeta active", effective_status: "ACTIVE" }],
        paging: { next: "https://untrusted.example/page?access_token=secret", cursors: { after: "second" } } });
    }
  });
  assert.equal(result.accountId, "123");
  assert.deepEqual(result.campaigns, [{ id: "2", name: "Alpha paused", status: "PAUSED" }, { id: "1", name: "Zeta active", status: "ACTIVE" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("after"), "second");
});

test("Facebook rejects unsafe IDs and missing credentials before making a request", async () => {
  let fetched = false;
  const fetchImpl: typeof fetch = async () => { fetched = true; return Response.json({}); };
  for (const account of ["123/path", "act_123?access_token=secret", "https://example.test", ""]) {
    await assert.rejects(listFacebookCampaigns(account, { env: { META_ADS_ACCESS_TOKEN: "secret" }, fetchImpl }));
  }
  await assert.rejects(listFacebookCampaigns("123", { env: {}, fetchImpl }));
  await assert.rejects(listFacebookCampaigns("123", { env: { META_ADS_ACCESS_TOKEN: "secret", META_ADS_API_VERSION: "evil" }, fetchImpl }));
  assert.equal(fetched, false);
});

test("Facebook loading rejects failed, malformed and incomplete paginated responses", async () => {
  for (const payload of [{ error: { message: "private" } }, { data: [{ id: "1" }] }, { data: [], paging: { next: "next" } }]) {
    await assert.rejects(listFacebookCampaigns("123", { env: { META_ADS_ACCESS_TOKEN: "secret" }, fetchImpl: async () => Response.json(payload) }));
  }
  await assert.rejects(listFacebookCampaigns("123", { env: { META_ADS_ACCESS_TOKEN: "secret" },
    fetchImpl: async () => new Response("private", { status: 403 }) }), /Facebook Ads request failed/);
  let requests = 0;
  await assert.rejects(listFacebookCampaigns("123", { env: { META_ADS_ACCESS_TOKEN: "secret" },
    fetchImpl: async () => { requests++; return Response.json({ data: [], paging: { next: "next", cursors: { after: "repeated" } } }); }
  }), /Incomplete Facebook/);
  assert.equal(requests, 2);
});

test("multiple Facebook campaigns persist once, moving old links and preserving Google and other accounts", async () => {
  const options = fixture([
    { siteId: "old-site", accountId: "123", campaignId: "2", sourcePaths: ["/old"] },
    { channel: "facebook", siteId: "site", accountId: "123", campaignId: "4", sourcePaths: ["/keep"] },
    { channel: "facebook", siteId: "site", accountId: "999", campaignId: "2", sourcePaths: ["/other-account"] },
    { channel: "google", siteId: "site", accountId: "123", campaignId: "2", sourcePaths: ["/google"] }
  ]);
  const matches = await saveFacebookCampaignMatches({ siteId: "site", accountId: "act_123", campaignIds: ["1", "2", "3", "2"], sourcePath: "/project/" }, options);
  assert.equal(options.writes(), 1);
  assert.deepEqual(matches.map(({ channel, accountId, campaignId, sourcePaths }) => [channel, accountId, campaignId, sourcePaths]),
    ["1", "2", "3"].map((id) => ["facebook", "123", id, ["/project"]]));
  assert.equal(options.saved().length, 6);
  assert.equal(options.saved().some((match) => match.siteId === "old-site"), false);
  assert.deepEqual(options.saved().filter((match) => match.channel === "google")[0].sourcePaths, ["/google"]);
  assert.deepEqual(options.saved().find((match) => match.accountId === "999")?.sourcePaths, ["/other-account"]);
  assert.deepEqual(options.saved().find((match) => match.campaignId === "4")?.sourcePaths, ["/keep"]);
});

test("Facebook deletion removes legacy and new Facebook links without touching the same Google ID", async () => {
  const options = fixture([
    { siteId: "site", accountId: "123", campaignId: "1", sourcePaths: ["/project"] },
    { channel: "facebook", siteId: "site", accountId: "123", campaignId: "2", sourcePaths: ["/project"] },
    { channel: "google", siteId: "site", accountId: "123", campaignId: "1", sourcePaths: ["/project"] }
  ]);
  await deleteFacebookCampaignMatch("act_123", "1", options);
  await deleteFacebookCampaignMatch("123", "2", options);
  assert.deepEqual(options.saved(), [{ channel: "google", siteId: "site", accountId: "123", campaignId: "1", sourcePaths: ["/project"] }]);
});

test("invalid Facebook selections cannot write or attach campaigns to unknown project pages", async () => {
  const options = fixture();
  const selection = { siteId: "site", accountId: "123", campaignIds: ["1"], sourcePath: "/project" };
  for (const override of [{ campaignIds: [] }, { campaignIds: ["bad"] },
    { campaignIds: Array.from({ length: 101 }, (_, id) => String(id)) }, { accountId: "123/path" },
    { siteId: "unknown" }, { sourcePath: "/unknown" }, { sourcePath: "https://example.test" }, { sourcePath: "//example.test" }]) {
    await assert.rejects(saveFacebookCampaignMatches({ ...selection, ...override }, options));
  }
  await assert.rejects(deleteFacebookCampaignMatch("123", "bad", options));
  assert.equal(options.writes(), 0);
});

test("Facebook storage failures are surfaced instead of reporting a saved link", async () => {
  const options = fixture();
  const broken = { ...options, store: { ...options.store, async write() { throw new Error("Unavailable"); } } };
  await assert.rejects(saveFacebookCampaignMatches({ siteId: "site", accountId: "123", campaignIds: ["1"], sourcePath: "/project" }, broken), /Unavailable/);
  await assert.rejects(deleteFacebookCampaignMatch("123", "1", broken), /Unavailable/);
});


test("Facebook account selection reads every accessible account by name, deduplicating paginated IDs", async () => {
  const urls: URL[] = [];
  const accounts = await listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret", META_ADS_AUTO_DISCOVERY: "false" },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input)); urls.push(url);
      assert.equal(url.hostname, "graph.facebook.com");
      assert.match(url.pathname, /\/me\/adaccounts$/);
      assert.equal(url.searchParams.get("fields"), "id,name,account_status");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret");
      assert.equal(init?.redirect, "error");
      return Response.json(url.searchParams.has("after") ? { data: [
        { id: "act_123", name: " Zeta ", account_status: 1 }, { id: "act_456", name: "Alpha", account_status: 2 },
        { id: "act_789", name: " ", account_status: 1 }
      ] } : { data: [{ id: "act_123", name: "Zeta", account_status: 1 }],
        paging: { next: "https://untrusted.example/?access_token=secret", cursors: { after: "page-two" } } });
    }
  });
  assert.deepEqual(accounts, [
    { id: "456", name: "Alpha", status: 2 }, { id: "789", name: "Facebook-account 789", status: 1 }, { id: "123", name: "Zeta", status: 1 }
  ]);
  assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get("after"), "page-two");
});

test("an accessible Facebook account list can be empty without fabricating saved or discovered accounts", async () => {
  assert.deepEqual(await listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret" },
    fetchImpl: async () => Response.json({ data: [] }) }), []);
});

test("Facebook account loading rejects missing credentials and invalid versions before fetching", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async () => { requests++; return Response.json({ data: [] }); };
  await assert.rejects(listFacebookAdAccounts({ env: {}, fetchImpl }));
  await assert.rejects(listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret", META_ADS_API_VERSION: "invalid" }, fetchImpl }));
  assert.equal(requests, 0);
});

test("malformed or incomplete Facebook account lists cannot appear as selectable accounts", async () => {
  for (const payload of [
    { error: { message: "private" } }, { data: [{ id: "bad", name: "Alpha", account_status: 1 }] },
    { data: [{ id: "act_123", name: "Alpha" }] }, { data: [], paging: { next: "next" } }
  ]) await assert.rejects(listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret" }, fetchImpl: async () => Response.json(payload) }));
  let requests = 0;
  await assert.rejects(listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret" },
    fetchImpl: async () => { requests++; return Response.json({ data: [], paging: { next: "next", cursors: { after: "repeat" } } }); }
  }), /Incomplete Facebook/);
  assert.equal(requests, 2);
});

test("a failure on a Facebook account continuation page never returns a partial account list", async () => {
  let requests = 0;
  await assert.rejects(listFacebookAdAccounts({ env: { META_ADS_ACCESS_TOKEN: "secret" }, fetchImpl: async () => {
    requests++;
    return requests === 1 ? Response.json({ data: [{ id: "act_123", name: "Alpha", account_status: 1 }],
      paging: { next: "next", cursors: { after: "second" } } }) : new Response("private provider error", { status: 403 });
  } }), /Facebook Ads request failed/);
  assert.equal(requests, 2);
});

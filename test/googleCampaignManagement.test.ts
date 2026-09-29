import test from "node:test";
import assert from "node:assert/strict";
import { listGoogleCampaigns, saveGoogleCampaignMatches } from "../src/googleCampaignManagement.js";
import { CAMPAIGN_PROJECT_MATCHES_KEY, type CampaignProjectMatch } from "../src/campaignProjects.js";

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
  const pages = { cvrPageCandidates: [{ siteId: "immogra", path: "/groene-wandeling" }], cvrLinks: [] };
  const matches = await saveGoogleCampaignMatches({ siteId: "immogra", accountId: "123", campaignIds: ["1", "2", "3"], sourcePath: "/groene-wandeling/" }, { store, pages });
  assert.equal(writes, 1);
  assert.deepEqual(matches.map((match) => match.campaignId), ["1", "2", "3"]);
  assert.deepEqual(saved.filter((match) => match.channel === "google").map((match) => [match.campaignId, match.sourcePaths[0]]),
    [["1", "/groene-wandeling"], ["2", "/groene-wandeling"], ["3", "/groene-wandeling"]]);
  assert.deepEqual(saved.find((match) => match.channel === "facebook")?.sourcePaths, ["/other"]);

  await assert.rejects(saveGoogleCampaignMatches({ siteId: "immogra", accountId: "123", campaignIds: ["4"], sourcePath: "/missing" }, { store, pages }));
  assert.equal(writes, 1);
});

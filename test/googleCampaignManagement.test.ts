import test from "node:test";
import assert from "node:assert/strict";
import { listGoogleCampaigns } from "../src/googleCampaignManagement.js";

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

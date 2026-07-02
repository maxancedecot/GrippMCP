import test from "node:test";
import assert from "node:assert/strict";
import { createGhlLocationToken, getGhlInstallUrl } from "../src/ghl/oauth.js";
import { saveGhlTokenRecord } from "../src/ghl/tokenStore.js";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("getGhlInstallUrl rewrites stale redirect_uri to this deployment callback", () => {
  process.env.GHL_INSTALL_URL =
    "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation?client_id=test-client&redirect_uri=https%3A%2F%2Fold.example%2Fcallback";
  delete process.env.GHL_REDIRECT_URI;

  const url = new URL(getGhlInstallUrl("https://gripp-mcp-two.vercel.app/api/connect/start"));

  assert.equal(url.searchParams.get("redirect_uri"), "https://gripp-mcp-two.vercel.app/api/connect/callback");
  assert.equal(url.searchParams.get("client_id"), "test-client");
});

test("getGhlInstallUrl prefers explicit GHL_REDIRECT_URI", () => {
  process.env.GHL_INSTALL_URL =
    "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation?client_id=test-client&redirect_uri=https%3A%2F%2Fold.example%2Fcallback";
  process.env.GHL_REDIRECT_URI = "https://custom.example/api/connect/callback";

  const url = new URL(getGhlInstallUrl("https://gripp-mcp-two.vercel.app/api/connect/start"));

  assert.equal(url.searchParams.get("redirect_uri"), "https://custom.example/api/connect/callback");
});

test("createGhlLocationToken stores a location token from a company token", async () => {
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "3".repeat(64);

  const originalFetch = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        access_token: "location-access",
        refresh_token: "location-refresh",
        token_type: "Bearer",
        expires_in: 86400,
        userType: "Location",
        companyId: "company_123",
        locationId: "location_123",
        userId: "user_123"
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    await saveGhlTokenRecord({
      installId: "company_123",
      accessToken: "agency-access",
      refreshToken: "agency-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 86_400_000,
      userType: "Company",
      companyId: "company_123",
      userId: "user_123",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const record = await createGhlLocationToken("company_123", "location_123");

    assert.equal(record.installId, "location_123");
    assert.equal(record.userType, "Location");
    assert.equal(record.accessToken, "location-access");
    assert.match((calls[0] as { url: string }).url, /oauth\/locationToken$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

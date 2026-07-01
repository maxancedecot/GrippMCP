import test from "node:test";
import assert from "node:assert/strict";
import { getGhlInstallUrl } from "../src/ghl/oauth.js";

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

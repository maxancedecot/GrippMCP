import test from "node:test";
import assert from "node:assert/strict";
import { checkMcpAccessKey } from "../src/accessControl.js";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("checkMcpAccessKey allows local development when no access key is configured", () => {
  delete process.env.MCP_ACCESS_KEY;
  delete process.env.VERCEL;
  process.env.NODE_ENV = "test";

  assert.deepEqual(checkMcpAccessKey(undefined), { ok: true });
});

test("checkMcpAccessKey fails closed on Vercel when no access key is configured", () => {
  delete process.env.MCP_ACCESS_KEY;
  process.env.VERCEL = "1";

  assert.deepEqual(checkMcpAccessKey(undefined), {
    ok: false,
    statusCode: 500,
    code: "missing_mcp_access_key",
    message: "Set MCP_ACCESS_KEY in the Vercel project environment before exposing this MCP endpoint."
  });
});

test("checkMcpAccessKey rejects missing and invalid access keys", () => {
  process.env.MCP_ACCESS_KEY = "expected-secret";

  assert.equal(checkMcpAccessKey(undefined).ok, false);
  assert.equal(checkMcpAccessKey("wrong-secret").ok, false);
});

test("checkMcpAccessKey accepts the configured access key", () => {
  process.env.MCP_ACCESS_KEY = "expected-secret";

  assert.deepEqual(checkMcpAccessKey("expected-secret"), { ok: true });
});

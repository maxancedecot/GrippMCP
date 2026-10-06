import test from "node:test";
import assert from "node:assert/strict";
import { GrippMcpError } from "../src/errors.js";
import { validateGhlCall } from "../src/ghl/client.js";

test("validateGhlCall allows relative GET requests without confirmation", () => {
  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "GET",
      path: "/contacts/abc123"
    })
  );
});

test("validateGhlCall rejects absolute or protocol-relative paths", () => {
  assert.throws(
    () =>
      validateGhlCall({
        method: "GET",
        path: "https://example.com/contacts"
      }),
    GrippMcpError
  );

  assert.throws(
    () =>
      validateGhlCall({
        method: "GET",
        path: "//example.com/contacts"
      }),
    GrippMcpError
  );
});

test("validateGhlCall requires confirmation for writes", () => {
  assert.throws(
    () =>
      validateGhlCall({
        method: "POST",
        path: "/contacts/",
        body: { firstName: "Ada" }
      }),
    GrippMcpError
  );

  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "POST",
      path: "/contacts/",
      body: { firstName: "Ada" },
      confirm: true
    })
  );
});

test("validateGhlCall allows explicitly read-only POST wrappers", () => {
  assert.doesNotThrow(() =>
    validateGhlCall({
      method: "POST",
      path: "/contacts/search",
      body: { locationId: "loc_123" },
      readOnly: true
    })
  );
});

test("GhlClient retries only reads after 429 and keeps request headers and bodies intact", async () => {
  const { GhlClient } = await import("../src/ghl/client.js");
  const { saveGhlTokenRecord } = await import("../src/ghl/tokenStore.js");
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    for (const name of ["VERCEL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[name];
    Object.assign(process.env, { NODE_ENV: "test", GHL_TOKEN_ENCRYPTION_KEY: "7".repeat(64) });
    for (const [method, readOnly, retryable] of [["GET", false, true], ["POST", true, true], ["POST", false, false], ["PUT", false, false]] as const) {
      const installId = `retry-${method}-${readOnly}`;
      await saveGhlTokenRecord({ installId, locationId: installId, accessToken: "test-access", refreshToken: "test-refresh",
        tokenType: "Bearer", expiresAt: Date.now() + 86400000, createdAt: Date.now(), updatedAt: Date.now() });
      const requests: RequestInit[] = [];
      globalThis.fetch = (async (_url, init) => {
        requests.push(init!);
        return requests.length === 1 ? Response.json({ message: "limited" }, { status: 429, headers: { "Retry-After": "0" } })
          : Response.json({ result: "recovered" });
      }) as typeof fetch;
      const input = { method, path: method === "GET" ? "/contacts/one" : "/contacts/search", readOnly, confirm: true,
        apiVersion: "v3", body: method === "GET" ? undefined : { locationId: installId } };
      const operation = new GhlClient(installId).call(input);
      if (retryable) assert.deepEqual(await operation, { result: "recovered" });
      else await assert.rejects(operation, (error: unknown) => error instanceof GrippMcpError && (error.details as { status: number }).status === 429);
      assert.equal(requests.length, retryable ? 2 : 1);
      for (const request of requests) {
        assert.equal(request.method, method); assert.equal(request.cache, "no-store");
        assert.equal((request.headers as Record<string, string>).Version, "v3");
        assert.equal((request.headers as Record<string, string>).Authorization, "Bearer test-access");
        assert.equal(request.body, input.body === undefined ? undefined : JSON.stringify(input.body));
      }
    }
  } finally { process.env = originalEnv; globalThis.fetch = originalFetch; }
});

import test from "node:test";
import assert from "node:assert/strict";
import { deleteJsonCache, getJsonCacheMode, readJsonCache, readJsonCaches, writeJsonCache } from "../src/jsonCache.js";

test("JSON cache stores values in memory mode", async (t) => {
  const previousStore = process.env.JSON_CACHE_STORE;
  process.env.JSON_CACHE_STORE = "memory";
  t.after(() => {
    if (previousStore === undefined) {
      delete process.env.JSON_CACHE_STORE;
    } else {
      process.env.JSON_CACHE_STORE = previousStore;
    }
  });

  const key = `test:${Date.now()}:memory`;
  const value = { ok: true, count: 3, nested: { label: "cache" } };

  assert.equal(getJsonCacheMode(), "memory");
  await writeJsonCache(key, value);
  assert.deepEqual(await readJsonCache<typeof value>(key), value);
  assert.deepEqual(await readJsonCaches([`${key}:missing`, key]), [null, value]);

  await deleteJsonCache(key);
  assert.equal(await readJsonCache(key), null);
});

test("batched persistent reads preserve missing entries and reject incomplete responses", async (t) => {
  const keys = ["JSON_CACHE_STORE", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  delete process.env.JSON_CACHE_STORE;
  process.env.KV_REST_API_URL = "https://cache.example.test";
  process.env.KV_REST_API_TOKEN = "test-only";
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  });
  let result: (string | null)[] = ['{"managerId":2}', null];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.cache, "no-store", "Persistent reads must always request the latest stored values");
    assert.deepEqual(JSON.parse(String(init?.body)), ["MGET", "client:1", "client:2"]);
    return new Response(JSON.stringify({ result }));
  };
  assert.deepEqual(await readJsonCaches(["client:1", "client:2"]), [{ managerId: 2 }, null]);
  assert.equal(calls, 1);
  result = ['{"managerId":3}', null];
  assert.deepEqual(await readJsonCaches(["client:1", "client:2"]), [{ managerId: 3 }, null]);
  assert.equal(calls, 2);
  result = [null];
  await assert.rejects(readJsonCaches(["client:1", "client:2"]), /Incomplete cache response/);
});

test("persistent cache errors include the provider response", async (t) => {
  const keys = ["JSON_CACHE_STORE", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  delete process.env.JSON_CACHE_STORE;
  process.env.KV_REST_API_URL = "https://cache.example.test";
  process.env.KV_REST_API_TOKEN = "test-only";
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  });
  globalThis.fetch = async () => new Response("request body is too large", { status: 400, statusText: "Bad Request" });

  await assert.rejects(writeJsonCache("oversized", { value: "x" }), /KV command failed \(400\): request body is too large/);
});


test("long-period cache reads use bounded batches and preserve missing values, duplicates and ordering", async (t) => {
  const envKeys = ["JSON_CACHE_STORE", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
  const previous = envKeys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  delete process.env.JSON_CACHE_STORE;
  process.env.KV_REST_API_URL = "https://cache.example.test";
  process.env.KV_REST_API_TOKEN = "test-only";
  t.after(() => {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  });
  const keys = Array.from({ length: 600 }, (_, index) => index % 13 === 0 ? "missing" : `daily:${index % 333}`);
  const expected = keys.map((key) => key === "missing" ? null : { key });
  let calls = 0, incomplete = false;
  globalThis.fetch = async (_url, init) => {
    const [command, ...batch] = JSON.parse(String(init?.body)) as string[];
    assert.equal(command, "MGET");
    assert.ok(batch.length <= 256);
    assert.equal(init?.cache, "no-store");
    calls++;
    const result = batch.map((key) => key === "missing" ? null : JSON.stringify({ key }));
    if (incomplete && calls === 2) result.pop();
    return Response.json({ result });
  };
  assert.deepEqual(await readJsonCaches(keys), expected);
  assert.equal(calls, 3);
  calls = 0; incomplete = true;
  await assert.rejects(readJsonCaches(keys), /Incomplete cache response/);
  assert.equal(calls, 2, "An incomplete later batch must stop the read without returning partial data");
  calls = 0;
  assert.deepEqual(await readJsonCaches([]), []);
  assert.equal(calls, 0);
});

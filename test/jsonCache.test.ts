import test from "node:test";
import assert from "node:assert/strict";
import { deleteJsonCache, getJsonCacheMode, readJsonCache, writeJsonCache } from "../src/jsonCache.js";

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

  await deleteJsonCache(key);
  assert.equal(await readJsonCache(key), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createGhlRequestQueue } from "../src/ghl/requestQueue.js";
import { GrippMcpError } from "../src/errors.js";

function clock() {
  let time = 0;
  const waits: number[] = [];
  return { now: () => time, waits, sleep: async (ms: number) => { waits.push(ms); time += ms; } };
}
const ok = () => Response.json({ contact: { tags: ["ledoux", "brochure"] } });
const limited = (headers: Record<string, string> = {}) => Response.json({ message: "private-provider-body" }, { status: 429, headers });

test("429 reads wait for Retry-After and return the recovered contact response", async () => {
  const time = clock(), queue = createGhlRequestQueue(time);
  let calls = 0;
  const result = await queue("location", async () => ++calls === 1 ? limited({ "Retry-After": "2" }) : ok(), true);
  assert.equal(result.status, 200); assert.equal(calls, 2); assert.deepEqual(time.waits, [2000]);
  assert.deepEqual(await result.json(), { contact: { tags: ["ledoux", "brochure"] } });
});

test("Retry-After HTTP dates and API interval headers determine the retry delay", async () => {
  for (const [headers, delay] of [
    [{ "Retry-After": new Date(5000).toUTCString() }, 5000],
    [{ "x-ratelimit-interval-milliseconds": "7000" }, 7000],
    [{ "Retry-After": "invalid", "x-ratelimit-interval-milliseconds": "" }, 10000]
  ] as [Record<string, string>, number][]) {
    const time = clock(), queue = createGhlRequestQueue(time); let calls = 0;
    await queue("location", async () => ++calls === 1 ? limited(headers) : ok(), true);
    assert.deepEqual(time.waits, [delay]);
  }
});

test("persistent 429 stops after two retries with fallback backoff and preserves the final error response", async () => {
  const time = clock(), queue = createGhlRequestQueue(time); let calls = 0;
  const result = await queue("location", async () => { calls++; return limited(); }, true);
  assert.equal(result.status, 429); assert.equal(calls, 3); assert.deepEqual(time.waits, [10000, 20000]);
  assert.deepEqual(await result.json(), { message: "private-provider-body" });
});

test("unsafe writes, daily limits and excessive Retry-After delays are not retried", async () => {
  for (const [headers, retryable] of [[{}, false], [{ "x-ratelimit-daily-remaining": "0" }, true], [{ "Retry-After": "86400" }, true]] as [Record<string, string>, boolean][]) {
    const time = clock(), queue = createGhlRequestQueue(time); let calls = 0;
    const result = await queue("location", async () => { calls++; return limited(headers); }, retryable);
    assert.equal(result.status, 429); assert.equal(calls, 1); assert.deepEqual(time.waits, []);
    if (headers["x-ratelimit-daily-remaining"] === "0") {
      await assert.rejects(queue("location", async () => { calls++; return ok(); }, true), (error: unknown) =>
        error instanceof GrippMcpError && JSON.stringify(error.details) === JSON.stringify({ status: 429, rateLimit: "daily" }));
      assert.equal(calls, 1);
    }
  }
});

test("different callers share the rolling 80-request limit for one resource", async () => {
  const time = clock(), queue = createGhlRequestQueue(time), starts: number[] = [];
  for (let index = 0; index < 165; index++) {
    await queue("shared-location", async () => { starts.push(time.now()); return ok(); }, true);
  }
  assert.deepEqual(time.waits, [10000, 10000]);
  for (const start of starts) assert.ok(starts.filter((other) => other > start - 10000 && other <= start).length <= 80);
});

test("lower provider limits and exhausted burst headers throttle the next read", async () => {
  const time = clock(), queue = createGhlRequestQueue(time), starts: number[] = [];
  for (let index = 0; index < 5; index++) await queue("location", async () => {
    starts.push(time.now()); return Response.json({}, { headers: { "x-ratelimit-max": "5", "x-ratelimit-interval-milliseconds": "2000" } });
  }, true);
  assert.deepEqual(starts, [0, 0, 0, 0, 2000]);
  await queue("location", async () => Response.json({}, { headers: { "x-ratelimit-remaining": "0" } }), true);
  await queue("location", async () => { starts.push(time.now()); return ok(); }, true);
  assert.equal(starts.at(-1), 4000);
});

test("one location has at most four active requests while another location can proceed independently", async () => {
  const time = clock(), queue = createGhlRequestQueue(time);
  const releases: (() => void)[] = []; let active = 0, peak = 0;
  const pending = Array.from({ length: 8 }, () => queue("location-a", async () => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve)); active--; return ok();
  }, true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 4);
  assert.equal((await queue("location-b", async () => ok(), true)).status, 200);
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(active, 4);
  for (const release of releases.splice(0)) release();
  await Promise.all(pending); assert.equal(peak, 4);
});

test("a network failure releases the resource queue without retrying an unknown outcome", async () => {
  const queue = createGhlRequestQueue(clock()); let calls = 0;
  await assert.rejects(queue("location", async () => { calls++; throw new Error("network"); }, true), /network/);
  assert.equal(calls, 1); assert.equal((await queue("location", async () => ok(), true)).status, 200);
});

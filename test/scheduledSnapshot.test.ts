import test from "node:test";
import assert from "node:assert/strict";
import { loadScheduledSnapshot, shouldRefreshSnapshot } from "../src/scheduledSnapshot.js";

test("scheduled snapshots refresh at most hourly on Brussels workdays from 08:00 until 19:00", () => {
  const friday = "2026-09-18T08:00:00.000Z";
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-18T08:59:59.000Z")), false);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-18T09:00:00.000Z")), true);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-18T16:59:59.000Z")), true);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-18T17:00:00.000Z")), false);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-19T10:00:00.000Z")), false);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-21T05:59:59.000Z")), false);
  assert.equal(shouldRefreshSnapshot(friday, new Date("2026-09-21T06:00:00.000Z")), true);
});

test("scheduled snapshots reuse cached data and let only the lease owner refresh", async () => {
  let stored: unknown = { refreshedAt: "2026-09-21T06:00:00.000Z", data: { value: 1 } };
  let loads = 0;
  const store = {
    read: async <T>() => stored as T,
    write: async (_key: string, value: unknown) => { stored = value; },
    claim: async () => false
  };
  const cached = await loadScheduledSnapshot({ key: "test", now: new Date("2026-09-21T08:00:00.000Z"), store,
    load: async () => ({ value: ++loads }) });
  assert.deepEqual(cached.data, { value: 1 });
  assert.equal(loads, 0);

  const refreshed = await loadScheduledSnapshot({ key: "test", now: new Date("2026-09-21T08:00:00.000Z"),
    store: { ...store, claim: async () => true }, load: async () => ({ value: ++loads }) });
  assert.deepEqual(refreshed.data, { value: 1 });
  assert.equal(loads, 1);
});

test("scheduled snapshots serve stale data when a refresh fails", async () => {
  const cached = { refreshedAt: "2026-09-18T08:00:00.000Z", data: { value: 7 } };
  const result = await loadScheduledSnapshot({ key: "test", now: new Date("2026-09-21T08:00:00.000Z"),
    store: { read: async <T>() => cached as T, write: async () => undefined, claim: async () => true },
    load: async () => { throw new Error("provider unavailable"); } });
  assert.deepEqual(result, cached);
});

test("transient snapshots retry after one minute outside work hours with a separate short lease", async () => {
  const cached = { refreshedAt: "2026-09-19T20:00:00.000Z", data: { retry: true } };
  const claims: [string, number][] = []; let loads = 0;
  const options = { key: "crm", retryWhen: (data: { retry: boolean }) => data.retry,
    store: { read: async <T>() => cached as T, write: async () => undefined,
      claim: async (key: string, ttl: number) => { claims.push([key, ttl]); return true; } },
    load: async () => { loads++; return { retry: false }; } };
  assert.deepEqual(await loadScheduledSnapshot({ ...options, now: new Date("2026-09-19T20:00:59.000Z") }), cached);
  assert.equal(loads, 0);
  const result = await loadScheduledSnapshot({ ...options, now: new Date("2026-09-19T20:01:00.000Z") });
  assert.deepEqual(result.data, { retry: false }); assert.equal(loads, 1);
  assert.deepEqual(claims, [["crm:retry:2026-09-19T20:00:00.000Z", 60000]]);
});

test("transient retry leases prevent concurrent loads; successful snapshots keep the ordinary schedule", async () => {
  for (const retry of [true, false]) {
    const cached = { refreshedAt: "2026-09-19T20:00:00.000Z", data: { retry } }; let loads = 0, claims = 0;
    const result = await loadScheduledSnapshot({ key: "crm", now: new Date("2026-09-19T20:02:00.000Z"), retryWhen: (data: { retry: boolean }) => data.retry,
      store: { read: async <T>() => cached as T, write: async () => undefined, claim: async () => { claims++; return false; } },
      load: async () => { loads++; return { retry: false }; } });
    assert.deepEqual(result, cached); assert.equal(loads, 0); assert.equal(claims, retry ? 1 : 0);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadBackgroundSnapshot, readSnapshotRefreshStatus, snapshotRefreshId, type BackgroundSnapshotStore } from "../src/backgroundSnapshot.js";
import { claimJsonCacheLease, releaseJsonCacheLease } from "../src/jsonCache.js";

const now = new Date("2026-10-06T10:00:00Z");
const old = { refreshedAt: "2026-10-06T08:00:00.000Z", data: { value: 7 } };
function fixture(initial: unknown = old) {
  const values = new Map<string, unknown>(initial === null ? [] : [["dashboard", initial]]);
  const leases = new Set<string>();
  const jobs: (() => Promise<void>)[] = [];
  const store: BackgroundSnapshotStore = {
    read: async <T>(key: string) => values.get(key) as T ?? null,
    write: async (key, value) => { values.set(key, structuredClone(value)); },
    claim: async (key) => { if (leases.has(key)) return false; leases.add(key); return true; },
    release: async (key) => { leases.delete(key); }
  };
  return { values, leases, jobs, store, schedule: (work: () => Promise<void>) => { jobs.push(work); } };
}

test("stale snapshots return saved figures without starting provider work before the response", async () => {
  const f = fixture(); let loads = 0;
  const options = { key: "dashboard", now, ...f, load: async () => ({ value: ++loads }), clock: () => new Date("2026-10-06T10:00:12Z") };
  const result = await loadBackgroundSnapshot(options);
  assert.deepEqual(result.data, old.data); assert.equal(result.refreshedAt, old.refreshedAt);
  assert.equal(result.refreshing, true); assert.equal(loads, 0); assert.equal(f.jobs.length, 1);
  const concurrent = await loadBackgroundSnapshot({ ...options, force: true });
  assert.equal(concurrent.refreshing, true); assert.equal(f.jobs.length, 1);
  await f.jobs[0]!();
  assert.equal(loads, 1); assert.equal(f.leases.size, 0);
  assert.deepEqual(f.values.get("dashboard"), { data: { value: 1 }, refreshedAt: "2026-10-06T10:00:12.000Z" });
  const status = await readSnapshotRefreshStatus(result.refreshId, f.store, now);
  assert.equal(status?.state, "complete"); assert.equal(status?.refreshedAt, "2026-10-06T10:00:12.000Z");
  const updated = await loadBackgroundSnapshot(options);
  assert.equal(updated.refreshing, false); assert.equal(updated.data.value, 1); assert.equal(f.jobs.length, 1);
});

test("refresh failures preserve figures and back off from the failure time", async () => {
  const f = fixture(); let loads = 0;
  const failedAt = new Date("2026-10-06T10:03:00Z");
  const options = { key: "dashboard", now, ...f, force: true, clock: () => failedAt,
    load: async () => { loads++; throw new Error("CRM down"); } };
  const result = await loadBackgroundSnapshot(options); await f.jobs[0]!();
  assert.deepEqual(f.values.get("dashboard"), old); assert.equal(f.leases.size, 0);
  assert.equal((await readSnapshotRefreshStatus(result.refreshId, f.store, failedAt))?.state, "failed");
  const retry = await loadBackgroundSnapshot({ ...options, now: new Date("2026-10-06T10:03:59Z") });
  assert.equal(retry.refreshing, false); assert.equal(retry.refreshFailed, true); assert.equal(f.jobs.length, 1); assert.equal(loads, 1);
  await loadBackgroundSnapshot({ ...options, now: new Date("2026-10-06T10:04:00Z") });
  assert.equal(f.jobs.length, 2);
});

test("cold snapshots wait for complete data and save the completion timestamp", async () => {
  const f = fixture(null); let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  let settled = false;
  const work = loadBackgroundSnapshot({ key: "dashboard", now, ...f, load: async () => { await gate; return { value: 8 }; }, clock: () => new Date("2026-10-06T10:00:20Z") });
  void work.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(f.jobs.length, 0);
  unblock(); const result = await work;
  assert.equal(result.refreshing, false); assert.equal(result.data.value, 8);
  assert.equal(result.refreshedAt, "2026-10-06T10:00:20.000Z");
});

test("cold concurrent requests share the lease and wait for the first snapshot", async () => {
  const f = fixture(null); let loads = 0; let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const options = { key: "dashboard", now, ...f, load: async () => { loads++; await gate; return { value: 3 }; }, clock: () => now };
  const first = loadBackgroundSnapshot(options);
  await new Promise((resolve) => setImmediate(resolve));
  const second = loadBackgroundSnapshot({ ...options, sleep: async () => { unblock(); await first; } });
  assert.equal((await second).data.value, 3); assert.equal(loads, 1);
});

test("off-hours snapshots stay cached while explicit updates and transient retries refresh", async () => {
  const weekend = new Date("2026-10-10T20:00:00Z"); const f = fixture();
  const options = { key: "dashboard", now: weekend, ...f, load: async () => ({ value: 9 }), clock: () => weekend };
  assert.equal((await loadBackgroundSnapshot(options)).refreshing, false); assert.equal(f.jobs.length, 0);
  assert.equal((await loadBackgroundSnapshot({ ...options, retryWhen: () => true })).refreshing, true);
  await f.jobs[0]!();
  assert.equal((await loadBackgroundSnapshot({ ...options, force: true })).refreshing, true); assert.equal(f.jobs.length, 2);
});

test("expired refreshes report failure; invalid status IDs never read storage", async () => {
  const f = fixture(); const id = snapshotRefreshId("dashboard");
  f.values.set(`dashboard-refresh:v1:${id}`, { state: "refreshing", startedAt: "2026-10-06T08:00:00Z", expiresAt: "2026-10-06T08:06:00Z" });
  assert.equal((await readSnapshotRefreshStatus(id, f.store, now))?.state, "failed");
  assert.equal(await readSnapshotRefreshStatus("dashboard", { ...f.store, read: async () => { throw new Error("must not read"); } }), null);
});

test("scheduling and lease errors preserve existing snapshots", async () => {
  const f = fixture(); const options = { key: "dashboard", now, ...f, load: async () => ({ value: 9 }), clock: () => now };
  const noLease = await loadBackgroundSnapshot({ ...options, store: { ...f.store, claim: async () => { throw new Error("storage unavailable"); } } });
  assert.deepEqual(noLease.data, old.data); assert.equal(noLease.refreshing, false); assert.equal(noLease.refreshFailed, true);
  const noSchedule = await loadBackgroundSnapshot({ ...options, schedule: () => { throw new Error("not supported"); } });
  assert.deepEqual(noSchedule.data, old.data); assert.equal(noSchedule.refreshing, false); assert.equal(f.leases.size, 0);
});

test("releasing non-Redis leases permits another immediate update", async () => {
  const before = process.env.JSON_CACHE_STORE; process.env.JSON_CACHE_STORE = "memory";
  try {
    assert.equal(await claimJsonCacheLease("background-test", 360000), true);
    assert.equal(await claimJsonCacheLease("background-test", 360000), false);
    await releaseJsonCacheLease("background-test");
    assert.equal(await claimJsonCacheLease("background-test", 360000), true);
  } finally { await releaseJsonCacheLease("background-test"); if (before === undefined) delete process.env.JSON_CACHE_STORE; else process.env.JSON_CACHE_STORE = before; }
});

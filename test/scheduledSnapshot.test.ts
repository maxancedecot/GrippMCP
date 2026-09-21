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

import { createHash } from "node:crypto";
import { z } from "zod";
import { claimJsonCacheLease, releaseJsonCacheLease, readJsonCache, writeJsonCache } from "./jsonCache.js";
import { shouldRefreshSnapshot } from "./scheduledSnapshot.js";

const LEASE_MS = 6 * 60_000;
const RETRY_MS = 60_000;
type Snapshot<T> = { refreshedAt: string; data: T };
export type BackgroundSnapshotStore = {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  claim(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
};
const defaultStore: BackgroundSnapshotStore = { read: readJsonCache, write: writeJsonCache, claim: claimJsonCacheLease, release: releaseJsonCacheLease };
const statusSchema = z.object({
  state: z.enum(["refreshing", "complete", "failed"]),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  refreshedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional()
});
export type BackgroundRefreshStatus = z.infer<typeof statusSchema>;
export function snapshotRefreshId(key: string) { return createHash("sha256").update(key).digest("hex"); }
const statusKey = (id: string) => `dashboard-refresh:v1:${id}`;

export async function readSnapshotRefreshStatus(id: string, store = defaultStore, now = new Date()): Promise<BackgroundRefreshStatus | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const parsed = statusSchema.safeParse(await store.read(statusKey(id)));
  if (!parsed.success) return null;
  if (parsed.data.state === "refreshing" && Date.parse(parsed.data.expiresAt) <= now.getTime()) return { ...parsed.data, state: "failed" };
  return parsed.data;
}

export async function loadBackgroundSnapshot<T>({ key, force = false, now = new Date(), load, schedule, retryWhen, store = defaultStore,
  clock = () => new Date(), sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: {
  key: string; force?: boolean; now?: Date; load: () => Promise<T>;
  schedule: (work: () => Promise<void>) => void;
  retryWhen?: (data: T) => boolean;
  store?: BackgroundSnapshotStore; clock?: () => Date; sleep?: (ms: number) => Promise<void>;
}): Promise<Snapshot<T> & { refreshId: string; refreshing: boolean; refreshFailed?: boolean }> {
  const raw = await store.read<Snapshot<T>>(key);
  const cached = raw && typeof raw.refreshedAt === "string" && Number.isFinite(Date.parse(raw.refreshedAt)) && "data" in raw ? raw : null;
  const refreshId = snapshotRefreshId(key);
  const status = await readSnapshotRefreshStatus(refreshId, store, now).catch(() => null);
  const active = status?.state === "refreshing";
  const due = cached && (retryWhen?.(cached.data)
    ? now.getTime() - Date.parse(cached.refreshedAt) >= RETRY_MS : shouldRefreshSnapshot(cached.refreshedAt, now));
  if (cached && (active || (!force && !due))) return { ...cached, refreshId, refreshing: active, refreshFailed: status?.state === "failed" };
  // Briefly back off after failures, including repeated requests to a forced URL.
  if (cached && status?.state === "failed" && now.getTime() - Date.parse(status.finishedAt ?? status.expiresAt) < RETRY_MS) {
    return { ...cached, refreshId, refreshing: false, refreshFailed: true };
  }
  const leaseKey = `${key}:background-refresh`;
  let claimed: boolean;
  try { claimed = await store.claim(leaseKey, LEASE_MS); }
  catch (error) { if (cached) return { ...cached, refreshId, refreshing: false, refreshFailed: true }; throw error; }
  if (!claimed) {
    if (cached) return { ...cached, refreshId, refreshing: true };
    // Another server is producing the first snapshot; do not duplicate its CRM work.
    for (let attempt = 0; attempt < 240; attempt++) {
      await sleep(1000);
      const result = await store.read<Snapshot<T>>(key);
      if (result && typeof result.refreshedAt === "string" && Number.isFinite(Date.parse(result.refreshedAt)) && "data" in result) {
        return { ...result, refreshId, refreshing: false };
      }
      const pending = await readSnapshotRefreshStatus(refreshId, store, clock());
      if (pending?.state === "failed") throw new Error("Dashboard refresh failed");
    }
    throw new Error("Dashboard refresh is still running");
  }
  const progress: BackgroundRefreshStatus = { state: "refreshing", startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + LEASE_MS).toISOString() };
  try { await store.write(statusKey(refreshId), progress); }
  catch (error) { await store.release(leaseKey).catch(() => undefined); if (cached) return { ...cached, refreshId, refreshing: false, refreshFailed: true }; throw error; }
  async function refresh(): Promise<Snapshot<T>> {
    try {
      const data = await load();
      const snapshot = { refreshedAt: clock().toISOString(), data };
      await store.write(key, snapshot);
      await store.write(statusKey(refreshId), { ...progress, state: "complete", refreshedAt: snapshot.refreshedAt, finishedAt: snapshot.refreshedAt });
      return snapshot;
    } catch (error) {
      await store.write(statusKey(refreshId), { ...progress, state: "failed", finishedAt: clock().toISOString() }).catch(() => undefined);
      throw error;
    } finally { await store.release(leaseKey).catch(() => undefined); }
  }
  if (!cached) return { ...await refresh(), refreshId, refreshing: false };
  try {
    schedule(async () => { await refresh().catch(() => undefined); });
  } catch {
    await store.write(statusKey(refreshId), { ...progress, state: "failed", finishedAt: clock().toISOString() }).catch(() => undefined);
    await store.release(leaseKey).catch(() => undefined);
    return { ...cached, refreshId, refreshing: false, refreshFailed: true };
  }
  return { ...cached, refreshId, refreshing: true };
}

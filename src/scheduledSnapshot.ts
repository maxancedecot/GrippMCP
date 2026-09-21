import { claimJsonCacheLease, readJsonCache, writeJsonCache } from "./jsonCache.js";

const HOUR_MS = 60 * 60_000;
const REFRESH_START_HOUR = 8;
const REFRESH_END_HOUR = 19;
const REFRESH_LEASE_MS = HOUR_MS;
const brusselsClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23"
});

type Snapshot<T> = { refreshedAt: string; data: T };
type SnapshotStore = {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  claim(key: string, ttlMs: number): Promise<boolean>;
};

const defaultStore: SnapshotStore = {
  read: readJsonCache,
  write: writeJsonCache,
  claim: claimJsonCacheLease
};

export async function loadScheduledSnapshot<T>({ key, now = new Date(), force = false, load, store = defaultStore }: {
  key: string;
  now?: Date;
  force?: boolean;
  load: () => Promise<T>;
  store?: SnapshotStore;
}): Promise<Snapshot<T>> {
  const cached = snapshotFrom(await store.read<unknown>(key)) as Snapshot<T> | null;
  if (!force && cached && !shouldRefreshSnapshot(cached.refreshedAt, now)) return cached;

  let claimed = force;
  if (!force) {
    try {
      claimed = await store.claim(`${key}:refresh`, REFRESH_LEASE_MS);
    } catch {
      if (cached) return cached;
      claimed = true;
    }
  }
  if (!claimed && cached) return cached;

  let data: T;
  try {
    data = await load();
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
  const snapshot = { refreshedAt: now.toISOString(), data };
  await store.write(key, snapshot);
  return snapshot;
}

export function shouldRefreshSnapshot(refreshedAt: string, now: Date): boolean {
  const refreshed = new Date(refreshedAt);
  if (Number.isNaN(refreshed.getTime()) || now.getTime() - refreshed.getTime() < HOUR_MS) return false;
  const parts = Object.fromEntries(brusselsClock.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return !["Sat", "Sun"].includes(parts.weekday) && hour >= REFRESH_START_HOUR && hour < REFRESH_END_HOUR;
}

function snapshotFrom(value: unknown): Snapshot<unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<Snapshot<unknown>>;
  return typeof snapshot.refreshedAt === "string" && "data" in snapshot && !Number.isNaN(Date.parse(snapshot.refreshedAt))
    ? { refreshedAt: snapshot.refreshedAt, data: snapshot.data }
    : null;
}

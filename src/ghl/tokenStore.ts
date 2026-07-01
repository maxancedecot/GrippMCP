import { decryptSecret, encryptSecret } from "./crypto.js";
import { GhlInstallationSummary, GhlTokenRecord } from "./types.js";

type StoredGhlTokenRecord = Omit<GhlTokenRecord, "accessToken" | "refreshToken"> & {
  accessToken: string;
  refreshToken: string;
};

const KEY_PREFIX = "ghl:token:";
const INDEX_KEY = "ghl:installations";
const memoryStore = new Map<string, string>();

export async function saveGhlTokenRecord(record: GhlTokenRecord): Promise<void> {
  const stored: StoredGhlTokenRecord = {
    ...record,
    accessToken: encryptSecret(record.accessToken),
    refreshToken: encryptSecret(record.refreshToken)
  };

  await writeRaw(keyForInstall(record.installId), JSON.stringify(stored));
  await upsertInstallationSummary(toInstallationSummary(record));
}

export async function getGhlTokenRecord(installId: string): Promise<GhlTokenRecord | null> {
  const raw = await readRaw(keyForInstall(installId));
  if (!raw) {
    return null;
  }

  const stored = JSON.parse(raw) as StoredGhlTokenRecord;
  return {
    ...stored,
    accessToken: decryptSecret(stored.accessToken),
    refreshToken: decryptSecret(stored.refreshToken)
  };
}

export function getGhlTokenStoreMode() {
  return hasKvConfig() ? "upstash_rest" : "memory";
}

export async function listGhlInstallations(): Promise<GhlInstallationSummary[]> {
  const index = await readInstallationIndex();
  if (index.length > 0) {
    return sortInstallations(index);
  }

  const records = await listStoredTokenRecords();
  const summaries = records.map(toInstallationSummary);
  if (summaries.length > 0) {
    await writeInstallationIndex(summaries);
  }

  return sortInstallations(summaries);
}

function toInstallationSummary(record: GhlTokenRecord): GhlInstallationSummary {
  const summary: GhlInstallationSummary = {
    installId: record.installId,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };

  if (record.scope !== undefined) {
    summary.scope = record.scope;
  }
  if (record.userType !== undefined) {
    summary.userType = record.userType;
  }
  if (record.companyId !== undefined) {
    summary.companyId = record.companyId;
  }
  if (record.locationId !== undefined) {
    summary.locationId = record.locationId;
  }
  if (record.userId !== undefined) {
    summary.userId = record.userId;
  }

  return summary;
}

async function upsertInstallationSummary(summary: GhlInstallationSummary): Promise<void> {
  const index = await readInstallationIndex();
  const next = [
    summary,
    ...index.filter((installation) => installation.installId !== summary.installId)
  ];
  await writeInstallationIndex(next);
}

async function readInstallationIndex(): Promise<GhlInstallationSummary[]> {
  const raw = await readRaw(INDEX_KEY);
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as GhlInstallationSummary[];
  return parsed.filter((installation) => installation.installId);
}

async function writeInstallationIndex(index: GhlInstallationSummary[]): Promise<void> {
  await writeRaw(INDEX_KEY, JSON.stringify(sortInstallations(index)));
}

function sortInstallations(index: GhlInstallationSummary[]) {
  return [...index].sort((left, right) => right.updatedAt - left.updatedAt);
}

async function listStoredTokenRecords(): Promise<GhlTokenRecord[]> {
  const keys = await listRawTokenKeys();
  const records = await Promise.all(
    keys.map(async (key) => {
      const installId = key.slice(KEY_PREFIX.length);
      return getGhlTokenRecord(installId);
    })
  );

  return records.filter((record): record is GhlTokenRecord => Boolean(record));
}

async function listRawTokenKeys(): Promise<string[]> {
  if (!hasKvConfig()) {
    ensureMemoryStoreAllowed();
    return [...memoryStore.keys()].filter((key) => key.startsWith(KEY_PREFIX));
  }

  const keys = await kvCommand<string[]>(["KEYS", `${KEY_PREFIX}*`]);
  return keys.filter((key) => key !== INDEX_KEY);
}

function keyForInstall(installId: string) {
  return `${KEY_PREFIX}${installId}`;
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (!hasKvConfig()) {
    ensureMemoryStoreAllowed();
    memoryStore.set(key, value);
    return;
  }

  await kvCommand(["SET", key, value]);
}

async function readRaw(key: string): Promise<string | null> {
  if (!hasKvConfig()) {
    ensureMemoryStoreAllowed();
    return memoryStore.get(key) ?? null;
  }

  const result = await kvCommand<string | null>(["GET", key]);
  return result;
}

async function kvCommand<T>(command: unknown[]): Promise<T> {
  const config = getKvConfig();
  if (!config) {
    throw new Error("KV REST configuration is missing.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const payload = (await response.json()) as { result?: T; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(`KV command failed: ${payload.error ?? response.statusText}`);
  }

  return payload.result as T;
}

function hasKvConfig() {
  return Boolean(getKvConfig());
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function ensureMemoryStoreAllowed() {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "Set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN before using GoHighLevel OAuth in production."
    );
  }
}

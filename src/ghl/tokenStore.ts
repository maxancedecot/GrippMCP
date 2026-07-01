import { decryptSecret, encryptSecret } from "./crypto.js";
import { GhlTokenRecord } from "./types.js";

type StoredGhlTokenRecord = Omit<GhlTokenRecord, "accessToken" | "refreshToken"> & {
  accessToken: string;
  refreshToken: string;
};

const KEY_PREFIX = "ghl:token:";
const memoryStore = new Map<string, string>();

export async function saveGhlTokenRecord(record: GhlTokenRecord): Promise<void> {
  const stored: StoredGhlTokenRecord = {
    ...record,
    accessToken: encryptSecret(record.accessToken),
    refreshToken: encryptSecret(record.refreshToken)
  };

  await writeRaw(keyForInstall(record.installId), JSON.stringify(stored));
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

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type JsonCacheMode = "upstash_rest" | "file" | "memory";

const memoryStore = new Map<string, string>();
const memoryLeases = new Map<string, number>();

export async function readJsonCache<T>(key: string): Promise<T | null> {
  const raw = await readRawCache(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readJsonCaches<T>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  if (getJsonCacheMode() !== "upstash_rest") return Promise.all(keys.map((key) => readJsonCache<T>(key)));
  const values = await kvCommand<(string | null)[]>(["MGET", ...keys]);
  if (!Array.isArray(values) || values.length !== keys.length) throw new Error("Incomplete cache response");
  return values.map((value) => value === null ? null : JSON.parse(value) as T);
}

export async function writeJsonCache(key: string, value: unknown): Promise<void> {
  await writeRawCache(key, JSON.stringify(value));
}

export async function deleteJsonCache(key: string): Promise<void> {
  await deleteRawCache(key);
}

export async function claimJsonCacheLease(key: string, ttlMs: number): Promise<boolean> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Cache lease TTL must be positive.");
  if (getJsonCacheMode() === "upstash_rest") {
    return await kvCommand<string | null>(["SET", key, "1", "NX", "PX", Math.floor(ttlMs)]) === "OK";
  }

  const now = Date.now();
  const expiresAt = memoryLeases.get(key) ?? 0;
  if (expiresAt > now) return false;
  memoryLeases.set(key, now + ttlMs);
  return true;
}

export function getJsonCacheMode(): JsonCacheMode {
  if (process.env.JSON_CACHE_STORE === "memory") {
    return "memory";
  }
  if (process.env.JSON_CACHE_STORE === "file") {
    return "file";
  }

  if (getKvConfig()) {
    return "upstash_rest";
  }

  if (shouldUseFileCache()) {
    return "file";
  }

  return "memory";
}

async function readRawCache(key: string): Promise<string | null> {
  const mode = getJsonCacheMode();
  if (mode === "upstash_rest") {
    return kvCommand<string | null>(["GET", key]);
  }
  if (mode === "file") {
    return readFileCache(key);
  }

  return memoryStore.get(key) ?? null;
}

async function writeRawCache(key: string, value: string): Promise<void> {
  const mode = getJsonCacheMode();
  if (mode === "upstash_rest") {
    await kvCommand(["SET", key, value]);
    return;
  }
  if (mode === "file") {
    await writeFileCache(key, value);
    return;
  }

  memoryStore.set(key, value);
}

async function deleteRawCache(key: string): Promise<void> {
  const mode = getJsonCacheMode();
  if (mode === "upstash_rest") {
    await kvCommand(["DEL", key]);
    return;
  }
  if (mode === "file") {
    await rm(filePathForKey(key), { force: true });
    return;
  }

  memoryStore.delete(key);
}

async function readFileCache(key: string): Promise<string | null> {
  try {
    return await readFile(filePathForKey(key), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeFileCache(key: string, value: string): Promise<void> {
  const filePath = filePathForKey(key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function filePathForKey(key: string) {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(process.cwd(), ".cache", "json", `${digest}.json`);
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

  const text = await response.text();
  let payload: { result?: T; error?: string };
  try {
    payload = JSON.parse(text) as { result?: T; error?: string };
  } catch {
    const providerError = text.slice(0, 500) || response.statusText || `HTTP ${response.status}`;
    throw new Error(`KV command failed (${response.status}): ${providerError}`);
  }

  if (!response.ok || payload.error) {
    const providerError = payload.error ?? (text.slice(0, 500) || response.statusText || `HTTP ${response.status}`);
    throw new Error(`KV command failed (${response.status}): ${providerError}`);
  }

  return payload.result as T;
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function shouldUseFileCache() {
  return !process.env.VERCEL;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

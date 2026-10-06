import { GrippMcpError } from "../errors.js";

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_BURST = 80; // Leave room below HighLevel's 100 requests / 10 seconds.
const MAX_CONCURRENT = 4;
const MAX_WAIT_MS = 30_000;
const MAX_ATTEMPTS = 3;

type QueueState = {
  starts: number[];
  active: number;
  intervalMs: number;
  burst: number;
  cooldownUntil: number;
  dailyBlockedUntil: number;
  tail: Promise<void>;
  changed: (() => void)[];
};

export function createGhlRequestQueue({ now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}) {
  const states = new Map<string, QueueState>();
  return async function request(resource: string, send: () => Promise<Response>, retryable: boolean): Promise<Response> {
    const state = states.get(resource) ?? {
      starts: [], active: 0, intervalMs: DEFAULT_INTERVAL_MS, burst: DEFAULT_BURST,
      cooldownUntil: 0, dailyBlockedUntil: 0, tail: Promise.resolve(), changed: []
    };
    states.set(resource, state);
    for (let attempt = 0; ; attempt++) {
      await acquire(state);
      let response: Response;
      try {
        response = await send();
        const interval = positiveHeader(response.headers, "x-ratelimit-interval-milliseconds");
        const max = positiveHeader(response.headers, "x-ratelimit-max");
        if (interval !== null) state.intervalMs = interval;
        if (max !== null) state.burst = Math.max(1, Math.min(DEFAULT_BURST, Math.floor(max * 0.8)));
        if (numberHeader(response.headers, "x-ratelimit-remaining") === 0) {
          state.cooldownUntil = Math.max(state.cooldownUntil, now() + state.intervalMs);
        }
        if (response.status === 429 && numberHeader(response.headers, "x-ratelimit-daily-remaining") === 0) {
          // Do not keep retrying a daily quota; subsequent queued requests fail promptly.
          state.dailyBlockedUntil = now() + 60_000;
          return response;
        }
        if (response.status !== 429) return response;
        const delay = retryAfterMs(response.headers.get("retry-after"), now()) ?? state.intervalMs * 2 ** attempt;
        state.cooldownUntil = Math.max(state.cooldownUntil, now() + delay);
        if (!retryable || attempt >= MAX_ATTEMPTS - 1 || delay > MAX_WAIT_MS) return response;
        // Release the response connection before retrying; never retain provider bodies.
        await response.text();
      } finally {
        state.active--;
        for (const resolve of state.changed.splice(0)) resolve();
      }
    }
  };

  async function acquire(state: QueueState) {
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      for (;;) {
        const current = now();
        if (state.dailyBlockedUntil > current) throw rateLimitError("daily");
        state.starts = state.starts.filter((start) => start > current - state.intervalMs);
        const windowUntil = state.starts.length >= state.burst ? state.starts[0]! + state.intervalMs : current;
        const delay = Math.max(state.cooldownUntil, windowUntil) - current;
        if (delay > MAX_WAIT_MS) throw rateLimitError("burst");
        if (delay > 0) { await sleep(delay); continue; }
        if (state.active >= MAX_CONCURRENT) {
          await new Promise<void>((resolve) => { state.changed.push(resolve); });
          continue;
        }
        state.starts.push(current);
        state.active++;
        return;
      }
    } finally { release(); }
  }
}

export const ghlRequestQueue = createGhlRequestQueue();

function numberHeader(headers: Headers, name: string) {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveHeader(headers: Headers, name: string) {
  const value = numberHeader(headers, name);
  return value !== null && value > 0 ? value : null;
}

function retryAfterMs(raw: string | null, now: number) {
  if (!raw?.trim()) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1, date - now) : null;
}

function rateLimitError(rateLimit: "daily" | "burst") {
  return new GrippMcpError("ghl_upstream_error", "GoHighLevel request limit reached.", { status: 429, rateLimit });
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync("public/site-analytics.js", "utf8");
function browser(options: { loading?: boolean; blockedStorage?: boolean; wordpress?: boolean; iframe?: boolean; path?: string } = {}) {
  let time = 1_000_000;
  let nextId = 0;
  const requests: { url: string; init: RequestInit; payload: Record<string, unknown> }[] = [];
  const storage = new Map<string, string>();
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const timers: (() => void)[] = [];
  const intervals: (() => void)[] = [];
  const listen = (name: string, callback: (event?: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), callback]);
  const location = new URL(`https://crm-site.example${options.path ?? "/project?utm_source=facebook&utm_medium=cpc&email=private@example.com#secret"}`);
  const document = {
    currentScript: { src: "https://dashboard.ledouxmedia.be/site-analytics.js", getAttribute: () => "ledoux" },
    readyState: options.loading ? "loading" : "complete", visibilityState: "visible", title: "Project",
    referrer: "https://google.com/search?q=private", body: options.loading ? null : { scrollHeight: 1500, scrollTop: 0 },
    documentElement: { scrollHeight: 1500, scrollTop: 0, clientHeight: 500 }, addEventListener: listen
  };
  const window: Record<string, any> = {
    addEventListener: listen, innerHeight: 500, scrollY: 0, crypto: { randomUUID: () => `uuid-${++nextId}` },
    setInterval: (callback: () => void) => intervals.push(callback), setTimeout: (callback: () => void) => timers.push(callback),
    localStorage: {
      getItem: (key: string) => { if (options.blockedStorage) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (options.blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); }
    },
    fetch: async (url: string, init: RequestInit) => { requests.push({ url, init, payload: JSON.parse(String(init.body)) }); return { ok: true }; }
  };
  window.self = window;
  window.top = options.iframe ? {} : window;
  if (options.wordpress) window.grippSiteAnalytics = { restUrl: "/wp-json/analytics" };
  const history = {
    pushState(_state: unknown, _title: string, url: string) { location.href = new URL(url, location).href; },
    replaceState(_state: unknown, _title: string, url: string) { location.href = new URL(url, location).href; }
  };
  const context = vm.createContext({ window, document, location, history, URL, URLSearchParams, Promise, Date: class extends Date { static now() { return time; } } });
  const run = () => vm.runInContext(script, context);
  const emit = (name: string, event: unknown = {}) => (listeners.get(name) ?? []).forEach((listener) => listener(event));
  const flush = async () => { while (timers.length) timers.shift()!(); for (let i = 0; i < 50; i++) await Promise.resolve(); };
  return { run, emit, flush, requests, document, window, location, history, advance: (ms: number) => { time += ms; }, interval: () => intervals.forEach((callback) => callback()) };
}

test("the header snippet waits for the DOM, posts one page view and omits contact parameters and credentials", async () => {
  const b = browser({ loading: true });
  b.run(); b.run();
  await b.flush();
  assert.equal(b.requests.length, 0);
  b.document.body = { scrollHeight: 1500, scrollTop: 0 };
  b.document.readyState = "complete";
  b.emit("DOMContentLoaded");
  await b.flush();
  b.run();
  assert.equal(b.requests.length, 1);
  const request = b.requests[0];
  assert.equal(request.url, "https://dashboard.ledouxmedia.be/api/site-analytics/browser");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.keepalive, true);
  assert.equal(request.payload.event_type, "page_view");
  assert.equal(request.payload.page_url, "https://crm-site.example/project");
  assert.equal(request.payload.referrer, "https://google.com");
  assert.equal(request.payload.source, "facebook");
  assert.equal(request.payload.medium, "cpc");
  assert.doesNotMatch(String(request.init.body), /private|email|secret/);
});

test("SPA navigation keeps departing engagement on its page and records a thank-you page once", async () => {
  const b = browser(); b.run(); await b.flush(); b.advance(4000);
  b.history.pushState(null, "", "/bedankt-brochure?p_slug=project&email=private@example.com");
  b.history.replaceState(null, "", "/bedankt-brochure?p_slug=project&email=private@example.com");
  b.document.title = "Brochure bedankt";
  await b.flush();
  assert.deepEqual(b.requests.map((request) => request.payload.event_type), ["page_view", "engagement", "page_view"]);
  assert.equal(b.requests[1].payload.page_url, "https://crm-site.example/project");
  assert.equal(b.requests[1].payload.active_time_ms_delta, 4000);
  assert.equal(b.requests[2].payload.page_url, "https://crm-site.example/bedankt-brochure?p_slug=project");
  assert.equal(b.requests[0].payload.visitor_id, b.requests[2].payload.visitor_id);
  assert.equal(b.requests[0].payload.session_id, b.requests[2].payload.session_id);
  assert.notEqual(b.requests[0].payload.page_view_id, b.requests[2].payload.page_view_id);
});

test("hidden time is excluded and scrolling is included in engagement", async () => {
  const b = browser(); b.run(); await b.flush();
  b.advance(5000); b.window.scrollY = 600; b.emit("scroll");
  b.document.visibilityState = "hidden"; b.emit("visibilitychange"); await b.flush();
  assert.equal(b.requests[1].payload.active_time_ms_delta, 5000);
  assert.equal(b.requests[1].payload.scroll_percent, 60);
  b.advance(60000); b.interval(); b.emit("pagehide"); await b.flush();
  assert.equal(b.requests.length, 2);
  b.document.visibilityState = "visible"; b.emit("visibilitychange"); b.advance(3000); b.interval(); await b.flush();
  assert.equal(b.requests[2].payload.active_time_ms_delta, 3000);
});

test("blocked storage still permits tracking and existing WordPress, iframe and preview trackers are skipped", async () => {
  const b = browser({ blockedStorage: true }); b.run(); await b.flush();
  assert.equal(b.requests.length, 1);
  for (const options of [{ wordpress: true }, { iframe: true }, { path: "/v2/preview/id" }, { path: "/wp-admin/" }]) {
    const skipped = browser(options); skipped.run(); await skipped.flush(); assert.equal(skipped.requests.length, 0);
  }
});

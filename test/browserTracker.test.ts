import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync("public/site-analytics.js", "utf8");
const VISITOR_KEY = "gripp_site_analytics_visitor_id";
const SESSION_KEY = "gripp_site_analytics_session";
const consentCookie = (statistics: unknown) => `cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: { statistieken: statistics } }))}`;
let nextBrowserId = 0;
function browser(options: { loading?: boolean; blockedStorage?: boolean; blockedCookie?: boolean; wordpress?: boolean; iframe?: boolean; path?: string; cookie?: string; storage?: Map<string, string> } = {}) {
  let time = 1_000_000;
  let nextId = 0;
  const browserId = ++nextBrowserId;
  const requests: { url: string; init: RequestInit; payload: Record<string, unknown> }[] = [];
  const storage = options.storage ?? new Map<string, string>();
  const storageReads: string[] = [];
  const storageWrites: string[] = [];
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const timers: (() => void)[] = [];
  const intervals: (() => void)[] = [];
  const listen = (name: string, callback: (event?: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), callback]);
  const location = new URL(`https://crm-site.example${options.path ?? "/project?utm_source=facebook&utm_medium=cpc&email=private@example.com#secret"}`);
  const document = {
    cookie: options.cookie ?? "",
    currentScript: { src: "https://dashboard.ledouxmedia.be/site-analytics.js", getAttribute: () => "ledoux" },
    readyState: options.loading ? "loading" : "complete", visibilityState: "visible", title: "Project",
    referrer: "https://google.com/search?q=private", body: options.loading ? null : { scrollHeight: 1500, scrollTop: 0 },
    documentElement: { scrollHeight: 1500, scrollTop: 0, clientHeight: 500 }, addEventListener: listen
  };
  if (options.blockedCookie) Object.defineProperty(document, "cookie", { get() { throw new Error("Cookies blocked"); } });
  const window: Record<string, any> = {
    addEventListener: listen, innerHeight: 500, scrollY: 0, crypto: { randomUUID: () => `uuid-${browserId}-${++nextId}` },
    setInterval: (callback: () => void) => intervals.push(callback), setTimeout: (callback: () => void) => timers.push(callback),
    localStorage: {
      getItem: (key: string) => { storageReads.push(key); if (options.blockedStorage) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { storageWrites.push(key); if (options.blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); },
      removeItem: (key: string) => { if (options.blockedStorage) throw new Error("Storage blocked"); storage.delete(key); }
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
  return { run, emit, flush, requests, storage, storageReads, storageWrites, document, window, location, history, advance: (ms: number) => { time += ms; }, interval: () => intervals.forEach((callback) => callback()) };
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
  for (const cookie of ["", consentCookie(true)]) {
    const b = browser({ blockedStorage: true, cookie }); b.run(); await b.flush();
    assert.equal(b.requests.length, 1);
  }
  for (const options of [{ wordpress: true }, { iframe: true }, { path: "/v2/preview/id" }, { path: "/wp-admin/" }]) {
    const skipped = browser(options); skipped.run(); await skipped.flush(); assert.equal(skipped.requests.length, 0);
  }
});

test("without consent, page views and engagement use memory IDs and never read or write localStorage", async () => {
  const storage = new Map([[VISITOR_KEY, "old-visitor"], [SESSION_KEY, JSON.stringify({ id: "old-session", updated_at: 999_000 })], ["unrelated", "keep"]]);
  const b = browser({ storage }); b.run(); await b.flush();
  b.advance(15000); b.interval(); await b.flush();
  assert.deepEqual(b.requests.map((request) => request.payload.event_type), ["page_view", "engagement"]);
  assert.notEqual(b.requests[0].payload.visitor_id, "old-visitor");
  assert.notEqual(b.requests[0].payload.session_id, "old-session");
  assert.equal(b.requests[0].payload.visitor_id, b.requests[1].payload.visitor_id);
  assert.equal(b.requests[0].payload.session_id, b.requests[1].payload.session_id);
  assert.equal(b.requests[1].payload.active_time_ms_delta, 15000);
  assert.deepEqual([...storage], [["unrelated", "keep"]]);
  assert.deepEqual(b.storageReads, []);
  assert.deepEqual(b.storageWrites, []);
  const nextPage = browser({ storage, path: "/next" }); nextPage.run(); await nextPage.flush();
  assert.notEqual(nextPage.requests[0].payload.visitor_id, b.requests[0].payload.visitor_id);
  assert.notEqual(nextPage.requests[0].payload.session_id, b.requests[0].payload.session_id);
  assert.deepEqual([...storage], [["unrelated", "keep"]]);
});

test("only an exact statistics boolean grants consent; malformed, missing and misleading cookies fail closed", async () => {
  const rejectedCookies = [
    "", "cc_toestemming=", "cc_toestemming=%broken", "cc_toestemming=not-json", "cc_toestemming=null",
    "cc_toestemming=%7B%7D", `cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: null }))}`,
    `cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: { marketing: true } }))}`,
    ...[false, "false", "true", 1, 0, null, [], {}].map(consentCookie),
    `other_cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: { statistieken: true } }))}`
  ];
  for (const cookie of rejectedCookies) {
    const b = browser({ cookie }); b.run(); await b.flush();
    b.advance(15000); b.interval(); await b.flush();
    assert.equal(b.requests.length, 2, cookie);
    assert.equal(b.storage.size, 0, cookie);
    assert.deepEqual(b.storageReads, [], cookie);
    assert.deepEqual(b.storageWrites, [], cookie);
  }
  const blocked = browser({ blockedCookie: true }); blocked.run(); await blocked.flush();
  assert.equal(blocked.requests.length, 1);
  assert.deepEqual(blocked.storageReads, []);
  assert.deepEqual(blocked.storageWrites, []);
});

test("consent reuses stored IDs, refreshes the session and preserves the browser payload contract", async () => {
  const storage = new Map([[VISITOR_KEY, "known-visitor"], [SESSION_KEY, JSON.stringify({ id: "known-session", updated_at: 999_000 })]]);
  const b = browser({ cookie: `other=value; ${consentCookie(true)}; third=value`, storage }); b.run(); await b.flush();
  const payload = b.requests[0].payload;
  assert.equal(payload.visitor_id, "known-visitor");
  assert.equal(payload.session_id, "known-session");
  assert.equal(storage.get(VISITOR_KEY), "known-visitor");
  assert.deepEqual(JSON.parse(storage.get(SESSION_KEY)!), { id: "known-session", updated_at: 1_000_000 });
  assert.deepEqual(Object.keys(payload).sort(), [
    "project", "event_type", "visitor_id", "session_id", "page_view_id", "page_url", "page_title",
    "referrer", "source", "medium", "active_time_ms_delta", "scroll_percent"
  ].sort());
  b.advance(15000); b.interval(); await b.flush();
  assert.equal(JSON.parse(storage.get(SESSION_KEY)!).updated_at, 1_015_000);
});

test("accepting statistics during a page stores the current temporary IDs on the next ping and reuses them on the next page", async () => {
  const b = browser(); b.run(); await b.flush();
  const first = b.requests[0].payload;
  assert.equal(b.storage.size, 0);
  b.document.cookie = consentCookie(true);
  b.advance(15000); b.interval(); await b.flush();
  assert.equal(b.storage.get(VISITOR_KEY), first.visitor_id);
  assert.equal(JSON.parse(b.storage.get(SESSION_KEY)!).id, first.session_id);
  assert.equal(b.requests[1].payload.visitor_id, first.visitor_id);
  assert.equal(b.requests[1].payload.session_id, first.session_id);
  const nextPage = browser({ cookie: b.document.cookie, storage: b.storage, path: "/next" }); nextPage.run(); await nextPage.flush();
  assert.equal(nextPage.requests[0].payload.visitor_id, first.visitor_id);
  assert.equal(nextPage.requests[0].payload.session_id, first.session_id);
});

test("revoking consent stops storage writes, then the banner reload clears old IDs and uses temporary IDs", async () => {
  const b = browser({ cookie: consentCookie(true) }); b.run(); await b.flush();
  const first = b.requests[0].payload;
  assert.equal(b.storage.size, 2);
  const reads = b.storageReads.length;
  const writes = b.storageWrites.length;
  b.document.cookie = consentCookie(false);
  b.advance(15000); b.interval(); await b.flush();
  assert.equal(b.storageReads.length, reads);
  assert.equal(b.storageWrites.length, writes);
  const reloaded = browser({ cookie: b.document.cookie, storage: b.storage }); reloaded.run(); await reloaded.flush();
  assert.equal(b.storage.size, 0);
  assert.notEqual(reloaded.requests[0].payload.visitor_id, first.visitor_id);
  assert.notEqual(reloaded.requests[0].payload.session_id, first.session_id);
  assert.deepEqual(reloaded.storageReads, []);
  assert.deepEqual(reloaded.storageWrites, []);
});

test("with consent, new or expired sessions get a fresh ID and keep the visitor", async () => {
  for (const session of [undefined, "not-json", JSON.stringify({ id: "expired-session", updated_at: -1_000_000 })]) {
    const storage = new Map([[VISITOR_KEY, "known-visitor"]]);
    if (session) storage.set(SESSION_KEY, session);
    const b = browser({ cookie: consentCookie(true), storage }); b.run(); await b.flush();
    assert.equal(b.requests[0].payload.visitor_id, "known-visitor");
    assert.notEqual(b.requests[0].payload.session_id, "expired-session");
    assert.equal(JSON.parse(storage.get(SESSION_KEY)!).id, b.requests[0].payload.session_id);
  }
});

test("with consent, SPA navigation keeps IDs and expires an inactive session after thirty minutes", async () => {
  const b = browser({ cookie: consentCookie(true) }); b.run(); await b.flush();
  b.advance(4000); b.history.pushState(null, "", "/next"); await b.flush();
  assert.equal(b.requests[0].payload.visitor_id, b.requests[2].payload.visitor_id);
  assert.equal(b.requests[0].payload.session_id, b.requests[2].payload.session_id);
  b.advance(30 * 60 * 1000);
  // Restore a cached page after inactivity without sending departing engagement first.
  b.emit("pageshow", { persisted: true }); await b.flush();
  assert.equal(b.requests[3].payload.visitor_id, b.requests[0].payload.visitor_id);
  assert.notEqual(b.requests[3].payload.session_id, b.requests[0].payload.session_id);
});

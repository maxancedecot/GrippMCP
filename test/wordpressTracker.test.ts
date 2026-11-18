import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import { GET as downloadPlugin } from "../app/api/site-analytics/plugin/route.js";

const root = "wordpress/gripp-site-analytics";
const script = readFileSync(`${root}/assets/tracker.js`, "utf8");
const VISITOR_KEY = "gripp_site_analytics_visitor_id";
const SESSION_KEY = "gripp_site_analytics_session";
const consentCookie = (statistics: unknown) => `cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: { statistieken: statistics } }))}`;
let nextBrowserId = 0;

function browser(options: {
  cookie?: string; blockedCookie?: boolean; blockedStorage?: boolean; storage?: Map<string, string>;
  beacon?: boolean; beaconAccepted?: boolean; configured?: boolean; alreadyLoaded?: boolean; source?: string;
} = {}) {
  let time = 1_000_000;
  let nextId = 0;
  const browserId = ++nextBrowserId;
  const storage = options.storage ?? new Map<string, string>();
  const storageReads: string[] = [];
  const storageWrites: string[] = [];
  const requests: { url: string; init: RequestInit; payload: Record<string, unknown> }[] = [];
  const beacons: { url: string; blob: Blob }[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const intervals: (() => void)[] = [];
  const listen = (name: string, callback: () => void) => listeners.set(name, [...(listeners.get(name) ?? []), callback]);
  const document = {
    cookie: options.cookie ?? "", title: "Project", referrer: "https://google.com/search?q=project",
    visibilityState: "visible", documentElement: { scrollHeight: 1500, scrollTop: 0, clientHeight: 500 },
    body: { scrollHeight: 1500, scrollTop: 0 }, addEventListener: listen
  };
  if (options.blockedCookie) Object.defineProperty(document, "cookie", { get() { throw new Error("Cookies blocked"); } });
  const window: Record<string, any> = {
    grippSiteAnalytics: options.configured === false ? {} : { restUrl: "https://wp.example/wp-json/gripp-site-analytics/v1/event", publicKey: "public-key" },
    __grippSiteAnalyticsLoaded: options.alreadyLoaded ?? false,
    location: new URL("https://wp.example/project?utm_source=facebook&utm_medium=cpc&utm_campaign=launch"),
    addEventListener: listen, innerHeight: 500, innerWidth: 1000, scrollY: 0,
    crypto: { randomUUID: () => `uuid-${browserId}-${++nextId}` },
    setInterval: (callback: () => void) => intervals.push(callback),
    localStorage: {
      getItem(key: string) { storageReads.push(key); if (options.blockedStorage) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storageWrites.push(key); if (options.blockedStorage) throw new Error("Storage blocked"); storage.set(key, value); },
      removeItem(key: string) { if (options.blockedStorage) throw new Error("Storage blocked"); storage.delete(key); }
    },
    fetch: async (url: string, init: RequestInit) => { requests.push({ url, init, payload: JSON.parse(String(init.body)) }); return { ok: true }; }
  };
  const navigator = options.beacon ? {
    sendBeacon(url: string, blob: Blob) { beacons.push({ url, blob }); return options.beaconAccepted !== false; }
  } : {};
  const context = vm.createContext({ window, document, navigator, Blob, URL, URLSearchParams, Date: class extends Date { static now() { return time; } } });
  return {
    run: () => vm.runInContext(options.source ?? script, context), document, window, requests, beacons,
    storage, storageReads, storageWrites,
    emit: (name: string) => (listeners.get(name) ?? []).forEach((callback) => callback()),
    advance: (ms: number) => { time += ms; }, interval: () => intervals.forEach((callback) => callback())
  };
}

test("WordPress without consent clears only analytics IDs without reading or writing values and still sends page, scroll and engagement events", () => {
  const storage = new Map([[VISITOR_KEY, "old-visitor"], [SESSION_KEY, "old-session"], ["unrelated", "keep"]]);
  const b = browser({ storage }); b.run();
  b.advance(15000); b.interval();
  b.window.scrollY = 600; b.emit("scroll"); b.emit("scroll");
  assert.deepEqual(b.requests.map((request) => request.payload.event_type), ["page_view", "engagement", "scroll", "scroll"]);
  assert.equal(b.requests[1].payload.active_time_ms_delta, 15000);
  assert.equal(b.requests[2].payload.scroll_percent, 60);
  for (const { payload } of b.requests) {
    assert.equal(payload.visitor_id, b.requests[0].payload.visitor_id);
    assert.equal(payload.session_id, b.requests[0].payload.session_id);
    assert.notEqual(payload.visitor_id, "old-visitor");
    assert.notEqual(payload.session_id, "old-session");
  }
  assert.deepEqual([...storage], [["unrelated", "keep"]]);
  assert.deepEqual(b.storageReads, []); assert.deepEqual(b.storageWrites, []);
  const nextPage = browser({ storage }); nextPage.run();
  assert.notEqual(nextPage.requests[0].payload.visitor_id, b.requests[0].payload.visitor_id);
  assert.notEqual(nextPage.requests[0].payload.session_id, b.requests[0].payload.session_id);
});

test("WordPress accepts only the exact statistics boolean and treats malformed or inaccessible cookies as no consent", () => {
  const rejected = ["", "cc_toestemming=%broken", "cc_toestemming=not-json", "cc_toestemming=null", "cc_toestemming=%7B%7D",
    ...[false, "true", "false", 1, 0, null, [], {}].map(consentCookie),
    `cc_toestemming=${encodeURIComponent(JSON.stringify({ keuzes: { marketing: true } }))}`,
    `other_${consentCookie(true)}`];
  for (const cookie of rejected) {
    const b = browser({ cookie }); b.run(); b.advance(15000); b.interval();
    assert.equal(b.requests.length, 2, cookie);
    assert.equal(b.storage.size, 0, cookie);
    assert.deepEqual(b.storageReads, [], cookie); assert.deepEqual(b.storageWrites, [], cookie);
  }
  const blocked = browser({ blockedCookie: true }); blocked.run();
  assert.equal(blocked.requests.length, 1);
  assert.deepEqual(blocked.storageReads, []); assert.deepEqual(blocked.storageWrites, []);
});

test("WordPress consent reuses a visitor and recent session while expired or invalid sessions are renewed", () => {
  for (const session of [JSON.stringify({ id: "known-session", updated_at: 999_000 }), JSON.stringify({ id: "old-session", updated_at: -1_000_000 }), "not-json", undefined]) {
    const storage = new Map([[VISITOR_KEY, "known-visitor"]]);
    if (session) storage.set(SESSION_KEY, session);
    const b = browser({ cookie: `other=value; ${consentCookie(true)}; third=value`, storage }); b.run();
    const payload = b.requests[0].payload;
    assert.equal(payload.visitor_id, "known-visitor");
    if (session?.includes("known-session")) assert.equal(payload.session_id, "known-session");
    else assert.notEqual(payload.session_id, "old-session");
    assert.deepEqual(JSON.parse(storage.get(SESSION_KEY)!), { id: payload.session_id, updated_at: 1_000_000 });
    b.advance(15000); b.interval();
    assert.equal(JSON.parse(storage.get(SESSION_KEY)!).updated_at, 1_015_000);
  }
});

test("WordPress accepting statistics during a page persists its temporary IDs on the next ping and keeps them on the next page", () => {
  const b = browser(); b.run();
  const first = b.requests[0].payload;
  assert.equal(b.storage.size, 0);
  b.document.cookie = consentCookie(true); b.advance(15000); b.interval();
  assert.equal(b.storage.get(VISITOR_KEY), first.visitor_id);
  assert.equal(JSON.parse(b.storage.get(SESSION_KEY)!).id, first.session_id);
  const nextPage = browser({ cookie: b.document.cookie, storage: b.storage }); nextPage.run();
  assert.equal(nextPage.requests[0].payload.visitor_id, first.visitor_id);
  assert.equal(nextPage.requests[0].payload.session_id, first.session_id);
});

test("WordPress revocation stops storage access and banner reload removes persistent IDs", () => {
  const b = browser({ cookie: consentCookie(true) }); b.run();
  const first = b.requests[0].payload;
  const reads = b.storageReads.length; const writes = b.storageWrites.length;
  b.document.cookie = consentCookie(false); b.advance(15000); b.interval();
  assert.equal(b.storageReads.length, reads); assert.equal(b.storageWrites.length, writes);
  const reloaded = browser({ cookie: b.document.cookie, storage: b.storage }); reloaded.run();
  assert.equal(b.storage.size, 0);
  assert.notEqual(reloaded.requests[0].payload.visitor_id, first.visitor_id);
  assert.notEqual(reloaded.requests[0].payload.session_id, first.session_id);
  assert.deepEqual(reloaded.storageReads, []); assert.deepEqual(reloaded.storageWrites, []);
});

test("WordPress blocked storage never breaks measurement and duplicate or unconfigured trackers are skipped", () => {
  for (const cookie of ["", consentCookie(true)]) {
    const b = browser({ cookie, blockedStorage: true }); b.run(); b.advance(15000); b.interval();
    assert.equal(b.requests.length, 2);
    assert.equal(b.requests[0].payload.visitor_id, b.requests[1].payload.visitor_id);
  }
  for (const options of [{ configured: false }, { alreadyLoaded: true }]) {
    const b = browser(options); b.run(); assert.equal(b.requests.length, 0);
    assert.deepEqual(b.storageReads, []); assert.deepEqual(b.storageWrites, []);
  }
  const b = browser(); b.run(); b.run(); assert.equal(b.requests.length, 1);
});

test("WordPress beacon and fetch fallback preserve payloads and finalize the page once", async () => {
  const b = browser({ beacon: true }); b.run();
  assert.equal(b.requests.length, 0); assert.equal(b.beacons.length, 1);
  assert.equal(b.beacons[0].url, "https://wp.example/wp-json/gripp-site-analytics/v1/event");
  const payload = JSON.parse(await b.beacons[0].blob.text());
  assert.equal(payload.public_key, "public-key"); assert.equal(payload.event_type, "page_view");
  assert.equal(payload.source, "facebook"); assert.equal(payload.medium, "cpc"); assert.equal(payload.campaign, "launch");
  assert.equal("consent" in payload, false);
  b.advance(3000); b.emit("pagehide"); b.emit("pagehide");
  assert.equal(b.beacons.length, 2);
  assert.equal(JSON.parse(await b.beacons[1].blob.text()).active_time_ms_delta, 3000);
  const fallback = browser({ beacon: true, beaconAccepted: false }); fallback.run();
  assert.equal(fallback.beacons.length, 1); assert.equal(fallback.requests.length, 1);
  assert.deepEqual(fallback.requests[0].payload, JSON.parse(await fallback.beacons[0].blob.text()));
  assert.equal(fallback.requests[0].init.credentials, "same-origin");
});

function unzip(archive: Buffer) {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const size = archive.readUInt32LE(offset + 18);
    const nameSize = archive.readUInt16LE(offset + 26);
    const extraSize = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString();
    const start = offset + 30 + nameSize + extraSize;
    const data = archive.subarray(start, start + size);
    assert.ok(method === 0 || method === 8);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset = start + size;
  }
  return files;
}

test("WordPress installable ZIP and dashboard download include the tested tracker and version 0.2.5", async () => {
  const response = await downloadPlugin(new Request("https://dashboard.example/api/site-analytics/plugin"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Type"), "application/zip");
  const archives = [unzip(readFileSync("wordpress/gripp-site-analytics.zip")), unzip(Buffer.from(await response.arrayBuffer()))];
  for (const files of archives) {
    assert.deepEqual([...files.keys()].sort(), ["gripp-site-analytics/README.md", "gripp-site-analytics/assets/tracker.js", "gripp-site-analytics/gripp-site-analytics.php"].sort());
    const tracker = files.get("gripp-site-analytics/assets/tracker.js")!.toString();
    assert.equal(tracker, script);
    assert.equal(files.get("gripp-site-analytics/README.md")!.toString(), readFileSync(`${root}/README.md`, "utf8"));
    const php = files.get("gripp-site-analytics/gripp-site-analytics.php")!.toString();
    assert.match(php, /Version: 0\.2\.5/); assert.match(php, /private const VERSION = '0\.2\.5';/);
    const b = browser({ source: tracker }); b.run();
    assert.equal(b.requests.length, 1); assert.equal(b.storage.size, 0);
    b.document.cookie = consentCookie(true); b.advance(15000); b.interval();
    assert.equal(b.storage.get(VISITOR_KEY), b.requests[0].payload.visitor_id);
  }
  assert.match(archives[1].get("gripp-site-analytics/gripp-site-analytics.php")!.toString(), /private const DEFAULT_DASHBOARD_URL = 'https:\/\/dashboard\.example';/);
});

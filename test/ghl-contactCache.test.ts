import test from "node:test";
import assert from "node:assert/strict";
import { loadCachedGhlContacts, type ContactCacheStore } from "../src/ghl/contactCache.js";
import { ghlConversionsByPipeline, type GhlReadCall } from "../src/ghl/appointmentConversions.js";
import { GrippMcpError } from "../src/errors.js";

const now = new Date("2026-10-06T10:00:00Z");
const scope = { installId: "install", locationId: "location" };
const contact = (id: string, extra: object = {}) => ({ id, locationId: scope.locationId, tags: ["ledoux", "brochure"], dateAdded: "2026-10-01T12:00:00Z", dateUpdated: "2026-10-06T09:59:30Z", ...extra });
function fixture() {
  const values = new Map<string, unknown>(); const calls: Parameters<GhlReadCall>[0][] = [];
  const store: ContactCacheStore = { read: async <T>(key: string) => values.get(key) as T ?? null,
    write: async (key, value) => { values.set(key, structuredClone(value)); } };
  const read: GhlReadCall = async (input) => {
    calls.push(input);
    if (input.path.startsWith("/contacts/") && input.path !== "/contacts/search") return { contact: contact(decodeURIComponent(input.path.slice(10))) };
    assert.equal(input.path, "/contacts/search"); assert.equal(input.method, "POST"); assert.equal(input.apiVersion, "2021-07-28");
    const body = input.body as { filters?: { filters: { value: string }[] }[]; sort?: unknown };
    const ids = body.filters?.[0]?.filters.map((filter) => filter.value) ?? [];
    return { contacts: ids.map((id) => contact(id, { email: "secret@example.com", phone: "private", name: "private" })), total: ids.length };
  };
  return { values, calls, store, read };
}

test("103 unique contacts use two bulk calls, omit private fields and reuse cache across periods", async () => {
  const f = fixture(); const ids = Array.from({ length: 103 }, (_, i) => `contact-${i}`);
  const result = await loadCachedGhlContacts([...ids, ids[0]!], scope, f.read, { now, store: f.store });
  assert.equal(result.size, 103); assert.equal(f.calls.length, 2);
  const persisted = JSON.stringify([...f.values.values()]);
  assert.equal(persisted.includes("secret@example.com"), false); assert.equal(persisted.includes("phone"), false);
  await loadCachedGhlContacts(ids.slice(50), scope, f.read, { now: new Date(now.getTime() + 299999), store: f.store });
  assert.equal(f.calls.length, 2);
  await loadCachedGhlContacts([ids[0]!, "new"], scope, f.read, { now: new Date(now.getTime() + 1000), store: f.store });
  assert.equal(f.calls.length, 3);
  assert.deepEqual((f.calls[2]!.body as { filters: { filters: { value: string }[] }[] }).filters[0]!.filters.map((v) => v.value), ["new"]);
});

test("expired contacts merge changed tags from a sorted delta and stop at the overlapping watermark", async () => {
  const f = fixture(); await loadCachedGhlContacts(["a", "b"], scope, f.read, { now, store: f.store });
  const delta: GhlReadCall = async (input) => {
    f.calls.push(input); const body = input.body as { sort: unknown };
    assert.deepEqual(body.sort, [{ field: "dateUpdated", direction: "desc" }]);
    return { total: 900, contacts: [contact("a", { dateUpdated: "2026-10-06T10:04:00Z", tags: ["ledoux", "afspraak"] }),
      { id: "unrelated", dateUpdated: "2026-10-06T10:02:00Z", tags: "unused" }, contact("b", { dateUpdated: "2026-10-06T09:58:00Z" })] };
  };
  const result = await loadCachedGhlContacts(["a", "b"], scope, delta, { now: new Date(now.getTime() + 300000), store: f.store });
  assert.deepEqual(result.get("a")!.tags, ["ledoux", "afspraak"]); assert.deepEqual(result.get("b")!.tags, ["ledoux", "brochure"]);
  assert.equal(f.calls.length, 2);
});

test("manual updates bypass fresh contacts and scopes never share cached records", async () => {
  const f = fixture(); await loadCachedGhlContacts(["a"], scope, f.read, { now, store: f.store });
  const updated: GhlReadCall = async (input) => { f.calls.push(input); return { contacts: [contact("a", { tags: ["ledoux", "afspraak"] })], total: 1 }; };
  const result = await loadCachedGhlContacts(["a"], scope, updated, { now, force: true, store: f.store });
  assert.deepEqual(result.get("a")!.tags, ["ledoux", "afspraak"]); assert.equal(f.calls.length, 2);
  await loadCachedGhlContacts(["a"], { ...scope, installId: "another" }, f.read, { now, store: f.store });
  assert.equal(f.calls.length, 3); assert.equal(f.values.size, 2);
});

test("unsupported search falls back to four concurrent contact-detail requests", async () => {
  const f = fixture(); let active = 0, peak = 0, gets = 0, searches = 0;
  const read: GhlReadCall = async (input) => {
    if (input.path === "/contacts/search") { searches++; throw new GrippMcpError("ghl_upstream_error", "unsupported", { status: 400 }); }
    active++; peak = Math.max(peak, active); gets++;
    await new Promise((resolve) => setImmediate(resolve)); active--;
    return { contact: contact(decodeURIComponent(input.path.slice(10))) };
  };
  const ids = Array.from({ length: 9 }, (_, i) => `c-${i}`);
  assert.equal((await loadCachedGhlContacts(ids, scope, read, { now, store: f.store })).size, 9);
  assert.equal(searches, 1); assert.equal(gets, 9); assert.equal(peak, 4);
  await loadCachedGhlContacts(ids, scope, read, { now, store: f.store }); assert.equal(gets, 9);
});

test("missing search results are checked directly instead of producing zero counts", async () => {
  const f = fixture(); let direct = 0;
  const read: GhlReadCall = async (input) => {
    if (input.path === "/contacts/search") return { contacts: [], total: 0 };
    direct++; return { contact: contact("a") };
  };
  assert.equal((await loadCachedGhlContacts(["a"], scope, read, { now, store: f.store })).size, 1); assert.equal(direct, 1);
  const missing: GhlReadCall = async (input) => { if (input.path === "/contacts/search") return { contacts: [], total: 0 }; throw new GrippMcpError("ghl_upstream_error", "not found", { status: 404 }); };
  const before = structuredClone([...f.values]);
  await assert.rejects(loadCachedGhlContacts(["a"], scope, missing, { now, force: true, store: f.store }));
  assert.deepEqual([...f.values], before);
});

test("invalid tags, unexpected IDs, mismatched locations and rate limits never poison saved contacts", async () => {
  for (const raw of [contact("a", { tags: [42] }), contact("another"), contact("a", { locationId: "other" })]) {
    const f = fixture(); await loadCachedGhlContacts(["a"], scope, f.read, { now, store: f.store });
    const before = structuredClone([...f.values]);
    await assert.rejects(loadCachedGhlContacts(["a"], scope, async () => ({ contacts: [raw], total: 1 }), { now, force: true, store: f.store }));
    assert.deepEqual([...f.values], before);
  }
  const f = fixture(); let calls = 0;
  await assert.rejects(loadCachedGhlContacts(["a"], scope, async () => { calls++; throw new GrippMcpError("ghl_upstream_error", "rate limit", { status: 429 }); }, { now, store: f.store }));
  assert.equal(calls, 1); assert.equal(f.values.size, 0);
});

test("null tags remain valid and unknown update dates force a full tracked-contact refresh", async () => {
  const f = fixture(); const read: GhlReadCall = async () => ({ contacts: [contact("a", { tags: null, dateUpdated: null })], total: 1 });
  assert.deepEqual((await loadCachedGhlContacts(["a"], scope, read, { now, store: f.store })).get("a")!.tags, []);
  await loadCachedGhlContacts(["a"], scope, f.read, { now: new Date(now.getTime() + 300000), store: f.store });
  assert.equal(f.calls.length, 1); assert.ok((f.calls[0]!.body as { filters?: unknown }).filters);
});

test("incomplete or unsorted delta pages fail without advancing the watermark", async () => {
  for (const response of [{ contacts: [contact("a")], total: 501 }, { contacts: [contact("a"), contact("b", { dateUpdated: "2026-10-06T10:01:00Z" })], total: 2 }]) {
    const f = fixture(); await loadCachedGhlContacts(["a", "b"], scope, f.read, { now, store: f.store }); const before = structuredClone([...f.values]);
    await assert.rejects(loadCachedGhlContacts(["a", "b"], scope, async () => response, { now: new Date(now.getTime() + 300000), store: f.store }));
    assert.deepEqual([...f.values], before);
  }
});

test("future and day-old entries are rebuilt rather than trusted", async () => {
  for (const offset of [-1000, 86400000]) {
    const f = fixture(); await loadCachedGhlContacts(["a"], scope, f.read, { now, store: f.store });
    await loadCachedGhlContacts(["a"], scope, f.read, { now: new Date(now.getTime() + offset), store: f.store });
    assert.equal(f.calls.length, 2); assert.ok((f.calls[1]!.body as { filters?: unknown }).filters);
  }
});

test("linked pipelines fetch their combined contacts once and preserve tag-based counts", async () => {
  const f = fixture(); const read: GhlReadCall = async (input) => {
    if (input.path === "/opportunities/pipelines") return { pipelines: [{ id: "p1", name: "one" }, { id: "p2", name: "two" }] };
    if (input.path === "/opportunities/search") return { opportunities: [{ id: `op-${input.query!.pipelineId}`, pipelineId: input.query!.pipelineId, contactId: "a" }], meta: { nextPage: false } };
    return f.read(input);
  };
  const result = await ghlConversionsByPipeline(scope, { start: "2026-10-01", end: "2026-10-06" }, read, { contactCache: { now, store: f.store, force: true } });
  assert.deepEqual(result.map((row) => [row.leads, row.appointments]), [[1, 0], [1, 0]]); assert.equal(f.calls.length, 1);
});

test("a busy location exceeding the delta page limit falls back to a complete tracked-ID search", async () => {
  const f = fixture(); await loadCachedGhlContacts(["a"], scope, f.read, { now, store: f.store });
  let pages = 0, full = 0;
  const read: GhlReadCall = async (input) => {
    const body = input.body as { sort?: unknown; page: number };
    if (!body.sort) { full++; return { contacts: [contact("a", { tags: ["ledoux", "afspraak"] })], total: 1 }; }
    pages++;
    return { contacts: Array.from({ length: 500 }, (_, i) => ({ id: `unrelated-${body.page}-${i}`, dateUpdated: "2026-10-06T10:01:00Z" })), total: 10001 };
  };
  const result = await loadCachedGhlContacts(["a"], scope, read, { now: new Date(now.getTime() + 300000), store: f.store });
  assert.equal(pages, 20); assert.equal(full, 1); assert.deepEqual(result.get("a")!.tags, ["ledoux", "afspraak"]);
});

test("frequent delta updates still force a full ID check after 24 hours", async () => {
  const f = fixture(); await loadCachedGhlContacts(["a"], scope, f.read, { now, store: f.store });
  for (let hour = 1; hour <= 23; hour++) await loadCachedGhlContacts(["a"], scope, async () => ({ contacts: [], total: 0 }), { now: new Date(now.getTime() + hour * 3600000), store: f.store });
  await loadCachedGhlContacts(["a"], scope, f.read, { now: new Date(now.getTime() + 24 * 3600000), store: f.store });
  assert.equal(f.calls.length, 2); assert.ok((f.calls[1]!.body as { filters?: unknown }).filters);
});

test("concurrent reads of one location reuse the first completed contact batch", async () => {
  const f = fixture(); let calls = 0;
  const read: GhlReadCall = async (input) => { calls++; await new Promise((resolve) => setImmediate(resolve)); return f.read(input); };
  const results = await Promise.all(Array.from({ length: 4 }, () => loadCachedGhlContacts(["a"], scope, read, { now, store: f.store })));
  assert.equal(calls, 1); assert.ok(results.every((result) => result.size === 1));
});

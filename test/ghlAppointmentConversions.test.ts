import test from "node:test";
import assert from "node:assert/strict";
import { countGhlAppointments, ghlConversionsByPipeline, classifyGhlContactTags, type GhlReadCall } from "../src/ghl/appointmentConversions.js";

const config = { locationId: "location", installId: "install" };
const period = { start: "2026-09-08", end: "2026-09-14" };
const pipeline = { id: "project", name: "Project" };
const contact = (id: string, tags: string[] = ["ledoux", "brochure"], dateAdded: string | null = "2026-09-10T12:00:00Z") => ({ id, locationId: "location", tags, dateAdded });
const opportunity = (id: string, contactId = id) => ({ id, contactId, pipelineId: "project" });
function read(opportunities: unknown[], contacts: ReturnType<typeof contact>[], nextPage: unknown = null): GhlReadCall {
  return async ({ path }) => {
    if (path.endsWith("/pipelines")) return { pipelines: [pipeline] };
    if (path.startsWith("/contacts/")) return { contact: contacts.find((item) => item.id === decodeURIComponent(path.slice(10))) };
    return { opportunities, meta: { nextPage } };
  };
}
const counts = (result: Awaited<ReturnType<typeof ghlConversionsByPipeline>>) => result.map(({ leads, appointments }) => [leads, appointments]);

test("contact tags require Ledoux, recognize brochure and contact leads, and give appointment priority", () => {
  for (const tags of [["ledoux", "brochure"], [" Ledoux ", "CONTACT"], ["ledoux_brochure"], ["LÉDOUX - contact"], ["ledoux", "brochure", "contact"]]) {
    assert.equal(classifyGhlContactTags(tags), "lead");
  }
  for (const tags of [["ledoux", "afspraak"], ["ledoux-afspraak"], ["ledoux", "afspraak", "brochure", "contact"]]) {
    assert.equal(classifyGhlContactTags(tags), "appointment");
  }
  for (const tags of [[], ["ledoux"], ["brochure"], ["afspraak"], ["contact"], ["notledoux", "contact"], ["ledoux", "contactpersoon"], ["ledoux", "brochures"]]) {
    assert.equal(classifyGhlContactTags(tags), null);
  }
});

test("contact details override embedded tags and pipeline stage; each contact counts once", async () => {
  const visits: string[] = [];
  const fixture = read([
    { ...opportunity("one", "lead"), pipelineStageId: "appointment", contact: { id: "lead", tags: ["ledoux", "afspraak"] } },
    { ...opportunity("duplicate", "lead"), pipelineStageId: null },
    { ...opportunity("two", "meeting"), pipelineStageId: "new" },
    { ...opportunity("three", "contact"), pipelineStageId: "unknown" },
    opportunity("unrelated")
  ], [contact("lead"), contact("meeting", ["ledoux", "afspraak", "brochure"]), contact("contact", ["ledoux", "contact"]), contact("unrelated", ["brochure"])]);
  const call: GhlReadCall = async (input) => { assert.equal(input.apiVersion, input.path.startsWith("/contacts/") ? "2021-07-28" : "v3"); visits.push(input.path); return fixture(input); };
  const result = await ghlConversionsByPipeline(config, period, call);
  assert.deepEqual(counts(result), [[2, 1]]);
  assert.deepEqual(result[0]?.leadContactIds, ["lead", "contact"]);
  assert.deepEqual(result[0]?.appointmentContactIds, ["meeting"]);
  assert.equal(visits.filter((path) => path === "/contacts/lead").length, 1);
});

test("period uses contact creation dates, inclusive Brussels boundaries, independently of opportunity dates", async () => {
  const contacts = [
    contact("start", ["ledoux", "brochure"], "2026-09-07T22:00:00Z"),
    contact("end", ["ledoux", "afspraak"], "2026-09-14T21:59:59Z"),
    contact("before", ["ledoux", "contact"], "2026-09-07T21:59:59Z"),
    contact("after", ["ledoux", "afspraak"], "2026-09-14T22:00:00Z")
  ];
  const call = read(contacts.map(({ id }) => ({ ...opportunity(id), createdAt: "2000-01-01", lastStageChangeAt: "2000-01-01" })), contacts);
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[1, 1]]);
});

test("missing contact date invalidates only the matching bucket and unrelated contacts need no date", async () => {
  for (const [tags, expected] of [
    [["ledoux", "brochure"], [null, 1]], [["ledoux", "afspraak"], [1, null]], [[], [1, 1]]
  ] as [string[], (number | null)[]][]) {
    assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, read(
      [opportunity("lead"), opportunity("meeting"), opportunity("missing")],
      [contact("lead"), contact("meeting", ["ledoux", "afspraak"]), contact("missing", tags, null)]
    ))), [expected]);
  }
});

test("empty pipelines return reliable zero regardless of configured stage names", async () => {
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, read([], []))), [[0, 0]]);
  assert.equal(await countGhlAppointments(config, period, read([opportunity("one")], [contact("one", ["ledoux", "afspraak"])])), 1);
});

test("missing contact identifiers leave counts unavailable; embedded contact id is supported", async () => {
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, read([{ id: "missing" }], []))), [[null, null]]);
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, read([{ id: "one", contact: { id: "one" } }], [contact("one")]))), [[1, 0]]);
});

test("malformed contacts, invalid tag types, wrong identifiers and locations never produce false totals", async () => {
  for (const invalid of [{}, { ...contact("one"), tags: "ledoux" }, { ...contact("one"), tags: [42] }, { ...contact("one"), tags: [{ id: "tag" }] }, { ...contact("wrong") }, { ...contact("one"), locationId: "other" }]) {
    const fixture = read([opportunity("one")], []);
    const call: GhlReadCall = async (input) => input.path.startsWith("/contacts/") ? { contact: invalid } : fixture(input);
    await assert.rejects(ghlConversionsByPipeline(config, period, call));
  }
  await assert.rejects(ghlConversionsByPipeline(config, period, read([{ ...opportunity("one"), contact: { id: "different" } }], [])), /Unexpected GoHighLevel contact/);
});

test("contact failures fail the CRM read rather than silently dropping contacts", async () => {
  const fixture = read([opportunity("one")], []);
  const call: GhlReadCall = async (input) => {
    if (input.path.startsWith("/contacts/")) throw new Error("Contact unavailable");
    return fixture(input);
  };
  await assert.rejects(ghlConversionsByPipeline(config, period, call), /Contact unavailable/);
});

test("changing contact tags changes the bucket on the next read without double counting", async () => {
  const one = contact("one");
  const call = read([opportunity("one")], [one]);
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[1, 0]]);
  one.tags.push("afspraak");
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[0, 1]]);
});

test("CRM pagination accepts flags, zero and numeric strings without mixing page and cursor pagination", async () => {
  for (const continuation of [true, "true", "2", 2]) for (const terminal of [false, "false", 0, "0", -1, "-1", "", null]) {
    const pages: unknown[] = [];
    const fixture = read([], [contact("first"), contact("second")]);
    const call: GhlReadCall = async (input) => {
      if (input.path !== "/opportunities/search") return fixture(input);
      const { query } = input;
      assert.equal(query?.locationId, "location"); assert.equal(query?.pipelineId, "project"); assert.equal(query?.status, "all");
      pages.push(query?.page);
      assert.equal(query?.startAfter, undefined); assert.equal(query?.startAfterId, undefined);
      return query?.page === 1 ? { opportunities: [opportunity("first")], meta: { nextPage: continuation } }
        : { opportunities: [opportunity("first"), opportunity("second")], meta: { nextPage: terminal } };
    };
    assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[2, 0]]);
    assert.deepEqual(pages, [1, 2]);
  }
});

test("pagination rejects repeated, backwards and failed pages instead of incomplete totals", async () => {
  let requests = 0;
  const fixture = read([], []);
  const call: GhlReadCall = async (input) => input.path !== "/opportunities/search" ? fixture(input)
    : (requests++, { opportunities: [opportunity("repeated")], meta: { nextPage: true } });
  await assert.rejects(ghlConversionsByPipeline(config, period, call), /Repeated GoHighLevel/);
  assert.equal(requests, 2);
  await assert.rejects(ghlConversionsByPipeline(config, period, read([], [], 1)), /Invalid GoHighLevel/);
  await assert.rejects(ghlConversionsByPipeline({ ...config, pipelineIds: ["missing"] }, period, read([], [])), /Unknown GoHighLevel/);
  await assert.rejects(ghlConversionsByPipeline(config, period, read([{ ...opportunity("one"), pipelineId: "other" }], [])), /Unexpected GoHighLevel pipeline/);
});

test("pipelines with over 100 contacts include the final page and fetch details with bounded concurrency", async () => {
  const contacts = Array.from({ length: 103 }, (_, index) => contact(String(index)));
  const fixture = read([], contacts);
  let active = 0, peak = 0;
  const pages: unknown[] = [];
  const call: GhlReadCall = async (input) => {
    if (input.path === "/opportunities/search") {
      pages.push(input.query?.page);
      return { opportunities: contacts.slice(input.query?.page === 1 ? 0 : 100, input.query?.page === 1 ? 100 : undefined).map(({ id }) => opportunity(id)) };
    }
    if (input.path.startsWith("/contacts/")) {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    }
    return fixture(input);
  };
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[103, 0]]);
  assert.deepEqual(pages, [1, 2]); assert.equal(peak, 4);
});

test("shared contacts are fetched once across pipelines and duplicate opportunity updates use the final contact", async () => {
  let requests = 0;
  const call: GhlReadCall = async ({ path, query }) => {
    if (path.endsWith("/pipelines")) return { pipelines: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
    if (path.startsWith("/contacts/")) { requests++; return { contact: contact("shared") }; }
    if (query?.pipelineId === "a" && query?.page === 1) return { opportunities: [{ id: "one", contactId: "old" }], meta: { nextPage: 2 } };
    return { opportunities: [{ id: "one", contactId: "shared" }, { id: "two", contactId: "shared" }], meta: { nextPage: null } };
  };
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, period, call)), [[1, 0], [1, 0]]);
  assert.equal(requests, 1);
});

test("year-long periods include contacts at both Brussels boundaries and in older months", async () => {
  const contacts = [contact("start", undefined, "2024-12-31T23:00:00Z"), contact("middle", undefined, "2025-03-01T12:00:00Z"),
    contact("end", ["ledoux", "afspraak"], "2025-12-31T22:59:59Z"), contact("outside", undefined, "2025-12-31T23:00:00Z")];
  assert.deepEqual(counts(await ghlConversionsByPipeline(config, { start: "2025-01-01", end: "2025-12-31" },
    read(contacts.map(({ id }) => opportunity(id)), contacts))), [[2, 1]]);
});

test("Villa Hippodrome brochure leads remain valid alongside contacts with empty or omitted tags", async () => {
  for (const untagged of [null, undefined, []]) {
    const fixture = read([
      opportunity("brochure", "villa-brochure"), opportunity("meeting", "villa-meeting"), opportunity("untagged")
    ], [
      contact("villa-brochure", ["brochure", "ledoux", "villa hippodrome"]),
      contact("villa-meeting", ["ledoux", "brochure", "afspraak", "villa hippodrome"])
    ]);
    const call: GhlReadCall = async (input) => input.path === "/contacts/untagged"
      ? { contact: { id: "untagged", locationId: "location", ...(untagged === undefined ? {} : { tags: untagged }) } }
      : fixture(input);
    const result = await ghlConversionsByPipeline(config, period, call);
    assert.deepEqual(counts(result), [[1, 1]]);
    assert.deepEqual(result[0]?.leadContactIds, ["villa-brochure"]);
    assert.deepEqual(result[0]?.appointmentContactIds, ["villa-meeting"]);
  }
});

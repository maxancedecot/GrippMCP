import test from "node:test";
import assert from "node:assert/strict";
import { countGhlAppointments, ghlConversionsByPipeline, isAppointmentStage, isNewLeadStage, type GhlReadCall } from "../src/ghl/appointmentConversions.js";

test("new leads recognize only the explicit new-lead stage", () => {
  for (const name of ["Nieuwe lead", " NIEUWE  LEAD ", "New lead", "New leads"]) assert.equal(isNewLeadStage(name), true, name);
  for (const name of ["Lead", "Lead opvolgen", "Gekwalificeerde lead", "Afspraak", "Nieuwe lead geannuleerd"]) {
    assert.equal(isNewLeadStage(name), false, name);
  }
});

test("appointment stages recognize Dutch and English labels but exclude cancelled stages", () => {
  for (const name of ["Afspraak", " AFSPRAAK  ", "Afspraak ingepland", "Appointment booked", "Appointment"]) {
    assert.equal(isAppointmentStage(name), true, name);
  }
  for (const name of ["Nieuwe lead", "Appointment cancelled", "Afspraak geannuleerd", "No-show meeting", "Consultation", "Bezichtiging", "Demo scheduled", "Intakegesprek", "Afspraak aanvragen", "Geen afspraak"]) {
    assert.equal(isAppointmentStage(name), false, name);
  }
});

test("CRM leads use creation date while appointments use stage date, deduplicating across pages", async () => {
  const pages: number[] = [];
  const lead = { id: "lead", pipelineId: "project", pipelineStageId: "new", createdAt: "2026-09-07T22:30:00Z" };
  const call: GhlReadCall = async ({ path, query, apiVersion }) => {
    assert.equal(apiVersion, "v3");
    if (path.endsWith("/pipelines")) return { pipelines: [{ id: "project", name: "Project", stages: [
      { id: "new", name: "New lead" }, { id: "meeting", name: "Appointment booked" }, { id: "cancelled", name: "Afspraak geannuleerd" }
    ] }] };
    assert.equal(query?.locationId, "location");
    assert.equal(query?.pipelineId, "project");
    assert.equal(query?.status, "all");
    pages.push(Number(query?.page));
    return query?.page === 1 ? { opportunities: [lead], meta: { nextPage: 2 } } : { opportunities: [
      lead,
      { id: "old-lead-new-meeting", pipelineId: "project", pipelineStageId: "meeting", createdAt: "2026-08-01T10:00:00Z", lastStageChangeAt: "2026-09-14T21:59:59Z" },
      { id: "new-lead-old-meeting", pipelineId: "project", pipelineStageId: "meeting", createdAt: "2026-09-08T10:00:00Z", lastStageChangeAt: "2026-09-07T21:59:59Z" },
      { id: "cancelled", pipelineId: "project", pipelineStageId: "cancelled", createdAt: "2026-09-08T10:00:00Z", lastStageChangeAt: "2026-09-08T10:00:00Z" },
      { id: "future", pipelineId: "project", pipelineStageId: "meeting", createdAt: "2026-09-14T22:00:00Z", lastStageChangeAt: "2026-09-14T22:00:00Z" }
    ], meta: { nextPage: null } };
  };
  const result = await ghlConversionsByPipeline({ locationId: "location", installId: "install" }, { start: "2026-09-08", end: "2026-09-14" }, call);
  assert.deepEqual(result, [{ pipelineId: "project", pipelineName: "Project", leads: 1, appointments: 1 }]);
  assert.deepEqual(pages, [1, 2]);
});

test("CRM counts preserve zero but never fabricate counts from malformed responses or missing dates", async () => {
  const config = { locationId: "location", installId: "install" }, period = { start: "2026-09-08", end: "2026-09-14" };
  const pipeline = { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }, { id: "meeting", name: "Appointment booked" }] }] };
  const read = (opportunities: unknown): GhlReadCall => async ({ path }) => path.endsWith("/pipelines") ? pipeline : opportunities;
  assert.deepEqual(await ghlConversionsByPipeline(config, period, read({ opportunities: [] })), [{ pipelineId: "project", pipelineName: "Project", leads: 0, appointments: 0 }]);
  assert.deepEqual(await ghlConversionsByPipeline(config, period, read({ opportunities: [{ id: "one", pipelineStageId: "meeting" }, { id: "two", pipelineStageId: "new" }] })),
    [{ pipelineId: "project", pipelineName: "Project", leads: null, appointments: null }]);
  await assert.rejects(ghlConversionsByPipeline(config, period, read({ error: "unauthorized" })));
  await assert.rejects(ghlConversionsByPipeline({ ...config, pipelineIds: ["missing"] }, period, read({ opportunities: [] })));
  await assert.rejects(ghlConversionsByPipeline(config, period, read({ opportunities: [{ id: "one", pipelineId: "other", pipelineStageId: "meeting" }] })));
  await assert.rejects(ghlConversionsByPipeline(config, period, read({ opportunities: [], meta: { nextPage: 1 } })));
});

test("GoHighLevel appointments count unique opportunities entering matching stages in the selected Brussels period", async () => {
  const calls: string[] = [];
  const call: GhlReadCall = async ({ path, query, apiVersion }) => {
    calls.push(`${path}:${query?.pipelineId ?? "pipelines"}:${query?.page ?? ""}:${apiVersion}`);
    if (path.endsWith("/pipelines")) return { pipelines: [
      { id: "project-a", name: "Project A", stages: [
        { id: "lead", name: "New lead" }, { id: "appointment", name: "Afspraak ingepland" },
        { id: "cancelled", name: "Appointment cancelled" }
      ] },
      { id: "ignored", name: "Other", stages: [{ id: "meeting", name: "Meeting booked" }] }
    ] };
    return { opportunities: [
      { id: "one", pipelineId: "project-a", pipelineStageId: "appointment", lastStageChangeAt: "2026-09-08T00:30:00+02:00" },
      { id: "old", pipelineId: "project-a", pipelineStageId: "appointment", lastStageChangeAt: "2026-09-07T23:59:59+02:00" },
      { id: "cancelled", pipelineId: "project-a", pipelineStageId: "cancelled", lastStageChangeAt: "2026-09-10T12:00:00Z" }
    ], meta: {} };
  };
  const count = await countGhlAppointments(
    { locationId: "location", installId: "install", pipelineIds: ["project-a"] },
    { start: "2026-09-08", end: "2026-09-14" }, call
  );
  assert.equal(count, 1);
  assert.deepEqual(calls, ["/opportunities/pipelines:pipelines::v3", "/opportunities/search:project-a:1:v3"]);
});

test("nullable appointment fields do not discard valid CRM lead dates", async () => {
  const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }, { id: "meeting", name: "Afspraak" }] }] }
    : { opportunities: [
      { id: "new", pipelineId: "project", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z", lastStageChangeAt: null },
      { id: "meeting", pipelineId: "project", pipelineStageId: "meeting", createdAt: "2026-09-10T12:00:00Z", lastStageChangeAt: null }
    ], meta: { nextPage: null } };
  assert.deepEqual(await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call),
    [{ pipelineId: "project", pipelineName: "Project", leads: 1, appointments: null }]);
});

test("moving a new lead into Afspraak changes its bucket without double counting", async () => {
  let stage = "new";
  const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [
      { id: "new", name: "Nieuwe lead" }, { id: "appointment", name: "Afspraak" },
      { id: "follow-up", name: "Lead opvolgen" }, { id: "cancelled", name: "Afspraak geannuleerd" }
    ] }] }
    : { opportunities: [
      { id: "one", pipelineStageId: stage, createdAt: "2026-09-10T12:00:00Z", lastStageChangeAt: "2026-09-11T12:00:00Z" },
      { id: "follow-up", pipelineStageId: "follow-up" }, { id: "cancelled", pipelineStageId: "cancelled" }
    ] };
  const count = () => ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call);
  assert.deepEqual((await count()).map(({ leads, appointments }) => [leads, appointments]), [[1, 0]]);
  stage = "appointment";
  assert.deepEqual((await count()).map(({ leads, appointments }) => [leads, appointments]), [[0, 1]]);
});

test("a stage change between paginated duplicates cannot count an opportunity in both buckets", async () => {
  const call: GhlReadCall = async ({ path, query }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [
      { id: "new", name: "Nieuwe lead" }, { id: "appointment", name: "Afspraak" }
    ] }] }
    : query?.page === 1
      ? { opportunities: [{ id: "one", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" }], meta: { nextPage: 2 } }
      : { opportunities: [
        { id: "one", pipelineStageId: "appointment", lastStageChangeAt: "2026-09-11T12:00:00Z" },
        { id: "two", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" }
      ], meta: { nextPage: null } };
  const counts = await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call);
  assert.deepEqual(counts.map(({ leads, appointments }) => [leads, appointments]), [[1, 1]]);
});

test("missing configured stages or opportunity stages leave counts unavailable", async () => {
  const config = { locationId: "location", installId: "install" }, period = { start: "2026-09-08", end: "2026-09-14" };
  const stages = [{ id: "new", name: "Nieuwe lead" }, { id: "appointment", name: "Afspraak" }];
  for (const missingStage of [null, undefined, "unknown"]) {
    const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
      ? { pipelines: [{ id: "project", name: "Project", stages }] }
      : { opportunities: [{ id: "one", pipelineStageId: missingStage, createdAt: "2026-09-10T12:00:00Z" }] };
    assert.deepEqual((await ghlConversionsByPipeline(config, period, call)).map(({ leads, appointments }) => [leads, appointments]), [[null, null]]);
  }
  for (const [configuredStages, expected] of [
    [[], [null, null]], [[stages[0]], [0, null]], [[stages[1]], [null, 0]]
  ] as const) {
    const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
      ? { pipelines: [{ id: "project", name: "Project", stages: configuredStages }] }
      : { opportunities: [] };
    assert.deepEqual((await ghlConversionsByPipeline(config, period, call)).map(({ leads, appointments }) => [leads, appointments]), [expected]);
  }
});

test("appointments do not require lead creation dates and missing lead dates only invalidate leads", async () => {
  let includeLead = false;
  const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [
      { id: "new", name: "Nieuwe lead" }, { id: "appointment", name: "Afspraak" }
    ] }] }
    : { opportunities: [
      { id: "one", pipelineStageId: "appointment", createdAt: null, lastStageChangeAt: "2026-09-10T12:00:00Z" },
      ...(includeLead ? [{ id: "two", pipelineStageId: "new" }] : [])
    ] };
  const count = () => ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call);
  assert.deepEqual((await count()).map(({ leads, appointments }) => [leads, appointments]), [[0, 1]]);
  includeLead = true;
  assert.deepEqual((await count()).map(({ leads, appointments }) => [leads, appointments]), [[null, 1]]);
});

test("CRM pagination accepts flags, zero and numeric strings without mixing page and cursor pagination", async () => {
  for (const continuation of [true, "true", "2", 2]) for (const terminal of [false, "false", 0, "0", -1, "-1", "", null]) {
    const pages: unknown[] = [];
    const call: GhlReadCall = async ({ path, query }) => {
      if (path.endsWith("/pipelines")) return { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }] }] };
      pages.push(query?.page);
      if (query?.page === 1) return { opportunities: [{ id: "first", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" }],
        meta: { nextPage: continuation, startAfter: 123, startAfterId: "first" } };
      assert.equal(query?.startAfter, undefined);
      assert.equal(query?.startAfterId, undefined);
      return { opportunities: [{ id: "second", pipelineStageId: "new", createdAt: "2026-09-11T12:00:00Z" }], meta: { nextPage: terminal } };
    };
    const result = await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
      { start: "2026-09-08", end: "2026-09-14" }, call);
    assert.equal(result[0]?.leads, 2);
    assert.deepEqual(pages, [1, 2]);
  }
});

test("CRM pagination rejects repeated pages rather than returning incomplete totals", async () => {
  let requests = 0;
  const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }] }] }
    : (requests++, { opportunities: [{ id: "repeated", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" }], meta: { nextPage: true } });
  await assert.rejects(ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call), /Repeated GoHighLevel/);
  assert.equal(requests, 2);
});

test("CRM pipelines with more than 100 leads count the entire last page", async () => {
  const pages: unknown[] = [];
  const call: GhlReadCall = async ({ path, query }) => {
    if (path.endsWith("/pipelines")) return { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }] }] };
    pages.push(query?.page);
    return query?.page === 1
      ? { opportunities: Array.from({ length: 100 }, (_, id) => ({ id: String(id), pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" })), meta: { nextPage: "2" } }
      : { opportunities: [{ id: "last", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z" }], meta: { nextPage: 0 } };
  };
  const result = await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call);
  assert.equal(result[0]?.leads, 101);
  assert.deepEqual(pages, [1, 2]);
});


test("a full-year CRM period includes old new leads and old stage changes at both boundaries", async () => {
  const call: GhlReadCall = async ({ path }) => path.endsWith("/pipelines")
    ? { pipelines: [{ id: "project", name: "Project", stages: [{ id: "new", name: "Nieuwe lead" }, { id: "meeting", name: "Afspraak" }] }] }
    : { opportunities: [
      { id: "old-lead", pipelineStageId: "new", createdAt: "2025-09-16T10:00:00Z" },
      { id: "outside-lead", pipelineStageId: "new", createdAt: "2025-09-15T10:00:00Z" },
      { id: "old-meeting", pipelineStageId: "meeting", createdAt: "2025-01-01T10:00:00Z", lastStageChangeAt: "2025-09-16T10:00:00Z" },
      { id: "recent-meeting", pipelineStageId: "meeting", lastStageChangeAt: "2026-09-15T10:00:00Z" },
      { id: "outside-meeting", pipelineStageId: "meeting", lastStageChangeAt: "2026-09-16T10:00:00Z" }
    ] };
  assert.deepEqual(await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2025-09-16", end: "2026-09-15" }, call), [{ pipelineId: "project", pipelineName: "Project", leads: 1, appointments: 2 }]);
});

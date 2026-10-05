import test from "node:test";
import assert from "node:assert/strict";
import { countGhlAppointments, ghlConversionsByPipeline, isAppointmentStage, type GhlReadCall } from "../src/ghl/appointmentConversions.js";

test("appointment stages recognize Dutch and English labels but exclude cancelled stages", () => {
  for (const name of ["Afspraak ingepland", "Appointment booked", "Consultation", "Bezichtiging", "Demo scheduled", "Intakegesprek"]) {
    assert.equal(isAppointmentStage(name), true, name);
  }
  for (const name of ["Nieuwe lead", "Appointment cancelled", "Afspraak geannuleerd", "No-show meeting"]) {
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
  assert.deepEqual(result, [{ pipelineId: "project", pipelineName: "Project", leads: 3, appointments: 1 }]);
  assert.deepEqual(pages, [1, 2]);
});

test("CRM counts preserve zero but never fabricate counts from malformed responses or missing dates", async () => {
  const config = { locationId: "location", installId: "install" }, period = { start: "2026-09-08", end: "2026-09-14" };
  const pipeline = { pipelines: [{ id: "project", name: "Project", stages: [{ id: "meeting", name: "Appointment booked" }] }] };
  const read = (opportunities: unknown): GhlReadCall => async ({ path }) => path.endsWith("/pipelines") ? pipeline : opportunities;
  assert.deepEqual(await ghlConversionsByPipeline(config, period, read({ opportunities: [] })), [{ pipelineId: "project", pipelineName: "Project", leads: 0, appointments: 0 }]);
  assert.deepEqual(await ghlConversionsByPipeline(config, period, read({ opportunities: [{ id: "one", pipelineStageId: "meeting" }] })),
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
    ? { pipelines: [{ id: "project", name: "Project", stages: [{ id: "meeting", name: "Afspraak" }] }] }
    : { opportunities: [
      { id: "new", pipelineId: "project", pipelineStageId: "new", createdAt: "2026-09-10T12:00:00Z", lastStageChangeAt: null },
      { id: "meeting", pipelineId: "project", pipelineStageId: "meeting", createdAt: "2026-09-10T12:00:00Z", lastStageChangeAt: null }
    ], meta: { nextPage: null } };
  assert.deepEqual(await ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call),
    [{ pipelineId: "project", pipelineName: "Project", leads: 2, appointments: null }]);
});

test("CRM pagination accepts flags, zero and numeric strings and follows provider cursors", async () => {
  for (const continuation of [true, "2", 2]) for (const terminal of [false, 0, "0", null]) {
    const pages: unknown[] = [];
    const call: GhlReadCall = async ({ path, query }) => {
      if (path.endsWith("/pipelines")) return { pipelines: [{ id: "project", name: "Project", stages: [] }] };
      pages.push(query?.page);
      if (query?.page === 1) return { opportunities: [{ id: "first", createdAt: "2026-09-10T12:00:00Z" }],
        meta: { nextPage: continuation, startAfter: 123, startAfterId: "first" } };
      assert.equal(query?.startAfter, 123);
      assert.equal(query?.startAfterId, "first");
      return { opportunities: [{ id: "second", createdAt: "2026-09-11T12:00:00Z" }], meta: { nextPage: terminal } };
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
    ? { pipelines: [{ id: "project", name: "Project", stages: [] }] }
    : (requests++, { opportunities: [{ id: "repeated", createdAt: "2026-09-10T12:00:00Z" }], meta: { nextPage: true } });
  await assert.rejects(ghlConversionsByPipeline({ locationId: "location", installId: "install" },
    { start: "2026-09-08", end: "2026-09-14" }, call), /Repeated GoHighLevel/);
  assert.equal(requests, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { countGhlAppointments, isAppointmentStage, type GhlReadCall } from "../src/ghl/appointmentConversions.js";

test("appointment stages recognize Dutch and English labels but exclude cancelled stages", () => {
  for (const name of ["Afspraak ingepland", "Appointment booked", "Consultation", "Bezichtiging", "Demo scheduled", "Intakegesprek"]) {
    assert.equal(isAppointmentStage(name), true, name);
  }
  for (const name of ["Nieuwe lead", "Appointment cancelled", "Afspraak geannuleerd", "No-show meeting"]) {
    assert.equal(isAppointmentStage(name), false, name);
  }
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

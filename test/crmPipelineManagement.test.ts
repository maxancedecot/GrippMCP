import test from "node:test";
import assert from "node:assert/strict";
import { CRM_PIPELINE_MATCHES_KEY, deleteCrmPipelineMatch, getCrmPipelineRevision, listCrmConnections,
  loadCrmPipelines, parseCrmPipelineMatches, readCrmPipelineMatches, saveCrmPipelineMatches } from "../src/crmPipelineManagement.js";
import type { CrmPipelineMatch } from "../src/crmPipelineManagement.js";
import type { GhlReadCall } from "../src/ghl/appointmentConversions.js";

function match(overrides: Partial<CrmPipelineMatch> = {}): CrmPipelineMatch {
  return { siteId: "site-a", sourcePath: "/alpha", locationId: "location", installId: "install", pipelineId: "one", pipelineName: "Social", ...overrides };
}
function memoryStore(initial: CrmPipelineMatch[] = []) {
  let value: unknown = initial;
  return { async read<T>(key: string) { assert.equal(key, CRM_PIPELINE_MATCHES_KEY); return structuredClone(value) as T; },
    async write(key: string, next: unknown) { assert.equal(key, CRM_PIPELINE_MATCHES_KEY); value = structuredClone(next); } };
}
const connections = [{ locationId: "location", installId: "install", label: "CRM" }];
const pages = [{ siteId: "site-a", path: "/alpha" }, { siteId: "site-b", path: "/beta" }];
const call: GhlReadCall = async ({ installId, path, query, apiVersion }) => {
  assert.equal(installId, "install"); assert.equal(path, "/opportunities/pipelines");
  assert.deepEqual(query, { locationId: "location" }); assert.equal(apiVersion, "v3");
  return { pipelines: [{ id: "one", name: "Social", stages: [] }, { id: "two", name: "Search", stages: [] }] };
};

test("CRM connections include installed locations and resolve existing configured accounts without exposing credentials", async () => {
  const result = await listCrmConnections({ installations: [
    { installId: "install", locationId: "location", expiresAt: 1, createdAt: 1, updatedAt: 1 },
    { installId: "agency", expiresAt: 1, createdAt: 1, updatedAt: 1 }
  ], mappings: [{ siteId: "site-a", ghl: { locationId: "location" } }], call: async ({ installId, path, apiVersion }) => {
    assert.equal(installId, "install"); assert.equal(path, "/locations/location"); assert.equal(apiVersion, "v3");
    return { location: { id: "location", name: "  Graanmolenhof  ", email: "private@example.test", phone: "private" } };
  } });
  assert.deepEqual(result, [{ locationId: "location", installId: "install", label: "Graanmolenhof" }]);
});

test("CRM subaccounts sort by name and keep working when one name lookup fails or returns another account", async () => {
  const installations = ["zeta", "alpha", "failed", "mismatch"].map((locationId) => ({
    installId: `install-${locationId}`, locationId, expiresAt: 1, createdAt: 1, updatedAt: 1
  }));
  const result = await listCrmConnections({ installations, call: async ({ path }) => {
    const locationId = path.split("/").at(-1);
    if (locationId === "failed") throw new Error("Forbidden");
    return { location: { id: locationId === "mismatch" ? "other" : locationId, name: locationId === "alpha" ? "Alice Buyssehof" : "Zeeduin" } };
  } });
  assert.deepEqual(result.map((item) => item.label), ["Alice Buyssehof", "CRM-subaccount failed", "CRM-subaccount mismatch", "Zeeduin"]);
  assert.equal(result.find((item) => item.locationId === "failed")?.installId, "install-failed");
});

test("validating CRM pipeline actions does not fetch subaccount names", async () => {
  const result = await listCrmConnections({ resolveNames: false, installations: [
    { installId: "install", locationId: "location", expiresAt: 1, createdAt: 1, updatedAt: 1 }
  ], call: async () => { assert.fail("Name requests are unnecessary for pipeline validation"); } });
  assert.deepEqual(result, connections.map((item) => ({ ...item, label: "CRM-subaccount location" })));
});

test("loading CRM pipelines validates the location and installation pair before calling the provider", async () => {
  assert.deepEqual(await loadCrmPipelines({ locationId: "location", installId: "install" }, { connections, call }), [
    { id: "one", name: "Social" }, { id: "two", name: "Search" }
  ]);
  let called = false;
  for (const input of [{ locationId: "other", installId: "install" }, { locationId: "location", installId: "other" }]) {
    await assert.rejects(loadCrmPipelines(input, { connections, call: async () => { called = true; return {}; } }));
  }
  assert.equal(called, false);
});

test("multiple CRM pipelines persist for one project and reassignment removes the old project without affecting other locations", async () => {
  const store = memoryStore([match(), match({ locationId: "other", pipelineId: "one" })]);
  const before = await getCrmPipelineRevision(store);
  const saved = await saveCrmPipelineMatches({ siteId: "site-b", sourcePath: "/beta/?utm_source=crm", locationId: "location",
    installId: "install", pipelineIds: ["one", "two", "one"] }, { connections, pages, store, call });
  assert.equal(saved.length, 2);
  assert.ok(saved.every((item) => item.siteId === "site-b" && item.sourcePath === "/beta"));
  assert.deepEqual(saved.map((item) => item.pipelineName), ["Social", "Search"]);
  assert.deepEqual(await readCrmPipelineMatches(store), [match({ locationId: "other", pipelineId: "one" }), ...saved]);
  assert.notEqual(await getCrmPipelineRevision(store), before);
  const firstRevision = await getCrmPipelineRevision(store);
  await saveCrmPipelineMatches({ siteId: "site-b", sourcePath: "/beta", locationId: "location", installId: "install", pipelineIds: ["one", "two"] },
    { connections, pages, store, call });
  assert.notEqual(await getCrmPipelineRevision(store), firstRevision, "re-saving refreshes the dashboard even when the assignment is unchanged");
  await deleteCrmPipelineMatch("location", "one", store);
  assert.deepEqual(await readCrmPipelineMatches(store), [match({ locationId: "other", pipelineId: "one" }), saved[1]]);
});

test("CRM storage corruption is surfaced instead of silently replacing saved mappings", async () => {
  const store = { async read<T>() { return { matches: "invalid", revision: "invalid" } as T; }, async write() { assert.fail("Must not overwrite invalid storage"); } };
  await assert.rejects(readCrmPipelineMatches(store));
  await assert.rejects(saveCrmPipelineMatches({ siteId: "site-a", sourcePath: "/alpha", locationId: "location", installId: "install", pipelineIds: ["one"] },
    { connections, pages, store, call }));
});

test("invalid CRM project, pipeline, and connection selections never write mappings", async () => {
  const store = memoryStore([match()]);
  const input = { siteId: "site-a", sourcePath: "/alpha", locationId: "location", installId: "install", pipelineIds: ["one"] };
  for (const bad of [
    { siteId: "unknown" }, { sourcePath: "/unknown" }, { sourcePath: "//other.example/project" },
    { sourcePath: "/bedankt" }, { sourcePath: "/preview/project" }, { sourcePath: "/alpha\\beta" },
    { pipelineIds: ["unknown"] }, { pipelineIds: [] }, { locationId: "unknown" }, { installId: "unknown" }
  ]) {
    await assert.rejects(saveCrmPipelineMatches({ ...input, ...bad }, { connections, pages, store, call }));
    assert.deepEqual(await readCrmPipelineMatches(store), [match()]);
  }
});

test("stored CRM mappings reject duplicate pipelines in the same location while accepting IDs reused across locations", () => {
  assert.throws(() => parseCrmPipelineMatches([match(), match({ siteId: "site-b", sourcePath: "/beta" })]));
  assert.equal(parseCrmPipelineMatches([match(), match({ locationId: "other" })]).length, 2);
});

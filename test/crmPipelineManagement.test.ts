import test from "node:test";
import assert from "node:assert/strict";
import { CRM_PIPELINE_MATCHES_KEY, deleteCrmPipelineMatch, getCrmPipelineRevision, listCrmConnections,
  getCrmConnectionInventory, loadCrmPipelines, parseCrmPipelineMatches, readCrmPipelineMatches, saveCrmPipelineMatches } from "../src/crmPipelineManagement.js";
import type { CrmPipelineMatch } from "../src/crmPipelineManagement.js";
import type { GhlReadCall } from "../src/ghl/appointmentConversions.js";
import { listAgencyCrmSubaccounts } from "../src/ghl/crmSubaccounts.js";
import { CrmPipelineLoadError } from "../src/crmPipelineErrors.js";

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

const agency = { installId: "agency", userType: "Company", companyId: "company", expiresAt: 1, createdAt: 1, updatedAt: 1 };

test("CRM inventory fetches every agency directory page and includes subaccounts without a stored location token", async () => {
  const skips: number[] = [];
  const inventory = await getCrmConnectionInventory({ installations: [agency,
    { installId: "direct", locationId: "location-0", expiresAt: 1, createdAt: 1, updatedAt: 1 }
  ], call: async ({ installId, path, apiVersion, query }) => {
    assert.equal(installId, "agency"); assert.equal(path, "/locations/search"); assert.equal(apiVersion, "v3");
    assert.equal(query?.companyId, "company"); assert.equal(query?.limit, 100);
    const skip = Number(query?.skip); skips.push(skip);
    return { locations: Array.from({ length: skip === 0 ? 100 : 2 }, (_, index) => ({
      id: `location-${skip + index}`, name: `Project ${skip + index}`, companyId: "company", email: "private@example.test"
    })) };
  } });
  assert.deepEqual(skips, [0, 100]);
  assert.equal(inventory.connections.length, 102);
  assert.equal(inventory.message, "");
  assert.deepEqual(inventory.connections.find((item) => item.locationId === "location-0"), {
    locationId: "location-0", installId: "direct", label: "Project 0"
  });
  assert.deepEqual(inventory.connections.find((item) => item.locationId === "location-101"), {
    locationId: "location-101", installId: "location-101", label: "Project 101",
    companyInstallId: "agency", companyId: "company", needsConnection: true
  });
  assert.doesNotMatch(JSON.stringify(inventory), /private@example/);
});

test("CRM directory deduplicates agency accounts and fills the connection for configured pages without a location token", async () => {
  const inventory = await getCrmConnectionInventory({ installations: [agency, { ...agency, installId: "second-agency" }],
    mappings: [{ siteId: "site-a", ghl: { locationId: "location" } }],
    call: async () => ({ locations: [{ id: "location", name: "Alpha", companyId: "company" }] }) });
  assert.equal(inventory.connections.length, 1);
  assert.deepEqual(inventory.connections[0], {
    locationId: "location", installId: "location", label: "Alpha", companyInstallId: "agency", companyId: "company", needsConnection: true
  });
});

test("agency directory errors report an incomplete list while preserving working direct connections", async () => {
  const installations = [agency, { installId: "install", locationId: "location", expiresAt: 1, createdAt: 1, updatedAt: 1 }];
  const inventory = await getCrmConnectionInventory({ installations, resolveNames: false,
    call: async () => { throw new Error("Forbidden secret-provider-details"); } });
  assert.deepEqual(inventory.connections, connections.map((item) => ({ ...item, label: "CRM-subaccount location" })));
  assert.match(inventory.message, /niet volledig/);
  assert.doesNotMatch(inventory.message, /secret-provider-details/);
  const standalone = await getCrmConnectionInventory({ installations: installations.slice(1), resolveNames: false });
  assert.match(standalone.message, /Alleen afzonderlijk verbonden/);
});

test("agency enumeration rejects repeated pages and subaccounts from an unrelated agency", async () => {
  let requests = 0;
  await assert.rejects(listAgencyCrmSubaccounts(agency, async () => {
    requests++;
    return { locations: Array.from({ length: 100 }, (_, index) => ({ id: `location-${index}`, name: "Alpha" })) };
  }), /Repeated/);
  assert.equal(requests, 2);
  await assert.rejects(listAgencyCrmSubaccounts(agency, async () => ({ locations: [{ id: "wrong", name: "Other", companyId: "other-company" }] })), /Unexpected agency/);
});

test("loading a discovered CRM account only creates a location token for the selected installed account", async () => {
  const selected = { locationId: "new", installId: "new", label: "New", companyInstallId: "agency", companyId: "company", needsConnection: true };
  const requests: string[] = [];
  const tokens: string[] = [];
  const pipelines = await loadCrmPipelines(selected, { connections: [selected], appId: "app",
    connectLocation: async (companyInstallId, locationId) => {
      assert.equal(companyInstallId, "agency"); tokens.push(locationId);
      return { installId: "new", locationId: "new" };
    }, call: async ({ installId, path, query, apiVersion }) => {
      requests.push(path); assert.equal(apiVersion, "v3");
      if (path === "/oauth/installed-locations") {
        assert.equal(installId, "agency");
        assert.deepEqual(query, { companyId: "company", appId: "app", locationId: "new", isInstalled: true, restrictToUserLocations: true, pageSize: 100 });
        return { items: [{ _id: "new", isInstalled: true }], pagination: {} };
      }
      assert.equal(installId, "new"); assert.equal(query?.locationId, "new");
      return { pipelines: [{ id: "one", name: "Social" }] };
    }
  });
  assert.deepEqual(tokens, ["new"]);
  assert.deepEqual(requests, ["/oauth/installed-locations", "/opportunities/pipelines"]);
  assert.deepEqual(pipelines, [{ id: "one", name: "Social" }]);
});

test("uninstalled, wrong, or inaccessible accounts cannot create location credentials or load pipelines", async () => {
  const selected = { locationId: "new", installId: "new", label: "New", companyInstallId: "agency", companyId: "company", needsConnection: true };
  for (const items of [[], [{ _id: "new", isInstalled: false }], [{ _id: "other", isInstalled: true }]]) {
    await assert.rejects(loadCrmPipelines(selected, { connections: [selected], appId: "app",
      connectLocation: async () => { assert.fail("No token may be created without an existing app authorization"); },
      call: async ({ path }) => { assert.equal(path, "/oauth/installed-locations"); return { items }; }
    }));
  }
  await assert.rejects(loadCrmPipelines({ ...selected, locationId: "unknown" }, { connections: [selected], appId: "app",
    call: async () => { assert.fail("Unknown accounts must be rejected before contacting the CRM"); }
  }));
});

test("installation verification finds the selected authorized subaccount on subsequent v3 pages", async () => {
  const selected = { locationId: "hbp", installId: "hbp", label: "HBP", companyInstallId: "agency", companyId: "company", needsConnection: true };
  let checks = 0, exchanges = 0;
  const pipelines = await loadCrmPipelines(selected, { connections: [selected], appId: "app",
    connectLocation: async (_, locationId) => { exchanges++; assert.equal(locationId, "hbp"); return { installId: "hbp", locationId: "hbp" }; },
    call: async ({ path, query }) => {
      if (path === "/opportunities/pipelines") return { pipelines: [{ id: "leads", name: "Leads" }] };
      checks++;
      assert.equal(query?.locationId, "hbp"); assert.equal(query?.restrictToUserLocations, true);
      return !query?.pageToken ? { items: [{ _id: "other", isInstalled: true }], pagination: { hasNextPage: true, nextPageToken: "second" } }
        : { items: [{ _id: "hbp", isInstalled: true }], pagination: { hasNextPage: false } };
    }
  });
  assert.deepEqual(pipelines, [{ id: "leads", name: "Leads" }]);
  assert.equal(checks, 2); assert.equal(exchanges, 1);
});

test("incomplete installation pagination cannot be mistaken for a missing app or create credentials", async () => {
  const selected = { locationId: "hbp", installId: "hbp", label: "HBP", companyInstallId: "agency", companyId: "company", needsConnection: true };
  for (const pagination of [{ hasNextPage: true }, { hasNextPage: true, nextPageToken: "repeated" }]) {
    await assert.rejects(loadCrmPipelines(selected, { connections: [selected], appId: "app",
      connectLocation: async () => { assert.fail("No credentials before authorization verification"); },
      call: async () => ({ items: [{ _id: "other", isInstalled: true }], pagination })
    }), (error: unknown) => error instanceof CrmPipelineLoadError && error.stage === "installation_check"
      && error.cause instanceof Error && /Incomplete/.test(error.cause.message));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { clientAssignmentKey, getDataManagementData, saveClientAccountManager } from "../src/dataManagement.js";
import type { JsonValue } from "../src/types.js";

function fixture() {
  const values = new Map<string, unknown>();
  const calls: { method: string; params: JsonValue[] }[] = [];
  const records: Record<string, JsonValue> = {
    "company.get": { data: [
      { id: 10, companyname: "Klant A", companyroles: ["CUSTOMER"], accountmanager: { id: "1" }, email: "private@example.test" },
      { "company.id": "11", "company.companyname": "Klant B", companyroles: ["LEAD"], active: false },
      { id: 12, companyname: "Leverancier", companyroles: ["SUPPLIER"] }
    ] },
    "employee.get": { records: [
      { id: 1, firstname: "Sam", lastname: "Janssens", active: true },
      { "employee.id": "2", "employee.screenname": "Alex", active: "1" },
      { id: 3, screenname: "Inactief", active: false }
    ] },
    "project.get": { result: { rows: [
      { "project.id": "100", "project.name": "Project A", "company.id": 10, "company.companyname": "Klant A" },
      { id: 101, name: "Project B", company: { id: 10 }, archived: true },
      { id: 102, name: "Project C", company: { value: "11" } },
      { id: 103, name: "Zonder klant", company: null }
    ] } }
  };
  const client = { async call(method: string, params: JsonValue[] = []) {
    calls.push({ method, params });
    assert.ok(method.endsWith(".get"), "The dashboard must never write to Gripp");
    return records[method];
  } };
  const store = {
    async read<T>(key: string): Promise<T | null> { return (values.get(key) as T) ?? null; },
    async readMany<T>(keys: string[]): Promise<(T | null)[]> { return keys.map((key) => (values.get(key) as T) ?? null); },
    async write(key: string, value: unknown) { values.set(key, structuredClone(value)); }
  };
  return { values, calls, records, client, store, now: new Date("2026-09-16T10:00:00Z") };
}

test("loads client-project relations and native managers without storing private Gripp fields", async () => {
  const options = fixture();
  const data = await getDataManagementData(options);
  assert.equal(data.error, "");
  assert.equal(data.canSave, true);
  assert.deepEqual(data.clients.map((client) => client.id), [10, 11]);
  assert.equal(data.clients[0].accountManagerId, 1);
  assert.equal(data.clients[0].assignmentSource, "gripp");
  assert.deepEqual(data.clients[0].projects.map((project) => project.id), [100, 101]);
  assert.equal(data.clients[0].projects[0].name, "Project A");
  assert.equal(data.clients[1].projects[0].id, 102);
  assert.equal(data.clients[1].active, false);
  assert.equal(data.unlinkedProjects, 1);
  assert.deepEqual(data.managers.map((manager) => manager.name), ["Alex", "Inactief", "Sam Janssens"]);
  assert.equal(data.managers.find((manager) => manager.id === 3)?.active, false);
  assert.ok(!JSON.stringify([...options.values.values()]).includes("private@example.test"));
});

test("saves and reloads dashboard assignments for all client projects, including explicit unlinking", async () => {
  const options = fixture();
  await saveClientAccountManager({ clientId: 10, managerId: 2 }, options);
  const reloaded = await getDataManagementData(options);
  assert.equal(reloaded.clients[0].accountManagerId, 2);
  assert.equal(reloaded.clients[0].assignmentSource, "dashboard");
  assert.equal(reloaded.clients[0].projects.length, 2);
  assert.equal(options.calls.length, 3, "Fresh catalog is reused for reload");
  await saveClientAccountManager({ clientId: 10, managerId: null }, options);
  const unlinked = await getDataManagementData(options);
  assert.equal(unlinked.clients[0].accountManagerId, null, "Explicit null must not fall back to native Gripp assignment");
  assert.equal(unlinked.clients[0].assignmentSource, "dashboard");
  assert.equal(options.calls.length, 3);
});

test("independent client saves persist without overwriting each other", async () => {
  const options = fixture();
  await getDataManagementData(options);
  await Promise.all([
    saveClientAccountManager({ clientId: 10, managerId: 2 }, options),
    saveClientAccountManager({ clientId: 11, managerId: 1 }, options)
  ]);
  assert.deepEqual((await getDataManagementData(options)).clients.map((client) => client.accountManagerId), [2, 1]);
});

test("rejects unknown clients, unknown or inactive employees, and malformed inputs without saving", async () => {
  const options = fixture();
  for (const input of [
    { clientId: 999, managerId: 1 }, { clientId: 10, managerId: 999 }, { clientId: 10, managerId: 3 },
    { clientId: -1, managerId: 1 }, { clientId: "10", managerId: 1 }, { clientId: 10, managerId: 1, extra: true }
  ]) await assert.rejects(saveClientAccountManager(input, options));
  assert.ok(![...options.values.keys()].some((key) => key.includes("client-account-manager")));
});

test("refreshing Gripp metadata preserves dashboard overrides", async () => {
  const options = fixture();
  await saveClientAccountManager({ clientId: 10, managerId: 2 }, options);
  const refreshed = await getDataManagementData({ ...options, force: true });
  assert.equal(options.calls.length, 6);
  assert.equal(refreshed.clients[0].accountManagerId, 2);
});

test("storage failures and invalid assignment scopes cannot show a successful save or silently wrong manager", async () => {
  const options = fixture();
  await getDataManagementData(options);
  await assert.rejects(saveClientAccountManager({ clientId: 10, managerId: 2 }, {
    ...options, store: { ...options.store, async write() { throw new Error("Storage unavailable"); } }
  }));
  options.values.set(clientAssignmentKey(10), { clientId: 11, managerId: 2, updatedAt: options.now.toISOString() });
  const data = await getDataManagementData(options);
  assert.equal(data.canSave, false);
  assert.equal(data.clients.length, 0);
  assert.notEqual(data.error, "");
});

test("paginates Gripp clients and rejects repeated pages or malformed responses", async () => {
  const options = fixture();
  const firstPage = Array.from({ length: 250 }, (_, index) => ({ id: index + 10, name: `Client ${index}`, companyroles: ["CUSTOMER"] }));
  const client = { async call(method: string, params: JsonValue[] = []) {
    if (method !== "company.get") return options.client.call(method, params);
    const page = params[1] as { paging: { firstresult: number } };
    return page.paging.firstresult === 0 ? firstPage : [{ id: 500, companyname: "Last client", companyroles: ["CUSTOMER"] }];
  } };
  const paged = await getDataManagementData({ ...options, client });
  assert.equal(paged.clients.length, 251);
  const repeated = await getDataManagementData({ ...options, force: true, client: {
    async call(method: string) { return method === "company.get" ? firstPage : []; }
  } });
  assert.notEqual(repeated.error, "");
  assert.equal(repeated.clients.length, 0);
  options.records["company.get"] = { error: "Permission denied" };
  const malformed = await getDataManagementData({ ...options, force: true });
  assert.equal(malformed.canSave, false);
  assert.notEqual(malformed.error, "");
});

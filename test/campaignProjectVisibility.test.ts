import test from "node:test";
import assert from "node:assert/strict";
import { readCampaignProjectVisibility, setCampaignProjectHidden } from "../src/campaignProjectVisibility.js";
import { filterCampaignProjectsByManager, summarizeFilteredCampaignProjects } from "../src/campaignAccountManagerFilter.js";
import type { CampaignProjectRow } from "../src/campaignProjects.js";
import type { ManagedProjectPage } from "../src/projectPageManagement.js";

function fixture() {
  const data = new Map<string, unknown>();
  const store = { readMany: async <T>(keys: string[]) => keys.map((key) => data.get(key) as T ?? null),
    write: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => { data.delete(key); } };
  return { data, store };
}
const pages = [{ siteId: "one", sourcePath: "/alpha" }, { siteId: "one", sourcePath: "/beta" }, { siteId: "two", sourcePath: "/alpha" }];

test("deleting persists by site and canonical page across snapshots and periods; restoring removes the preference", async () => {
  const f = fixture(); await setCampaignProjectHidden({ siteId: "one", path: "/alpha/?utm_source=facebook#section" }, true, f);
  for (const snapshot of [pages, structuredClone(pages)]) {
    const selection = await readCampaignProjectVisibility(snapshot, f);
    assert.equal(selection.canSave, true); assert.deepEqual([...selection.hiddenKeys], ["one:/alpha"]);
    assert.equal(selection.hiddenKeys.has("two:/alpha"), false);
  }
  await setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, false, f);
  assert.equal((await readCampaignProjectVisibility(pages, f)).hiddenKeys.size, 0); assert.equal(f.data.size, 0);
});

test("p_slug projects remain independent and repeated deletes and restores are idempotent", async () => {
  const f = fixture(); const input = { siteId: "one", path: "/?p_slug=alpha&utm_source=google" };
  await setCampaignProjectHidden(input, true, f); await setCampaignProjectHidden(input, true, f);
  assert.equal(f.data.size, 1);
  const selection = await readCampaignProjectVisibility([{ siteId: "one", sourcePath: "/?p_slug=alpha" }, { siteId: "one", sourcePath: "/?p_slug=beta" }, { siteId: "one", sourcePath: "/" }], f);
  assert.deepEqual([...selection.hiddenKeys], ["one:/?p_slug=alpha"]);
  await setCampaignProjectHidden(input, false, f); await setCampaignProjectHidden(input, false, f);
  assert.equal(f.data.size, 0);
});

test("simultaneous deletion of different rows preserves every choice", async () => {
  const f = fixture(); await Promise.all(pages.map((page) => setCampaignProjectHidden({ siteId: page.siteId, path: page.sourcePath }, true, f)));
  assert.equal(f.data.size, 3); assert.equal((await readCampaignProjectVisibility(pages, f)).hiddenKeys.size, 3);
  await setCampaignProjectHidden({ siteId: "one", path: "/beta" }, false, f);
  assert.deepEqual([...((await readCampaignProjectVisibility(pages, f)).hiddenKeys)], ["one:/alpha", "two:/alpha"]);
});

test("storage errors never report success or let saved deletions reappear", async () => {
  const f = fixture();
  await assert.rejects(setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, true, { store: { ...f.store, write: async () => { throw new Error("storage down"); } } }));
  await assert.rejects(setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, false, { store: { ...f.store, delete: async () => { throw new Error("storage down"); } } }));
  for (const readMany of [async <T>() => { throw new Error("storage down"); return [] as (T | null)[]; }, async <T>() => [] as (T | null)[],
    async <T>() => [{ siteId: "other", path: "/alpha", hiddenAt: new Date().toISOString() }, null, null] as (T | null)[]]) {
    const selection = await readCampaignProjectVisibility(pages, { store: { ...f.store, readMany } });
    assert.equal(selection.canSave, false); assert.equal(selection.hiddenKeys.size, 3); assert.match(selection.error, /tijdelijk verborgen/);
  }
});

test("invalid inputs cannot create deletion records and memory-only deployment disables deletion", async () => {
  const f = fixture();
  for (const input of [{ siteId: "", path: "/alpha" }, { siteId: "one", path: "https://other.test/" }, { siteId: "one", path: "//other.test/" },
    { siteId: "one", path: "/\\other.test" }, { siteId: "one", path: "" }, { siteId: "one", path: "/alpha", extra: true }]) {
    await assert.rejects(setCampaignProjectHidden(input, true, f));
  }
  assert.equal(f.data.size, 0);
  const before = process.env.JSON_CACHE_STORE; process.env.JSON_CACHE_STORE = "memory";
  try {
    const selection = await readCampaignProjectVisibility(pages);
    assert.equal(selection.canSave, false); assert.match(selection.error, /permanente opslag/);
    await assert.rejects(setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, true));
  } finally { if (before === undefined) delete process.env.JSON_CACHE_STORE; else process.env.JSON_CACHE_STORE = before; }
});

test("hidden rows leave CRM totals but retain the manager filter and restoration list", async () => {
  const f = fixture(); await setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, true, f);
  const visibility = await readCampaignProjectVisibility(pages, f);
  const projects: CampaignProjectRow[] = pages.map((page, i) => ({ ...page, key: `${page.siteId}:${page.sourcePath}`, siteName: page.siteId,
    title: page.sourcePath, url: `https://example.test${page.sourcePath}`, visitors: 100, leads: i + 1, appointments: 1,
    leadSource: "crm", appointmentSource: "crm", cvr: (i + 2), hasConversionMapping: true,
    facebookState: "not_configured", googleState: "not_configured", campaigns: [], googleCampaigns: [] }));
  const assignments = Object.fromEntries(projects.map((project, i) => [project.key, { accountManagerId: i + 1, accountManagerName: `Manager ${i + 1}` }])) as Record<string, ManagedProjectPage>;
  const visible = filterCampaignProjectsByManager(projects, assignments, undefined, visibility.hiddenKeys);
  assert.deepEqual(visible.projects.map((project) => project.key), ["one:/beta", "two:/alpha"]);
  assert.equal(visible.totalProjects, 2); assert.equal(summarizeFilteredCampaignProjects(visible.projects).leads, 5);
  assert.equal(summarizeFilteredCampaignProjects(visible.projects).appointments, 2);
  const manager = filterCampaignProjectsByManager(projects, assignments, "1", visibility.hiddenKeys);
  assert.equal(manager.selectedManager, "1"); assert.equal(manager.projects.length, 0); assert.equal(manager.hiddenProjects.length, 1);
  assert.ok(manager.managers.some(([id]) => id === "1"));
  await setCampaignProjectHidden({ siteId: "one", path: "/alpha" }, false, f);
  const restored = filterCampaignProjectsByManager(projects, assignments, "1", (await readCampaignProjectVisibility(pages, f)).hiddenKeys);
  assert.equal(restored.projects.length, 1); assert.equal(restored.hiddenProjects.length, 0);
});

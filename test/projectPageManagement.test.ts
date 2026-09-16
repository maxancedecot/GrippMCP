import test from "node:test";
import assert from "node:assert/strict";
import { getProjectPageManagementData, pageAssignmentKey, projectPagesFromDashboard, resolveProjectPage, saveProjectPageManager, type ProjectPage } from "../src/projectPageManagement.js";
import type { GrippDataCatalog } from "../src/dataManagement.js";
import type { SiteAnalyticsDashboardData } from "../src/siteAnalytics.js";

function fixture() {
  const catalog: GrippDataCatalog = {
    fetchedAt: "2026-09-16T10:00:00Z",
    clients: [
      { id: 10, name: "THUZ NV", active: true, accountManagerId: 1, website: "https://thuz.be" },
      { id: 11, name: "Mees", active: true, accountManagerId: 2, website: "" },
      { id: 12, name: "Zonder manager", active: true, accountManagerId: null, website: "" }
    ],
    managers: [{ id: 1, name: "Pieter", active: true }, { id: 2, name: "Tristan", active: true }, { id: 3, name: "Inactief", active: false }],
    projects: [
      { id: 100, name: "Hugo Verriest", clientId: 10, archived: false, accountManagerId: 2 },
      { id: 101, name: "Onderhoud Hugo Verriest", clientId: 10, archived: false, accountManagerId: null },
      { id: 102, name: "Crollet", clientId: 11, archived: false, accountManagerId: null },
      { id: 103, name: "Groene Wandeling", clientId: 12, archived: false, accountManagerId: null }
    ]
  };
  const values = new Map<string, unknown>();
  const store = {
    async read<T>(key: string): Promise<T | null> { return (values.get(key) as T) ?? null; },
    async readMany<T>(keys: string[]): Promise<(T | null)[]> { return keys.map((key) => (values.get(key) as T) ?? null); },
    async write(key: string, value: unknown) { values.set(key, structuredClone(value)); }
  };
  return { catalog, store, values, pages: [page("/aanbod/hugo-verriest", "Hugo Verriest - Thuz")], now: new Date(catalog.fetchedAt) };
}
function page(path = "/", title = "Home", siteId = "thuz", siteName = "Thuz", host = "thuz.be"): ProjectPage {
  return { siteId, siteName, path, title, url: `https://${host}${path}` };
}

test("project pages inherit the matched Gripp client's manager before the project manager", () => {
  const { catalog, pages } = fixture();
  const result = resolveProjectPage(pages[0], catalog);
  assert.equal(result.accountManagerName, "Pieter");
  assert.equal(result.clientName, "THUZ NV");
  assert.equal(result.source, "gripp");
  assert.equal(result.needsAssignment, false);
  assert.equal(resolveProjectPage(page("/", "Home", "thuz", "Thuz"), catalog).accountManagerId, 1);
});

test("matches joined domains and small spelling differences, but leaves missing managers unresolved", () => {
  const { catalog } = fixture();
  const missing = resolveProjectPage(page("/", "Home", "groen", "Groenewandeling", "groenewandeling.gent"), catalog);
  assert.equal(missing.clientName, "Zonder manager");
  assert.equal(missing.needsAssignment, true);
  assert.match(missing.reason, /geen accountmanager/);
  catalog.projects.push({ id: 104, name: "Alice Buysehof", clientId: 11, archived: false, accountManagerId: null });
  assert.equal(resolveProjectPage(page("/", "Home", "alice", "alice-buyssehof.be", "alice-buyssehof.be"), catalog).accountManagerId, 2);
});

test("ambiguous matches, inactive managers and unrelated generic project names require manual assignment", () => {
  const { catalog, pages } = fixture();
  catalog.projects.push({ ...catalog.projects[0], id: 105, clientId: 11 });
  assert.equal(resolveProjectPage(pages[0], catalog).needsAssignment, true);
  assert.match(resolveProjectPage(pages[0], catalog).reason, /verschillende accountmanagers/);
  catalog.clients[1].accountManagerId = 3;
  assert.equal(resolveProjectPage(page("/crollet", "Crollet", "mees", "M-development", "m-development.be"), catalog).needsAssignment, true);
  catalog.projects.push({ id: 106, name: "Website & marketing onderhoud", clientId: 11, archived: false, accountManagerId: null });
  const unknown = resolveProjectPage(page("/", "Website", "unknown", "Unknown", "unrelated.be"), catalog);
  assert.equal(unknown.accountManagerId, null);
  assert.equal(unknown.clientName, null);
  catalog.projects.push({ id: 107, name: "Aftermovie investment days (FR)", clientId: 11, archived: false, accountManagerId: null });
  assert.equal(resolveProjectPage(page("/fr", "Thuz"), catalog).accountManagerId, 1, "A language code must not match an unrelated project");
});

test("saved page assignments persist, stay scoped by site/path and can revert to Gripp", async () => {
  const options = fixture();
  options.pages.push(page("/aanbod/hugo-verriest", "Hugo Verriest", "other", "Other", "other.be"));
  const saved = await saveProjectPageManager({ siteId: "thuz", path: "/aanbod/hugo-verriest/", managerId: 2 }, options);
  assert.equal(saved.source, "manual");
  const loaded = await getProjectPageManagementData({ ...options, force: true });
  assert.deepEqual(loaded.pages.map((page) => page.accountManagerId), [2, 1]);
  assert.equal(loaded.pages[0].source, "manual");
  assert.equal(options.values.size, 1, "Only a dashboard page override is written");
  const reset = await saveProjectPageManager({ siteId: "thuz", path: "/aanbod/hugo-verriest", managerId: null }, options);
  assert.equal(reset.source, "gripp");
  assert.equal(reset.accountManagerId, 1);
  assert.equal((await getProjectPageManagementData(options)).pages[0].accountManagerId, 1);
});

test("rejects unknown pages, invalid paths and inactive managers; storage errors cannot report success", async () => {
  const options = fixture();
  for (const input of [
    { siteId: "thuz", path: "/other", managerId: 1 },
    { siteId: "thuz", path: "/aanbod/hugo-verriest", managerId: 3 },
    { siteId: "thuz", path: "//evil.example", managerId: 1 },
    { siteId: "thuz", path: "/?preview=true", managerId: 1 },
    { siteId: "thuz", path: "/aanbod/hugo-verriest", managerId: 999 }
  ]) await assert.rejects(saveProjectPageManager(input, options));
  assert.equal(options.values.size, 0);
  await assert.rejects(saveProjectPageManager({ siteId: "thuz", path: options.pages[0].path, managerId: 2 }, {
    ...options, store: { ...options.store, async write() { throw new Error("Unavailable"); } }
  }));
  options.values.set(pageAssignmentKey(options.pages[0]), { siteId: "wrong-site", path: options.pages[0].path, managerId: 2, updatedAt: options.now.toISOString() });
  const invalid = await getProjectPageManagementData(options);
  assert.equal(invalid.canSave, false);
  assert.notEqual(invalid.error, "");
});

test("inventory uses actual website pages and saved project links, excluding tooling, assets and thank-you pages", () => {
  const dashboard = {
    sites: [{ id: "thuz", name: "Thuz", url: "https://thuz.be" }, { id: "preview", name: "Preview", url: "https://sites.leadconnectorhq.com" }],
    cvrPageCandidates: ["/aanbod/hugo-verriest", "/contact", "/privacy", "/bedankt", "/brochure.pdf", "/?elementor=1"].map((path) => ({ siteId: "thuz", path, title: path })),
    cvrLinks: [{ siteId: "thuz", sourcePath: "/aanbod/hugo-verriest/", sourceTitle: "Hugo Verriest" }]
  } as SiteAnalyticsDashboardData;
  const pages = projectPagesFromDashboard(dashboard, [{ siteId: "thuz", path: "/aanbod/nieuw-project" }, { siteId: "thuz", path: "/preview/test" }]);
  assert.deepEqual(pages.map((page) => page.path), ["/", "/aanbod/hugo-verriest", "/aanbod/nieuw-project"]);
  assert.equal(pages[1].title, "Hugo Verriest");
});

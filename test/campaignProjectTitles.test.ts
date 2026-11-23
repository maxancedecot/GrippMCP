import test from "node:test";
import assert from "node:assert/strict";
import { applyCampaignProjectTitles, readCampaignProjectTitles, saveCampaignProjectTitle } from "../src/campaignProjectTitles.js";
import { filterCampaignPerformanceViewData } from "../app/dashboard/campaign-performance.js";
import { getCampaignPerformance } from "../src/campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "../src/siteAnalytics.js";

function fixture() {
  const data = new Map<string, unknown>();
  const store = {
    readMany: async <T>(keys: string[]) => keys.map((key) => structuredClone(data.get(key) as T ?? null)),
    write: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }
  };
  return { data, store };
}
const projects = [
  { siteId: "one", sourcePath: "/alpha", title: "Original Alpha", leads: 5 },
  { siteId: "one", sourcePath: "/beta", title: "Original Beta", leads: 2 },
  { siteId: "two", sourcePath: "/alpha", title: "Other Alpha", leads: 3 }
];

test("project titles persist across refreshed snapshots and periods, scoped by site and canonical page", async () => {
  const f = fixture();
  assert.equal(await saveCampaignProjectTitle({ siteId: "one", path: "/alpha/?utm_source=facebook#section", title: "  Nieuwe projectnaam  " }, f), "Nieuwe projectnaam");
  for (const snapshot of [projects, structuredClone(projects)]) {
    const titles = await readCampaignProjectTitles(snapshot, f);
    assert.equal(titles.canSave, true);
    const renamed = applyCampaignProjectTitles(snapshot, titles);
    assert.deepEqual(renamed.map((project) => project.title), ["Nieuwe projectnaam", "Original Beta", "Other Alpha"]);
    assert.deepEqual(renamed.map((project) => project.leads), [5, 2, 3]);
    assert.equal(snapshot[0].title, "Original Alpha", "never mutate source snapshots or matching names");
  }
});

test("simultaneous renames do not overwrite other projects and each page can be renamed again", async () => {
  const f = fixture();
  await Promise.all(projects.map((project, index) => saveCampaignProjectTitle({ siteId: project.siteId, path: project.sourcePath, title: `Project ${index}` }, f)));
  await saveCampaignProjectTitle({ siteId: "one", path: "/alpha", title: "Gewijzigd" }, f);
  assert.equal(f.data.size, 3);
  assert.deepEqual(applyCampaignProjectTitles(projects, await readCampaignProjectTitles(projects, f)).map((project) => project.title), ["Gewijzigd", "Project 1", "Project 2"]);
});

test("query-based project pages keep independent names and grouped pages use their canonical row", async () => {
  const f = fixture();
  const pages = ["/?p_slug=alpha", "/?p_slug=beta", "/"].map((sourcePath) => ({ siteId: "one", sourcePath, title: sourcePath }));
  await saveCampaignProjectTitle({ siteId: "one", path: "/?utm_source=google&p_slug=alpha", title: "Alpha" }, f);
  const named = applyCampaignProjectTitles(pages, await readCampaignProjectTitles(pages, f));
  assert.deepEqual(named.map((page) => page.title), ["Alpha", "/?p_slug=beta", "/"]);
  const group = [{ siteId: "one", sourcePath: "/group", sourcePaths: ["/group", "/group-fr"], title: "Original group" }];
  await saveCampaignProjectTitle({ siteId: "one", path: "/group", title: "Mijn projectgroep" }, f);
  const renamed = applyCampaignProjectTitles(group, await readCampaignProjectTitles(group, f));
  assert.equal(renamed[0].title, "Mijn projectgroep");
  assert.deepEqual(renamed[0].sourcePaths, group[0].sourcePaths);
});

test("invalid names and paths cannot be saved and storage failure never reports success", async () => {
  const f = fixture();
  const valid = { siteId: "one", path: "/alpha", title: "Alpha" };
  for (const input of [{ ...valid, title: "" }, { ...valid, title: "  " }, { ...valid, title: "x".repeat(181) },
    { ...valid, title: "Two\nlines" }, { ...valid, title: "A\u0000B" }, { ...valid, siteId: "" },
    { ...valid, path: "https://other.test/" }, { ...valid, path: "//other.test/" }, { ...valid, path: "/\\other.test" },
    { ...valid, path: "" }, { ...valid, extra: true }]) {
    await assert.rejects(saveCampaignProjectTitle(input, f));
  }
  assert.equal(f.data.size, 0);
  await assert.rejects(saveCampaignProjectTitle(valid, { store: { ...f.store, write: async () => { throw new Error("storage down"); } } }));
});

test("unavailable or mismatched saved titles preserve performance rows and disable editing", async () => {
  const f = fixture();
  for (const readMany of [async <T>() => { throw new Error("storage down"); return [] as (T | null)[]; },
    async <T>() => [] as (T | null)[],
    async <T>() => [{ siteId: "other", path: "/alpha", title: "Wrong scope", updatedAt: new Date().toISOString() }, null, null] as (T | null)[]]) {
    const titles = await readCampaignProjectTitles(projects, { store: { ...f.store, readMany } });
    assert.equal(titles.canSave, false); assert.match(titles.error, /niet worden geladen/);
    assert.deepEqual(applyCampaignProjectTitles(projects, titles), projects);
  }
  const before = process.env.JSON_CACHE_STORE;
  process.env.JSON_CACHE_STORE = "memory";
  try {
    const titles = await readCampaignProjectTitles(projects);
    assert.equal(titles.canSave, false); assert.match(titles.error, /permanente opslag/);
    await assert.rejects(saveCampaignProjectTitle({ siteId: "one", path: "/alpha", title: "Alpha" }));
  } finally { if (before === undefined) delete process.env.JSON_CACHE_STORE; else process.env.JSON_CACHE_STORE = before; }
});

test("fresh project names overlay cached performance and hidden rows without altering metrics or account-manager matches", async () => {
  const f = fixture();
  const totals = { pageViews: 100, uniqueVisitors: 60, sessions: 70, avgTimeOnPageSeconds: 20, avgScrollPercent: 50 };
  const dashboard: SiteAnalyticsDashboardData = {
    source: { mode: "live", message: "" }, period: { days: 7, start: "2026-09-08", end: "2026-09-14", label: "Laatste 7 dagen" }, totals,
    sites: [{ id: "one", name: "One", url: "https://one.example", ...totals, cvrSourceVisitors: 50, cvrConversionVisitors: 5, cvrLinkCount: 1, conversionRatePercent: 10 }],
    dailyRows: [], pageRows: [], referrerRows: [], cvrPageCandidates: [], lastUpdated: "14/09/2026",
    cvrLinks: [{ id: "link", siteId: "one", siteName: "One", sourcePath: "/alpha", sourceTitle: "Original Alpha", targetPath: "/bedankt-brochure", targetTitle: "Bedankt",
      createdAt: "2026-09-01", updatedAt: "2026-09-01", sourceVisitors: 50, sourcePageViews: 80, targetVisitors: 5, targetPageViews: 5, conversionRatePercent: 10, dailySeries: [] }]
  };
  const performance = await getCampaignPerformance(dashboard, { env: {} });
  const manager = { key: "one:/alpha", siteId: "one", siteName: "One", path: "/alpha", title: "Original Alpha", url: "https://one.example/alpha",
    accountManagerId: 7, accountManagerName: "Manager", clientName: null, grippProjectName: null, source: "manual" as const, reason: "", needsAssignment: false };
  const base = { ...performance, managers: [manager], accountManagers: { "one:/alpha": manager } };
  await saveCampaignProjectTitle({ siteId: "one", path: "/alpha", title: "Nieuwe projectnaam" }, f);
  const titles = await readCampaignProjectTitles(base.projects, f);
  const view = filterCampaignPerformanceViewData(base, "7", undefined, { hiddenKeys: new Set(), canSave: true, error: "" }, titles);
  assert.equal(view.canRenameProjects, true);
  assert.equal(view.projects[0].title, "Nieuwe projectnaam");
  assert.equal(view.projects[0].leads, base.projects[0].leads);
  assert.equal(view.projects[0].cvr, base.projects[0].cvr);
  assert.equal(view.projects[0].url, base.projects[0].url);
  assert.equal(base.projects[0].title, "Original Alpha");
  assert.equal(view.accountManagers["one:/alpha"].title, "Original Alpha");
  const hidden = filterCampaignPerformanceViewData(base, "7", undefined, { hiddenKeys: new Set(["one:/alpha"]), canSave: true, error: "" }, titles);
  assert.equal(hidden.projects.length, 0);
  assert.equal(hidden.hiddenProjects[0].title, "Nieuwe projectnaam");
});

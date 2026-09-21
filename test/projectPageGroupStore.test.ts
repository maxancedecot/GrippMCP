import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteProjectPageGroup,
  getProjectPageGroupRevision,
  getProjectPageGroupsForSites,
  saveProjectPageGroup
} from "../src/projectPageGroupStore.js";
import { cvrOverviewRowsFromLinks } from "../src/siteAnalyticsConversions.js";
import type { SiteAnalyticsCvrLinkRow, SiteAnalyticsProjectPageGroup } from "../src/siteAnalytics.js";

function fixture() {
  let value: unknown = null;
  const store = {
    async read<T>() { return value as T | null; },
    async write(_key: string, next: unknown) { value = structuredClone(next); }
  };
  const sites = [{ id: "site-a", url: "https://site-a.example" }];
  const pages = ["/project", "/project-fr/", "/project-en", "/bedankt"].map((path) => ({ siteId: "site-a", path, title: path }));
  return { store, sites, pages };
}

test("project pages can be merged into one persisted group with a primary page", async () => {
  const options = fixture();
  const group = await saveProjectPageGroup({
    siteId: "site-a",
    title: "Project One",
    sourcePath: "/project/",
    sourcePaths: ["/project/", "/project-fr/", "/project-en"]
  }, { ...options, now: new Date("2026-09-21T10:00:00.000Z") });

  assert.equal(group.sourcePath, "/project");
  assert.deepEqual(group.sourcePaths, ["/project", "/project-fr", "/project-en"]);
  assert.equal(group.managed, true);
  assert.equal((await getProjectPageGroupsForSites(options.sites, options))[0].title, "Project One");
  assert.equal(await getProjectPageGroupRevision(options), "2026-09-21T10:00:00.000Z");
  assert.equal(await deleteProjectPageGroup(group.id, { ...options, now: new Date("2026-09-21T10:05:00.000Z") }), true);
  assert.deepEqual(await getProjectPageGroupsForSites(options.sites, options), []);
});

test("project groups reject overlapping, unknown and thank-you pages", async () => {
  const options = fixture();
  await saveProjectPageGroup({ siteId: "site-a", title: "First", sourcePath: "/project", sourcePaths: ["/project", "/project-fr"] }, options);
  await assert.rejects(saveProjectPageGroup({ siteId: "site-a", title: "Overlap", sourcePath: "/project-fr", sourcePaths: ["/project-fr", "/project-en"] }, options));
  await assert.rejects(saveProjectPageGroup({ siteId: "site-a", title: "Unknown", sourcePath: "/project-en", sourcePaths: ["/project-en", "/missing"] }, options));
  await assert.rejects(saveProjectPageGroup({ siteId: "site-a", title: "Conversion", sourcePath: "/project-en", sourcePaths: ["/project-en", "/bedankt"] }, options));
});

test("CVR overview replaces member rows with deduplicated group totals", () => {
  const link = (sourcePath: string, targetPath: string, targetVisitors: number): SiteAnalyticsCvrLinkRow => ({
    id: `${sourcePath}:${targetPath}`, siteId: "site-a", siteName: "Site A", sourcePath, sourceTitle: sourcePath,
    targetPath, targetTitle: targetPath, createdAt: "2026-09-21T10:00:00.000Z", updatedAt: "2026-09-21T10:00:00.000Z",
    sourceVisitors: 10, sourcePageViews: 12, targetVisitors, targetPageViews: targetVisitors,
    conversionRatePercent: targetVisitors * 10, dailySeries: []
  });
  const group: SiteAnalyticsProjectPageGroup = {
    groupId: "group", siteId: "site-a", title: "Project One", sourcePath: "/project",
    sourcePaths: ["/project", "/project-fr", "/project-en"], managed: true,
    visitors: 24, pageViews: 40, leads: 5, appointments: 3
  };
  const rows = cvrOverviewRowsFromLinks([
    link("/project", "/bedankt-brochure", 3),
    link("/project-fr", "/bedankt-afspraak", 2)
  ], [group]);
  assert.deepEqual(rows.map((row) => [row.sourceTitle, row.sourceVisitors, row.brochure.visitors, row.appointment.visitors]), [
    ["Project One", 24, 5, 3]
  ]);
});

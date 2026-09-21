import test from "node:test";
import assert from "node:assert/strict";
import { filterCampaignProjectsByManager, summarizeFilteredCampaignProjects } from "../src/campaignAccountManagerFilter.js";
import type { CampaignProjectRow } from "../src/campaignProjects.js";
import type { ManagedProjectPage } from "../src/projectPageManagement.js";

const project = (key: string, siteId: string, path: string, visitors: number, leads: number, appointments: number): CampaignProjectRow => ({
  key, siteId, siteName: siteId, sourcePath: path, url: `https://${siteId}.example${path}`, title: key,
  visitors, leads, appointments, cvr: visitors ? (leads + appointments) / visitors * 100 : 0,
  hasConversionMapping: true, facebookState: "connected", campaigns: [], googleState: "connected", googleCampaigns: []
});

const projects = [project("one:/a", "one", "/a", 100, 5, 2), project("one:/b", "one", "/b", 50, 1, 1),
  project("two:/c", "two", "/c", 25, 0, 1)];
const assignment = (key: string, id: number | null, name: string | null): ManagedProjectPage => ({
  key, siteId: key.split(":")[0], siteName: key, path: key.slice(key.indexOf(":") + 1), title: key, url: "https://example.test",
  accountManagerId: id, accountManagerName: name, source: id === null ? "unmatched" : "gripp", reason: "",
  clientName: null, grippProjectName: null, needsAssignment: id === null
});
const assignments = {
  "one:/a": assignment("one:/a", 2, "Zoë"),
  "one:/b": assignment("one:/b", 1, "Adam"),
  "two:/c": assignment("two:/c", null, null)
};

test("account manager filtering selects every page section from the same project set", () => {
  const filtered = filterCampaignProjectsByManager(projects, assignments, "2");
  assert.deepEqual(filtered.managers, [["1", "Adam"], ["2", "Zoë"]]);
  assert.deepEqual(filtered.projects.map((item) => item.key), ["one:/a"]);
  const summary = summarizeFilteredCampaignProjects(filtered.projects);
  assert.deepEqual({ ...summary, conversionRate: Math.round(summary.conversionRate ?? 0) }, {
    visitors: 100, leads: 5, appointments: 2, conversionRate: 7,
    measuredProjects: 1, leadProjects: 1, appointmentProjects: 1
  });
  assert.deepEqual(filterCampaignProjectsByManager(projects, assignments, "unassigned").projects.map((item) => item.key), ["two:/c"]);
  assert.equal(filterCampaignProjectsByManager(projects, assignments, "unknown").selectedManager, "");
});

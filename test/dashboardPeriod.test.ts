import test from "node:test";
import assert from "node:assert/strict";
import { accountManagerHref, dashboardHref, dashboardPeriodSelection, siteAnalyticsPeriod } from "../src/dashboardPeriod.js";

const now = new Date("2026-09-15T12:00:00Z");

test("custom periods include both boundaries and calendar days across leap years and DST", () => {
  assert.deepEqual(siteAnalyticsPeriod({ start: "2026-09-08", end: "2026-09-14" }, now), {
    days: 7, start: "2026-09-08", end: "2026-09-14", label: "08/09/2026 – 14/09/2026"
  });
  assert.equal(siteAnalyticsPeriod({ start: "2026-09-15", end: "2026-09-15" }, now).days, 1);
  assert.equal(siteAnalyticsPeriod({ start: "2024-02-28", end: "2024-03-01" }, now).days, 3);
  assert.equal(siteAnalyticsPeriod({ start: "2026-03-28", end: "2026-03-30" }, now).days, 3);
  assert.equal(siteAnalyticsPeriod({ start: "2025-10-25", end: "2025-10-27" }, now).days, 3);
  assert.equal(siteAnalyticsPeriod({ start: "2026-06-18", end: "2026-09-15" }, now).days, 90);
});

test("invalid dates and oversized periods cannot silently become a different API range", () => {
  for (const range of [
    { start: "2026-02-29", end: "2026-03-01" }, { start: "2026-09-15" },
    { end: "2026-09-15" }, { start: "", end: "2026-09-15" },
    { start: "2026-9-01", end: "2026-09-15" }, { start: "2026-09-14", end: "2026-09-13" },
    { start: "2026-09-15", end: "2026-09-16" }, { start: "2026-06-17", end: "2026-09-15" },
    { start: "2026-09-01' OR 1=1", end: "2026-09-15" }
  ]) {
    assert.throws(() => siteAnalyticsPeriod(range, now));
    const selection = dashboardPeriodSelection(range, now);
    assert.equal(selection.custom, false);
    assert.ok(selection.error);
    assert.deepEqual(selection.period, siteAnalyticsPeriod({ days: 30 }, now));
  }
});

test("relative periods use the Brussels calendar day at UTC midnight and DST boundaries", () => {
  assert.deepEqual(siteAnalyticsPeriod({ days: 7 }, new Date("2026-03-29T22:30:00Z")), {
    days: 7, start: "2026-03-24", end: "2026-03-30", label: "Laatste 7 dagen"
  });
  assert.equal(siteAnalyticsPeriod({ days: 1 }, new Date("2026-10-25T23:30:00Z")).start, "2026-10-26");
});

test("switching sites or tabs retains custom dates while a preset clears them", () => {
  const params = { tab: "campaigns", site: "first", start: "2026-08-01", end: "2026-08-31", days: "7" };
  const selection = dashboardPeriodSelection(params, now);
  assert.equal(selection.custom, true);
  assert.equal(selection.period.days, 31);
  const customPeriod = { start: selection.period.start, end: selection.period.end };
  assert.equal(dashboardHref({ params, days: 31, siteId: "second", customPeriod }), "/dashboard?tab=campaigns&start=2026-08-01&end=2026-08-31&site=second");
  assert.equal(dashboardHref({ params: { ...params, tab: undefined }, days: 31, customPeriod }), "/dashboard?start=2026-08-01&end=2026-08-31");
  assert.equal(dashboardHref({ params, days: 14, siteId: "first" }), "/dashboard?tab=campaigns&days=14&site=first");
  assert.equal(dashboardHref({ params, days: 30 }), "/dashboard?tab=campaigns");
});


test("manual Meta sync keeps filters and does not repeat when navigating", () => {
  const options = { params: { tab: "campaigns", syncMeta: "1" }, days: 7, siteId: "first" };
  assert.equal(dashboardHref(options), "/dashboard?tab=campaigns&days=7&site=first");
  assert.equal(dashboardHref({ ...options, syncMeta: true }), "/dashboard?tab=campaigns&days=7&site=first&syncMeta=1");
});

test("account manager links use their own page and drop dashboard-only filters", () => {
  const params = { tab: "campaigns", site: "first", start: "2026-08-01", end: "2026-08-31", refresh: "1", syncMeta: "1" };
  const customPeriod = { start: "2026-08-01", end: "2026-08-31" };
  assert.equal(accountManagerHref({ params, days: 31, customPeriod }), "/accountmanager?start=2026-08-01&end=2026-08-31");
  assert.equal(accountManagerHref({ params, days: 7, syncMeta: true }), "/accountmanager?days=7&syncMeta=1");
  assert.equal(accountManagerHref({ params: {}, days: 30 }), "/accountmanager");
  assert.equal(accountManagerHref({ params: { manager: "42" }, days: 7 }), "/accountmanager?manager=42&days=7");
});

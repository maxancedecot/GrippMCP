import test from "node:test";
import assert from "node:assert/strict";
import { highestSortValue, liveSortValue, nextTableSort, sortTableRows } from "../src/tableSorting.js";

test("header sorting uses raw numbers, toggles direction, and leaves missing values after zero", () => {
  const rows = [
    { key: "two", sortValues: { ctr: 2.41, appointments: 10 } },
    { key: "missing", sortValues: { ctr: null, appointments: null } },
    { key: "ten", sortValues: { ctr: 10, appointments: 2 } },
    { key: "zero", sortValues: { ctr: 0, appointments: 0 } }
  ];
  const keys = (data: typeof rows) => data.map((row) => row.key);
  const descending = nextTableSort(null, "ctr");
  assert.deepEqual(keys(sortTableRows(rows, descending)), ["ten", "two", "zero", "missing"]);
  const ascending = nextTableSort(descending, "ctr");
  assert.deepEqual(keys(sortTableRows(rows, ascending)), ["zero", "two", "ten", "missing"]);
  assert.deepEqual(keys(sortTableRows(rows, nextTableSort(ascending, "ctr"))), ["ten", "two", "zero", "missing"]);
  assert.deepEqual(keys(sortTableRows(rows, nextTableSort(ascending, "appointments"))), ["two", "ten", "zero", "missing"]);
  assert.deepEqual(keys(rows), ["two", "missing", "ten", "zero"]);
  assert.deepEqual(sortTableRows(rows, null), rows);
});

test("sorting preserves equal rows and handles multiple campaigns and unknown live status", () => {
  const rows = [
    { key: "same-a", sortValues: { ctr: highestSortValue([null, 2, 12]), live: liveSortValue([false, true]) } },
    { key: "same-b", sortValues: { ctr: 12, live: liveSortValue([false]) } },
    { key: "unknown", sortValues: { ctr: highestSortValue([]), live: liveSortValue([null]) } },
    { key: "zero", sortValues: { ctr: highestSortValue([0, null]), live: liveSortValue([]) } }
  ];
  assert.deepEqual(sortTableRows(rows, { column: "ctr", direction: "descending" }).map((row) => row.key), ["same-a", "same-b", "zero", "unknown"]);
  assert.deepEqual(sortTableRows(rows, { column: "live", direction: "ascending" }).map((row) => row.key), ["same-b", "same-a", "unknown", "zero"]);
  const names = [{ sortValues: { name: "Project 2" } }, { sortValues: { name: "Project 10" } }];
  assert.equal(sortTableRows(names, { column: "name", direction: "descending" })[0].sortValues.name, "Project 10");
});

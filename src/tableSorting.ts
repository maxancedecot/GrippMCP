export type TableSortValue = number | string | null;
export type TableSort = { column: string; direction: "descending" | "ascending" };
export type TableSortRow = { sortValues: Record<string, TableSortValue> };

export function nextTableSort(current: TableSort | null, column: string): TableSort {
  return { column, direction: current?.column === column && current.direction === "descending" ? "ascending" : "descending" };
}

export function sortTableRows<T extends TableSortRow>(rows: readonly T[], sort: TableSort | null): T[] {
  if (!sort) return [...rows];
  const missing = (value: TableSortValue | undefined) => value == null || (typeof value === "number" && !Number.isFinite(value));
  return [...rows].sort((left, right) => {
    const a = left.sortValues[sort.column], b = right.sortValues[sort.column];
    // Missing measurements belong at the bottom in either direction, after zero.
    if (missing(a) || missing(b)) return Number(missing(a)) - Number(missing(b));
    const difference = typeof a === "number" && typeof b === "number" ? a - b
      : String(a).localeCompare(String(b), "nl-BE", { numeric: true, sensitivity: "base" });
    return sort.direction === "descending" ? -difference : difference;
  });
}

export function highestSortValue(values: (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return measured.length ? Math.max(...measured) : null;
}

export function liveSortValue(values: (boolean | null)[]): number | null {
  if (values.includes(true)) return 1;
  return values.length > 0 && values.every((value) => value === false) ? 0 : null;
}

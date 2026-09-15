"use client";

import { Fragment, useState, type ReactNode } from "react";
import { nextTableSort, sortTableRows, type TableSort, type TableSortRow } from "../../src/tableSorting.js";

type Column = { key: string; label: string; text?: boolean; description?: string };
type Row = TableSortRow & { key: string; content: ReactNode };

export function SortableTable({ columns, rows, className }: { columns: Column[]; rows: Row[]; className: string }) {
  const [sort, setSort] = useState<TableSort | null>(null);
  return <table className={className}>
    <thead><tr>{columns.map((column) => {
      const active = sort?.column === column.key;
      const next = nextTableSort(sort, column.key);
      const direction = column.text ? (next.direction === "descending" ? "Z naar A" : "A naar Z")
        : next.direction === "descending" ? "hoog naar laag" : "laag naar hoog";
      const action = `Sorteer van ${direction}${column.description ? `. ${column.description}` : ""}`;
      return <th key={column.key} scope="col" className="sortable-column" aria-sort={active ? sort.direction : "none"}>
        <button type="button" className="table-sort-button" onClick={() => setSort((current) => nextTableSort(current, column.key))}
          title={action} aria-label={`${column.label}: ${action}`}>
          {column.label}<span className="table-sort-indicator" aria-hidden="true">{active ? sort.direction === "descending" ? "↓" : "↑" : "↕"}</span>
        </button>
      </th>;
    })}</tr></thead>
    <tbody>{sortTableRows(rows, sort).map((row) => <Fragment key={row.key}>{row.content}</Fragment>)}</tbody>
  </table>;
}

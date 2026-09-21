import type { ReactNode } from "react";
import { SortableTable, type Column, type Row } from "./sortable-table.js";

type ProjectRow = Row & { accountManagerId: number | null; accountManagerName: string | null };
export function CampaignProjectTable({ columns, rows, info }: { columns: Column[]; rows: ProjectRow[]; info?: ReactNode }) {
  return <>
    <div className="panel-heading">
      <h2 id="campaign-projects-title">Performance per projectpagina</h2>
    </div>
    {info}
    {rows.length === 0 ? <p className="empty-state">Geen projectpagina’s voor deze accountmanager in de gekozen periode.</p>
      : <div className="table-wrap campaign-table-wrap campaign-project-table-wrap" role="region" aria-label="Accountmanager dashboard per projectpagina" tabIndex={0}>
        <SortableTable className="campaign-project-table" columns={columns} rows={rows} />
      </div>}
  </>;
}

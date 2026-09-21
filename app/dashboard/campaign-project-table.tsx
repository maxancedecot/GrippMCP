import type { ReactNode } from "react";
import { SortableTable, type Column, type Row } from "./sortable-table.js";

type ProjectRow = Row & { accountManagerId: number | null; accountManagerName: string | null };
const number = new Intl.NumberFormat("nl-BE");

export function CampaignProjectTable({ columns, rows, info }: { columns: Column[]; rows: ProjectRow[]; info?: ReactNode }) {
  return <>
    <div className="panel-heading">
      <div><p className="eyebrow">Campagnes gekoppeld aan projecten</p><h2 id="campaign-projects-title">Performance per projectpagina</h2></div>
      <span className="panel-total" role="status">{number.format(rows.length)} projectpagina’s</span>
    </div>
    {info}
    {rows.length === 0 ? <p className="empty-state">Geen projectpagina’s voor deze accountmanager in de gekozen periode.</p>
      : <div className="table-wrap campaign-table-wrap campaign-project-table-wrap" role="region" aria-label="Accountmanager dashboard per projectpagina" tabIndex={0}>
        <SortableTable className="campaign-project-table" columns={columns} rows={rows} />
      </div>}
  </>;
}

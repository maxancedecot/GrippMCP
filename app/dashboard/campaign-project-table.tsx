"use client";

import { useId, useState } from "react";
import { SortableTable, type Column, type Row } from "./sortable-table.js";

type ProjectRow = Row & { accountManagerId: number | null; accountManagerName: string | null };
const number = new Intl.NumberFormat("nl-BE");

export function CampaignProjectTable({ columns, rows }: { columns: Column[]; rows: ProjectRow[] }) {
  const filterId = useId();
  const [selectedManager, setSelectedManager] = useState("");
  const managers = [...new Map(rows.flatMap((row) => row.accountManagerId !== null && row.accountManagerName
    ? [[String(row.accountManagerId), row.accountManagerName] as const] : [])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "nl-BE"));
  const activeManager = selectedManager === "unassigned" || managers.some(([id]) => id === selectedManager) ? selectedManager : "";
  const filtered = rows.filter((row) => !activeManager || (activeManager === "unassigned"
    ? row.accountManagerId === null : String(row.accountManagerId) === activeManager));

  return <>
    <div className="panel-heading">
      <div><p className="eyebrow">Campagnes gekoppeld aan projecten</p><h2 id="campaign-projects-title">Performance per projectpagina</h2></div>
      <span className="panel-total" role="status">{activeManager ? `${number.format(filtered.length)} van ${number.format(rows.length)}` : number.format(rows.length)} projectpagina’s</span>
    </div>
    <div className="campaign-project-filters">
      <label htmlFor={filterId}>Accountmanager
        <select id={filterId} value={activeManager} onChange={(event) => setSelectedManager(event.target.value)} aria-controls={`${filterId}-projects`}>
          <option value="">Alle accountmanagers</option>
          {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="unassigned">Nog toe te wijzen</option>
        </select>
      </label>
    </div>
    <div id={`${filterId}-projects`}>
      {rows.length === 0 ? <p className="empty-state">Er zijn nog geen projectpagina’s gekoppeld.</p>
        : filtered.length === 0 ? <p className="empty-state">Geen projectpagina’s voor deze accountmanager in de gekozen periode.</p>
        : <div className="table-wrap campaign-table-wrap campaign-project-table-wrap" role="region" aria-label="Campagneperformance per projectpagina" tabIndex={0}>
          <SortableTable className="campaign-project-table" columns={columns} rows={filtered} />
        </div>}
    </div>
  </>;
}

import { CampaignProjectRowButton } from "./campaign-project-row-button.js";
import type { CampaignProjectRow } from "../../src/campaignProjects.js";
import type { ReactNode } from "react";
import { SortableTable, type Column, type Row } from "./sortable-table.js";

type ProjectRow = Row & { accountManagerId: number | null; accountManagerName: string | null };
export function CampaignProjectTable({ columns, rows, info, hiddenProjects = [], canDeleteProjects = false }: { columns: Column[]; rows: ProjectRow[]; info?: ReactNode; hiddenProjects?: CampaignProjectRow[]; canDeleteProjects?: boolean }) {
  return <>
    <div className="panel-heading">
      <h2 id="campaign-projects-title">Performance per projectpagina</h2>
    </div>
    {info}
    {rows.length === 0 ? <p className="empty-state">Geen projectpagina’s voor deze accountmanager in de gekozen periode.</p>
      : <div className="table-wrap campaign-table-wrap campaign-project-table-wrap" role="region" aria-label="Accountmanager dashboard per projectpagina" tabIndex={0}>
        <SortableTable className="campaign-project-table" columns={columns} rows={rows} />
      </div>}
    {hiddenProjects.length > 0 ? <details className="campaign-project-deleted">
      <summary>Verwijderde rijen ({hiddenProjects.length})</summary>
      <p>Deze rijen blijven verwijderd in alle periodes. Je kunt ze hier herstellen.</p>
      <ul>{hiddenProjects.map((project) => <li key={project.key}>
        <div><strong>{project.title}</strong><span className="cell-muted">{project.siteName} · {project.sourcePath}</span></div>
        <CampaignProjectRowButton siteId={project.siteId} path={project.sourcePath} title={project.title} restore disabled={!canDeleteProjects} />
      </li>)}</ul>
    </details> : null}
  </>;
}

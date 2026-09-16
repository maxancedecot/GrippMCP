"use client";

import { useId, useState, type FormEvent } from "react";
import type { AccountManager } from "../../src/dataManagement.js";
import type { ManagedProjectPage, ProjectPageManagementData } from "../../src/projectPageManagement.js";
import { saveAccountManagerAction } from "./data-management-actions.js";

export function DataManagementBoard({ data }: { data: ProjectPageManagementData }) {
  const [pages, setPages] = useState(data.pages);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("unmatched");
  const [notice, setNotice] = useState("");
  const query = search.trim().toLocaleLowerCase("nl-BE");
  const filtered = pages.filter((page) => (!query || `${page.title} ${page.url} ${page.clientName ?? ""} ${page.accountManagerName ?? ""}`.toLocaleLowerCase("nl-BE").includes(query))
    && (status === "all" || (status === "unmatched" ? page.needsAssignment : !page.needsAssignment)));
  const unresolved = pages.filter((page) => page.needsAssignment).length;
  return <>
    <section className="metric-grid data-management-metrics" aria-label="Projectpaginakoppelingen">
      <article className="metric-card metric-card--neutral"><span>Projectpagina’s</span><strong>{pages.length}</strong><p>Uit de verbonden websites</p></article>
      <article className="metric-card metric-card--good"><span>Gekoppeld</span><strong>{pages.length - unresolved}</strong><p>{pages.filter((page) => page.source === "gripp").length} via Gripp · {pages.filter((page) => page.source === "manual").length} handmatig</p></article>
      <article className="metric-card metric-card--neutral"><span>Nog toe te wijzen</span><strong>{unresolved}</strong><p>Geen eenduidige, actieve accountmanager gevonden</p></article>
    </section>
    <section className="panel data-management-panel" aria-labelledby="data-management-pages">
      <div className="panel-heading"><div><p className="eyebrow">Accountmanager per projectpagina</p><h2 id="data-management-pages">Projectpagina’s koppelen</h2></div><span className="panel-total">{filtered.length} van {pages.length} pagina’s</span></div>
      <div className="data-management-filters">
        <label>Zoeken<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projectpagina, klant of accountmanager zoeken…" /></label>
        <label>Weergave<select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="unmatched">Nog toe te wijzen</option><option value="linked">Gekoppeld</option><option value="all">Alle projectpagina’s</option>
        </select></label>
      </div>
      <p className="cell-muted data-management-help">We matchen projectpagina’s met projecten en klanten in Gripp. Hun accountmanager wordt automatisch overgenomen. Kies hieronder een accountmanager wanneer die koppeling ontbreekt of niet eenduidig is.</p>
      {notice ? <p className="data-management-success" role="status">{notice}</p> : null}
      {filtered.length ? <div className="data-management-clients">{filtered.map((page) => <PageAssignmentRow key={`${page.key}:${page.accountManagerId}:${page.source}`} page={page} managers={data.managers} canSave={data.canSave}
        onSaved={(updated) => {
          setPages((current) => current.map((item) => item.key === updated.key ? updated : item));
          setNotice(`${updated.title}: ${updated.accountManagerName ? `toegewezen aan ${updated.accountManagerName}` : "volgt opnieuw Gripp"}. Opgeslagen.`);
        }} />)}</div> : <p className="empty-state">{query ? "Geen projectpagina’s gevonden met deze filters." : status === "unmatched" ? "Alle projectpagina’s hebben een accountmanager." : "Geen projectpagina’s in deze weergave."}</p>}
    </section>
  </>;
}

function PageAssignmentRow({ page, managers, canSave, onSaved }: {
  page: ManagedProjectPage; managers: AccountManager[]; canSave: boolean; onSaved: (page: ManagedProjectPage) => void;
}) {
  const inputId = useId();
  const savedValue = page.source === "manual" ? String(page.accountManagerId) : "";
  const [value, setValue] = useState(savedValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const result = await saveAccountManagerAction(page.siteId, page.path, value ? Number(value) : null);
      if (!result.ok) { setError(result.error); return; }
      onSaved(result.page);
    } catch { setError("Opslaan is niet gelukt. Probeer opnieuw."); }
    finally { setPending(false); }
  }
  return <article className="data-management-client" data-project-page-key={page.key}>
    <div className="data-management-client-heading">
      <h3><a className="row-title" href={page.url} target="_blank" rel="noreferrer">{page.title}</a></h3>
      <span className="cell-muted data-management-page-url">{page.url}</span>
      <p className="cell-muted">{page.clientName ? `Klant: ${page.clientName}` : "Klant nog niet herkend"}{page.grippProjectName ? ` · Gripp-project: ${page.grippProjectName}` : ""}</p>
      <p className={page.needsAssignment ? "data-management-error" : "cell-muted"}>{page.reason}{page.accountManagerName ? ` · ${page.accountManagerName}` : ""}</p>
    </div>
    <form className="data-management-assignment" onSubmit={save}>
      <label htmlFor={inputId}>Accountmanager voor {page.title}</label>
      <div className="data-management-assignment-controls">
        <select id={inputId} value={value} disabled={!canSave || pending} onChange={(event) => { setValue(event.target.value); setError(""); }}>
          <option value="">{page.source === "gripp" ? `Gripp volgen (${page.accountManagerName})` : page.source === "manual" ? "Opnieuw automatisch via Gripp" : "Kies een accountmanager"}</option>
          {managers.filter((manager) => manager.active).map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
        </select>
        <button type="submit" disabled={!canSave || pending || value === savedValue}>{pending ? "Opslaan…" : "Opslaan"}</button>
      </div>
      {error ? <p className="data-management-error" role="alert">{error}</p> : null}
    </form>
  </article>;
}

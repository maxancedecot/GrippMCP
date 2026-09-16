"use client";

import { useId, useState, type FormEvent } from "react";
import type { AccountManager, DataManagementData, ManagedClient } from "../../src/dataManagement.js";
import { saveAccountManagerAction } from "./data-management-actions.js";

export function DataManagementBoard({ data }: { data: DataManagementData }) {
  const [clients, setClients] = useState(data.clients);
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const query = search.trim().toLocaleLowerCase("nl-BE");
  const filtered = clients.filter((client) => (!query || `${client.name} ${client.projects.map((project) => project.name).join(" ")}`.toLocaleLowerCase("nl-BE").includes(query))
    && (!managerFilter || (managerFilter === "unassigned" ? client.accountManagerId === null : String(client.accountManagerId) === managerFilter)));
  const assigned = clients.filter((client) => client.accountManagerId !== null).length;
  const usedManagerIds = new Set(clients.map((client) => client.accountManagerId));
  return <>
    <section className="metric-grid data-management-metrics" aria-label="Klantkoppelingen">
      <article className="metric-card metric-card--neutral"><span>Klanten</span><strong>{clients.length}</strong><p>Uit Gripp, inclusief klanten met projecten</p></article>
      <article className="metric-card metric-card--good"><span>Met accountmanager</span><strong>{assigned}</strong><p>{clients.length - assigned} nog te koppelen</p></article>
      <article className="metric-card metric-card--neutral"><span>Projecten bij klanten</span><strong>{clients.reduce((sum, client) => sum + client.projects.length, 0)}</strong><p>Volgen de accountmanager van hun klant</p></article>
    </section>
    <section className="panel data-management-panel" aria-labelledby="data-management-clients">
      <div className="panel-heading"><div><p className="eyebrow">Accountmanager per klant</p><h2 id="data-management-clients">Klantkoppelingen</h2></div><span className="panel-total">{filtered.length} van {clients.length} klanten</span></div>
      <div className="data-management-filters">
        <label>Zoeken<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Klant of project zoeken…" /></label>
        <label>Accountmanager<select value={managerFilter} onChange={(event) => setManagerFilter(event.target.value)}>
          <option value="">Alle accountmanagers</option><option value="unassigned">Zonder accountmanager</option>
          {data.managers.filter((manager) => manager.active || usedManagerIds.has(manager.id)).map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.active ? "" : " (inactief)"}</option>)}
        </select></label>
      </div>
      <p className="cell-muted data-management-help">Bestaande Gripp-koppelingen zijn als startpunt ingevuld. Kies een accountmanager en klik op Opslaan. Kies ‘Geen accountmanager’ om een koppeling in dit dashboard te verwijderen.</p>
      {filtered.length ? <div className="data-management-clients">{filtered.map((client) => <ClientAssignmentRow key={client.id} client={client} managers={data.managers} canSave={data.canSave}
        onSaved={(updated) => setClients((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}</div>
        : <p className="empty-state">{clients.length ? "Geen klanten gevonden met deze filters." : "Er zijn nog geen klanten beschikbaar."}</p>}
    </section>
    {data.unlinkedProjects > 0 ? <p className="data-notice">{data.unlinkedProjects} projecten hebben geen beschikbare klantkoppeling in Gripp en zijn daarom niet in dit overzicht opgenomen.</p> : null}
  </>;
}

function ClientAssignmentRow({ client, managers, canSave, onSaved }: {
  client: ManagedClient; managers: AccountManager[]; canSave: boolean; onSaved: (client: ManagedClient) => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(client.accountManagerId === null ? "" : String(client.accountManagerId));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const savedValue = client.accountManagerId === null ? "" : String(client.accountManagerId);
  const managerName = managers.find((manager) => manager.id === client.accountManagerId)?.name ?? (client.accountManagerId === null ? "Geen accountmanager" : `Medewerker ${client.accountManagerId}`);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setNotice("");
    try {
      const result = await saveAccountManagerAction(client.id, value ? Number(value) : null);
      if (!result.ok) { setError(result.error); return; }
      onSaved({ ...client, accountManagerId: result.assignment.managerId, assignmentSource: "dashboard", updatedAt: result.assignment.updatedAt });
      setNotice("Opgeslagen voor deze klant en alle bijbehorende projecten.");
    } catch { setError("Opslaan is niet gelukt. Probeer opnieuw."); }
    finally { setPending(false); }
  }
  return <article className="data-management-client" data-client-id={client.id}>
    <div className="data-management-client-heading"><h3>{client.name}</h3><span className="cell-muted">{client.active ? "" : "Inactieve klant · "}{client.assignmentSource === "dashboard" ? "Dashboardkoppeling" : "Overgenomen uit Gripp"}</span></div>
    <form className="data-management-assignment" onSubmit={save}>
      <label htmlFor={inputId}>Accountmanager voor {client.name}</label>
      <div className="data-management-assignment-controls">
        <select id={inputId} value={value} disabled={!canSave || pending} onChange={(event) => { setValue(event.target.value); setNotice(""); setError(""); }}>
          <option value="">Geen accountmanager</option>
          {client.accountManagerId !== null && !managers.some((manager) => manager.id === client.accountManagerId) ? <option value={client.accountManagerId} disabled>{managerName} (niet beschikbaar)</option> : null}
          {managers.filter((manager) => manager.active || manager.id === client.accountManagerId).map((manager) => <option key={manager.id} value={manager.id} disabled={!manager.active}>{manager.name}{manager.active ? "" : " (inactief)"}</option>)}
        </select>
        <button type="submit" disabled={!canSave || pending || value === savedValue}>{pending ? "Opslaan…" : "Opslaan"}</button>
      </div>
      {notice ? <p className="data-management-success" role="status">{notice}</p> : null}
      {error ? <p className="data-management-error" role="alert">{error}</p> : null}
    </form>
    {client.projects.length ? <details className="data-management-projects"><summary>{client.projects.length} {client.projects.length === 1 ? "project" : "projecten"} · {managerName}</summary>
      <ul>{client.projects.map((project) => <li key={project.id}><span>{project.name}{project.archived ? <small>Gearchiveerd</small> : null}</span><span className="cell-muted">{managerName}</span></li>)}</ul>
    </details> : <p className="cell-muted data-management-projects">Nog geen projecten gekoppeld aan deze klant.</p>}
  </article>;
}

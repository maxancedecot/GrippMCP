"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation.js";
import type { CrmConnection, CrmPipelineMatch, CrmPipelineOption } from "../../src/crmPipelineManagement.js";
import type { SiteAnalyticsCvrPageCandidate } from "../../src/siteAnalytics.js";
import { normalizeProjectPath } from "../../src/projectPageGroups.js";
import { deleteCrmPipelineMatchAction, loadCrmPipelinesAction, saveCrmPipelineMatchesAction } from "./data-management-actions.js";

export function CrmPipelineManager({ pages, connections, initialMatches, canSave, error: initialError = "", discoveryMessage = "" }: {
  pages: SiteAnalyticsCvrPageCandidate[]; connections: CrmConnection[]; initialMatches: CrmPipelineMatch[];
  canSave: boolean; error?: string; discoveryMessage?: string;
}) {
  const router = useRouter();
  const [connectionIndex, setConnectionIndex] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [pipelines, setPipelines] = useState<CrmPipelineOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageKey, setPageKey] = useState("");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState(initialMatches);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const connection = connectionIndex ? connections[Number(connectionIndex)] : undefined;
  const options = useMemo(() => pages.filter((page) => !/bedankt|thankyou|thank[\s_-]*you/i.test(page.path))
    .sort((a, b) => a.siteName.localeCompare(b.siteName, "nl-BE") || a.title.localeCompare(b.title, "nl-BE")), [pages]);
  const keyFor = (page: { siteId: string; path: string }) => JSON.stringify([page.siteId, normalizeProjectPath(page.path)]);
  const pageFor = (match: CrmPipelineMatch) => options.find((page) => keyFor(page) === keyFor({ siteId: match.siteId, path: match.sourcePath }));
  const subaccountFor = (match: CrmPipelineMatch) => connections.find((item) => item.locationId === match.locationId && item.installId === match.installId)
    ?? connections.find((item) => item.locationId === match.locationId);
  const query = search.trim().toLocaleLowerCase("nl-BE");
  const visiblePipelines = pipelines.filter((pipeline) => !query || `${pipeline.name} ${pipeline.id}`.toLocaleLowerCase("nl-BE").includes(query));
  const connectionQuery = connectionSearch.trim().toLocaleLowerCase("nl-BE");
  const visibleConnections = connections.map((item, index) => ({ item, index }))
    .filter(({ item }) => !connectionQuery || item.label.toLocaleLowerCase("nl-BE").includes(connectionQuery));
  const groupedMatches = new Map<string, CrmPipelineMatch[]>();
  for (const match of matches) {
    const key = keyFor({ siteId: match.siteId, path: match.sourcePath });
    groupedMatches.set(key, [...(groupedMatches.get(key) ?? []), match]);
  }
  const matchQuery = matchSearch.trim().toLocaleLowerCase("nl-BE");
  const visibleMatches = [...groupedMatches.entries()].filter(([, group]) => !matchQuery || group.some((match) =>
    `${pageFor(match)?.title ?? ""} ${pageFor(match)?.siteName ?? ""} ${match.sourcePath} ${match.pipelineName} ${subaccountFor(match)?.label ?? ""}`
      .toLocaleLowerCase("nl-BE").includes(matchQuery)));

  function resetConnection() {
    setConnectionIndex(""); setPipelines([]); setLoaded(false); setSelectedIds([]); setSearch(""); setError(""); setNotice("");
  }

  async function load() {
    if (!connection) return;
    setPending(true); setError(""); setNotice(""); setLoaded(false); setPipelines([]); setSelectedIds([]);
    try {
      const result = await loadCrmPipelinesAction({ locationId: connection.locationId, installId: connection.installId });
      if (!result.ok) { setError(result.error); return; }
      setPipelines(result.pipelines); setLoaded(true);
      setNotice(`${result.pipelines.length} CRM-pipelines geladen.`);
    } catch { setError("De CRM-pipelines konden niet worden geladen. Probeer opnieuw."); }
    finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const page = options.find((item) => keyFor(item) === pageKey);
    if (!page || !connection || !selectedIds.length) { setError("Kies een projectpagina en minstens één pipeline."); return; }
    setPending(true); setError(""); setNotice("");
    try {
      const result = await saveCrmPipelineMatchesAction({ siteId: page.siteId, sourcePath: page.path,
        locationId: connection.locationId, installId: connection.installId, pipelineIds: selectedIds });
      if (!result.ok) { setError(result.error); return; }
      const selected = new Set(selectedIds);
      setMatches((current) => [...current.filter((match) => match.locationId !== connection.locationId || !selected.has(match.pipelineId)), ...result.matches]);
      setSelectedIds([]);
      setNotice(`${result.matches.length} CRM-pipeline${result.matches.length === 1 ? "" : "s"} gekoppeld aan ${page.title}. Leads en afspraken verschijnen bij dit project in het accountmanager-dashboard.`);
      router.refresh();
    } catch { setError("De CRM-pipelines konden niet worden gekoppeld. Probeer opnieuw."); }
    finally { setPending(false); }
  }

  async function remove(match: CrmPipelineMatch) {
    setPending(true); setError(""); setNotice("");
    try {
      const result = await deleteCrmPipelineMatchAction(match.locationId, match.pipelineId);
      if (!result.ok) { setError(result.error); return; }
      setMatches((current) => current.filter((item) => item.locationId !== match.locationId || item.pipelineId !== match.pipelineId));
      setNotice("Handmatige CRM-koppeling verwijderd. De pipeline volgt opnieuw de bestaande configuratie of automatische naamherkenning.");
      router.refresh();
    } catch { setError("De CRM-koppeling kon niet worden verwijderd. Probeer opnieuw."); }
    finally { setPending(false); }
  }

  return <section className="panel data-management-panel" aria-labelledby="crm-pipeline-management-title">
    <div className="panel-heading"><div><p className="eyebrow">CRM · GoHighLevel</p><h2 id="crm-pipeline-management-title">Pipelines aan projecten koppelen</h2></div>
      <span className="panel-total">{connections.length} subaccounts · {matches.length} handmatige koppelingen</span></div>
    {discoveryMessage ? <p className="data-notice" role="status">{discoveryMessage} <a href="/api/ghl/oauth/start">GoHighLevel verbinden</a></p> : null}
    <p className="cell-muted data-management-help">Kies een subaccount, laad de pipelines en selecteer het project. Je kunt meerdere pipelines koppelen; hun leads en afspraken worden opgeteld.</p>
    {connections.length ? <div className="data-management-assignment-controls">
      <label>Subaccount zoeken<input type="search" value={connectionSearch} disabled={pending} placeholder="Bijvoorbeeld Immogra…"
        onChange={(event) => { setConnectionSearch(event.target.value); resetConnection(); }} /></label>
      <label>CRM-subaccount<select value={connectionIndex} disabled={pending} onChange={(event) => {
        setConnectionIndex(event.target.value); setPipelines([]); setLoaded(false); setSelectedIds([]); setSearch(""); setError(""); setNotice("");
      }}><option value="">{visibleConnections.length ? "Kies een subaccount" : "Geen subaccounts gevonden"}</option>
        {visibleConnections.map(({ item, index }) => <option key={JSON.stringify([item.locationId, item.installId])} value={String(index)}>{item.label}{connections.filter((other) => other.locationId === item.locationId).length > 1 ? ` · verbinding ${connections.filter((other) => other.locationId === item.locationId).indexOf(item) + 1}` : ""}</option>)}</select></label>
      <button type="button" disabled={pending || !connection} onClick={load}>{pending ? "Bezig…" : "Pipelines laden"}</button>
    </div> : !initialError ? <p className="empty-state">Er is nog geen CRM-subaccount verbonden. <a href="/api/ghl/oauth/start">Verbind GoHighLevel</a> en vernieuw daarna de gegevens.</p> : null}
    {!canSave && !initialError ? <p className="cell-muted">Koppelen is beschikbaar zodra projectpagina’s en permanente opslag beschikbaar zijn.</p> : null}
    {loaded && !pipelines.length ? <p className="empty-state">Dit CRM-subaccount heeft geen pipelines.</p> : null}
    {pipelines.length ? <form className="project-group-form" onSubmit={save}>
      <div className="data-management-assignment-controls"><label>Projectpagina<select value={pageKey} disabled={!canSave || pending}
        onChange={(event) => { setPageKey(event.target.value); setError(""); }}><option value="">Kies een projectpagina</option>
        {options.map((page) => <option key={keyFor(page)} value={keyFor(page)}>{page.siteName} · {page.title} · {page.path}</option>)}
      </select></label></div>
      <div className="data-management-filters"><label>Pipelines zoeken<input type="search" value={search} disabled={pending}
        onChange={(event) => setSearch(event.target.value)} placeholder="Pipelinenaam of ID…" /></label></div>
      <fieldset disabled={!canSave || pending}><legend>Pipelines kiezen · {selectedIds.length} geselecteerd (max. 100)</legend>
        <div className="project-group-candidates">{visiblePipelines.map((pipeline) => {
          const linked = matches.find((match) => match.locationId === connection?.locationId && match.pipelineId === pipeline.id);
          return <label className="project-group-candidate" key={pipeline.id}>
            <input type="checkbox" checked={selectedIds.includes(pipeline.id)} disabled={selectedIds.length >= 100 && !selectedIds.includes(pipeline.id)}
              onChange={() => setSelectedIds((current) => current.includes(pipeline.id) ? current.filter((id) => id !== pipeline.id) : [...current, pipeline.id])} />
            <span><strong>{pipeline.name || "Pipeline zonder naam"}</strong><small>ID {pipeline.id}{linked ? ` · Gekoppeld aan ${pageFor(linked)?.title ?? linked.sourcePath}` : ""}</small></span>
          </label>;
        })}</div>
      </fieldset>
      {!visiblePipelines.length ? <p className="empty-state">Geen pipelines gevonden met deze zoekopdracht.</p> : null}
      <div className="data-management-assignment-controls"><button type="submit" disabled={!canSave || pending || !selectedIds.length || !pageKey}>
        {pending ? "Koppelen…" : selectedIds.length > 1 ? `${selectedIds.length} pipelines koppelen` : "Pipeline koppelen"}
      </button></div>
    </form> : null}
    {notice ? <p className="data-management-success" role="status">{notice}</p> : null}
    {error ? <p className="data-management-error" role="alert">{error}</p> : null}
    {matches.length ? <div className="management-saved-links">
      <h3>Opgeslagen koppelingen <span className="cell-muted">· {groupedMatches.size} projecten</span></h3>
      <div className="data-management-filters"><label>Gekoppelde projecten zoeken<input type="search" value={matchSearch}
        onChange={(event) => setMatchSearch(event.target.value)} placeholder="Project, pipeline of subaccount…" /></label></div>
      <div className="project-group-list">{visibleMatches.map(([key, group]) => <details className="management-linked-project" key={key}>
        <summary><span><strong>{pageFor(group[0])?.title ?? group[0].sourcePath}</strong>
          <small>{pageFor(group[0])?.siteName ?? group[0].siteId}</small></span><span className="management-link-count">{group.length} pipeline{group.length === 1 ? "" : "s"}</span></summary>
        <div className="management-linked-content">{group.map((match) => <div className="management-linked-row" key={JSON.stringify([match.locationId, match.pipelineId])}>
          <div><strong>{match.pipelineName || match.pipelineId}</strong><span className="cell-muted">{subaccountFor(match)?.label ?? `CRM-subaccount ${match.locationId}`} · {match.sourcePath}</span></div>
          <button type="button" disabled={!canSave || pending} aria-label={`Handmatige koppeling verwijderen voor ${match.pipelineName || match.pipelineId}`} onClick={() => remove(match)}>Verwijderen</button>
        </div>)}</div>
      </details>)}</div>
      {!visibleMatches.length ? <p className="empty-state">Geen gekoppelde projecten gevonden.</p> : null}
    </div> : <p className="empty-state">Nog geen CRM-pipelines gekoppeld. Kies hierboven een subaccount om te beginnen.</p>}
  </section>;
}

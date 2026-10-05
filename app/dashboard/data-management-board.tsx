"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { GitBranch, Layers3, Megaphone, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation.js";
import type { AccountManager } from "../../src/dataManagement.js";
import { normalizeProjectPath } from "../../src/projectPageGroups.js";
import type { SiteAnalyticsCvrPageCandidate, SiteAnalyticsProjectPageGroup } from "../../src/siteAnalytics.js";
import type { ManagedProjectPage, ProjectPageManagementData } from "../../src/projectPageManagement.js";
import type { CampaignProjectMatch } from "../../src/campaignProjects.js";
import type { GoogleCampaignOption } from "../../src/googleCampaignManagement.js";
import { deleteGoogleCampaignMatchAction, deleteProjectPageGroupAction, loadGoogleCampaignsAction, saveAccountManagerAction, saveGoogleCampaignMatchesAction, saveProjectPageGroupAction } from "./data-management-actions.js";

export function DataManagementBoard({ data, mergePages, projectGroups, googleCampaignMatches, crm, crmCount }: {
  data: ProjectPageManagementData;
  mergePages: SiteAnalyticsCvrPageCandidate[];
  projectGroups: SiteAnalyticsProjectPageGroup[];
  googleCampaignMatches: CampaignProjectMatch[];
  crm: ReactNode;
  crmCount: number;
}) {
  const [activeSection, setActiveSection] = useState("accountmanagers");
  const [pages, setPages] = useState(data.pages);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("unmatched");
  const [notice, setNotice] = useState("");
  const query = search.trim().toLocaleLowerCase("nl-BE");
  const filtered = pages.filter((page) => (!query || `${page.title} ${page.url} ${page.clientName ?? ""} ${page.accountManagerName ?? ""}`.toLocaleLowerCase("nl-BE").includes(query))
    && (status === "all" || (status === "unmatched" ? page.needsAssignment : !page.needsAssignment)));
  const unresolved = pages.filter((page) => page.needsAssignment).length;
  const sections = [
    { id: "accountmanagers", label: "Accountmanagers", description: `${unresolved} nog toe te wijzen`, icon: UsersRound },
    { id: "crm", label: "CRM-pipelines", description: `${crmCount} gekoppelde pipelines`, icon: GitBranch },
    { id: "google", label: "Google Ads", description: `${googleCampaignMatches.length} gekoppelde campagnes`, icon: Megaphone },
    { id: "groups", label: "Projectgroepen", description: `${projectGroups.length} samengevoegde projecten`, icon: Layers3 }
  ];
  return <>
    <div className="data-management-overview" aria-label="Overzicht projectpagina’s">
      <span><strong>{pages.length}</strong> projectpagina’s</span>
      <span><strong>{pages.length - unresolved}</strong> met accountmanager</span>
      <span className={unresolved ? "data-management-attention" : ""}><strong>{unresolved}</strong> nog toe te wijzen</span>
    </div>
    <nav className="data-management-sections" aria-label="Beheeronderdelen">
      {sections.map(({ id, label, description, icon: Icon }) => <button key={id} type="button"
        className="data-management-section-button" aria-pressed={activeSection === id} aria-controls={`management-${id}`}
        onClick={() => setActiveSection(id)}>
        <Icon aria-hidden="true" size={21} /><span><strong>{label}</strong><small>{description}</small></span>
      </button>)}
    </nav>
    <div id="management-crm" className="data-management-view" hidden={activeSection !== "crm"}>{crm}</div>
    <div id="management-google" className="data-management-view" hidden={activeSection !== "google"}>
      <GoogleCampaignManager pages={mergePages} initialMatches={googleCampaignMatches} canSave={data.canSave} />
    </div>
    <div id="management-groups" className="data-management-view" hidden={activeSection !== "groups"}>
      <ProjectPageGroupManager pages={mergePages} groups={projectGroups} canSave={data.canSave} />
    </div>
    <div id="management-accountmanagers" className="data-management-view" hidden={activeSection !== "accountmanagers"}>
    <section className="panel data-management-panel" aria-labelledby="data-management-pages">
      <div className="panel-heading"><div><p className="eyebrow">Toewijzing per project</p><h2 id="data-management-pages">Accountmanagers</h2></div><span className="panel-total">{filtered.length} van {pages.length} pagina’s</span></div>
      <p className="cell-muted data-management-help">Accountmanagers worden automatisch uit Gripp overgenomen. Wijs de overige projecten hieronder toe of pas een bestaande toewijzing aan.</p>
      <div className="data-management-filters">
        <label>Zoeken<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Projectpagina, klant of accountmanager zoeken…" /></label>
        <label>Weergave<select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="unmatched">Nog toe te wijzen</option><option value="linked">Gekoppeld</option><option value="all">Alle projectpagina’s</option>
        </select></label>
      </div>
      {notice ? <p className="data-management-success" role="status">{notice}</p> : null}
      {filtered.length ? <div className="data-management-clients">{filtered.map((page) => <PageAssignmentRow key={`${page.key}:${page.accountManagerId}:${page.source}`} page={page} managers={data.managers} canSave={data.canSave}
        onSaved={(updated) => {
          setPages((current) => current.map((item) => item.key === updated.key ? updated : item));
          setNotice(`${updated.title}: ${updated.accountManagerName ? `toegewezen aan ${updated.accountManagerName}` : "volgt opnieuw Gripp"}. Opgeslagen.`);
        }} />)}</div> : <p className="empty-state">{query ? "Geen projectpagina’s gevonden met deze filters." : status === "unmatched" ? "Alle projectpagina’s hebben een accountmanager." : "Geen projectpagina’s in deze weergave."}</p>}
    </section>
    </div>
  </>;
}

function GoogleCampaignManager({ pages, initialMatches, canSave }: { pages: SiteAnalyticsCvrPageCandidate[]; initialMatches: CampaignProjectMatch[]; canSave: boolean }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<GoogleCampaignOption[]>([]);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [pageKey, setPageKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [matches, setMatches] = useState(initialMatches);
  const options = useMemo(() => pages.filter((page) => !isThankYouPath(page.path)).sort((a, b) => a.siteName.localeCompare(b.siteName, "nl-BE") || a.title.localeCompare(b.title, "nl-BE")), [pages]);
  const campaignQuery = campaignSearch.trim().toLocaleLowerCase("nl-BE");
  const filteredCampaigns = campaigns.filter((campaign) => !campaignQuery || `${campaign.name} ${campaign.id}`.toLocaleLowerCase("nl-BE").includes(campaignQuery));
  const groupedMatches = useMemo(() => {
    const groups = new Map<string, CampaignProjectMatch[]>();
    for (const match of matches) {
      const key = `${match.siteId}:${normalizeProjectPath(match.sourcePaths[0])}`;
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
    return [...groups.entries()];
  }, [matches]);
  const matchQuery = matchSearch.trim().toLocaleLowerCase("nl-BE");
  const visibleMatches = groupedMatches.filter(([, group]) => {
    const page = options.find((item) => item.siteId === group[0].siteId && normalizeProjectPath(item.path) === normalizeProjectPath(group[0].sourcePaths[0]));
    return !matchQuery || `${page?.title ?? ""} ${page?.siteName ?? ""} ${group[0].sourcePaths[0]} ${group.map((match) => `${match.accountId} ${match.campaignId}`).join(" ")}`.toLocaleLowerCase("nl-BE").includes(matchQuery);
  });

  async function load() {
    setPending(true); setError(""); setNotice("");
    try {
      const result = await loadGoogleCampaignsAction(customerId);
      if (!result.ok) { setError(result.error); return; }
      setAccountId(result.customerId); setCampaigns(result.campaigns); setSelectedCampaignIds([]); setCampaignSearch("");
      setNotice(`${result.campaigns.length} campagnes geladen.`);
    } catch { setError("De Google Ads-campagnes konden niet worden geladen."); }
    finally { setPending(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setNotice("");
    const page = options.find((item) => `${item.siteId}:${normalizeProjectPath(item.path)}` === pageKey);
    if (!page) { setPending(false); setError("Kies een projectpagina."); return; }
    try {
      const result = await saveGoogleCampaignMatchesAction({ siteId: page.siteId, accountId, campaignIds: selectedCampaignIds, sourcePath: page.path });
      if (!result.ok) { setError(result.error); return; }
      const selected = new Set(selectedCampaignIds);
      setMatches((current) => [...current.filter((item) => !(item.accountId === accountId && selected.has(item.campaignId))), ...result.matches]);
      setSelectedCampaignIds([]);
      setNotice(`${result.matches.length} Google-campagne${result.matches.length === 1 ? "" : "s"} gekoppeld aan ${page.title}.`); router.refresh();
    } catch { setError("De Google-campagnes konden niet worden gekoppeld."); }
    finally { setPending(false); }
  }
  async function remove(match: CampaignProjectMatch) {
    setPending(true); setError(""); setNotice("");
    try {
      const result = await deleteGoogleCampaignMatchAction(match.accountId, match.campaignId);
      if (result.ok) { setMatches((current) => current.filter((item) => item !== match)); setNotice("Google-campagnekoppeling verwijderd."); router.refresh(); }
      else setError(result.error);
    } catch { setError("De Google-campagnekoppeling kon niet worden verwijderd."); }
    finally { setPending(false); }
  }
  return <section className="panel data-management-panel" aria-labelledby="google-campaign-management-title">
    <div className="panel-heading"><div><p className="eyebrow">Google Ads</p><h2 id="google-campaign-management-title">Campagnes aan projecten koppelen</h2></div><span className="panel-total">{matches.length} koppelingen</span></div>
    <p className="cell-muted data-management-help">Laad een Google Ads-account, kies een project en selecteer de campagnes die erbij horen. Hun CTR en spend worden samen weergegeven in het dashboard.</p>
    <div className="data-management-assignment-controls"><label>Klantnummer<input value={customerId} disabled={pending} onChange={(event) => setCustomerId(event.target.value)} placeholder="123-456-7890" /></label>
      <button type="button" disabled={pending || !customerId.trim()} onClick={load}>{pending ? "Laden…" : "Campagnes laden"}</button></div>
    {campaigns.length ? <form className="project-group-form" onSubmit={save}>
      <div className="data-management-assignment-controls google-campaign-link-controls">
        <label>Projectpagina<select value={pageKey} disabled={!canSave || pending} onChange={(event) => setPageKey(event.target.value)}><option value="">Kies een projectpagina</option>{options.map((page) => <option key={`${page.siteId}:${page.path}`} value={`${page.siteId}:${normalizeProjectPath(page.path)}`}>{page.siteName} · {page.title} · {page.path}</option>)}</select></label>
      </div>
      <div className="data-management-filters"><label>Campagnes zoeken<input type="search" value={campaignSearch} disabled={pending} onChange={(event) => setCampaignSearch(event.target.value)} placeholder="Campagnenaam of ID…" /></label></div>
      <fieldset disabled={!canSave || pending}><legend>Campagnes kiezen · {selectedCampaignIds.length} geselecteerd (max. 100)</legend><div className="project-group-candidates">{filteredCampaigns.map((campaign) => {
        const linked = matches.find((match) => match.accountId === accountId && match.campaignId === campaign.id);
        const linkedPage = linked && options.find((page) => page.siteId === linked.siteId && normalizeProjectPath(page.path) === normalizeProjectPath(linked.sourcePaths[0]));
        return <label className="project-group-candidate" key={campaign.id}>
          <input type="checkbox" checked={selectedCampaignIds.includes(campaign.id)} disabled={selectedCampaignIds.length >= 100 && !selectedCampaignIds.includes(campaign.id)} onChange={() => setSelectedCampaignIds((current) => current.includes(campaign.id) ? current.filter((id) => id !== campaign.id) : [...current, campaign.id])} />
          <span><strong>{campaign.name}</strong><small>ID {campaign.id} · {campaign.status}{linked ? ` · Gekoppeld aan ${linkedPage?.title ?? linked.sourcePaths[0]}` : ""}</small></span>
        </label>;
      })}</div></fieldset>
      {filteredCampaigns.length === 0 ? <p className="empty-state">Geen campagnes gevonden met deze zoekopdracht.</p> : null}
      <div className="data-management-assignment-controls google-campaign-link-controls">
        <button type="submit" disabled={!canSave || pending || selectedCampaignIds.length === 0 || !pageKey}>{pending ? "Koppelen…" : selectedCampaignIds.length > 1 ? `${selectedCampaignIds.length} campagnes koppelen` : "Campagne koppelen"}</button>
    </div></form> : null}
    {notice ? <p className="data-management-success" role="status">{notice}</p> : null}{error ? <p className="data-management-error" role="alert">{error}</p> : null}
    {groupedMatches.length ? <div className="management-saved-links"><h3>Opgeslagen koppelingen <span className="cell-muted">· {groupedMatches.length} projecten</span></h3>
      <div className="data-management-filters"><label>Gekoppelde projecten zoeken<input type="search" value={matchSearch}
        onChange={(event) => setMatchSearch(event.target.value)} placeholder="Project, website of klantnummer…" /></label></div>
      <div className="project-group-list">{visibleMatches.map(([key, group]) => {
      const page = options.find((item) => item.siteId === group[0].siteId && normalizeProjectPath(item.path) === normalizeProjectPath(group[0].sourcePaths[0]));
      return <details className="management-linked-project" key={key}><summary><span><strong>{page?.title ?? group[0].sourcePaths[0]}</strong><small>{page?.siteName ?? group[0].siteId}</small></span>
        <span className="management-link-count">{group.length} campagne{group.length === 1 ? "" : "s"}</span></summary>
        <div className="management-linked-content">{group.map((match) => <div className="management-linked-row" key={`${match.accountId}:${match.campaignId}`}>
          <div><strong>{campaigns.find((campaign) => accountId === match.accountId && campaign.id === match.campaignId)?.name ?? `Campagne ${match.campaignId}`}</strong><span className="cell-muted">Google Ads-account {match.accountId}</span></div>
          <button type="button" disabled={!canSave || pending} aria-label={`Koppeling verwijderen voor Google-campagne ${match.campaignId}`} onClick={() => remove(match)}>Verwijderen</button>
        </div>)}</div></details>;
    })}</div>{!visibleMatches.length ? <p className="empty-state">Geen gekoppelde projecten gevonden.</p> : null}</div>
      : <p className="empty-state">Nog geen Google Ads-campagnes gekoppeld. Laad hierboven een account om te beginnen.</p>}
  </section>;
}

function ProjectPageGroupManager({ pages, groups, canSave }: {
  pages: SiteAnalyticsCvrPageCandidate[];
  groups: SiteAnalyticsProjectPageGroup[];
  canSave: boolean;
}) {
  const router = useRouter();
  const sites = useMemo(() => [...new Map(pages.map((page) => [page.siteId, page.siteName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1], "nl-BE")), [pages]);
  const [siteId, setSiteId] = useState(sites[0]?.[0] ?? "");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [sourcePath, setSourcePath] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const claimedPaths = useMemo(() => new Set(groups.filter((group) => group.siteId === siteId)
    .flatMap((group) => group.sourcePaths.map(normalizeProjectPath))), [groups, siteId]);
  const candidates = useMemo(() => pages.filter((page) => page.siteId === siteId && !isThankYouPath(page.path))
    .sort((left, right) => left.title.localeCompare(right.title, "nl-BE")), [pages, siteId]);
  const groupQuery = groupSearch.trim().toLocaleLowerCase("nl-BE");
  const visibleGroups = groups.filter((group) => !groupQuery || `${group.title} ${sites.find(([id]) => id === group.siteId)?.[1] ?? ""} ${group.sourcePaths.join(" ")}`.toLocaleLowerCase("nl-BE").includes(groupQuery));

  const toggle = (page: SiteAnalyticsCvrPageCandidate) => {
    const path = normalizeProjectPath(page.path);
    setError("");
    setSelectedPaths((current) => {
      if (current.includes(path)) {
        const next = current.filter((item) => item !== path);
        if (sourcePath === path) setSourcePath(next[0] ?? "");
        return next;
      }
      if (!sourcePath) setSourcePath(path);
      if (!title) setTitle(page.title);
      return [...current, path];
    });
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setNotice("");
    try {
      const result = await saveProjectPageGroupAction({ siteId, title, sourcePath, sourcePaths: selectedPaths });
      if (!result.ok) { setError(result.error); return; }
      setSelectedPaths([]); setSourcePath(""); setTitle("");
      setNotice(`${title}: projectpagina’s samengevoegd.`);
      router.refresh();
    } catch { setError("Samenvoegen is niet gelukt. Probeer opnieuw."); }
    finally { setPending(false); }
  }

  async function remove(groupId: string) {
    setPending(true); setError(""); setNotice("");
    try {
      const result = await deleteProjectPageGroupAction(groupId);
      if (!result.ok) { setError(result.error); return; }
      setNotice("Projectgroep opgeheven. De pagina’s worden weer afzonderlijk weergegeven.");
      router.refresh();
    } catch { setError("De projectgroep kon niet worden verwijderd. Probeer opnieuw."); }
    finally { setPending(false); }
  }

  return <section className="panel data-management-panel project-group-panel" aria-labelledby="project-page-groups-title">
    <div className="panel-heading">
      <div><p className="eyebrow">Meerdere pagina’s, één project</p><h2 id="project-page-groups-title">Projectpagina’s samenvoegen</h2></div>
      <span className="panel-total">{groups.length} groepen</span>
    </div>
    <p className="cell-muted data-management-help">Selecteer minstens twee pagina’s van hetzelfde project. Bezoekers, advertenties en gekoppelde thank-youpagina’s worden daarna als één project getoond.</p>
    {sites.length > 1 ? <label className="project-group-site">Website<select value={siteId} onChange={(event) => {
      setSiteId(event.target.value); setSelectedPaths([]); setSourcePath(""); setTitle(""); setError("");
    }}>{sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
    <form className="project-group-form" onSubmit={save}>
      <fieldset disabled={!canSave || pending}>
        <legend>Pagina’s kiezen</legend>
        <div className="project-group-candidates">{candidates.map((page) => {
          const path = normalizeProjectPath(page.path);
          const grouped = claimedPaths.has(path);
          return <label className={`project-group-candidate${grouped ? " project-group-candidate--disabled" : ""}`} key={path}>
            <input type="checkbox" checked={selectedPaths.includes(path)} disabled={grouped} onChange={() => toggle(page)} />
            <span><strong>{page.title}</strong><small>{path}</small></span>
            {grouped ? <em>Al samengevoegd</em> : null}
          </label>;
        })}</div>
      </fieldset>
      <div className="project-group-fields">
        <label>Projectnaam<input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder="Bijvoorbeeld Residentie Crollet" /></label>
        <label>Hoofdpagina<select value={sourcePath} disabled={selectedPaths.length === 0} onChange={(event) => setSourcePath(event.target.value)}>
          {selectedPaths.map((path) => <option key={path} value={path}>{pages.find((page) => page.siteId === siteId && normalizeProjectPath(page.path) === path)?.title ?? path}</option>)}
        </select></label>
        <button type="submit" disabled={!canSave || pending || selectedPaths.length < 2 || !sourcePath || !title.trim()}>{pending ? "Samenvoegen…" : "Pagina’s samenvoegen"}</button>
      </div>
    </form>
    {error ? <p className="data-management-error" role="alert">{error}</p> : null}
    {notice ? <p className="data-management-success" role="status">{notice}</p> : null}
    {groups.length ? <div className="management-saved-links"><h3>Opgeslagen projectgroepen <span className="cell-muted">· {groups.length} groepen</span></h3>
      <div className="data-management-filters"><label>Projectgroepen zoeken<input type="search" value={groupSearch}
        onChange={(event) => setGroupSearch(event.target.value)} placeholder="Project of website…" /></label></div>
      <div className="project-group-list">{visibleGroups.map((group) => <details className="management-linked-project" key={group.groupId}>
        <summary><span><strong>{group.title}</strong><small>{sites.find(([id]) => id === group.siteId)?.[1] ?? group.siteId}</small></span><span className="management-link-count">{group.sourcePaths.length} pagina’s</span></summary>
        <div className="management-linked-content"><ul className="management-group-pages">{group.sourcePaths.map((path) => <li key={path}>
          <strong>{pages.find((page) => page.siteId === group.siteId && normalizeProjectPath(page.path) === normalizeProjectPath(path))?.title ?? path}</strong><span className="cell-muted">{path}</span>
        </li>)}</ul>
          {group.managed ? <button type="button" disabled={!canSave || pending} aria-label={`Projectgroep ${group.title} opheffen`} onClick={() => remove(group.groupId)}>Groep opheffen</button> : <span className="cell-muted">Vaste groep</span>}
        </div>
      </details>)}</div>{!visibleGroups.length ? <p className="empty-state">Geen projectgroepen gevonden.</p> : null}</div>
      : <p className="empty-state">Nog geen projectgroepen. Selecteer hierboven de pagina’s die bij hetzelfde project horen.</p>}
  </section>;
}

function isThankYouPath(path: string) {
  const normalized = path.toLowerCase();
  const spaced = normalized.replace(/%20|[_-]+/g, " ");
  return normalized.includes("thankyou") || spaced.includes("thank you") || normalized.includes("bedankt");
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

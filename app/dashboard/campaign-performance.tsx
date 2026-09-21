import {
  getCampaignPerformance, facebookAccountSources, summarizeAds,
  type AdCampaign, type AdPerformance, type CampaignPerformanceRow, type CampaignSource, type LinkCtrSummary
} from "../../src/campaignPerformance.js";
import type { MetaAccountSync } from "../../src/metaAccountDiscovery.js";
import type { SiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { Info } from "lucide-react";
import { summarizeFacebookProjectCampaigns, summarizeGoogleProjectCampaigns, type CampaignProjectRow, type UnmatchedProjectCampaign } from "../../src/campaignProjects.js";
import { liveSortValue } from "../../src/tableSorting.js";
import { CampaignProjectTable } from "./campaign-project-table.js";
import { getProjectPageManagementData, projectPageKey, type ManagedProjectPage } from "../../src/projectPageManagement.js";
import { filterCampaignProjectsByManager, summarizeFilteredCampaignProjects } from "../../src/campaignAccountManagerFilter.js";

const number = new Intl.NumberFormat("nl-BE");
const percent = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 2 });
const percentage = (value: number | null) => value === null ? "—" : `${percent.format(value)}%`;

function rateColor(value: number | null, target: number) {
  if (value === null || !Number.isFinite(value)) return undefined;
  const belowTarget = value < target;
  // Pale near the target; full red at 0% or green at three times the target.
  const distance = Math.min(1, belowTarget ? 1 - value / target : (value / target - 1) / 2);
  const intensity = (40 + distance * 60).toFixed(2);
  return `color-mix(in srgb, var(--${belowTarget ? "danger" : "green"}) ${intensity}%, var(--ink))`;
}

type CampaignPerformanceProps = {
  dashboard: SiteAnalyticsDashboardData; discoverySites?: { id: string; name: string; url: string }[]; forceMetaSync?: boolean; syncHref?: string;
  selectedAccountManager?: string;
};

export async function loadCampaignPerformanceViewData({ dashboard, discoverySites, forceMetaSync, syncHref, selectedAccountManager }: CampaignPerformanceProps) {
  const { rows, message, facebookLinkCtr, projects, unmatchedCampaigns, metaSync } = await getCampaignPerformance(dashboard, { discoverySites, forceMetaSync });
  const managers = await getProjectPageManagementData({ pages: projects.map((project) => ({ siteId: project.siteId, siteName: project.siteName, path: project.sourcePath, title: project.title, url: project.url })) });
  const accountManagers = Object.fromEntries(managers.pages.map((page) => [page.key, page]));
  const filtered = filterCampaignProjectsByManager(projects, accountManagers, selectedAccountManager);
  const filteredSiteIds = new Set(filtered.projects.map((project) => project.siteId));
  const filteredRows = filtered.selectedManager ? rows.filter((row) => filteredSiteIds.has(row.siteId)) : rows;
  const filteredMetaAccountIds = new Set(filtered.projects.flatMap((project) => project.campaigns.map((campaign) => `act_${campaign.accountId}`)));
  const filteredMetaSync = filtered.selectedManager && metaSync
    ? { ...metaSync, accounts: metaSync.accounts.filter((account) => filteredMetaAccountIds.has(account.id)) }
    : metaSync;
  return { rows: filteredRows, message: [message, managers.error, metaSync?.message].filter(Boolean).join(" "),
    facebookLinkCtr: filtered.selectedManager ? filteredProjectLinkCtr(filtered.projects) : facebookLinkCtr,
    projects: filtered.projects, unmatchedCampaigns: filtered.selectedManager ? [] : unmatchedCampaigns,
    accountManagers, metaSync: filteredMetaSync, syncHref,
    managers: filtered.managers, selectedManager: filtered.selectedManager, totalProjects: filtered.totalProjects };
}

export async function CampaignPerformance(props: CampaignPerformanceProps) {
  return <CampaignPerformanceView {...await loadCampaignPerformanceViewData(props)} />;
}

export function CampaignPerformanceView({ rows, message, facebookLinkCtr, projects, unmatchedCampaigns, accountManagers, metaSync, syncHref,
  selectedManager = "", totalProjects = projects.length }: {
  rows: CampaignPerformanceRow[]; message: string; facebookLinkCtr: LinkCtrSummary;
  projects: CampaignProjectRow[]; unmatchedCampaigns: UnmatchedProjectCampaign[];
  accountManagers: Record<string, ManagedProjectPage>;
  metaSync?: MetaAccountSync; syncHref?: string;
  managers?: [string, string][]; selectedManager?: string; totalProjects?: number;
}) {
  const projectSummary = summarizeFilteredCampaignProjects(projects);
  const measuredSites = rows.filter((row) => row.websiteCvr !== null);
  const visitors = selectedManager ? projectSummary.visitors : measuredSites.reduce((sum, row) => sum + row.websiteVisitors, 0);
  const conversions = selectedManager ? projectSummary.leads + projectSummary.appointments
    : measuredSites.reduce((sum, row) => sum + row.websiteConversions, 0);
  const cvr = selectedManager ? projectSummary.conversionRate : visitors > 0 ? conversions / visitors * 100 : null;
  const facebookAccounts = rows.flatMap(facebookAccountSources);
  const googleSources = selectedManager ? projectAdSources(projects, "google") : rows.map((row) => row.google);
  const facebookSources = selectedManager ? projectAdSources(projects, "facebook") : facebookAccounts.map((account) => account.facebook);
  const issues = rows.flatMap((row) => {
    const basic = (["google", "leads", "appointments"] as const)
      .filter((key) => row[key].state !== "connected")
      .map((key) => ({ key: `${row.siteId}:${key}`, site: row.name, message: row[key].message }));
    const meta = facebookAccountSources(row).flatMap((account, index) =>
      (["facebook", "facebookLinkCtr", "facebookCampaignPages"] as const)
        .filter((key) => account[key].state === "unavailable" || (key === "facebook" && account[key].state === "not_configured"))
        .map((key) => ({ key: `${row.siteId}:${index}:${key}`, site: row.name, message: account[key].message })));
    const google = row.google.state === "connected" && row.googleCampaignPages.message
      ? [{ key: `${row.siteId}:googleCampaignPages`, site: row.name, message: row.googleCampaignPages.message }] : [];
    return [...basic, ...meta, ...google];
  });

  return (
    <div className="campaign-performance">
      {message ? <p className="data-notice">{message}</p> : null}
      {selectedManager ? <p className="campaign-filter-summary">{number.format(projects.length)} van {number.format(totalProjects)} projectpagina’s</p> : null}
      <section className="campaign-channel-grid" aria-label="Advertentie- en website-KPI's">
        <ChannelPanel name="Google" sources={googleSources} />
        <ChannelPanel name="Facebook" sources={facebookSources} linkCtr={facebookLinkCtr} />
        <CampaignMetric label="Website CVR" value={percentage(cvr)} detail="Conversieratio van gekoppelde websitepagina’s"
          availability={selectedManager
            ? projectSummary.measuredProjects > 0 ? `${projectSummary.measuredProjects} van ${projects.length} projectpagina’s met metingen` : "Nog geen conversiemetingen"
            : measuredSites.length > 0 ? `${measuredSites.length} van ${rows.length} sites met metingen` : "Nog geen conversiemetingen"} />
      </section>

      <section className="panel campaign-overview" aria-labelledby="campaign-projects-title">
        <CampaignProjectTable info={<details className="campaign-project-info">
          <summary aria-label="Meer informatie over de projectcijfers" title="Toelichting tonen of verbergen"><Info size={20} aria-hidden="true" /></summary>
          <div className="campaign-info-content"><p>Facebook en Google tonen per project één gewogen gemiddelde CTR, de totale spend en Live zodra minstens één campagne live is. Beweeg over een cijfer of status voor de afzonderlijke campagnes. CTR onder 1% en project-CVR onder 2% zijn rood, vanaf die grenzen groen; de kleur wordt sterker verder van de grens. CTR en spend gelden voor de gekozen periode; Live is de huidige status. Bij een campagne voor meerdere projectpagina’s gelden CTR en spend voor die pagina’s samen. Brochure, Afspraak en CVR komen één keer per project uit Websiteprestaties.</p></div>
        </details>} columns={[
          { key: "title", label: "Projectpagina", text: true },
          { key: "live", label: "Facebook live" },
          { key: "googleLive", label: "Google live" },
          { key: "ctr", label: "Facebook CTR (link)", description: "Gemiddelde CTR, gewogen op vertoningen" },
          { key: "spend", label: "Facebook spend", description: "Totale spend van de campagnes binnen het project" },
          { key: "googleCtr", label: "Google CTR", description: "Gemiddelde CTR, gewogen op vertoningen" },
          { key: "googleSpend", label: "Google spend", description: "Totale spend van de campagnes binnen het project" },
          { key: "visitors", label: "Bezoekers" },
          { key: "leads", label: "Brochure" }, { key: "appointments", label: "Afspraak" }, { key: "cvr", label: "Project CVR" }
        ]} rows={projects.map((project) => {
          const google = summarizeGoogleProjectCampaigns(project.googleCampaigns);
          const facebook = summarizeFacebookProjectCampaigns(project.campaigns);
          const manager = accountManagers[projectPageKey({ siteId: project.siteId, path: project.sourcePath })];
          return {
            key: project.key,
            accountManagerId: manager?.accountManagerId ?? null,
            accountManagerName: manager?.accountManagerName ?? null,
            sortValues: {
              title: project.title, ctr: facebook.ctr,
              spend: project.campaigns.length ? project.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0) : null,
              live: liveSortValue(project.campaigns.map((campaign) => campaign.live)),
              googleCtr: google.ctr,
              googleSpend: project.googleCampaigns.length ? project.googleCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0) : null,
              googleLive: liveSortValue(project.googleCampaigns.map((campaign) => campaign.live)),
              visitors: project.visitors, leads: project.leads, appointments: project.appointments, cvr: project.cvr
            },
            content: <tr key={project.key} data-project-key={project.key} data-account-manager-id={manager?.accountManagerId ?? "unassigned"}>
              <th scope="row"><a className="row-title" href={project.url} target="_blank" rel="noreferrer">{project.title}</a>
                {manager?.accountManagerName ? <span className="cell-muted campaign-project-manager" title={[manager.reason, manager.clientName, manager.grippProjectName].filter(Boolean).join(" · ")}>Accountmanager: {manager.accountManagerName}</span>
                  : <a className="cell-muted campaign-project-manager" href="/dashboard?tab=data-management">Accountmanager: nog toe te wijzen</a>}
                <span className="cell-muted">{project.siteName}</span><span className="cell-muted" title={project.sourcePaths?.join("\n")}>{project.sourcePaths ? "Samengevoegde projectpagina’s" : project.sourcePath}</span></th>
              <td data-metric="status"><ProjectCampaignMetric project={project} summary={facebook} channel="facebook" metric="status" /></td>
              <td data-metric="google-status"><ProjectCampaignMetric project={project} summary={google} channel="google" metric="status" /></td>
              <td data-metric="ctr"><ProjectCampaignMetric project={project} summary={facebook} channel="facebook" metric="ctr" /></td>
              <td data-metric="spend"><ProjectCampaignMetric project={project} summary={facebook} channel="facebook" metric="spend" /></td>
              <td data-metric="google-ctr"><ProjectCampaignMetric project={project} summary={google} channel="google" metric="ctr" /></td>
              <td data-metric="google-spend"><ProjectCampaignMetric project={project} summary={google} channel="google" metric="spend" /></td>
              <td><strong>{project.visitors === null ? "—" : number.format(project.visitors)}</strong></td>
              <td><strong>{project.leads === null ? "—" : number.format(project.leads)}</strong></td>
              <td><strong>{project.appointments === null ? "—" : number.format(project.appointments)}</strong></td>
              <td><strong className="campaign-project-cvr-value" style={{ color: rateColor(project.cvr, 2) }}>{percentage(project.cvr)}</strong>
                {!project.hasConversionMapping ? <span className="cell-muted">Bedankpagina nog niet gekoppeld</span> : null}</td>
            </tr>
          };
        })} />
        {unmatchedCampaigns.length > 0 ? <div className="campaign-unmatched">
          <h3>Nog aan een projectpagina te koppelen</h3>
          <ul>{unmatchedCampaigns.map((campaign) => <li key={`${campaign.channel}:${campaign.siteId}:${campaign.accountId ?? ""}:${campaign.campaignId}`}>
            {campaign.siteName} — {campaign.channel === "google" ? "Google" : "Facebook"}: {campaign.campaignName}
          </li>)}</ul>
        </div> : null}
      </section>

      {issues.length > 0 ? <details className="panel campaign-connection-details" open>
        <summary>Koppelingen aanvullen <span>{issues.length}</span></summary>
        <ul>{issues.map((issue) => <li key={issue.key}><strong>{issue.site}</strong> — {issue.message}</li>)}</ul>
      </details> : null}

      {metaSync && metaSync.state !== "not_configured" ? <details className="panel campaign-connection-details">
        <summary>Meta-accounts <span>{metaSync.accounts.length}</span></summary>
        <p>Nieuwe advertentieaccounts worden automatisch opgehaald bij het laden van dit overzicht. Campagnes worden via hun advertentielinks aan websites gekoppeld; deze controle wordt maximaal vijf minuten bewaard.</p>
        {syncHref ? <p><a className="header-meta-link" href={syncHref}>Nu synchroniseren</a></p> : null}
        {metaSync.message ? <p className="data-notice" role="status">{metaSync.message}</p> : null}
        <ul>{metaSync.accounts.map((account) => <li key={account.id}>
          <strong>{account.name}</strong> — {account.siteNames.length ? `Gekoppeld aan ${account.siteNames.join(", ")}.` : "Nog niet gekoppeld."}
          {account.message ? ` ${account.message}` : ""}
        </li>)}</ul>
      </details> : null}

      <details className="campaign-method-info">
        <summary aria-label="Meer informatie over de cijfers en databronnen" title="Toelichting tonen of verbergen"><Info size={20} aria-hidden="true" /><span>Over deze cijfers</span></summary>
        <div className="campaign-info-content"><p>
        Live = momenteel actief volgens het advertentieplatform. Google CTR = alle klikken ÷ vertoningen.
        Facebook link-CTR is het gemiddelde van de campagnepercentages, gewogen op vertoningen in de gekozen periode, ook bij gestopte campagnes.
        Facebook-cijfers tellen alleen campagnes met “Ledoux” in de naam, inclusief hun Instagram-plaatsingen.
        Projectpagina’s worden gekoppeld via vastgelegde campagnekoppelingen of de bestemmingslink van de advertenties.
        Leads = Brochure en Afspraken = Afspraak uit Websiteprestaties, voor dezelfde website en periode.
        Dit zijn bezoekers van gekoppelde bedankpagina’s; ze zijn niet uitsluitend aan advertenties toegeschreven.
        Websitemetingen gebruiken de tijdzone Brussel; advertentiecijfers volgen de accounttijdzone.
        Bij onvolledige koppelingen tonen de kaarten alleen de beschikbare gegevens.
        </p></div>
      </details>
    </div>
  );
}

function ProjectCampaignMetric({ project, summary, metric, channel }: {
  project: CampaignProjectRow; summary: ReturnType<typeof summarizeGoogleProjectCampaigns>; metric: "ctr" | "spend" | "status"; channel: "facebook" | "google";
}) {
  const campaigns = channel === "google" ? project.googleCampaigns : project.campaigns;
  const state = channel === "google" ? project.googleState : project.facebookState;
  if (!campaigns.length) return metric === "status"
    ? <span className="cell-muted">{state === "not_configured" ? "Niet gekoppeld"
      : state === "unavailable" ? "Niet beschikbaar" : "Geen campagne"}</span>
    : <strong>—</strong>;
  const status = (live: boolean | null) => live === true ? "Live" : live === false ? "Niet live" : "Onbekend";
  const detail = campaigns.map((campaign) => [
    campaign.name,
    `CTR: ${percentage(campaign.ctr)} · Spend: ${formatSpend([{ amount: campaign.spend, currency: campaign.currency }])} · ${status(campaign.live)}`,
    ...(campaign.unavailable || (campaign.ctr === null && campaign.impressions > 0) ? ["CTR niet beschikbaar."]
      : campaign.impressions === 0 ? ["Geen vertoningen in deze periode."] : []),
    ...(campaign.projectCount > 1 ? [`CTR en spend voor ${campaign.projectCount} projectpagina’s samen.`] : [])
  ].join("\n")).join("\n\n");
  const title = `${channel === "facebook" ? "Facebook" : "Google"}-campagnes · ${project.title}\nCTR gewogen op vertoningen; spend opgeteld.\n\n${detail}`;
  const value = metric === "ctr" ? percentage(summary.ctr) : metric === "spend" ? formatSpend(summary.spend) : status(summary.live);
  return <span className="campaign-project-summary campaign-ctr-trigger" tabIndex={0} title={title} aria-label={`${value}. ${title}`}>
    {metric === "status" ? <span className={`campaign-status campaign-status--${summary.live === true ? "live" : summary.live === false ? "offline" : "unknown"}`}>
      <i aria-hidden="true" />{value}
    </span> : <strong style={metric === "ctr" ? { color: rateColor(summary.ctr, 1) } : undefined}>{value}</strong>}
  </span>;
}

function projectAdSources(projects: CampaignProjectRow[], channel: "facebook" | "google"): CampaignSource<AdPerformance>[] {
  const accounts = new Map<string, { accountId: string; currency: string; campaigns: Map<string, AdCampaign> }>();
  for (const project of projects) {
    const campaigns = channel === "google" ? project.googleCampaigns : project.campaigns;
    for (const campaign of campaigns) {
      const key = `${campaign.accountId}:${campaign.currency}`;
      const account = accounts.get(key) ?? { accountId: campaign.accountId, currency: campaign.currency, campaigns: new Map<string, AdCampaign>() };
      if (!account.campaigns.has(campaign.id)) account.campaigns.set(campaign.id, {
        id: campaign.id,
        name: campaign.name,
        live: campaign.live,
        clicks: "clicks" in campaign && typeof campaign.clicks === "number" ? campaign.clicks
          : campaign.ctr === null ? 0 : campaign.impressions * campaign.ctr / 100,
        impressions: campaign.impressions,
        spend: campaign.spend
      });
      accounts.set(key, account);
    }
  }
  return [...accounts.values()].map((account) => ({
    state: "connected" as const,
    message: "",
    data: { accountId: account.accountId, currency: account.currency, campaigns: [...account.campaigns.values()] }
  }));
}

function filteredProjectLinkCtr(projects: CampaignProjectRow[]): LinkCtrSummary {
  const campaigns = new Map<string, CampaignProjectRow["campaigns"][number]>();
  for (const project of projects) {
    for (const campaign of project.campaigns) campaigns.set(`${campaign.accountId}:${campaign.id}`, campaign);
  }
  const values = [...campaigns.values()];
  const measured = values.filter((campaign) => campaign.impressions > 0);
  const unavailable = measured.some((campaign) => campaign.unavailable || campaign.ctr === null);
  const impressions = measured.reduce((sum, campaign) => sum + campaign.impressions, 0);
  return {
    campaigns: values.length,
    unavailable,
    ctr: unavailable || impressions === 0 ? null
      : measured.reduce((sum, campaign) => sum + campaign.ctr! * campaign.impressions, 0) / impressions
  };
}

function CampaignMetric({ label, value, detail, availability }: { label: string; value: string; detail: string; availability: string }) {
  return <article className={`metric-card campaign-metric-card metric-card--${value === "—" ? "neutral" : "good"}`}>
    <span>{label}</span><strong>{value}</strong>
    <details className="campaign-metric-info">
      <summary aria-label={`Meer informatie over ${label}`} title="Toelichting tonen of verbergen"><Info size={20} aria-hidden="true" /></summary>
      <div className="campaign-info-content"><p>{detail}</p><small className="campaign-coverage">{availability}</small></div>
    </details>
  </article>;
}

function ChannelPanel({ name, sources, linkCtr }: { name: string; sources: CampaignSource<AdPerformance>[]; linkCtr?: LinkCtrSummary }) {
  const summary = summarizeAds(sources);
  return <article className="panel campaign-channel-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Advertenties</p><h2>{name} Ads</h2></div>
      <CampaignStatus sources={sources} />
    </div>
    <dl className="campaign-channel-metrics">
      <div><dt>{linkCtr ? `Facebook link-CTR${linkCtr.campaigns > 1 ? " (gewogen)" : ""}` : `${name} CTR`}</dt>
        <dd style={{ color: rateColor(linkCtr ? linkCtr.ctr : summary.ctr, 1) }}>{percentage(linkCtr ? linkCtr.ctr : summary.ctr)}</dd></div>
      <div><dt>{name} spend</dt><dd>{formatSpend(summary.spend)}</dd></div>
    </dl>
    <details className="campaign-channel-info">
      <summary aria-label={`Meer informatie over ${name} Ads`} title="Toelichting tonen of verbergen"><Info size={20} aria-hidden="true" /></summary>
      <div className="campaign-info-content">
        <p>{summary.connected > 0
          ? `${summary.liveCount} van ${summary.campaignCount} campagnes live · ${coverage(summary, "website-accountkoppelingen")}`
          : coverage(summary, "website-accountkoppelingen")}</p>
        {linkCtr ? <p>CTR (taux de clics sur le lien) uit Ads Manager, per Ledoux-campagne in de gekozen periode, ook als die nu niet meer live is.</p> : null}
        {linkCtr && linkCtr.campaigns > 1 ? <p>
          Gewogen op vertoningen per campagne. Hieronder zie je het gemiddelde per project; hover toont de afzonderlijke campagnes.
        </p> : null}
        {linkCtr?.unavailable ? <p>Link-CTR niet beschikbaar voor alle gekoppelde campagnes.</p> : null}
      </div>
    </details>
  </article>;
}

function CampaignStatus({ sources }: { sources: CampaignSource<AdPerformance>[] }) {
  const summary = summarizeAds(sources);
  const unavailable = sources.some((source) => source.state === "unavailable");
  const incomplete = summary.connected < sources.length;
  let label = "Niet gekoppeld";
  let tone = "unknown";
  if (summary.liveCount > 0) { label = "Live"; tone = "live"; }
  else if (summary.unknownCount > 0 || (summary.connected > 0 && incomplete)) label = "Onbekend";
  else if (summary.connected > 0) { label = "Niet live"; tone = "offline"; }
  else if (unavailable) label = "Niet beschikbaar";
  return <span className={`campaign-status campaign-status--${tone}`}><i aria-hidden="true" />{label}</span>;
}

function formatSpend(values: { amount: number; currency: string }[]) {
  return values.length ? values.map(({ amount, currency }) => new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(amount)).join(" + ") : "—";
}

function coverage({ connected, total }: { connected: number; total: number }, label = "sites") {
  return connected === 0 ? "Nog geen gegevens beschikbaar" : `${connected} van ${total} ${label} gekoppeld${connected < total ? " · gedeeltelijk totaal" : ""}`;
}

import type { ReactNode } from "react";
import {
  getCampaignPerformance, summarizeAds, summarizeWebsiteConversions,
  type AdPerformance, type CampaignPerformanceRow, type CampaignSource, type WebsiteConversionPerformance, type LinkCtrSummary
} from "../../src/campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { summarizeGoogleProjectCampaigns, type CampaignProjectRow, type UnmatchedProjectCampaign } from "../../src/campaignProjects.js";
import { highestSortValue, liveSortValue } from "../../src/tableSorting.js";
import { SortableTable } from "./sortable-table.js";

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

export async function CampaignPerformance({ dashboard }: { dashboard: SiteAnalyticsDashboardData }) {
  const { rows, message, facebookLinkCtr, projects, unmatchedCampaigns } = await getCampaignPerformance(dashboard);
  return <CampaignPerformanceView rows={rows} message={message} facebookLinkCtr={facebookLinkCtr} projects={projects} unmatchedCampaigns={unmatchedCampaigns} />;
}

export function CampaignPerformanceView({ rows, message, facebookLinkCtr, projects, unmatchedCampaigns }: {
  rows: CampaignPerformanceRow[]; message: string; facebookLinkCtr: LinkCtrSummary;
  projects: CampaignProjectRow[]; unmatchedCampaigns: UnmatchedProjectCampaign[];
}) {
  const leads = summarizeWebsiteConversions(rows.map((row) => row.leads));
  const appointments = summarizeWebsiteConversions(rows.map((row) => row.appointments));
  const measuredSites = rows.filter((row) => row.websiteCvr !== null);
  const visitors = measuredSites.reduce((sum, row) => sum + row.websiteVisitors, 0);
  const conversions = measuredSites.reduce((sum, row) => sum + row.websiteConversions, 0);
  const cvr = visitors > 0 ? conversions / visitors * 100 : null;
  const issues = rows.flatMap((row) => (["google", "facebook", "leads", "appointments"] as const)
    .filter((key) => row[key].state !== "connected")
    .map((key) => ({ key: `${row.siteId}:${key}`, site: row.name, message: row[key].message }))
    .concat(row.facebookLinkCtr.state === "unavailable"
      ? [{ key: `${row.siteId}:facebookLinkCtr`, site: row.name, message: row.facebookLinkCtr.message }] : [])
    .concat(row.google.state === "connected" && row.googleCampaignPages.message
      ? [{ key: `${row.siteId}:googleCampaignPages`, site: row.name, message: row.googleCampaignPages.message }] : []));

  return (
    <div className="campaign-performance">
      {message ? <p className="data-notice">{message}</p> : null}
      <section className="metric-grid campaign-metric-grid" aria-label="Campagne KPI's">
        <CampaignMetric label="Leads" value={leads.count === null ? "—" : number.format(leads.count)}
          detail="Brochure uit Websiteprestaties" availability={coverage(leads)} />
        <CampaignMetric label="Afspraken" value={appointments.count === null ? "—" : number.format(appointments.count)}
          detail="Afspraak uit Websiteprestaties" availability={coverage(appointments)} />
        <CampaignMetric label="Website CVR" value={percentage(cvr)} detail="Conversieratio van gekoppelde websitepagina’s"
          availability={measuredSites.length > 0 ? `${measuredSites.length} van ${rows.length} sites met metingen` : "Nog geen conversiemetingen"} />
      </section>

      <section className="campaign-channel-grid" aria-label="Advertentiekanalen">
        <ChannelPanel name="Google" sources={rows.map((row) => row.google)} />
        <ChannelPanel name="Facebook" sources={rows.map((row) => row.facebook)} linkCtr={facebookLinkCtr} />
      </section>

      <section className="panel campaign-overview" aria-labelledby="campaign-projects-title">
        <div className="panel-heading">
          <div><p className="eyebrow">Campagnes gekoppeld aan projecten</p><h2 id="campaign-projects-title">Performance per projectpagina</h2></div>
          <span className="panel-total">{number.format(projects.length)} projectpagina’s</span>
        </div>
        {projects.length === 0 ? <p className="empty-state">Er zijn nog geen projectpagina’s gekoppeld.</p> : (
          <div className="table-wrap campaign-table-wrap campaign-project-table-wrap" role="region" aria-label="Campagneperformance per projectpagina" tabIndex={0}>
            <SortableTable className="campaign-project-table" columns={[
              { key: "title", label: "Projectpagina", text: true },
              { key: "ctr", label: "Facebook CTR (link)", description: "Hoogste CTR binnen het project" },
              { key: "spend", label: "Facebook spend", description: "Totale spend van de campagnes binnen het project" },
              { key: "live", label: "Facebook live" },
              { key: "googleCtr", label: "Google CTR", description: "Gemiddelde CTR, gewogen op vertoningen" },
              { key: "googleSpend", label: "Google spend", description: "Totale spend van de campagnes binnen het project" },
              { key: "googleLive", label: "Google live" }, { key: "visitors", label: "Bezoekers" },
              { key: "leads", label: "Brochure" }, { key: "appointments", label: "Afspraak" }, { key: "cvr", label: "Project CVR" }
            ]} rows={projects.map((project) => {
              const google = summarizeGoogleProjectCampaigns(project.googleCampaigns);
              return {
                key: project.key,
                sortValues: {
                  title: project.title, ctr: highestSortValue(project.campaigns.map((campaign) => campaign.ctr)),
                  spend: project.campaigns.length ? project.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0) : null,
                  live: liveSortValue(project.campaigns.map((campaign) => campaign.live)),
                  googleCtr: google.ctr,
                  googleSpend: project.googleCampaigns.length ? project.googleCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0) : null,
                  googleLive: liveSortValue(project.googleCampaigns.map((campaign) => campaign.live)),
                  visitors: project.visitors, leads: project.leads, appointments: project.appointments, cvr: project.cvr
                },
                content: <tr key={project.key} data-project-key={project.key}>
                  <th scope="row"><a className="row-title" href={project.url} target="_blank" rel="noreferrer">{project.title}</a>
                    <span className="cell-muted">{project.siteName}</span><span className="cell-muted">{project.sourcePath}</span></th>
                  <td data-metric="ctr"><ProjectCampaignMetric project={project} metric="ctr" /></td>
                  <td data-metric="spend"><ProjectCampaignMetric project={project} metric="spend" /></td>
                  <td data-metric="status"><ProjectCampaignMetric project={project} metric="status" /></td>
                  <td data-metric="google-ctr"><GoogleProjectMetric project={project} summary={google} metric="ctr" /></td>
                  <td data-metric="google-spend"><GoogleProjectMetric project={project} summary={google} metric="spend" /></td>
                  <td data-metric="google-status"><GoogleProjectMetric project={project} summary={google} metric="status" /></td>
                  <td><strong>{project.visitors === null ? "—" : number.format(project.visitors)}</strong></td>
                  <td><strong>{project.leads === null ? "—" : number.format(project.leads)}</strong></td>
                  <td><strong>{project.appointments === null ? "—" : number.format(project.appointments)}</strong></td>
                  <td><strong className="campaign-project-cvr-value" style={{ color: rateColor(project.cvr, 2) }}>{percentage(project.cvr)}</strong>
                    {!project.hasConversionMapping ? <span className="cell-muted">Bedankpagina nog niet gekoppeld</span> : null}</td>
                </tr>
              };
            })} />
          </div>
        )}
        <p className="campaign-method-note">Google toont per project één gewogen gemiddelde CTR, de totale spend en Live zodra minstens één campagne live is. Beweeg over een Google-cijfer of status voor de afzonderlijke campagnes. CTR onder 1% en project-CVR onder 2% zijn rood, vanaf die grenzen groen; de kleur wordt sterker verder van de grens. Beweeg over de Facebook-CTR voor de campagnenaam. Spend geldt voor de gekozen periode; Live is de huidige status. Bij een campagne voor meerdere projectpagina’s gelden CTR en spend voor die pagina’s samen. Brochure, Afspraak en CVR komen één keer per project uit Websiteprestaties.</p>
        {unmatchedCampaigns.length > 0 ? <div className="campaign-unmatched">
          <h3>Nog aan een projectpagina te koppelen</h3>
          <ul>{unmatchedCampaigns.map((campaign) => <li key={`${campaign.channel}:${campaign.siteId}:${campaign.campaignId}`}>
            {campaign.siteName} — {campaign.channel === "google" ? "Google" : "Facebook"}: {campaign.campaignName}
          </li>)}</ul>
        </div> : null}
      </section>

      <details className="panel campaign-overview campaign-connection-details">
        <summary>Totalen per website en advertentieaccount</summary>
        <div className="panel-heading">
          <div><p className="eyebrow">Alle kanalen samen</p><h2 id="campaign-overview-title">Performance per website</h2></div>
          <span className="panel-total">{number.format(rows.length)} {rows.length === 1 ? "site" : "sites"}</span>
        </div>
        {rows.length === 0 ? <p className="empty-state">Er zijn nog geen gekoppelde websites met campagnegegevens.</p> : (
          <div className="table-wrap campaign-table-wrap" role="region" aria-label="Campagneperformance per website" tabIndex={0}>
            <SortableTable className="campaign-table" columns={[
              { key: "name", label: "Website", text: true }, { key: "googleLive", label: "Google live" },
              { key: "facebookLive", label: "Facebook live" }, { key: "leads", label: "Leads" },
              { key: "appointments", label: "Afspraken" }, { key: "facebookCtr", label: "Facebook link-CTR", description: "Hoogste CTR binnen de website" },
              { key: "facebookSpend", label: "Facebook spend" }, { key: "googleCtr", label: "Google CTR" },
              { key: "googleSpend", label: "Google spend" }, { key: "cvr", label: "Website CVR" }
            ]} rows={rows.map((row) => ({ key: row.siteId, sortValues: websiteSortValues(row), content: <tr key={row.siteId}>
                <th scope="row"><span className="row-title">{row.name}</span><span className="cell-muted">{displayHost(row.url)}</span></th>
                <td><CampaignStatus sources={[row.google]} /></td><td><CampaignStatus sources={[row.facebook]} /></td>
                <td><ConversionValue source={row.leads} /></td><td><ConversionValue source={row.appointments} /></td>
                <td><FacebookCampaignCtr row={row} /></td>
                <td><AdValue source={row.facebook} metric="spend" /></td>
                <td><AdValue source={row.google} metric="ctr" /></td><td><AdValue source={row.google} metric="spend" /></td>
                <td><strong className="campaign-cvr-value">{percentage(row.websiteCvr)}</strong>{row.websiteCvr === null ? <span className="cell-muted">Geen metingen</span> : null}</td>
              </tr> }))} />
          </div>
        )}
      </details>

      {issues.length > 0 ? <details className="panel campaign-connection-details" open>
        <summary>Koppelingen aanvullen <span>{issues.length}</span></summary>
        <ul>{issues.map((issue) => <li key={issue.key}><strong>{issue.site}</strong> — {issue.message}</li>)}</ul>
      </details> : null}

      <p className="campaign-method-note">
        Live = momenteel actief volgens het advertentieplatform. Google CTR = alle klikken ÷ vertoningen.
        Facebook link-CTR wordt per campagne getoond: linkklikken ÷ vertoningen van die campagne, binnen de gekozen periode.
        Facebook-cijfers tellen alleen campagnes met “Ledoux” in de naam, inclusief hun Instagram-plaatsingen.
        Projectpagina’s worden gekoppeld via vastgelegde campagnekoppelingen of de bestemmingslink van de advertenties.
        Leads = Brochure en Afspraken = Afspraak uit Websiteprestaties, voor dezelfde website en periode.
        Dit zijn bezoekers van gekoppelde bedankpagina’s; ze zijn niet uitsluitend aan advertenties toegeschreven.
        Websitemetingen gebruiken de tijdzone Brussel; advertentiecijfers volgen de accounttijdzone.
        Bij onvolledige koppelingen tonen de kaarten alleen de beschikbare gegevens.
      </p>
    </div>
  );
}

function websiteSortValues(row: CampaignPerformanceRow) {
  const spend = (source: CampaignSource<AdPerformance>) => source.data
    ? source.data.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0) : null;
  const live = (source: CampaignSource<AdPerformance>) => source.data
    ? source.data.campaigns.length ? liveSortValue(source.data.campaigns.map((campaign) => campaign.live)) : 0 : null;
  return {
    name: row.name, googleLive: live(row.google), facebookLive: live(row.facebook),
    leads: row.leads.data?.count ?? null, appointments: row.appointments.data?.count ?? null,
    facebookCtr: highestSortValue(row.facebookLinkCtr.data?.campaigns.map((campaign) => campaign.ctr) ?? []),
    facebookSpend: spend(row.facebook), googleCtr: summarizeAds([row.google]).ctr, googleSpend: spend(row.google), cvr: row.websiteCvr
  };
}

function ProjectCampaignMetric({ project, metric, channel = "facebook" }: { project: CampaignProjectRow; metric: "ctr" | "spend" | "status"; channel?: "facebook" | "google" }) {
  const campaigns = channel === "google" ? project.googleCampaigns : project.campaigns;
  const state = channel === "google" ? project.googleState : project.facebookState;
  if (campaigns.length === 0) return metric === "status"
    ? <span className="cell-muted">{state === "not_configured" ? "Niet gekoppeld"
      : state === "unavailable" ? "Niet beschikbaar" : "Geen campagne"}</span>
    : <strong>—</strong>;
  return <ul className="campaign-project-values">
    {campaigns.map((campaign) => {
      const shared = campaign.projectCount > 1 ? `CTR en spend voor ${campaign.projectCount} projectpagina’s samen.` : "";
      const status = campaign.live === true ? "Live" : campaign.live === false ? "Niet live" : "Onbekend";
      const ctrDetail = channel === "facebook" && campaign.live !== true ? "CTR wordt alleen voor lopende campagnes getoond."
        : campaign.unavailable ? "CTR niet beschikbaar." : campaign.ctr === null ? "Geen vertoningen in deze periode." : "";
      return <li key={`${campaign.accountId}:${campaign.id}`} data-campaign-id={campaign.id}>
        {metric === "ctr" ? <CampaignCtr name={campaign.name} ctr={campaign.ctr} detail={`${status}. ${ctrDetail} ${shared}`.trim()} />
          : metric === "spend" ? <strong title={`${campaign.name}${shared ? `\n${shared}` : ""}`}>{formatSpend([{ amount: campaign.spend, currency: campaign.currency }])}</strong>
          : <span className={`campaign-status campaign-status--${campaign.live === true ? "live" : campaign.live === false ? "offline" : "unknown"}`} title={campaign.name}>
            <i aria-hidden="true" />{status}
          </span>}
      </li>;
    })}
  </ul>;
}

function GoogleProjectMetric({ project, summary, metric }: {
  project: CampaignProjectRow; summary: ReturnType<typeof summarizeGoogleProjectCampaigns>; metric: "ctr" | "spend" | "status";
}) {
  if (!project.googleCampaigns.length) return <ProjectCampaignMetric project={project} channel="google" metric={metric} />;
  const status = (live: boolean | null) => live === true ? "Live" : live === false ? "Niet live" : "Onbekend";
  const detail = project.googleCampaigns.map((campaign) => [
    campaign.name,
    `CTR: ${percentage(campaign.ctr)} · Spend: ${formatSpend([{ amount: campaign.spend, currency: campaign.currency }])} · ${status(campaign.live)}`,
    ...(campaign.projectCount > 1 ? [`CTR en spend voor ${campaign.projectCount} projectpagina’s samen.`] : [])
  ].join("\n")).join("\n\n");
  const title = `Google-campagnes · ${project.title}\nCTR gewogen op vertoningen; spend opgeteld.\n\n${detail}`;
  const value = metric === "ctr" ? percentage(summary.ctr) : metric === "spend" ? formatSpend(summary.spend) : status(summary.live);
  return <span className="campaign-google-summary campaign-ctr-trigger" tabIndex={0} title={title} aria-label={`${value}. ${title}`}>
    {metric === "status" ? <span className={`campaign-status campaign-status--${summary.live === true ? "live" : summary.live === false ? "offline" : "unknown"}`}>
      <i aria-hidden="true" />{value}
    </span> : <strong style={metric === "ctr" ? { color: rateColor(summary.ctr, 1) } : undefined}>{value}</strong>}
  </span>;
}

function CampaignCtr({ name, ctr, detail = "" }: { name: string; ctr: number | null; detail?: string }) {
  return <strong className="campaign-ctr-trigger" style={{ color: rateColor(ctr, 1) }} tabIndex={0} title={`${name}${detail ? `\n${detail}` : ""}`}
    aria-label={`${name}: ${percentage(ctr)}${detail ? `. ${detail}` : ""}`}>{percentage(ctr)}</strong>;
}

function CampaignMetric({ label, value, detail, availability }: { label: string; value: string; detail: string; availability: string }) {
  return <article className={`metric-card metric-card--${value === "—" ? "neutral" : "good"}`}>
    <span>{label}</span><strong>{value}</strong><p>{detail}</p><small className="campaign-coverage">{availability}</small>
  </article>;
}

function ChannelPanel({ name, sources, linkCtr }: { name: string; sources: CampaignSource<AdPerformance>[]; linkCtr?: LinkCtrSummary }) {
  const summary = summarizeAds(sources);
  return <article className="panel campaign-channel-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Advertenties</p><h2>{name} Ads</h2></div>
      <CampaignStatus sources={sources} />
    </div>
    <p className="campaign-channel-description">{summary.connected > 0
      ? `${summary.liveCount} van ${summary.campaignCount} campagnes live · ${coverage(summary)}`
      : coverage(summary)}</p>
    {linkCtr ? <p className="campaign-channel-description">CTR (taux de clics sur le lien) uit Ads Manager, per lopende Ledoux-campagne in de gekozen periode.</p> : null}
    <dl className="campaign-channel-metrics">
      <div><dt>{linkCtr ? `Facebook link-CTR${linkCtr.campaigns > 1 ? " (gewogen)" : ""}` : `${name} CTR`}</dt>
        <dd style={{ color: rateColor(linkCtr ? linkCtr.ctr : summary.ctr, 1) }}>{percentage(linkCtr ? linkCtr.ctr : summary.ctr)}</dd></div>
      <div><dt>{name} spend</dt><dd>{formatSpend(summary.spend)}</dd></div>
    </dl>
    {linkCtr && linkCtr.campaigns > 1 ? <p className="campaign-method-note">
      Gewogen op vertoningen per campagne. Hieronder zie je de CTR per campagne.
    </p> : null}
    {linkCtr?.unavailable ? <p className="cell-muted">Link-CTR niet beschikbaar voor alle gekoppelde campagnes.</p> : null}
  </article>;
}

function FacebookCampaignCtr({ row }: { row: CampaignPerformanceRow }) {
  const source = row.facebookLinkCtr;
  if (!source.data || source.data.campaigns.length === 0) return <>
    <DataValue source={source}>—</DataValue>
    {source.data && source.message ? <span className="cell-muted">{source.message}</span> : null}
  </>;
  return <ul className="campaign-ctr-list" aria-label="Link-CTR per Facebook-campagne">
    {source.data.campaigns.map((campaign) => {
      const pages = row.facebookCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
      return <li key={campaign.id} data-campaign-id={campaign.id}>
        <CampaignCtr name={campaign.name} ctr={campaign.ctr} />
        {campaign.ctr === null ? <span className="cell-muted">Geen vertoningen in deze periode</span> : null}
        {pages.map((page) => <a key={page.path} className="campaign-project-link" href={page.url} target="_blank" rel="noreferrer">
          {page.title}{page.hasConversionMapping ? <span className="cell-muted">Gekoppeld aan Websiteprestaties</span> : null}
        </a>)}
        {pages.length > 1 ? <span className="cell-muted">Campagne-CTR voor deze pagina’s samen</span> : null}
        {row.facebookCampaignPages.message && pages.length > 0 ? <span className="cell-muted">{row.facebookCampaignPages.message}</span> : null}
        {pages.length === 0 ? <span className="cell-muted">{row.facebookCampaignPages.state === "unavailable"
          ? "Projectpagina kon niet worden gecontroleerd" : "Geen projectpagina op deze website gevonden"}</span> : null}
      </li>;
    })}
  </ul>;
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

function ConversionValue({ source }: { source: CampaignSource<WebsiteConversionPerformance> }) {
  return <DataValue source={source}>{source.data ? number.format(source.data.count) : "—"}</DataValue>;
}

function AdValue({ source, metric }: { source: CampaignSource<AdPerformance>; metric: "ctr" | "spend" }) {
  const summary = summarizeAds([source]);
  return <DataValue source={source}>{metric === "ctr"
    ? <span style={{ color: rateColor(summary.ctr, 1) }}>{percentage(summary.ctr)}</span>
    : formatSpend(summary.spend)}</DataValue>;
}

function DataValue({ source, children }: { source: CampaignSource<unknown>; children: ReactNode }) {
  return <><strong>{children}</strong>{!source.data ? <span className="cell-muted">{source.state === "unavailable" ? "Niet beschikbaar" : "Niet gekoppeld"}</span> : null}</>;
}

function formatSpend(values: { amount: number; currency: string }[]) {
  return values.length ? values.map(({ amount, currency }) => new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(amount)).join(" + ") : "—";
}

function coverage({ connected, total }: { connected: number; total: number }) {
  return connected === 0 ? "Nog geen gegevens beschikbaar" : `${connected} van ${total} sites gekoppeld${connected < total ? " · gedeeltelijk totaal" : ""}`;
}

function displayHost(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

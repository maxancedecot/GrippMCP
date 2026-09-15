import type { ReactNode } from "react";
import {
  getCampaignPerformance, summarizeAds, summarizeWebsiteConversions,
  type AdPerformance, type CampaignPerformanceRow, type CampaignSource, type WebsiteConversionPerformance, type LinkCtrSummary
} from "../../src/campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import type { CampaignProjectRow, UnmatchedProjectCampaign } from "../../src/campaignProjects.js";

const number = new Intl.NumberFormat("nl-BE");
const percent = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 2 });
const percentage = (value: number | null) => value === null ? "—" : `${percent.format(value)}%`;

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
      ? [{ key: `${row.siteId}:facebookLinkCtr`, site: row.name, message: row.facebookLinkCtr.message }] : []));

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
          <div className="table-wrap campaign-table-wrap" role="region" aria-label="Campagneperformance per projectpagina" tabIndex={0}>
            <table className="campaign-project-table">
              <thead><tr>
                <th scope="col">Projectpagina</th><th scope="col">Facebook CTR (link)</th>
                <th scope="col">Facebook spend</th><th scope="col">Facebook live</th>
                <th scope="col">Bezoekers</th><th scope="col">Brochure</th><th scope="col">Afspraak</th><th scope="col">Project CVR</th>
              </tr></thead>
              <tbody>{projects.map((project) => <tr key={project.key} data-project-key={project.key}>
                <th scope="row"><a className="row-title" href={project.url} target="_blank" rel="noreferrer">{project.title}</a>
                  <span className="cell-muted">{project.siteName}</span><span className="cell-muted">{project.sourcePath}</span></th>
                <td data-metric="ctr"><ProjectCampaignMetric project={project} metric="ctr" /></td>
                <td data-metric="spend"><ProjectCampaignMetric project={project} metric="spend" /></td>
                <td data-metric="status"><ProjectCampaignMetric project={project} metric="status" /></td>
                <td><strong>{project.visitors === null ? "—" : number.format(project.visitors)}</strong></td>
                <td><strong>{project.leads === null ? "—" : number.format(project.leads)}</strong></td>
                <td><strong>{project.appointments === null ? "—" : number.format(project.appointments)}</strong></td>
                <td><strong className="campaign-cvr-value">{percentage(project.cvr)}</strong>
                  {!project.hasConversionMapping ? <span className="cell-muted">Bedankpagina nog niet gekoppeld</span> : null}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="campaign-method-note">Beweeg over de CTR voor de campagnenaam. Spend geldt voor de gekozen periode; Live is de huidige status. Bij een campagne voor meerdere projectpagina’s gelden CTR en spend voor die pagina’s samen. Brochure, Afspraak en CVR komen één keer per project uit Websiteprestaties.</p>
        {unmatchedCampaigns.length > 0 ? <div className="campaign-unmatched">
          <h3>Nog aan een projectpagina te koppelen</h3>
          <ul>{unmatchedCampaigns.map((campaign) => <li key={`${campaign.siteId}:${campaign.campaignId}`}>
            {campaign.siteName} — {campaign.campaignName}
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
            <table className="campaign-table">
              <thead><tr>
                <th scope="col">Website</th><th scope="col">Google live</th><th scope="col">Facebook live</th>
                <th scope="col">Leads</th><th scope="col">Afspraken</th><th scope="col">Facebook link-CTR</th>
                <th scope="col">Facebook spend</th><th scope="col">Google CTR</th><th scope="col">Google spend</th><th scope="col">Website CVR</th>
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.siteId}>
                <th scope="row"><span className="row-title">{row.name}</span><span className="cell-muted">{displayHost(row.url)}</span></th>
                <td><CampaignStatus sources={[row.google]} /></td><td><CampaignStatus sources={[row.facebook]} /></td>
                <td><ConversionValue source={row.leads} /></td><td><ConversionValue source={row.appointments} /></td>
                <td><FacebookCampaignCtr row={row} /></td>
                <td><AdValue source={row.facebook} metric="spend" /></td>
                <td><AdValue source={row.google} metric="ctr" /></td><td><AdValue source={row.google} metric="spend" /></td>
                <td><strong className="campaign-cvr-value">{percentage(row.websiteCvr)}</strong>{row.websiteCvr === null ? <span className="cell-muted">Geen metingen</span> : null}</td>
              </tr>)}</tbody>
            </table>
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

function ProjectCampaignMetric({ project, metric }: { project: CampaignProjectRow; metric: "ctr" | "spend" | "status" }) {
  if (project.campaigns.length === 0) return metric === "status"
    ? <span className="cell-muted">{project.facebookState === "not_configured" ? "Niet gekoppeld"
      : project.facebookState === "unavailable" ? "Niet beschikbaar" : "Geen campagne"}</span>
    : <strong>—</strong>;
  return <ul className="campaign-project-values">
    {project.campaigns.map((campaign) => {
      const shared = campaign.projectCount > 1 ? `CTR en spend voor ${campaign.projectCount} projectpagina’s samen.` : "";
      const status = campaign.live === true ? "Live" : campaign.live === false ? "Niet live" : "Onbekend";
      const ctrDetail = campaign.live !== true ? "CTR wordt alleen voor lopende campagnes getoond."
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

function CampaignCtr({ name, ctr, detail = "" }: { name: string; ctr: number | null; detail?: string }) {
  return <strong className="campaign-ctr-trigger" tabIndex={0} title={`${name}${detail ? `\n${detail}` : ""}`}
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
        <dd>{percentage(linkCtr ? linkCtr.ctr : summary.ctr)}</dd></div>
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
  return <DataValue source={source}>{metric === "ctr" ? percentage(summary.ctr) : formatSpend(summary.spend)}</DataValue>;
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

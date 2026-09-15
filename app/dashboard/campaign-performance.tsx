import type { ReactNode } from "react";
import {
  getCampaignPerformance, summarizeAds, summarizeWebsiteConversions,
  type AdPerformance, type CampaignPerformanceRow, type CampaignSource, type WebsiteConversionPerformance, type UniqueCtrSummary
} from "../../src/campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";

const number = new Intl.NumberFormat("nl-BE");
const percent = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 2 });
const percentage = (value: number | null) => value === null ? "—" : `${percent.format(value)}%`;

export async function CampaignPerformance({ dashboard }: { dashboard: SiteAnalyticsDashboardData }) {
  const { rows, message, facebookUniqueCtr } = await getCampaignPerformance(dashboard);
  return <CampaignPerformanceView rows={rows} message={message} facebookUniqueCtr={facebookUniqueCtr} />;
}

export function CampaignPerformanceView({ rows, message, facebookUniqueCtr }: { rows: CampaignPerformanceRow[]; message: string; facebookUniqueCtr: UniqueCtrSummary }) {
  const leads = summarizeWebsiteConversions(rows.map((row) => row.leads));
  const appointments = summarizeWebsiteConversions(rows.map((row) => row.appointments));
  const measuredSites = rows.filter((row) => row.websiteCvr !== null);
  const visitors = measuredSites.reduce((sum, row) => sum + row.websiteVisitors, 0);
  const conversions = measuredSites.reduce((sum, row) => sum + row.websiteConversions, 0);
  const cvr = visitors > 0 ? conversions / visitors * 100 : null;
  const issues = rows.flatMap((row) => (["google", "facebook", "leads", "appointments"] as const)
    .filter((key) => row[key].state !== "connected")
    .map((key) => ({ key: `${row.siteId}:${key}`, site: row.name, message: row[key].message }))
    .concat(row.facebookUniqueCtr.state === "unavailable"
      ? [{ key: `${row.siteId}:facebookUniqueCtr`, site: row.name, message: row.facebookUniqueCtr.message }] : []));

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
        <ChannelPanel name="Facebook" sources={rows.map((row) => row.facebook)} uniqueCtr={facebookUniqueCtr} />
      </section>

      <section className="panel campaign-overview" aria-labelledby="campaign-overview-title">
        <div className="panel-heading">
          <div><p className="eyebrow">Alle kanalen samen</p><h2 id="campaign-overview-title">Performance per website</h2></div>
          <span className="panel-total">{number.format(rows.length)} {rows.length === 1 ? "site" : "sites"}</span>
        </div>
        {rows.length === 0 ? <p className="empty-state">Er zijn nog geen gekoppelde websites met campagnegegevens.</p> : (
          <div className="table-wrap campaign-table-wrap" role="region" aria-label="Campagneperformance per website" tabIndex={0}>
            <table className="campaign-table">
              <thead><tr>
                <th scope="col">Website</th><th scope="col">Google live</th><th scope="col">Facebook live</th>
                <th scope="col">Leads</th><th scope="col">Afspraken</th><th scope="col">Facebook unieke link-CTR</th>
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
      </section>

      {issues.length > 0 ? <details className="panel campaign-connection-details" open>
        <summary>Koppelingen aanvullen <span>{issues.length}</span></summary>
        <ul>{issues.map((issue) => <li key={issue.key}><strong>{issue.site}</strong> — {issue.message}</li>)}</ul>
      </details> : null}

      <p className="campaign-method-note">
        Live = momenteel actief volgens het advertentieplatform. Google CTR = alle klikken ÷ vertoningen.
        Facebook unieke link-CTR wordt per campagne getoond: unieke linkklikkers ÷ uniek bereik van die campagne, binnen de gekozen periode.
        Facebook-cijfers tellen alleen campagnes met “Ledoux” in de naam, inclusief hun Instagram-plaatsingen.
        Projectpagina’s worden gekoppeld via de bestemmingslink van de advertenties binnen elke campagne.
        Leads = Brochure en Afspraken = Afspraak uit Websiteprestaties, voor dezelfde website en periode.
        Dit zijn bezoekers van gekoppelde bedankpagina’s; ze zijn niet uitsluitend aan advertenties toegeschreven.
        Websitemetingen gebruiken de tijdzone Brussel; advertentiecijfers volgen de accounttijdzone.
        Bij onvolledige koppelingen tonen de kaarten alleen de beschikbare gegevens.
      </p>
    </div>
  );
}

function CampaignMetric({ label, value, detail, availability }: { label: string; value: string; detail: string; availability: string }) {
  return <article className={`metric-card metric-card--${value === "—" ? "neutral" : "good"}`}>
    <span>{label}</span><strong>{value}</strong><p>{detail}</p><small className="campaign-coverage">{availability}</small>
  </article>;
}

function ChannelPanel({ name, sources, uniqueCtr }: { name: string; sources: CampaignSource<AdPerformance>[]; uniqueCtr?: UniqueCtrSummary }) {
  const summary = summarizeAds(sources);
  return <article className="panel campaign-channel-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Advertenties</p><h2>{name} Ads</h2></div>
      <CampaignStatus sources={sources} />
    </div>
    <p className="campaign-channel-description">{summary.connected > 0
      ? `${summary.liveCount} van ${summary.campaignCount} campagnes live · ${coverage(summary)}`
      : coverage(summary)}</p>
    {uniqueCtr ? <p className="campaign-channel-description">Alleen campagnes met “Ledoux” in de naam. Unieke link-CTR per lopende campagne in de gekozen periode.</p> : null}
    <dl className="campaign-channel-metrics">
      <div><dt>{uniqueCtr ? `Facebook unieke link-CTR${uniqueCtr.campaigns > 1 ? " (gewogen)" : ""}` : `${name} CTR`}</dt>
        <dd>{percentage(uniqueCtr ? uniqueCtr.ctr : summary.ctr)}</dd></div>
      <div><dt>{name} spend</dt><dd>{formatSpend(summary.spend)}</dd></div>
    </dl>
    {uniqueCtr && uniqueCtr.campaigns > 1 ? <p className="campaign-method-note">
      Gemiddelde gewogen op bereik per campagne. Dezelfde persoon kan in meerdere campagnes meetellen. Hieronder zie je de CTR per campagne.
    </p> : null}
    {uniqueCtr?.unavailable ? <p className="cell-muted">Unieke link-CTR niet beschikbaar voor alle gekoppelde campagnes.</p> : null}
  </article>;
}

function FacebookCampaignCtr({ row }: { row: CampaignPerformanceRow }) {
  const source = row.facebookUniqueCtr;
  if (!source.data || source.data.campaigns.length === 0) return <>
    <DataValue source={source}>—</DataValue>
    {source.data && source.message ? <span className="cell-muted">{source.message}</span> : null}
  </>;
  return <ul className="campaign-ctr-list" aria-label="Unieke link-CTR per Facebook-campagne">
    {source.data.campaigns.map((campaign) => {
      const pages = row.facebookCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
      return <li key={campaign.id} data-campaign-id={campaign.id}>
        <span>{campaign.name}</span><strong>{percentage(campaign.ctr)}</strong>
        {campaign.ctr === null ? <span className="cell-muted">Geen bereik in deze periode</span> : null}
        {pages.map((page) => <a key={page.path} className="campaign-project-link" href={page.url} target="_blank" rel="noreferrer">
          {page.title}{page.hasConversionMapping ? <span className="cell-muted">Gekoppeld aan Websiteprestaties</span> : null}
        </a>)}
        {pages.length > 1 ? <span className="cell-muted">Campagne-CTR voor deze pagina’s samen</span> : null}
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

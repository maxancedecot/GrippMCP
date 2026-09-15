import type { ReactNode } from "react";
import {
  getCampaignPerformance, summarizeAds, summarizeCrm,
  type AdPerformance, type CampaignPerformanceRow, type CampaignSource, type CrmPerformance, type UniqueCtrSummary
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
  const leads = summarizeCrm(rows.map((row) => row.leads));
  const appointments = summarizeCrm(rows.map((row) => row.appointments));
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
          detail="Nieuwe contacten in GoHighLevel" availability={coverage(leads)} />
        <CampaignMetric label="Afspraken" value={appointments.count === null ? "—" : number.format(appointments.count)}
          detail="Afspraken in de gekozen periode, excl. annuleringen" availability={coverage(appointments)} />
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
                <th scope="col">Leads</th><th scope="col">Afspraken</th><th scope="col">Facebook unieke CTR</th>
                <th scope="col">Facebook spend</th><th scope="col">Google CTR</th><th scope="col">Google spend</th><th scope="col">Website CVR</th>
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.siteId}>
                <th scope="row"><span className="row-title">{row.name}</span><span className="cell-muted">{displayHost(row.url)}</span></th>
                <td><CampaignStatus sources={[row.google]} /></td><td><CampaignStatus sources={[row.facebook]} /></td>
                <td><CrmValue source={row.leads} /></td><td><CrmValue source={row.appointments} /></td>
                <td><DataValue source={row.facebookUniqueCtr}>{percentage(row.facebookUniqueCtr.data?.ctr ?? null)}</DataValue></td>
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
        Facebook unieke CTR (alle) = unieke klikkers ÷ uniek bereik, over de volledige gekozen periode.
        Facebook-cijfers omvatten de plaatsingen van het Meta-advertentieaccount, inclusief Instagram.
        Leads en afspraken komen uit de gekoppelde CRM-locatie en zijn niet uitsluitend aan advertenties toegeschreven.
        CRM en website gebruiken de tijdzone Brussel; advertentiecijfers volgen de accounttijdzone.
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
    <dl className="campaign-channel-metrics">
      <div><dt>{uniqueCtr ? `Facebook unieke CTR${uniqueCtr.accounts > 1 ? " (gewogen)" : ""}` : `${name} CTR`}</dt>
        <dd>{percentage(uniqueCtr ? uniqueCtr.ctr : summary.ctr)}</dd></div>
      <div><dt>{name} spend</dt><dd>{formatSpend(summary.spend)}</dd></div>
    </dl>
    {uniqueCtr?.accounts && uniqueCtr.accounts > 1 ? <p className="campaign-method-note">
      Gewogen op bereik per advertentieaccount. Personen die via meerdere accounts zijn bereikt, kunnen meermaals meetellen.
    </p> : null}
    {uniqueCtr?.unavailable ? <p className="cell-muted">Unieke CTR niet beschikbaar voor alle gekoppelde accounts.</p> : null}
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

function CrmValue({ source }: { source: CampaignSource<CrmPerformance> }) {
  return <DataValue source={source}>{source.data ? number.format(source.data.ids.length) : "—"}</DataValue>;
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

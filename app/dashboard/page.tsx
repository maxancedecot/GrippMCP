import type { Metadata } from "next";
import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation.js";
import {
  deleteSiteAnalyticsCvrLink,
  getPublicSiteAnalyticsSites,
  getSiteAnalyticsDashboardData,
  upsertSiteAnalyticsCvrLink,
  type SiteAnalyticsCvrLinkRow,
  type SiteAnalyticsMetricSummary,
  type SiteAnalyticsPeriod,
  type SiteAnalyticsReferrerRow
} from "../../src/siteAnalytics.js";
import { cvrOverviewRowsFromLinks, type CvrOverviewMetric, type CvrOverviewRow } from "../../src/siteAnalyticsConversions.js";
import { DashboardFrame } from "../dashboard-frame.js";
import { CvrMappingBoard } from "./cvr-mapping-board.js";
import { CvrTrendChart } from "./cvr-trend-chart.js";
import { CampaignPerformance } from "./campaign-performance.js";
import { dashboardHref, dashboardPeriodSelection, dashboardToday, DASHBOARD_PERIOD_OPTIONS, MAX_DASHBOARD_DAYS, type DashboardSearchParams } from "../../src/dashboardPeriod.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Website- en campagneprestaties | Dashboard",
  description: "Websiteprestaties en campagneperformance uit Google Ads, Facebook Ads en websiteconversies."
};

type DashboardFormValue = FormDataEntryValue | null;

const periodOptions = DASHBOARD_PERIOD_OPTIONS;

const numberFormatter = new Intl.NumberFormat("nl-BE");
const percentFormatter = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
const conversionRateFormatter = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

async function createCvrLinkAction(formData: FormData) {
  "use server";

  const returnTo = dashboardReturnPathFromForm(formData.get("return_to"));
  await upsertSiteAnalyticsCvrLink({
    site_id: stringFromFormValue(formData.get("site_id")),
    source_path: stringFromFormValue(formData.get("source_path")),
    target_path: stringFromFormValue(formData.get("target_path")),
    source_title: stringFromFormValue(formData.get("source_title")),
    target_title: stringFromFormValue(formData.get("target_title"))
  });
  revalidatePath("/dashboard");
  redirect(returnTo);
}

async function deleteCvrLinkAction(formData: FormData) {
  "use server";

  const returnTo = dashboardReturnPathFromForm(formData.get("return_to"));
  await deleteSiteAnalyticsCvrLink(stringFromFormValue(formData.get("link_id")));
  revalidatePath("/dashboard");
  redirect(returnTo);
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const selection = dashboardPeriodSelection(params, now);
  const { days } = selection.period;
  const customPeriod = selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined;
  const analyticsOptions = { days, ...customPeriod, now };
  const siteId = firstParam(params.site);
  const view = firstParam(params.tab) === "campaigns" ? "campaigns" : "website";
  const dashboardPromise = getSiteAnalyticsDashboardData({ ...analyticsOptions, siteId });
  const connectedDashboardPromise = siteId ? getSiteAnalyticsDashboardData(analyticsOptions) : dashboardPromise;
  const [dashboard, connectedDashboard, configuredSites] = await Promise.all([
    dashboardPromise,
    connectedDashboardPromise,
    getPublicSiteAnalyticsSites()
  ]);
  const overviewCvrLinks = dashboard.cvrLinks;
  const siteTabs = configuredSites.length > 0 ? configuredSites : connectedDashboard.sites;
  const totalCvrSourceVisitors = dashboard.sites.reduce((sum, site) => sum + site.cvrSourceVisitors, 0);
  const totalCvrConversionVisitors = dashboard.sites.reduce((sum, site) => sum + site.cvrConversionVisitors, 0);
  const overallConversionRatePercent = totalCvrSourceVisitors > 0 ? (totalCvrConversionVisitors / totalCvrSourceVisitors) * 100 : 0;

  return (
    <DashboardFrame showTopMenu={false}>
      <main className="dashboard-shell site-analytics-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">{view === "campaigns" ? "Marketingoverzicht" : "Website-analyse"}</p>
            <h1>{view === "campaigns" ? "Campagneperformance" : "Websiteprestaties"}</h1>
          </div>
          <div className="header-meta">
            <a className="header-meta-link" href="/api/site-analytics/plugin" download>
              WordPress-plugin
            </a>
            <span className={`source-badge source-badge--${dashboard.source.mode}`}>
              {dashboard.source.mode === "live" ? "Website verbonden" : "Website-demo"}
            </span>
            <span>{dashboard.period.label}</span>
            <span>Bijgewerkt {dashboard.lastUpdated}</span>
          </div>
        </header>

        <nav className="dashboard-tabs site-analytics-view-tabs" aria-label="Dashboardweergave">
          {(["website", "campaigns"] as const).map((tab) => (
            <a
              key={tab}
              className={`dashboard-tab ${view === tab ? "dashboard-tab--active" : ""}`}
              href={dashboardHref({ params: { ...params, tab: tab === "campaigns" ? tab : undefined }, days, siteId: dashboard.selectedSiteId, customPeriod })}
              aria-current={view === tab ? "page" : undefined}
            >
              {tab === "campaigns" ? "Campagneperformance" : "Websiteprestaties"}
            </a>
          ))}
        </nav>

        {view === "website" && dashboard.source.message ? <p className="data-notice">{dashboard.source.message}</p> : null}

        {selection.error ? <p className="data-notice" role="alert">{selection.error}</p> : null}

        <div className="site-analytics-controls">
          <nav className="dashboard-tabs" aria-label="Periode">
            {periodOptions.map((periodDays) => (
              <a
                key={periodDays}
                className={`dashboard-tab ${!selection.custom && dashboard.period.days === periodDays ? "dashboard-tab--active" : ""}`}
                href={dashboardHref({ params, days: periodDays, siteId: dashboard.selectedSiteId })}
                aria-current={!selection.custom && dashboard.period.days === periodDays ? "page" : undefined}
              >
                {periodDays}d
              </a>
            ))}
          </nav>

          <form className="period-form dashboard-date-range" action="/dashboard" method="get" aria-label="Eigen periode kiezen">
            {view === "campaigns" ? <input type="hidden" name="tab" value="campaigns" /> : null}
            {dashboard.selectedSiteId ? <input type="hidden" name="site" value={dashboard.selectedSiteId} /> : null}
            <label>Van<input type="date" name="start" required defaultValue={dashboard.period.start} max={dashboardToday(now)} /></label>
            <label>Tot en met<input type="date" name="end" required defaultValue={dashboard.period.end} max={dashboardToday(now)} /></label>
            <button type="submit">Toepassen</button>
            <span>Max. {MAX_DASHBOARD_DAYS} dagen per periode</span>
          </form>

          <nav className="dashboard-tabs site-analytics-site-tabs" aria-label="Sites">
            <a
              className={`dashboard-tab ${!dashboard.selectedSiteId ? "dashboard-tab--active" : ""}`}
              href={dashboardHref({ params, days: dashboard.period.days, customPeriod })}
              aria-current={!dashboard.selectedSiteId ? "page" : undefined}
            >
              Alle
            </a>
            {siteTabs.map((site) => (
              <a
                key={site.id}
                className={`dashboard-tab ${dashboard.selectedSiteId === site.id ? "dashboard-tab--active" : ""}`}
                href={dashboardHref({ params, days: dashboard.period.days, siteId: site.id, customPeriod })}
                aria-current={dashboard.selectedSiteId === site.id ? "page" : undefined}
              >
                {site.name}
              </a>
            ))}
          </nav>
        </div>

        {view === "campaigns" ? (
          <Suspense fallback={<p className="data-notice" role="status">Campagnegegevens laden uit Google Ads, Facebook Ads en Websiteprestaties…</p>}>
            <CampaignPerformance dashboard={dashboard} />
          </Suspense>
        ) : <>
        <section className="metric-grid site-analytics-metric-grid" aria-label="Website KPI's">
          <MetricCard label="CVR" value={`${formatConversionRate(overallConversionRatePercent)}%`} detail="Conversieratio" tone="good" />
          <MetricCard label="Bezoekers" value={formatNumber(dashboard.totals.uniqueVisitors)} detail="Unieke bezoekers" tone="blue" />
          <MetricCard label="Sessies" value={formatNumber(dashboard.totals.sessions)} detail="Unieke sessies" tone="neutral" />
          <MetricCard label="Gemiddelde tijd" value={formatDuration(dashboard.totals.avgTimeOnPageSeconds)} detail="Actieve tijd per weergave" tone="warning" />
          <MetricCard label="Gem. scroll" value={`${formatPercent(dashboard.totals.avgScrollPercent)}%`} detail="Maximale diepte" tone="overtime" />
        </section>

        <section className="panel site-analytics-chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conversie</p>
              <h2>CVR-verloop</h2>
            </div>
          </div>
          <CvrTrendChart links={overviewCvrLinks} periodLabel={periodLabel(dashboard.period)} />
        </section>

        <section className="site-analytics-detail-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Gekoppelde pagina's</p>
                <h2>Overzicht</h2>
              </div>
              <span className="panel-total">{overviewCvrLinks.length} koppelingen</span>
            </div>
            <CvrOverviewTable rows={overviewCvrLinks} />
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Acquisitie</p>
                <h2>Verwijzers</h2>
              </div>
            </div>
            <ReferrerTable rows={dashboard.referrerRows} totals={dashboard.totals} />
          </article>
        </section>

        <CvrMappingBoard
          sites={siteTabs}
          pages={dashboard.cvrPageCandidates}
          links={dashboard.cvrLinks}
          selectedSiteId={dashboard.selectedSiteId}
          returnTo={dashboardHref({ params, days: dashboard.period.days, siteId: dashboard.selectedSiteId, customPeriod })}
          createAction={createCvrLinkAction}
          deleteAction={deleteCvrLinkAction}
        />
        </>}
      </main>
    </DashboardFrame>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "blue" | "warning" | "neutral" | "overtime";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function CvrOverviewTable({ rows }: { rows: SiteAnalyticsCvrLinkRow[] }) {
  const projectRows = cvrOverviewRowsFromLinks(rows);

  if (projectRows.length === 0) {
    return <p className="empty-state">Geen projectpagina's gekoppeld aan bedankingspagina's.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="cvr-overview-table">
        <thead>
          <tr>
            <th>Projectpagina</th>
            <th>Bezoekers</th>
            <th>Brochure</th>
            <th>Afspraak</th>
            <th>CVR</th>
          </tr>
        </thead>
        <tbody>
          {projectRows.map((row) => {
            return (
              <tr key={row.key}>
                <td>
                  <span className="row-title">{row.sourceTitle}</span>
                  <span className="cell-muted">{row.sourcePath}</span>
                </td>
                <td>
                  <span className="row-title">{formatNumber(row.sourceVisitors)}</span>
                </td>
                <td>
                  <CvrOverviewMetricCell metric={row.brochure} sourceVisitors={row.sourceVisitors} />
                </td>
                <td>
                  <CvrOverviewMetricCell metric={row.appointment} sourceVisitors={row.sourceVisitors} />
                </td>
                <td>
                  <CvrOverviewTotalCell row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CvrOverviewTotalCell({ row }: { row: CvrOverviewRow }) {
  const conversions = row.brochure.visitors + row.appointment.visitors;
  const conversionRate = row.sourceVisitors > 0 ? (conversions / row.sourceVisitors) * 100 : 0;

  return (
    <span className="cvr-overview-metric cvr-overview-metric--total">
      <strong>{formatConversionRate(conversionRate)}%</strong>
      <span>{formatNumber(conversions)} conversies</span>
    </span>
  );
}

function CvrOverviewMetricCell({ metric, sourceVisitors }: { metric: CvrOverviewMetric; sourceVisitors: number }) {
  const conversionRate = sourceVisitors > 0 ? (metric.visitors / sourceVisitors) * 100 : 0;

  return (
    <span className="cvr-overview-metric">
      <strong>{formatNumber(metric.visitors)}</strong>
      <span>{formatConversionRate(conversionRate)}%</span>
    </span>
  );
}

function ReferrerTable({ rows, totals }: { rows: SiteAnalyticsReferrerRow[]; totals: SiteAnalyticsMetricSummary }) {
  if (rows.length === 0) {
    return <p className="empty-state">Geen verwijzers in deze periode.</p>;
  }

  return (
    <div className="site-analytics-referrer-list">
      {rows.map((row) => {
        const share = totals.pageViews > 0 ? (row.pageViews / totals.pageViews) * 100 : 0;

        return (
          <div className="site-analytics-referrer-row" key={row.source}>
            <div>
              <span className="row-title">{row.source}</span>
              <span className="cell-muted">{formatNumber(row.sessions)} sessies</span>
            </div>
            <div className="site-analytics-referrer-metrics">
              <strong>{formatNumber(row.pageViews)}</strong>
              <ScrollBar value={share} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScrollBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <span className="site-analytics-scroll-bar">
      <span><i style={{ width: `${width}%` }} /></span>
      <strong>{formatPercent(value)}%</strong>
    </span>
  );
}

function periodLabel(period: SiteAnalyticsPeriod) {
  return `${formatDate(period.start)} - ${formatDate(period.end)}`;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function stringFromFormValue(value: DashboardFormValue) {
  return typeof value === "string" ? value : "";
}

function dashboardReturnPathFromForm(value: DashboardFormValue) {
  const raw = stringFromFormValue(value);
  if (!raw.startsWith("/dashboard")) {
    return "/dashboard";
  }

  try {
    const url = new URL(raw, "https://dashboard.local");
    return url.pathname === "/dashboard" ? `${url.pathname}${url.search}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatPercent(value: number) {
  return percentFormatter.format(Math.max(0, Math.min(100, value)));
}

function formatConversionRate(value: number) {
  return conversionRateFormatter.format(Math.max(0, value));
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("nl-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, (month ?? 1) - 1, day ?? 1));
}

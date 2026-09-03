import type { Metadata } from "next";
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
import { DashboardFrame } from "../dashboard-frame.js";
import { CvrMappingBoard } from "./cvr-mapping-board.js";
import { CvrTrendChart } from "./cvr-trend-chart.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WordPress-prestaties | Dashboard",
  description: "Centraal dashboard voor de prestaties van WordPress-sites."
};

type DashboardSearchParams = Record<string, string | string[] | undefined>;
type DashboardFormValue = FormDataEntryValue | null;

const periodOptions = [7, 14, 30, 90];

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
  const days = dashboardDaysFromParams(params);
  const siteId = firstParam(params.site);
  const dashboardPromise = getSiteAnalyticsDashboardData({ days, siteId });
  const connectedDashboardPromise = siteId ? getSiteAnalyticsDashboardData({ days }) : dashboardPromise;
  const [dashboard, connectedDashboard, configuredSites] = await Promise.all([
    dashboardPromise,
    connectedDashboardPromise,
    getPublicSiteAnalyticsSites()
  ]);
  const overviewCvrLinks = dashboard.cvrLinks;
  const siteTabs = configuredSites.length > 0 ? configuredSites : connectedDashboard.sites;
  const totalCvrSourceVisitors = overviewCvrLinks.reduce((sum, link) => sum + link.sourceVisitors, 0);
  const totalCvrConversionVisitors = overviewCvrLinks.reduce((sum, link) => sum + link.targetVisitors, 0);
  const overallConversionRatePercent = totalCvrSourceVisitors > 0 ? (totalCvrConversionVisitors / totalCvrSourceVisitors) * 100 : 0;

  return (
    <DashboardFrame>
      <main className="dashboard-shell site-analytics-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">WordPress-analyse</p>
            <h1>Websiteprestaties</h1>
          </div>
          <div className="header-meta">
            <a className="header-meta-link" href="/api/site-analytics/plugin" download>
              WordPress-plugin
            </a>
            <span className={`source-badge source-badge--${dashboard.source.mode}`}>
              {dashboard.source.mode === "live" ? "Verbonden sites" : "Demogegevens"}
            </span>
            <span>{dashboard.period.label}</span>
            <span>Bijgewerkt {dashboard.lastUpdated}</span>
          </div>
        </header>

        {dashboard.source.message ? <p className="data-notice">{dashboard.source.message}</p> : null}

        <div className="site-analytics-controls">
          <nav className="dashboard-tabs" aria-label="Periode">
            {periodOptions.map((periodDays) => (
              <a
                key={periodDays}
                className={`dashboard-tab ${dashboard.period.days === periodDays ? "dashboard-tab--active" : ""}`}
                href={dashboardHref({ params, days: periodDays, siteId: dashboard.selectedSiteId })}
                aria-current={dashboard.period.days === periodDays ? "page" : undefined}
              >
                {periodDays}d
              </a>
            ))}
          </nav>

          <nav className="dashboard-tabs site-analytics-site-tabs" aria-label="Sites">
            <a
              className={`dashboard-tab ${!dashboard.selectedSiteId ? "dashboard-tab--active" : ""}`}
              href={dashboardHref({ params, days: dashboard.period.days })}
              aria-current={!dashboard.selectedSiteId ? "page" : undefined}
            >
              Alle
            </a>
            {siteTabs.map((site) => (
              <a
                key={site.id}
                className={`dashboard-tab ${dashboard.selectedSiteId === site.id ? "dashboard-tab--active" : ""}`}
                href={dashboardHref({ params, days: dashboard.period.days, siteId: site.id })}
                aria-current={dashboard.selectedSiteId === site.id ? "page" : undefined}
              >
                {site.name}
              </a>
            ))}
          </nav>
        </div>

        <section className="metric-grid site-analytics-metric-grid" aria-label="WordPress KPI's">
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
          returnTo={dashboardHref({ params, days: dashboard.period.days, siteId: dashboard.selectedSiteId })}
          createAction={createCvrLinkAction}
          deleteAction={deleteCvrLinkAction}
        />
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
  if (rows.length === 0) {
    return <p className="empty-state">Geen projectpagina's gekoppeld aan bedankingspagina's.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="cvr-overview-table">
        <thead>
          <tr>
            <th>Projectpagina</th>
            <th>Bezoekers</th>
            <th>Conversion</th>
            <th>CVR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((link) => {
            return (
              <tr key={link.id}>
                <td>
                  <span className="row-title">{link.sourceTitle}</span>
                </td>
                <td>
                  <span className="row-title">{formatNumber(link.sourceVisitors)}</span>
                </td>
                <td>
                  <span className="row-title">{formatNumber(link.targetVisitors)}</span>
                </td>
                <td>
                  <span className="cvr-overview-rate">{formatConversionRate(link.conversionRatePercent)}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

function dashboardDaysFromParams(params: DashboardSearchParams) {
  const value = Number(firstParam(params.days));
  return periodOptions.includes(value) ? value : 30;
}

function dashboardHref({ params, days, siteId }: { params: DashboardSearchParams; days: number; siteId?: string }) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "days" || key === "site") {
      continue;
    }
    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  if (days !== 30) {
    search.set("days", String(days));
  }
  if (siteId) {
    search.set("site", siteId);
  }

  const query = search.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

function periodLabel(period: SiteAnalyticsPeriod) {
  return `${formatDate(period.start)} - ${formatDate(period.end)}`;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function paramValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
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

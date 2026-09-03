import type { Metadata } from "next";
import {
  getPublicSiteAnalyticsSites,
  getSiteAnalyticsDashboardData,
  type SiteAnalyticsDailyRow,
  type SiteAnalyticsMetricSummary,
  type SiteAnalyticsPageRow,
  type SiteAnalyticsPeriod,
  type SiteAnalyticsReferrerRow,
  type SiteAnalyticsSiteSummary
} from "../../src/siteAnalytics.js";
import { smoothAreaPath, smoothLinePath, type ChartPoint } from "../chart-paths.js";
import { DashboardFrame } from "../dashboard-frame.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Performance WordPress | Dashboard",
  description: "Dashboard centralise des performances des sites WordPress."
};

type DashboardSearchParams = Record<string, string | string[] | undefined>;

const periodOptions = [7, 30, 90];

const numberFormatter = new Intl.NumberFormat("fr-BE");
const percentFormatter = new Intl.NumberFormat("fr-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = (await searchParams) ?? {};
  const days = dashboardDaysFromParams(params);
  const siteId = firstParam(params.site);
  const dashboard = await getSiteAnalyticsDashboardData({ days, siteId });
  const configuredSites = await getPublicSiteAnalyticsSites();
  const siteTabs = configuredSites.length > 0 ? configuredSites : dashboard.sites;

  return (
    <DashboardFrame>
      <main className="dashboard-shell site-analytics-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">WordPress analytics</p>
            <h1>Performance des sites</h1>
          </div>
          <div className="header-meta">
            <a className="header-meta-link" href="/api/site-analytics/plugin" download>
              Plugin WordPress
            </a>
            <span className={`source-badge source-badge--${dashboard.source.mode}`}>
              {dashboard.source.mode === "live" ? "Sites connectes" : "Demo-data"}
            </span>
            <span>{dashboard.period.label}</span>
            <span>Mis a jour {dashboard.lastUpdated}</span>
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
                {periodDays}j
              </a>
            ))}
          </nav>

          <nav className="dashboard-tabs site-analytics-site-tabs" aria-label="Sites">
            <a
              className={`dashboard-tab ${!dashboard.selectedSiteId ? "dashboard-tab--active" : ""}`}
              href={dashboardHref({ params, days: dashboard.period.days })}
              aria-current={!dashboard.selectedSiteId ? "page" : undefined}
            >
              Tous
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

        <section className="metric-grid site-analytics-metric-grid" aria-label="KPI WordPress">
          <MetricCard label="Vues" value={formatNumber(dashboard.totals.pageViews)} detail="Pages vues" tone="good" />
          <MetricCard label="Visiteurs" value={formatNumber(dashboard.totals.uniqueVisitors)} detail="Visiteurs uniques" tone="blue" />
          <MetricCard label="Sessions" value={formatNumber(dashboard.totals.sessions)} detail="Sessions uniques" tone="neutral" />
          <MetricCard label="Temps moyen" value={formatDuration(dashboard.totals.avgTimeOnPageSeconds)} detail="Temps actif par vue" tone="warning" />
          <MetricCard label="Scroll moyen" value={`${formatPercent(dashboard.totals.avgScrollPercent)}%`} detail="Profondeur maximale" tone="overtime" />
        </section>

        <section className="panel site-analytics-chart-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Trafic</p>
              <h2>Vues et visiteurs</h2>
            </div>
            <span className="panel-total">{periodLabel(dashboard.period)}</span>
          </div>
          <TrafficChart rows={dashboard.dailyRows} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Sites</p>
              <h2>Vue d'ensemble</h2>
            </div>
            <span className="panel-total">{dashboard.sites.length} sites</span>
          </div>
          <SiteSummaryTable rows={dashboard.sites} />
        </section>

        <section className="site-analytics-detail-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Pages</p>
                <h2>Pages principales</h2>
              </div>
            </div>
            <PageTable rows={dashboard.pageRows} />
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Acquisition</p>
                <h2>Referents</h2>
              </div>
            </div>
            <ReferrerTable rows={dashboard.referrerRows} totals={dashboard.totals} />
          </article>
        </section>
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

function TrafficChart({ rows }: { rows: SiteAnalyticsDailyRow[] }) {
  const width = Math.max(760, rows.length * 42);
  const height = 320;
  const padding = { top: 28, right: 34, bottom: 48, left: 74 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, ...rows.flatMap((row) => [row.pageViews, row.uniqueVisitors]));
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / maximum) * chartHeight;
  const viewPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.pageViews) }));
  const visitorPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.uniqueVisitors) }));
  const viewPath = smoothLinePath(viewPoints);
  const visitorPath = smoothLinePath(visitorPoints);
  const areaPath = smoothAreaPath(viewPoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round(maximum - (maximum * index) / 4);
    return { key: index, value, y: yFor(value) };
  });
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="site-analytics-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="site-analytics-legend-dot site-analytics-legend-dot--views" />Vues</span>
        <span><i className="site-analytics-legend-dot site-analytics-legend-dot--visitors" />Visiteurs</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Trafic: ${rows.map((row) => `${row.label} ${row.pageViews} vues, ${row.uniqueVisitors} visiteurs`).join(", ")}`}
      >
        <defs>
          <linearGradient id="site-analytics-traffic-gradient" x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="site-analytics-gradient-start" offset="0%" />
            <stop className="site-analytics-gradient-end" offset="100%" />
          </linearGradient>
        </defs>
        <rect className="revenue-line-plot-bg" x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="6" />
        {gridTicks.map((tick) => (
          <g key={tick.key}>
            <line className="revenue-line-grid" x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
            <text className="revenue-line-y-label" x={padding.left - 12} y={tick.y + 4} textAnchor="end">
              {formatNumber(tick.value)}
            </text>
          </g>
        ))}
        {rows.length > 1 ? <path className="site-analytics-area" d={areaPath} fill="url(#site-analytics-traffic-gradient)" /> : null}
        {rows.length > 1 ? <path className="site-analytics-line site-analytics-line--views" d={viewPath} /> : null}
        {rows.length > 1 ? <path className="site-analytics-line site-analytics-line--visitors" d={visitorPath} /> : null}
        {rows.map((row, index) => (
          <g key={row.date}>
            <title>{`${row.label}: ${formatNumber(row.pageViews)} vues, ${formatNumber(row.uniqueVisitors)} visiteurs, ${formatNumber(row.sessions)} sessions`}</title>
            <circle className="site-analytics-point site-analytics-point--views" cx={viewPoints[index].x} cy={viewPoints[index].y} r="3.5" />
            <circle className="site-analytics-point site-analytics-point--visitors" cx={visitorPoints[index].x} cy={visitorPoints[index].y} r="3" />
            {index % labelEvery === 0 || index === rows.length - 1 ? (
              <text className="revenue-line-label" x={viewPoints[index].x} y={height - 20} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}>
                {row.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function SiteSummaryTable({ rows }: { rows: SiteAnalyticsSiteSummary[] }) {
  if (rows.length === 0) {
    return <p className="empty-state">Aucun site dans cette selection.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="site-analytics-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Vues</th>
            <th>Visiteurs</th>
            <th>Sessions</th>
            <th>Temps</th>
            <th>Scroll</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((site) => (
            <tr key={site.id}>
              <td>
                <span className="row-title">{site.name}</span>
                <span className="cell-muted">{site.url || site.id}</span>
              </td>
              <td>{formatNumber(site.pageViews)}</td>
              <td>{formatNumber(site.uniqueVisitors)}</td>
              <td>{formatNumber(site.sessions)}</td>
              <td>{formatDuration(site.avgTimeOnPageSeconds)}</td>
              <td>
                <ScrollBar value={site.avgScrollPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageTable({ rows }: { rows: SiteAnalyticsPageRow[] }) {
  if (rows.length === 0) {
    return <p className="empty-state">Aucune page mesuree sur cette periode.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="site-analytics-table site-analytics-page-table">
        <thead>
          <tr>
            <th>Page</th>
            <th>Vues</th>
            <th>Visiteurs</th>
            <th>Temps</th>
            <th>Scroll</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((page) => (
            <tr key={`${page.siteId}:${page.path}`}>
              <td>
                <span className="row-title">{page.title}</span>
                <span className="cell-muted">{page.siteName} - {page.path}</span>
              </td>
              <td>{formatNumber(page.pageViews)}</td>
              <td>{formatNumber(page.uniqueVisitors)}</td>
              <td>{formatDuration(page.avgTimeOnPageSeconds)}</td>
              <td>
                <ScrollBar value={page.avgScrollPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferrerTable({ rows, totals }: { rows: SiteAnalyticsReferrerRow[]; totals: SiteAnalyticsMetricSummary }) {
  if (rows.length === 0) {
    return <p className="empty-state">Aucun referent sur cette periode.</p>;
  }

  return (
    <div className="site-analytics-referrer-list">
      {rows.map((row) => {
        const share = totals.pageViews > 0 ? (row.pageViews / totals.pageViews) * 100 : 0;

        return (
          <div className="site-analytics-referrer-row" key={row.source}>
            <div>
              <span className="row-title">{row.source}</span>
              <span className="cell-muted">{formatNumber(row.sessions)} sessions</span>
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

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatPercent(value: number) {
  return percentFormatter.format(Math.max(0, Math.min(100, value)));
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
  return new Intl.DateTimeFormat("fr-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, (month ?? 1) - 1, day ?? 1));
}

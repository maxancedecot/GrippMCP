import type { Metadata } from "next";
import { DashboardFrame } from "../dashboard-frame.js";
import { CampaignPerformanceView, loadCampaignPerformanceViewData } from "../dashboard/campaign-performance.js";
import { DashboardSidebarFooter, DashboardViewTabs } from "../dashboard/view-tabs.js";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import {
  accountManagerHref,
  dashboardPeriodSelection,
  dashboardToday,
  type DashboardSearchParams
} from "../../src/dashboardPeriod.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accountmanager dashboard",
  description: "Accountmanager dashboard met Google Ads, Facebook Ads en websiteconversies."
};

export default async function AccountManagerPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const selection = dashboardPeriodSelection(params, now);
  const { days } = selection.period;
  const customPeriod = selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined;
  const dashboard = await getSiteAnalyticsDashboardData({ days, ...customPeriod, now });
  const selectedAccountManager = first(params.manager);
  const clearFilterHref = accountManagerHref({ params: { ...params, manager: undefined }, days, customPeriod });
  const performance = await loadCampaignPerformanceViewData({ dashboard, discoverySites: dashboard.sites,
    selectedAccountManager, forceMetaSync: first(params.syncMeta) === "1",
    syncHref: accountManagerHref({ params, days, customPeriod, syncMeta: true }) });

  return <DashboardFrame showTopMenu={false} sidebar={<DashboardViewTabs view="campaigns" params={params} days={days}
    customPeriod={customPeriod} managers={performance.managers} selectedManager={performance.selectedManager}
    clearFilterHref={clearFilterHref} periodStart={dashboard.period.start} periodEnd={dashboard.period.end}
    maxDate={dashboardToday(now)} />} sidebarFooter={<DashboardSidebarFooter view="campaigns" params={params}
      days={days} customPeriod={customPeriod} />}>
    <main className="dashboard-shell site-analytics-shell">
      <header className="dashboard-header">
        <div><p className="eyebrow">Marketingoverzicht</p><h1>Accountmanager dashboard</h1></div>
        <div className="header-meta">
          <span className={`source-badge source-badge--${dashboard.source.mode}`}>
            {dashboard.source.mode === "live" ? "Website verbonden" : "Website-demo"}
          </span>
          <span>{dashboard.period.label}</span>
          <span>Bijgewerkt {dashboard.lastUpdated}</span>
        </div>
      </header>

      {selection.error ? <p className="data-notice" role="alert">{selection.error}</p> : null}

      <CampaignPerformanceView {...performance} />
    </main>
  </DashboardFrame>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

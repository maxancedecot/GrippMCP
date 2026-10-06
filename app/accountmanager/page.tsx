import type { Metadata } from "next";
import { after } from "next/server.js";
import { DashboardFrame } from "../dashboard-frame.js";
import {
  CampaignPerformanceView,
  filterCampaignPerformanceViewData,
  loadCampaignPerformanceBaseData
} from "../dashboard/campaign-performance.js";
import { DashboardSidebarFooter, DashboardViewTabs } from "../dashboard/view-tabs.js";
import { hasProjectPage } from "../../src/campaignProjects.js";
import { readCampaignProjectVisibility } from "../../src/campaignProjectVisibility.js";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { loadBackgroundSnapshot } from "../../src/backgroundSnapshot.js";
import { getProjectPageGroupRevision } from "../../src/projectPageGroupStore.js";
import { getCrmPipelineRevision } from "../../src/crmPipelineManagement.js";
import {
  accountManagerHref,
  dashboardPeriodSelection,
  dashboardToday,
  type DashboardSearchParams
} from "../../src/dashboardPeriod.js";
import { AccountManagerLoadingProvider, AccountManagerLoadingRegion } from "./loading-overlay.js";
import { AccountManagerRefreshStatus } from "./refresh-status.js";
import { AccountManagerInitialLoadComplete } from "./initial-loading.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Accountmanager dashboard",
  description: "Accountmanager dashboard met Google Ads, Facebook Ads en CRM-leads en afspraken per project."
};

export default async function AccountManagerPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const selection = dashboardPeriodSelection(params, now);
  const { days } = selection.period;
  const customPeriod = selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined;
  const selectedAccountManager = first(params.manager);
  const forceMetaSync = first(params.syncMeta) === "1";
  const [projectGroupRevision, crmRevision] = await Promise.all([getProjectPageGroupRevision(), getCrmPipelineRevision()]);
  const snapshotKey = selection.custom
    ? `accountmanager-dashboard:v15:custom:${selection.period.start}:${selection.period.end}:${projectGroupRevision}:${crmRevision}`
    : `accountmanager-dashboard:v15:rolling:${days}:${projectGroupRevision}:${crmRevision}`;
  const snapshot = await loadBackgroundSnapshot({ key: snapshotKey, now, force: forceMetaSync,
    schedule: (work) => after(work),
    retryWhen: (data) => data.performance.projects.some((project) => project.crmMessage?.startsWith("CRM-aanvraaglimiet bereikt")),
    load: async () => {
      const dashboard = await getSiteAnalyticsDashboardData({ days, ...customPeriod, now });
      const performance = await loadCampaignPerformanceBaseData({ dashboard, discoverySites: dashboard.sites, forceMetaSync });
      return { dashboard, performance };
    }
  });
  const { dashboard } = snapshot.data;
  const updatedAt = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels",
    dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.refreshedAt));
  const cleanHref = accountManagerHref({ params, days, customPeriod });
  const clearFilterHref = accountManagerHref({ params: { ...params, manager: undefined }, days, customPeriod });
  const visibility = await readCampaignProjectVisibility(snapshot.data.performance.projects.filter(hasProjectPage));
  const performance = filterCampaignPerformanceViewData(snapshot.data.performance, selectedAccountManager,
    accountManagerHref({ params, days, customPeriod, syncMeta: true }), visibility);

  return <AccountManagerLoadingProvider>
    <AccountManagerInitialLoadComplete />
    <DashboardFrame showTopMenu={false} className="dashboard-app--accountmanager"
      sidebar={<DashboardViewTabs view="campaigns" params={params} days={days}
      customPeriod={customPeriod} managers={performance.managers} selectedManager={performance.selectedManager}
      clearFilterHref={clearFilterHref} periodStart={dashboard.period.start} periodEnd={dashboard.period.end}
      maxDate={dashboardToday(now)} />} sidebarFooter={<DashboardSidebarFooter view="campaigns" params={params}
        days={days} customPeriod={customPeriod} />}>
      <main className="dashboard-shell site-analytics-shell">
        <header className="dashboard-header">
          <div><h1>Accountmanager dashboard</h1></div>
          <div className="header-meta">
            <span className={`source-badge source-badge--${dashboard.source.mode}`}>
              {dashboard.source.mode === "live" ? "Website verbonden" : "Website-demo"}
            </span>
            <span>{dashboard.period.label}</span>
            <span>Bijgewerkt {updatedAt}</span>
            <AccountManagerRefreshStatus refreshId={snapshot.refreshId} refreshedAt={snapshot.refreshedAt}
              refreshing={snapshot.refreshing} refreshFailed={snapshot.refreshFailed} cleanHref={cleanHref} />
          </div>
        </header>

        <AccountManagerLoadingRegion>
          {selection.error ? <p className="data-notice" role="alert">{selection.error}</p> : null}
          <CampaignPerformanceView {...performance} />
        </AccountManagerLoadingRegion>
      </main>
    </DashboardFrame>
  </AccountManagerLoadingProvider>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

import { getProjectPageManagementData } from "../../src/projectPageManagement.js";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { dashboardPeriodSelection, type DashboardSearchParams } from "../../src/dashboardPeriod.js";
import { DashboardFrame } from "../dashboard-frame.js";
import { DataManagementBoard } from "./data-management-board.js";
import { DashboardSidebarFooter, DashboardViewTabs } from "./view-tabs.js";
import { readGoogleCampaignMatches } from "../../src/googleCampaignManagement.js";
import { getCrmConnectionInventory, readCrmPipelineMatches } from "../../src/crmPipelineManagement.js";
import { parseCampaignSiteMappings } from "../../src/campaignPerformance.js";
import { CrmPipelineManager } from "./crm-pipeline-manager.js";
import { getJsonCacheMode } from "../../src/jsonCache.js";

export async function DataManagementPage({ params }: { params: DashboardSearchParams }) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const [data, dashboard, googleCampaignMatches, crm] = await Promise.all([
    getProjectPageManagementData({ force: first(params.refresh) === "1" }),
    getSiteAnalyticsDashboardData({ days: 90 }),
    readGoogleCampaignMatches(),
    Promise.resolve().then(() => Promise.all([getCrmConnectionInventory({ mappings: parseCampaignSiteMappings(process.env.CAMPAIGN_PERFORMANCE_SITES) }), readCrmPipelineMatches()]))
      .then(([inventory, matches]) => ({ ...inventory, matches, error: "" }))
      .catch(() => ({ connections: [], matches: [], message: "", error: "De CRM-koppelingen konden niet worden geladen. Vernieuw de gegevens en probeer opnieuw." }))
  ]);
  const selection = dashboardPeriodSelection(params);
  const measuredPages = new Map(dashboard.cvrPageCandidates.map((page) => [`${page.siteId}:${page.path}`, page]));
  const mergePages = data.pages.map((page) => {
    const measured = measuredPages.get(`${page.siteId}:${page.path}`);
    return {
      siteId: page.siteId,
      siteName: page.siteName,
      path: page.path,
      title: page.title,
      uniqueVisitors: measured?.uniqueVisitors ?? 0,
      pageViews: measured?.pageViews ?? 0
    };
  });
  return <DashboardFrame showTopMenu={false} sidebar={<DashboardViewTabs view="data-management" params={params}
    days={selection.period.days} siteId={first(params.site)}
    customPeriod={selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined} />}
    sidebarFooter={<DashboardSidebarFooter view="data-management" params={params} days={selection.period.days}
      siteId={first(params.site)} customPeriod={selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined} />}>
    <main className="dashboard-shell site-analytics-shell">
      <header className="dashboard-header">
        <div><p className="eyebrow">Projecten en koppelingen</p><h1>Data management</h1></div>
        <div className="header-meta">
          <a className="header-meta-link" href="/dashboard?tab=data-management&refresh=1">Gegevens vernieuwen</a>
          {data.fetchedAt ? <span>Bijgewerkt {new Intl.DateTimeFormat("nl-BE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" }).format(new Date(data.fetchedAt))}</span> : null}
        </div>
      </header>
      <p className="data-management-intro">Beheer je accountmanagers, CRM-pipelines en campagnes per project. Kies hieronder wat je wilt aanpassen.</p>
      {data.error ? <p className="data-notice" role="alert">{data.error}</p> : null}
      <DataManagementBoard key={data.fetchedAt ?? "unavailable"}
        data={data} mergePages={mergePages} projectGroups={dashboard.projectPageGroups ?? []} googleCampaignMatches={googleCampaignMatches}
        crmCount={crm.matches.length} crm={<CrmPipelineManager key={JSON.stringify([crm.connections, mergePages])} pages={mergePages}
        connections={crm.connections} initialMatches={crm.matches} error={crm.error} discoveryMessage={crm.message}
        canSave={getJsonCacheMode() !== "memory" && !crm.error && !!mergePages.length} />} />
    </main>
  </DashboardFrame>;
}

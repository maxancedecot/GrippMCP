import { getProjectPageManagementData } from "../../src/projectPageManagement.js";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { dashboardPeriodSelection, type DashboardSearchParams } from "../../src/dashboardPeriod.js";
import { DashboardFrame } from "../dashboard-frame.js";
import { DataManagementBoard } from "./data-management-board.js";
import { DashboardSidebarFooter, DashboardViewTabs } from "./view-tabs.js";
import { readGoogleCampaignMatches } from "../../src/googleCampaignManagement.js";
import { listCrmConnections, readCrmPipelineMatches } from "../../src/crmPipelineManagement.js";
import { parseCampaignSiteMappings } from "../../src/campaignPerformance.js";
import { CrmPipelineManager } from "./crm-pipeline-manager.js";
import { getJsonCacheMode } from "../../src/jsonCache.js";

export async function DataManagementPage({ params }: { params: DashboardSearchParams }) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const [data, dashboard, googleCampaignMatches, crm] = await Promise.all([
    getProjectPageManagementData({ force: first(params.refresh) === "1" }),
    getSiteAnalyticsDashboardData({ days: 90 }),
    readGoogleCampaignMatches(),
    Promise.resolve().then(() => Promise.all([listCrmConnections({ mappings: parseCampaignSiteMappings(process.env.CAMPAIGN_PERFORMANCE_SITES) }), readCrmPipelineMatches()]))
      .then(([connections, matches]) => ({ connections, matches, error: "" }))
      .catch(() => ({ connections: [], matches: [], error: "De CRM-koppelingen konden niet worden geladen. Vernieuw de gegevens en probeer opnieuw." }))
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
        <div><p className="eyebrow">Projectpagina’s en accountmanagers</p><h1>Data management</h1></div>
        <div className="header-meta">
          <a className="header-meta-link" href="/dashboard?tab=data-management&refresh=1">Gegevens vernieuwen</a>
          {data.fetchedAt ? <span>Bijgewerkt {new Intl.DateTimeFormat("nl-BE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" }).format(new Date(data.fetchedAt))}</span> : null}
        </div>
      </header>
      <p className="data-management-intro">Projectpagina’s volgen waar mogelijk de accountmanager uit Gripp. Hier wijs je pagina’s zonder duidelijke koppeling toe. Handmatige toewijzingen worden alleen in dit dashboard bewaard.</p>
      {data.error ? <p className="data-notice" role="alert">{data.error}</p> : null}
      <CrmPipelineManager key={JSON.stringify([crm.connections, mergePages])} pages={mergePages}
        connections={crm.connections} initialMatches={crm.matches} error={crm.error}
        canSave={getJsonCacheMode() !== "memory" && !crm.error && !!mergePages.length} />
      {data.fetchedAt ? <DataManagementBoard key={`${data.fetchedAt}:${(dashboard.projectPageGroups ?? []).map((group) => group.groupId).join(",")}`}
        data={data} mergePages={mergePages} projectGroups={dashboard.projectPageGroups ?? []} googleCampaignMatches={googleCampaignMatches} /> : null}
    </main>
  </DashboardFrame>;
}

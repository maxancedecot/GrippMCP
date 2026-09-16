import { dashboardHref, type DashboardSearchParams } from "../../src/dashboardPeriod.js";

export function DashboardViewTabs({ view, params, days, siteId, customPeriod }: {
  view: "website" | "campaigns" | "data-management"; params: DashboardSearchParams; days: number;
  siteId?: string; customPeriod?: { start: string; end: string };
}) {
  return <nav className="dashboard-tabs site-analytics-view-tabs" aria-label="Dashboardweergave">
    {([{ key: "website", label: "Websiteprestaties" }, { key: "campaigns", label: "Campagneperformance" },
      { key: "data-management", label: "Data management" }] as const).map((tab) => <a key={tab.key}
      className={`dashboard-tab ${view === tab.key ? "dashboard-tab--active" : ""}`}
      href={dashboardHref({ params: { ...params, tab: tab.key === "website" ? undefined : tab.key, refresh: undefined }, days,
        siteId: tab.key === "campaigns" ? undefined : siteId, customPeriod })}
      aria-current={view === tab.key ? "page" : undefined}>{tab.label}</a>)}
  </nav>;
}

import { accountManagerHref, dashboardHref, type DashboardSearchParams } from "../../src/dashboardPeriod.js";

export function DashboardViewTabs({ view, params, days, siteId, customPeriod }: {
  view: "website" | "campaigns" | "data-management"; params: DashboardSearchParams; days: number;
  siteId?: string; customPeriod?: { start: string; end: string };
}) {
  return <nav className="dashboard-sidebar-nav" aria-label="Analytics navigatie">
    {([{ key: "website", label: "Websiteprestaties" }, { key: "campaigns", label: "Accountmanager dashboard" },
      { key: "data-management", label: "Data management" }] as const).map((tab) => {
      const cleanParams = { ...params, tab: tab.key === "website" ? undefined : tab.key, refresh: undefined,
        manager: tab.key === "campaigns" ? params.manager : undefined };
      const href = tab.key === "campaigns"
        ? accountManagerHref({ params: cleanParams, days, customPeriod })
        : dashboardHref({ params: cleanParams, days, siteId, customPeriod });
      return <a key={tab.key} className={`dashboard-sidebar-link ${view === tab.key ? "dashboard-sidebar-link--active" : ""}`}
        href={href} aria-current={view === tab.key ? "page" : undefined}>{tab.label}</a>;
    })}
  </nav>;
}

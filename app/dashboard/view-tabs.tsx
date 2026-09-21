import { accountManagerHref, dashboardHref, type DashboardSearchParams } from "../../src/dashboardPeriod.js";
import { AccountManagerSidebarFilter } from "./account-manager-sidebar-filter.js";
import { CrmTrackingCopy } from "./crm-tracking-copy.js";
import { ThemeToggle } from "./theme-toggle.js";

export function DashboardViewTabs({ view, params, days, siteId, customPeriod, managers = [], selectedManager = "", clearFilterHref }: {
  view: "website" | "campaigns" | "data-management"; params: DashboardSearchParams; days: number;
  siteId?: string; customPeriod?: { start: string; end: string };
  managers?: [string, string][]; selectedManager?: string; clearFilterHref?: string;
}) {
  return <>
    <nav className="dashboard-sidebar-nav" aria-label="Analytics navigatie">
    {([{ key: "website", label: "Websiteprestaties" }, { key: "campaigns", label: "Accountmanager dashboard" }] as const).map((tab) => {
      const cleanParams = { ...params, tab: tab.key === "website" ? undefined : tab.key, refresh: undefined,
        manager: tab.key === "campaigns" ? params.manager : undefined };
      const href = tab.key === "campaigns"
        ? accountManagerHref({ params: cleanParams, days, customPeriod })
        : dashboardHref({ params: cleanParams, days, siteId, customPeriod });
      return <a key={tab.key} className={`dashboard-sidebar-link ${view === tab.key ? "dashboard-sidebar-link--active" : ""}`}
        href={href} aria-current={view === tab.key ? "page" : undefined}>{tab.label}</a>;
    })}
    </nav>
    {view === "campaigns" ? <AccountManagerSidebarFilter managers={managers} selectedManager={selectedManager}
      period={customPeriod ?? (days !== 30 ? { days } : undefined)} clearFilterHref={clearFilterHref} /> : null}
  </>;
}

export function DashboardSidebarFooter({ view, params, days, siteId, customPeriod }: {
  view: "website" | "campaigns" | "data-management"; params: DashboardSearchParams; days: number;
  siteId?: string; customPeriod?: { start: string; end: string };
}) {
  const dataManagementHref = dashboardHref({ params: { ...params, tab: "data-management", manager: undefined, refresh: undefined },
    days, siteId, customPeriod });
  return <>
    <a className={`dashboard-sidebar-link ${view === "data-management" ? "dashboard-sidebar-link--active" : ""}`}
      href={dataManagementHref} aria-current={view === "data-management" ? "page" : undefined}>Data management</a>
    <div className="dashboard-sidebar-tools">
      <a className="dashboard-sidebar-action" href="/api/site-analytics/plugin" download>WordPress-plugin</a>
      <CrmTrackingCopy variant="sidebar" />
      <ThemeToggle />
    </div>
  </>;
}

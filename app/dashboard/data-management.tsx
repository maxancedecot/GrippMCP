import { getDataManagementData } from "../../src/dataManagement.js";
import { dashboardPeriodSelection, type DashboardSearchParams } from "../../src/dashboardPeriod.js";
import { DashboardFrame } from "../dashboard-frame.js";
import { DataManagementBoard } from "./data-management-board.js";
import { DashboardViewTabs } from "./view-tabs.js";

export async function DataManagementPage({ params }: { params: DashboardSearchParams }) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const data = await getDataManagementData({ force: first(params.refresh) === "1" });
  const selection = dashboardPeriodSelection(params);
  return <DashboardFrame showTopMenu={false}>
    <main className="dashboard-shell site-analytics-shell">
      <header className="dashboard-header">
        <div><p className="eyebrow">Klanten en verantwoordelijken</p><h1>Data management</h1></div>
        <div className="header-meta">
          <a className="header-meta-link" href="/dashboard?tab=data-management&refresh=1">Gegevens vernieuwen</a>
          {data.fetchedAt ? <span>Bijgewerkt {new Intl.DateTimeFormat("nl-BE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" }).format(new Date(data.fetchedAt))}</span> : null}
        </div>
      </header>
      <DashboardViewTabs view="data-management" params={params} days={selection.period.days} siteId={first(params.site)}
        customPeriod={selection.custom ? { start: selection.period.start, end: selection.period.end } : undefined} />
      <p className="data-management-intro">Koppel een accountmanager aan een klant. Alle projecten van die klant volgen deze koppeling. Wijzigingen worden alleen in dit dashboard bewaard.</p>
      {data.error ? <p className="data-notice" role="alert">{data.error}</p> : null}
      {data.fetchedAt ? <DataManagementBoard key={data.fetchedAt} data={data} /> : null}
    </main>
  </DashboardFrame>;
}

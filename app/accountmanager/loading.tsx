import { DashboardFrame } from "../dashboard-frame.js";
import { AccountManagerLoadingOverlay } from "./loading-overlay.js";

export default function AccountManagerLoading() {
  return <DashboardFrame showTopMenu={false} className="dashboard-app--accountmanager">
    <main className="dashboard-shell site-analytics-shell">
      <header className="dashboard-header"><h1>Accountmanager dashboard</h1></header>
      <section className="accountmanager-loading-region accountmanager-loading-region--active">
        <AccountManagerLoadingOverlay />
      </section>
    </main>
  </DashboardFrame>;
}

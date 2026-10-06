"use client";

import { DashboardFrame } from "../dashboard-frame.js";
import { AccountManagerInitialLoadComplete } from "./initial-loading.js";

export default function AccountManagerError({ reset }: { reset: () => void }) {
  return <>
    <AccountManagerInitialLoadComplete />
    <DashboardFrame showTopMenu={false} className="dashboard-app--accountmanager">
      <main className="dashboard-shell site-analytics-shell">
        <h1>Accountmanager dashboard</h1>
        <p role="alert">De gegevens konden niet worden geladen. Probeer opnieuw.</p>
        <button type="button" onClick={reset}>Opnieuw laden</button>
      </main>
    </DashboardFrame>
  </>;
}

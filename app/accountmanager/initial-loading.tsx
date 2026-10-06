"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DashboardFrame } from "../dashboard-frame.js";
import { AccountManagerLoadingOverlay } from "./loading-overlay.js";

const InitialLoadCompleteContext = createContext<() => void>(() => {});

// Keep the game outside the page's pending Suspense boundary. The layout can
// hydrate and handle clicks while the server is still fetching dashboard data.
export function AccountManagerInitialLoadingBoundary({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const complete = useCallback(() => setReady(true), []);
  return <InitialLoadCompleteContext.Provider value={complete}>
    {!ready ? <DashboardFrame showTopMenu={false} className="dashboard-app--accountmanager">
      <main className="dashboard-shell site-analytics-shell">
        <header className="dashboard-header"><h1>Accountmanager dashboard</h1></header>
        <section className="accountmanager-loading-region accountmanager-loading-region--active">
          <AccountManagerLoadingOverlay />
        </section>
      </main>
    </DashboardFrame> : null}
    <div hidden={!ready}>{children}</div>
  </InitialLoadCompleteContext.Provider>;
}

export function AccountManagerInitialLoadComplete() {
  const complete = useContext(InitialLoadCompleteContext);
  useEffect(() => complete(), [complete]);
  return null;
}

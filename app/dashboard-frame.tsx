import type { ReactNode } from "react";

export function DashboardFrame({ children, showTopMenu = true, className = "" }: { children: ReactNode; showTopMenu?: boolean; className?: string }) {
  return (
    <div className={`dashboard-app ${className}`}>
      {showTopMenu ? (
        <div className="dashboard-brandbar">
          <a className="dashboard-brand" href="/dashboard" aria-label="Ledoux dashboards">
            <img src="/ledoux/logo/ledoux-logo.svg" alt="" />
          </a>
          <nav className="dashboard-nav" aria-label="Dashboards">
            <a href="/dashboard">WordPress</a>
            <a href="/pm">PM</a>
            <a href="/projectmanagement">Projecten</a>
            <a href="/gent">Gent 3D</a>
          </nav>
        </div>
      ) : null}
      <div className="dashboard-main">
        {children}
      </div>
    </div>
  );
}

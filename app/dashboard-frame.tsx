import type { ReactNode } from "react";

export function DashboardFrame({ children, showTopMenu = true, className = "", sidebar }: {
  children: ReactNode; showTopMenu?: boolean; className?: string; sidebar?: ReactNode;
}) {
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
            <a href="/alice-buyssehof">Kaart 3D</a>
          </nav>
        </div>
      ) : null}
      {sidebar ? <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <a className="dashboard-brand dashboard-sidebar-brand" href="/dashboard" aria-label="Ledoux dashboards">
            <img src="/ledoux/logo/ledoux-logo.svg" alt="" />
          </a>
          <div className="dashboard-sidebar-section">
            <p className="dashboard-sidebar-label">Analytics</p>
            {sidebar}
          </div>
          <nav className="dashboard-sidebar-secondary" aria-label="Andere dashboards">
            <a href="/pm">PM dashboard</a>
            <a href="/projectmanagement">Projecten</a>
            <a href="/alice-buyssehof">Kaart 3D</a>
          </nav>
        </aside>
        <div className="dashboard-main">{children}</div>
      </div> : <div className="dashboard-main">{children}</div>}
    </div>
  );
}

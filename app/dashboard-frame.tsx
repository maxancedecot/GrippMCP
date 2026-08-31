import type { ReactNode } from "react";

type DashboardSection = "dashboard" | "pm" | "projectmanagement";

const dashboardNavItems: Array<{
  id: DashboardSection;
  href: string;
  label: string;
  detail: string;
}> = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Uren",
    detail: "Declarabiliteit en omzet"
  },
  {
    id: "pm",
    href: "/pm",
    label: "PM dashboard",
    detail: "Billableheid en capaciteit"
  },
  {
    id: "projectmanagement",
    href: "/projectmanagement",
    label: "Projectmanagement",
    detail: "Planning en opdrachten"
  }
];

export function DashboardFrame({ active, children }: { active: DashboardSection; children: ReactNode }) {
  return (
    <div className="dashboard-app">
      <aside className="dashboard-sidebar" aria-label="Dashboard navigatie">
        <a className="dashboard-brand" href="/dashboard" aria-label="Gripp dashboards">
          <span className="dashboard-brand-mark" aria-hidden="true">G</span>
          <span className="dashboard-brand-copy">
            <strong>Gripp</strong>
            <small>Dashboards</small>
          </span>
        </a>

        <nav className="dashboard-sidebar-nav">
          {dashboardNavItems.map((item) => (
            <a
              aria-current={active === item.id ? "page" : undefined}
              className={`dashboard-nav-link ${active === item.id ? "dashboard-nav-link--active" : ""}`}
              href={item.href}
              key={item.id}
            >
              <span className="dashboard-nav-icon" aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="dashboard-main">
        {children}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

export function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-app">
      <div className="dashboard-main">
        {children}
      </div>
    </div>
  );
}

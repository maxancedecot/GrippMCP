"use client";

import { useRef } from "react";

export function AccountManagerSidebarFilter({ managers, selectedManager, period, clearFilterHref, periodStart, periodEnd, maxDate }: {
  managers: [string, string][];
  selectedManager: string;
  period?: { days?: number; start?: string; end?: string };
  clearFilterHref?: string;
  periodStart?: string;
  periodEnd?: string;
  maxDate?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return <div className="dashboard-sidebar-filter">
    <form ref={form} className="dashboard-sidebar-filter-form" action="/accountmanager" method="get">
      {period?.days ? <input type="hidden" name="days" value={period.days} /> : null}
      {period?.start ? <input type="hidden" name="start" value={period.start} /> : null}
      {period?.end ? <input type="hidden" name="end" value={period.end} /> : null}
      <label>Accountmanager
        <select name="manager" value={selectedManager} onChange={() => form.current?.requestSubmit()}>
          <option value="">Alle accountmanagers</option>
          {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="unassigned">Nog toe te wijzen</option>
        </select>
      </label>
      <button className="sr-only" type="submit">Filter toepassen</button>
      {selectedManager && clearFilterHref ? <a href={clearFilterHref}>Filter wissen</a> : null}
    </form>
    {periodStart && periodEnd && maxDate ? <form className="dashboard-sidebar-date-form" action="/accountmanager" method="get"
      aria-label="Periode kiezen">
      {selectedManager ? <input type="hidden" name="manager" value={selectedManager} /> : null}
      <div className="dashboard-sidebar-date-fields">
        <label>Van<input type="date" name="start" required defaultValue={periodStart} max={maxDate} /></label>
        <label>Tot<input type="date" name="end" required defaultValue={periodEnd} max={maxDate} /></label>
      </div>
      <button type="submit">Toepassen</button>
    </form> : null}
  </div>;
}

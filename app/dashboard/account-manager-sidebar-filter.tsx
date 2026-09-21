"use client";

import { useRef } from "react";

export function AccountManagerSidebarFilter({ managers, selectedManager, period, clearFilterHref }: {
  managers: [string, string][];
  selectedManager: string;
  period?: { days?: number; start?: string; end?: string };
  clearFilterHref?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return <form ref={form} className="dashboard-sidebar-filter" action="/accountmanager" method="get">
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
  </form>;
}

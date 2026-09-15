export type SiteAnalyticsPeriod = { days: number; start: string; end: string; label: string };
export type DashboardSearchParams = Record<string, string | string[] | undefined>;
export const MAX_DASHBOARD_DAYS = 90;
export const DASHBOARD_PERIOD_OPTIONS = [7, 14, 30, 90];
const DAY_MS = 86_400_000;

export function dashboardToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function siteAnalyticsPeriod(options: { days?: number; start?: string; end?: string }, now = new Date()): SiteAnalyticsPeriod {
  const today = dashboardToday(now);
  if (options.start !== undefined || options.end !== undefined) {
    const { start, end } = options;
    if (!validDate(start) || !validDate(end)) throw new Error("Kies een geldige begin- en einddatum.");
    if (start > end) throw new Error("De begindatum moet op of vóór de einddatum liggen.");
    if (end > today) throw new Error("De einddatum mag niet in de toekomst liggen.");
    const days = (Date.parse(end) - Date.parse(start)) / DAY_MS + 1;
    if (days > MAX_DASHBOARD_DAYS) throw new Error(`Kies een periode van maximaal ${MAX_DASHBOARD_DAYS} dagen.`);
    const format = (date: string) => date.split("-").reverse().join("/");
    return { days, start, end, label: `${format(start)} – ${format(end)}` };
  }
  const days = !options.days || !Number.isFinite(options.days) ? 30
    : Math.max(1, Math.min(MAX_DASHBOARD_DAYS, Math.round(options.days)));
  const start = new Date(Date.parse(today) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { days, start, end: today, label: `Laatste ${days} dagen` };
}

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function dashboardPeriodSelection(params: DashboardSearchParams, now = new Date()) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const value = Number(first(params.days));
  const days = DASHBOARD_PERIOD_OPTIONS.includes(value) ? value : 30;
  const custom = params.start !== undefined || params.end !== undefined;
  try {
    return { period: siteAnalyticsPeriod({ days, start: first(params.start), end: first(params.end) }, now), custom, error: "" };
  } catch (error) {
    return { period: siteAnalyticsPeriod({ days }, now), custom: false,
      error: `${(error as Error).message} De laatste ${days} dagen worden getoond.` };
  }
}

export function dashboardHref({ params, days, siteId, customPeriod }: {
  params: DashboardSearchParams; days: number; siteId?: string; customPeriod?: { start: string; end: string };
}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (["days", "site", "start", "end"].includes(key)) continue;
    for (const item of Array.isArray(value) ? value : value ? [value] : []) search.append(key, item);
  }
  if (customPeriod) {
    search.set("start", customPeriod.start);
    search.set("end", customPeriod.end);
  } else if (days !== 30) search.set("days", String(days));
  if (siteId) search.set("site", siteId);
  const query = search.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

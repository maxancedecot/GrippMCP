import type { Metadata } from "next";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PM dashboard | Gripp",
  description: "Managementdashboard met omzet, billableheid en omzet per uur uit Gripp."
};

type JsonRecord = Record<string, unknown>;

type Period = {
  start: string;
  end: string;
  year: string;
  label: string;
};

type DashboardSource = {
  mode: "live" | "demo";
  message: string;
};

type BillabilitySources = {
  offerProjectLineInvoiceBasis: Map<number, string>;
};

type MonthRevenue = {
  key: string;
  label: string;
  revenue: number;
};

type PmDashboardData = {
  period: Period;
  source: DashboardSource;
  revenue: number;
  loggedHours: number;
  billableHours: number;
  nonBillableHours: number;
  billability: number;
  revenuePerLoggedHour: number;
  revenuePerBillableHour: number;
  invoiceCount: number;
  hourCount: number;
  revenueByMonth: MonthRevenue[];
  lastUpdated: string;
};

const PAGE_SIZE = 250;
const MAX_INVOICE_PAGES = 80;
const MAX_HOUR_PAGES = 160;

const hoursFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const percentFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const currencyFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const currencyPerHourFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export default async function PmDashboardPage() {
  const dashboard = await getPmDashboardData();
  const gaugeProgress = Math.max(0, Math.min(dashboard.billability, 100));
  const maxMonthlyRevenue = Math.max(1, ...dashboard.revenueByMonth.map((row) => Math.abs(row.revenue)));

  return (
    <main className="dashboard-shell pm-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Gripp management</p>
          <h1>PM dashboard</h1>
        </div>
        <div className="header-meta">
          <span className={`source-badge source-badge--${dashboard.source.mode}`}>
            {dashboard.source.mode === "live" ? "Live uit Gripp" : "Demo-data"}
          </span>
          <span>{dashboard.period.label}</span>
          <span>Bijgewerkt {dashboard.lastUpdated}</span>
        </div>
      </header>

      {dashboard.source.message ? <p className="data-notice">{dashboard.source.message}</p> : null}

      <section className="metric-grid pm-metric-grid" aria-label="Kerncijfers management">
        <MetricCard label="Omzet dit jaar" value={formatCurrency(dashboard.revenue)} detail="Verkoopfacturen, excl. btw netto" tone="good" />
        <MetricCard label="Billableheid" value={`${formatPercent(dashboard.billability)}%`} detail={`${formatHours(dashboard.billableHours)} / ${formatHours(dashboard.loggedHours)} uur`} tone="blue" />
        <MetricCard label="Omzet / gelogd uur" value={formatCurrencyPerHour(dashboard.revenuePerLoggedHour)} detail="Omzet gedeeld door alle gelogde uren" tone="neutral" />
        <MetricCard label="Omzet / billable uur" value={formatCurrencyPerHour(dashboard.revenuePerBillableHour)} detail="Omzet gedeeld door billable uren" tone="warning" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Uren</p>
              <h2>Billableheid</h2>
            </div>
            <span className="panel-total">{formatHours(dashboard.loggedHours)} gelogd</span>
          </div>

          <div className="distribution-layout">
            <div className="gauge" aria-label={`Billableheid ${formatPercent(dashboard.billability)} procent`}>
              <svg className="gauge-ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="gauge-ring-track" cx="60" cy="60" r="52" pathLength={100} />
                <circle className="gauge-ring-fill" cx="60" cy="60" r="52" pathLength={100} strokeDasharray={`${gaugeProgress} ${100 - gaugeProgress}`} />
              </svg>
              <div className="gauge-inner">
                <strong>{formatPercent(dashboard.billability)}%</strong>
                <span>billable</span>
              </div>
            </div>

            <dl className="legend-list">
              <LegendItem label="Billable" value={`${formatHours(dashboard.billableHours)} uur`} className="legend-dot--good" />
              <LegendItem label="Niet billable" value={`${formatHours(dashboard.nonBillableHours)} uur`} className="legend-dot--neutral" />
              <LegendItem label="Gelogd totaal" value={`${formatHours(dashboard.loggedHours)} uur`} className="legend-dot--blue" />
            </dl>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Berekening</p>
              <h2>Omzet per uur</h2>
            </div>
          </div>

          <dl className="pm-formula-list">
            <FormulaItem label="Omzet" detail={`${dashboard.invoiceCount} verkoopfacturen met rapportagedatum in ${dashboard.period.year}`} value={formatCurrency(dashboard.revenue)} />
            <FormulaItem label="Gelogde uren" detail={`${dashboard.hourCount} urenregels van alle medewerkers`} value={`${formatHours(dashboard.loggedHours)} uur`} />
            <FormulaItem label="Billable uren" detail="Opdrachtregels met facturatiebasis FIXED, COSTING of BUDGETED" value={`${formatHours(dashboard.billableHours)} uur`} />
            <FormulaItem label="Per gelogd uur" detail="Omzet / gelogde uren" value={formatCurrencyPerHour(dashboard.revenuePerLoggedHour)} />
            <FormulaItem label="Per billable uur" detail="Omzet / billable uren" value={formatCurrencyPerHour(dashboard.revenuePerBillableHour)} />
          </dl>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Omzet</p>
            <h2>Per maand</h2>
          </div>
          <span className="panel-total">{formatCurrency(dashboard.revenue)}</span>
        </div>

        <div className="pm-month-list">
          {dashboard.revenueByMonth.map((row) => (
            <div className="stack-row" key={row.key}>
              <div className="stack-label">
                <span>{row.label}</span>
                <span>{formatCurrency(row.revenue)}</span>
              </div>
              <div className="inline-bar" aria-hidden="true">
                <span className="bar-segment bar-segment--blue" style={{ width: `${Math.max(0, (Math.abs(row.revenue) / maxMonthlyRevenue) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "blue" | "warning" | "neutral";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function LegendItem({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div>
      <dt>
        <span className={`legend-dot ${className}`} />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function FormulaItem({ label, detail, value }: { label: string; detail: string; value: string }) {
  return (
    <div className="pm-formula-row">
      <dt>
        <span>{label}</span>
        <small>{detail}</small>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

async function getPmDashboardData(): Promise<PmDashboardData> {
  const period = getYearToDatePeriod();

  if (!process.env.GRIPP_API_TOKEN) {
    const demoHours = createDemoHours(period);
    return buildPmDashboardData(createDemoInvoices(period), demoHours, createDemoBillabilitySources(demoHours), period, {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-cijfers te tonen."
    });
  }

  try {
    const client = new GrippClient();
    const [invoices, hours] = await Promise.all([fetchInvoicesForPeriod(client, period), fetchHoursForPeriod(client, period)]);
    const billabilitySources = await fetchBillabilitySources(client, hours);

    return buildPmDashboardData(invoices, hours, billabilitySources, period, {
      mode: "live",
      message: ""
    });
  } catch (error) {
    const demoHours = createDemoHours(period);
    return buildPmDashboardData(createDemoInvoices(period), demoHours, createDemoBillabilitySources(demoHours), period, {
      mode: "demo",
      message: `Live PM-data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    });
  }
}

async function fetchInvoicesForPeriod(client: GrippClient, period: Period) {
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "invoice.reportdate", operator: "greaterequals", value: period.start },
    { field: "invoice.reportdate", operator: "lessequals", value: period.end },
    { field: "invoice.status", operator: "equals", value: "SENT" }
  ];

  for (let page = 0; page < MAX_INVOICE_PAGES; page += 1) {
    const result = await client.call("invoice.get", [
      filters,
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings: [{ field: "invoice.reportdate", direction: "asc" }]
      }
    ] as JsonValue[]);
    const pageRecords = asRecords(result);
    records.push(...pageRecords);

    if (pageRecords.length < PAGE_SIZE) {
      break;
    }
  }

  return records;
}

async function fetchHoursForPeriod(client: GrippClient, period: Period) {
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "hour.date", operator: "greaterequals", value: period.start },
    { field: "hour.date", operator: "lessequals", value: period.end }
  ];

  for (let page = 0; page < MAX_HOUR_PAGES; page += 1) {
    const result = await client.call("hour.get", [
      filters,
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings: [{ field: "hour.date", direction: "asc" }]
      }
    ] as JsonValue[]);
    const pageRecords = asRecords(result);
    records.push(...pageRecords);

    if (pageRecords.length < PAGE_SIZE) {
      break;
    }
  }

  return records;
}

async function fetchBillabilitySources(client: GrippClient, hours: JsonRecord[]): Promise<BillabilitySources> {
  const offerProjectLineInvoiceBasis = new Map<number, string>();
  const offerProjectLineIds = uniqueRelationIds(hours, "offerprojectline");

  for (let index = 0; index < offerProjectLineIds.length; index += 100) {
    const idChunk = offerProjectLineIds.slice(index, index + 100);
    const result = await client.call("offerprojectline.get", [
      [{ field: "offerprojectline.id", operator: "in", value: idChunk }],
      {
        paging: { firstresult: 0, maxresults: PAGE_SIZE },
        orderings: [{ field: "offerprojectline.id", direction: "asc" }]
      }
    ] as JsonValue[]);

    for (const offerProjectLine of asRecords(result)) {
      const id = idFrom(readField(offerProjectLine, "id"));
      const invoiceBasis = stringFrom(readField(offerProjectLine, "invoicebasis"))?.toUpperCase();
      if (id !== null && invoiceBasis) {
        offerProjectLineInvoiceBasis.set(id, invoiceBasis);
      }
    }
  }

  return { offerProjectLineInvoiceBasis };
}

function buildPmDashboardData(
  invoices: JsonRecord[],
  hours: JsonRecord[],
  billabilitySources: BillabilitySources,
  period: Period,
  source: DashboardSource
): PmDashboardData {
  let revenue = 0;
  let invoiceCount = 0;
  let loggedHours = 0;
  let billableHours = 0;
  let hourCount = 0;
  const revenueByMonth = new Map<string, number>();

  for (const invoice of invoices) {
    if (stringFrom(readField(invoice, "status"))?.toUpperCase() === "CONCEPT") {
      continue;
    }

    const reportDate = dateKeyFromValue(readField(invoice, "reportdate"));
    const monthKey = monthKeyForDateInPeriod(reportDate, period);
    if (!monthKey) {
      continue;
    }

    const amount = numberFrom(readField(invoice, "totalincldiscountexclvat"));
    if (amount === null) {
      continue;
    }

    revenue += amount;
    invoiceCount += 1;
    revenueByMonth.set(monthKey, (revenueByMonth.get(monthKey) ?? 0) + amount);
  }

  for (const hour of hours) {
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (amount === 0 || !dateKeyFromValue(readField(hour, "date"))) {
      continue;
    }

    loggedHours += amount;
    hourCount += 1;

    if (isBillableHour(hour, billabilitySources)) {
      billableHours += amount;
    }
  }

  return {
    period,
    source,
    revenue,
    loggedHours,
    billableHours,
    nonBillableHours: Math.max(0, loggedHours - billableHours),
    billability: percent(billableHours, loggedHours),
    revenuePerLoggedHour: divideCurrency(revenue, loggedHours),
    revenuePerBillableHour: divideCurrency(revenue, billableHours),
    invoiceCount,
    hourCount,
    revenueByMonth: makeMonthBuckets(period).map((bucket) => ({
      ...bucket,
      revenue: revenueByMonth.get(bucket.key) ?? 0
    })),
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date())
  };
}

function isBillableHour(hour: JsonRecord, billabilitySources: BillabilitySources) {
  const directInvoiceBasis = stringFrom(readField(hour, "invoicebasis"))?.toUpperCase();
  const offerProjectLineId = relationId(hour, "offerprojectline");
  const invoiceBasis = offerProjectLineId === null
    ? directInvoiceBasis
    : billabilitySources.offerProjectLineInvoiceBasis.get(offerProjectLineId) ?? directInvoiceBasis;

  if (invoiceBasis) {
    return invoiceBasis !== "NONBILLABLE";
  }

  return relationId(hour, "invoiceline") !== null;
}

function getYearToDatePeriod(): Period {
  const end = currentDateKey();
  const year = end.slice(0, 4);
  const start = `${year}-01-01`;

  return {
    start,
    end,
    year,
    label: `${formatDate(start)} - ${formatDate(end)}`
  };
}

function currentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function makeMonthBuckets(period: Period): MonthRevenue[] {
  const start = parseDateKey(period.start);
  const end = parseDateKey(period.end);
  if (!start || !end) {
    return [];
  }

  const buckets: MonthRevenue[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const stop = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= stop) {
    buckets.push({
      key: monthKey(cursor),
      label: new Intl.DateTimeFormat("nl-NL", { month: "short", year: "numeric" }).format(cursor),
      revenue: 0
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return buckets;
}

function monthKeyForDateInPeriod(value: unknown, period: Period) {
  const normalizedValue = dateKeyFromValue(value);
  const date = normalizedValue ? parseDateKey(normalizedValue) : null;
  const periodStart = parseDateKey(period.start);
  const periodEnd = parseDateKey(period.end);
  if (!date || !periodStart || !periodEnd || date < periodStart || date > periodEnd) {
    return null;
  }

  return monthKey(date);
}

function uniqueRelationIds(records: JsonRecord[], field: string) {
  return Array.from(
    new Set(
      records
        .map((record) => relationId(record, field))
        .filter((id): id is number => id !== null)
    )
  );
}

function asRecords(value: JsonValue): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((record): record is JsonRecord => Boolean(record));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of ["result", "data", "rows", "records", "items", "entities"]) {
    const nestedRecords = asRecords(record[key] as JsonValue);
    if (nestedRecords.length > 0) {
      return nestedRecords;
    }
  }

  return looksLikeEntity(record) ? [record] : [];
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function readField(record: JsonRecord | undefined, field: string) {
  if (!record) {
    return undefined;
  }

  const direct =
    record[field] ??
    record[`hour.${field}`] ??
    record[`invoice.${field}`] ??
    record[`offerprojectline.${field}`] ??
    record[`invoiceline.${field}`];
  if (direct !== undefined) {
    return direct;
  }

  const suffix = `.${field.toLowerCase()}`;
  const matchingKey = Object.keys(record).find((key) => key.toLowerCase().endsWith(suffix));
  return matchingKey ? record[matchingKey] : undefined;
}

function relationId(record: JsonRecord, field: string) {
  return (
    idFrom(readField(record, field)) ??
    idFrom(record[`${field}.id`]) ??
    idFrom(record[`hour.${field}.id`]) ??
    idFrom(record[`invoice.${field}.id`]) ??
    idFrom(Object.entries(record).find(([key]) => key.toLowerCase().endsWith(`.${field.toLowerCase()}.id`))?.[1])
  );
}

function idFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  const record = asRecord(value);
  const id = record ? numberFrom(record.id ?? record.value ?? record.rawValue ?? record.rawvalue ?? record.key ?? readField(record, "id")) : null;
  return id ?? null;
}

function numberFrom(value: unknown): number | null {
  const scalar = scalarFrom(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }

  if (typeof scalar === "string") {
    const normalized = normalizeNumberString(scalar);
    if (normalized && Number.isFinite(Number(normalized))) {
      return Number(normalized);
    }
  }

  return null;
}

function stringFrom(value: unknown): string | undefined {
  const scalar = scalarFrom(value);
  if (typeof scalar === "string") {
    return scalar.trim() || undefined;
  }

  if (typeof scalar === "number" || typeof scalar === "boolean") {
    return String(scalar);
  }

  return undefined;
}

function scalarFrom(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return value;
  }

  for (const key of ["value", "rawValue", "rawvalue", "id", "displayvalue", "displayValue", "label", "name", "searchname", "screenname"]) {
    if (record[key] !== undefined && record[key] !== null) {
      return scalarFrom(record[key]);
    }
  }

  return value;
}

function looksLikeEntity(record: JsonRecord) {
  return ["id", "amount", "date", "reportdate", "searchname", "offerprojectline", "totalincldiscountexclvat"].some(
    (field) => readField(record, field) !== undefined
  );
}

function dateKeyFromValue(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateKey(value);
  }

  if (typeof value === "string") {
    return dateKeyFromString(value);
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ["rawValue", "rawvalue", "date", "value", "displayvalue", "displayValue", "label", "name", "searchname"]) {
    const nestedValue = record[key];
    if (nestedValue !== undefined && nestedValue !== null && nestedValue !== value) {
      const nestedDate = dateKeyFromValue(nestedValue);
      if (nestedDate) {
        return nestedDate;
      }
    }
  }

  return undefined;
}

function dateKeyFromString(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const dateKeyMatch = trimmed.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isDateKey(dateKeyMatch)) {
    return dateKeyMatch;
  }

  const dayFirstMatch = trimmed.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (dayFirstMatch) {
    const [, day, month, year] = dayFirstMatch;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (isDateKey(date)) {
      return date;
    }
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : dateKey(parsed);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isDateKey(value: string | undefined): value is string {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/) && parseDateKey(value));
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNumberString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.includes(",") && trimmed.includes(".")) {
    return trimmed.replace(/\./g, "").replace(",", ".");
  }

  return trimmed.replace(",", ".");
}

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function divideCurrency(value: number, denominator: number) {
  return denominator > 0 ? value / denominator : 0;
}

function formatHours(value: number) {
  return hoursFormatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatCurrencyPerHour(value: number) {
  return `${currencyPerHourFormatter.format(value)}/u`;
}

function formatDate(value: string) {
  const date = parseDateKey(value);
  return date
    ? new Intl.DateTimeFormat("nl-NL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(date)
    : value;
}

function createDemoHours(period: Period): JsonRecord[] {
  return makeMonthBuckets(period).flatMap((bucket, index) => {
    const month = bucket.key;
    return [
      { id: index * 4 + 1, date: `${month}-05`, amount: 138 + (index % 3) * 4, employee: 1, offerprojectline: 1000 + index * 4 },
      { id: index * 4 + 2, date: `${month}-12`, amount: 126 + (index % 4) * 3, employee: 2, offerprojectline: 1001 + index * 4 },
      { id: index * 4 + 3, date: `${month}-19`, amount: 114 + (index % 2) * 5, employee: 3, offerprojectline: 1002 + index * 4 },
      { id: index * 4 + 4, date: `${month}-24`, amount: 32 + (index % 3) * 2, employee: 4, offerprojectline: 1003 + index * 4 }
    ];
  });
}

function createDemoBillabilitySources(hours: JsonRecord[]): BillabilitySources {
  const offerProjectLineInvoiceBasis = new Map<number, string>();

  uniqueRelationIds(hours, "offerprojectline").forEach((id, index) => {
    offerProjectLineInvoiceBasis.set(id, index % 5 === 4 ? "NONBILLABLE" : "COSTING");
  });

  return { offerProjectLineInvoiceBasis };
}

function createDemoInvoices(period: Period): JsonRecord[] {
  return makeMonthBuckets(period).map((bucket, index) => ({
    id: 9000 + index,
    reportdate: `${bucket.key}-15`,
    status: "SENT",
    totalincldiscountexclvat: [18500, 22400, 26350, 19800, 28900, 24400][index % 6]
  }));
}

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

type LineBillability = {
  invoiceBasis?: string;
  hasPositiveValue: boolean;
};

type BillabilitySources = {
  offerProjectLines: Map<number, LineBillability>;
  invoiceLines: Map<number, LineBillability>;
};

type CapacitySources = {
  employees: JsonRecord[];
  workingHoursByEmployeeId: Map<number, number>;
  leaveHoursFromWorkingHoursByEmployeeId: Map<number, number>;
  absenceRequestLines: JsonRecord[];
  absenceRequestsById: Map<number, JsonRecord>;
};

type WorkingHoursCapacity = {
  workingHoursByEmployeeId: Map<number, number>;
  leaveHoursByEmployeeId: Map<number, number>;
};

type CapacitySummary = {
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  employeeCount: number;
  fallbackWorkingHoursEmployeeCount: number;
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
  unbillableLoggedHours: number;
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  capacityRemainingHours: number;
  billability: number;
  revenuePerLoggedHour: number;
  revenuePerBillableHour: number;
  invoiceCount: number;
  hourCount: number;
  employeeCount: number;
  fallbackWorkingHoursEmployeeCount: number;
  revenueByMonth: MonthRevenue[];
  lastUpdated: string;
};

const PAGE_SIZE = 250;
const MAX_INVOICE_PAGES = 80;
const MAX_HOUR_PAGES = 160;
const MAX_EMPLOYEE_PAGES = 20;
const MAX_ABSENCE_LINE_PAGES = 80;
const WORKING_HOURS_BATCH_SIZE = 25;
const DEFAULT_WEEKLY_CONTRACT_HOURS = 40;

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
        <MetricCard label="Billableheid" value={`${formatPercent(dashboard.billability)}%`} detail={`${formatHours(dashboard.billableHours)} / ${formatHours(dashboard.availableHours)} beschikbare uren`} tone="blue" />
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
            <span className="panel-total">{formatHours(dashboard.availableHours)} beschikbaar</span>
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
              <LegendItem label="Rest beschikbaar" value={`${formatHours(dashboard.capacityRemainingHours)} uur`} className="legend-dot--neutral" />
              <LegendItem label="Verlof" value={`${formatHours(dashboard.leaveHours)} uur`} className="legend-dot--warning" />
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
            <FormulaItem label="Werktijd" detail={`${dashboard.employeeCount} werknemers vanaf hun begindatum; ontbrekende werktijd valt terug op 40u/week`} value={`${formatHours(dashboard.contractHours)} uur`} />
            <FormulaItem label="Verlof" detail="Goedgekeurde verlofmutaties of afwezigheid uit Gripp-werktijden in dezelfde periode" value={`${formatHours(dashboard.leaveHours)} uur`} />
            <FormulaItem label="Beschikbaar" detail="Werktijd min verlof" value={`${formatHours(dashboard.availableHours)} uur`} />
            <FormulaItem label="Billable uren" detail="Uren gekoppeld aan een factuur- of opdrachtregel met klantprijs boven 0 euro" value={`${formatHours(dashboard.billableHours)} uur`} />
            <FormulaItem label="Gelogde uren" detail={`${dashboard.hourCount} urenregels van alle medewerkers; ${formatHours(dashboard.unbillableLoggedHours)} uur niet billable`} value={`${formatHours(dashboard.loggedHours)} uur`} />
            <FormulaItem label="Per gelogd uur" detail="Omzet / gelogde uren" value={formatCurrencyPerHour(dashboard.revenuePerLoggedHour)} />
            <FormulaItem label="Per billable uur" detail="Omzet / billable uren" value={formatCurrencyPerHour(dashboard.revenuePerBillableHour)} />
            {dashboard.fallbackWorkingHoursEmployeeCount > 0 ? (
              <FormulaItem label="Fallback" detail="Werknemers zonder werktijden in Gripp zijn met 40u/week gerekend" value={String(dashboard.fallbackWorkingHoursEmployeeCount)} />
            ) : null}
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
    return buildPmDashboardData(createDemoInvoices(period), demoHours, createDemoBillabilitySources(demoHours), createDemoCapacitySources(period), period, {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-cijfers te tonen."
    });
  }

  try {
    const client = new GrippClient();
    const issues: string[] = [];
    const [invoices, hours] = await Promise.all([
      requiredData("verkoopfacturen", () => fetchInvoicesForPeriod(client, period)),
      requiredData("uren", () => fetchHoursForPeriod(client, period))
    ]);
    const [employees, absenceRequestLines, billabilitySources] = await Promise.all([
      optionalData(issues, "medewerkers", [], () => fetchEmployees(client)),
      optionalData(issues, "verlofmutaties", [], () => fetchAbsenceRequestLinesForPeriod(client, period)),
      fetchBillabilitySources(client, hours, issues)
    ]);
    const absenceRequestsById = await optionalData(issues, "verlofaanvragen", new Map<number, JsonRecord>(), () =>
      fetchAbsenceRequestsById(client, absenceRequestLines)
    );
    const workingHoursCapacity = await optionalData(issues, "werktijden", emptyWorkingHoursCapacity(), () =>
      fetchWorkingHoursForEmployees(client, employees, hours, absenceRequestLines, absenceRequestsById, period)
    );

    return buildPmDashboardData(invoices, hours, billabilitySources, {
      employees,
      workingHoursByEmployeeId: workingHoursCapacity.workingHoursByEmployeeId,
      leaveHoursFromWorkingHoursByEmployeeId: workingHoursCapacity.leaveHoursByEmployeeId,
      absenceRequestLines,
      absenceRequestsById
    }, period, {
      mode: "live",
      message: liveSourceMessage(issues)
    });
  } catch (error) {
    const demoHours = createDemoHours(period);
    return buildPmDashboardData(createDemoInvoices(period), demoHours, createDemoBillabilitySources(demoHours), createDemoCapacitySources(period), period, {
      mode: "demo",
      message: `Live PM-data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    });
  }
}

async function requiredData<T>(label: string, loader: () => Promise<T>) {
  try {
    return await loader();
  } catch (error) {
    throw new Error(`${label} niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }
}

async function optionalData<T>(issues: string[], label: string, fallback: T, loader: () => Promise<T>) {
  try {
    return await loader();
  } catch (error) {
    issues.push(`${label} niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
    return fallback;
  }
}

function liveSourceMessage(issues: string[]) {
  if (issues.length === 0) {
    return "";
  }

  return `Live data geladen met fallback: ${issues.join("; ")}.`;
}

function emptyWorkingHoursCapacity(): WorkingHoursCapacity {
  return {
    workingHoursByEmployeeId: new Map<number, number>(),
    leaveHoursByEmployeeId: new Map<number, number>()
  };
}

function errorCode(error: unknown) {
  const record = asRecord(error);
  return typeof record?.code === "string" ? record.code : "";
}

async function fetchInvoicesForPeriod(client: GrippClient, period: Period) {
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "invoice.reportdate", operator: "greaterequals", value: period.start },
    { field: "invoice.reportdate", operator: "lessequals", value: period.end }
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
async function fetchEmployees(client: GrippClient) {
  const records: JsonRecord[] = [];

  for (let page = 0; page < MAX_EMPLOYEE_PAGES; page += 1) {
    const result = await client.call("employee.get", [
      [],
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings: [{ field: "employee.id", direction: "asc" }]
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

async function fetchAbsenceRequestLinesForPeriod(client: GrippClient, period: Period) {
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "absencerequestline.date", operator: "greaterequals", value: period.start },
    { field: "absencerequestline.date", operator: "lessequals", value: period.end }
  ];

  for (let page = 0; page < MAX_ABSENCE_LINE_PAGES; page += 1) {
    const result = await client.call("absencerequestline.get", [
      filters,
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings: [{ field: "absencerequestline.date", direction: "asc" }]
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

async function fetchAbsenceRequestsById(client: GrippClient, absenceRequestLines: JsonRecord[]) {
  const absenceRequestsById = new Map<number, JsonRecord>();
  const absenceRequestIds = uniqueRelationIds(absenceRequestLines, "absencerequest");

  for (let index = 0; index < absenceRequestIds.length; index += 100) {
    const idChunk = absenceRequestIds.slice(index, index + 100);
    const result = await client.call("absencerequest.get", [
      [{ field: "absencerequest.id", operator: "in", value: idChunk }],
      {
        paging: { firstresult: 0, maxresults: PAGE_SIZE },
        orderings: [{ field: "absencerequest.id", direction: "asc" }]
      }
    ] as JsonValue[]);

    for (const absenceRequest of asRecords(result)) {
      const id = idFrom(readField(absenceRequest, "id"));
      if (id !== null) {
        absenceRequestsById.set(id, absenceRequest);
      }
    }
  }

  return absenceRequestsById;
}

async function fetchWorkingHoursForEmployees(
  client: GrippClient,
  employees: JsonRecord[],
  hours: JsonRecord[],
  absenceRequestLines: JsonRecord[],
  absenceRequestsById: Map<number, JsonRecord>,
  period: Period
) {
  const leaveByEmployeeId = buildLeaveByEmployeeId(absenceRequestLines, absenceRequestsById, period);
  const entries = workingHourEmployeeEntries(employees, hours, leaveByEmployeeId, period);
  const workingHoursByEmployeeId = new Map<number, number>();
  const leaveHoursByEmployeeId = new Map<number, number>();
  const callableEntries = entries.filter((entry) => {
    if (entry.start > period.end) {
      workingHoursByEmployeeId.set(entry.employeeId, 0);
      leaveHoursByEmployeeId.set(entry.employeeId, 0);
      return false;
    }

    return true;
  });

  for (let index = 0; index < callableEntries.length; index += WORKING_HOURS_BATCH_SIZE) {
    const chunk = callableEntries.slice(index, index + WORKING_HOURS_BATCH_SIZE);
    const results = await client.batch(
      chunk.flatMap((entry) => [
        {
          method: "employee.getWorkingHours",
          params: [[entry.employeeId], entry.start, period.end, false] as JsonValue[]
        },
        {
          method: "employee.getWorkingHours",
          params: [[entry.employeeId], entry.start, period.end, true] as JsonValue[]
        }
      ])
    );

    chunk.forEach((entry, chunkIndex) => {
      const workingHours = workingHoursTotalFromResult(results[chunkIndex * 2]);
      const workingHoursIncludingAbsence = workingHoursTotalFromResult(results[chunkIndex * 2 + 1]);
      workingHoursByEmployeeId.set(entry.employeeId, workingHours);
      leaveHoursByEmployeeId.set(entry.employeeId, Math.max(0, workingHours - workingHoursIncludingAbsence));
    });
  }

  return { workingHoursByEmployeeId, leaveHoursByEmployeeId };
}

async function fetchBillabilitySources(client: GrippClient, hours: JsonRecord[], issues: string[] = []): Promise<BillabilitySources> {
  const offerProjectLines = new Map<number, LineBillability>();
  const invoiceLines = new Map<number, LineBillability>();
  const offerProjectLineIds = uniqueRelationIds(hours, "offerprojectline");
  const invoiceLineIds = uniqueRelationIds(hours, "invoiceline");

  try {
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
        if (id !== null) {
          offerProjectLines.set(id, {
            invoiceBasis,
            hasPositiveValue: lineHasPositiveValue(offerProjectLine)
          });
        }
      }
    }
  } catch (error) {
    issues.push(`opdrachtregelprijzen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  try {
    for (let index = 0; index < invoiceLineIds.length; index += 100) {
      const idChunk = invoiceLineIds.slice(index, index + 100);
      const result = await client.call("invoiceline.get", [
        [{ field: "invoiceline.id", operator: "in", value: idChunk }],
        {
          paging: { firstresult: 0, maxresults: PAGE_SIZE },
          orderings: [{ field: "invoiceline.id", direction: "asc" }]
        }
      ] as JsonValue[]);

      for (const invoiceLine of asRecords(result)) {
        const id = idFrom(readField(invoiceLine, "id"));
        if (id !== null) {
          invoiceLines.set(id, {
            hasPositiveValue: lineHasPositiveValue(invoiceLine)
          });
        }
      }
    }
  } catch (error) {
    issues.push(`factuurregelprijzen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  return { offerProjectLines, invoiceLines };
}

function buildPmDashboardData(
  invoices: JsonRecord[],
  hours: JsonRecord[],
  billabilitySources: BillabilitySources,
  capacitySources: CapacitySources,
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

  const capacity = buildCapacitySummary(capacitySources, hours, period);

  return {
    period,
    source,
    revenue,
    loggedHours,
    billableHours,
    unbillableLoggedHours: Math.max(0, loggedHours - billableHours),
    contractHours: capacity.contractHours,
    leaveHours: capacity.leaveHours,
    availableHours: capacity.availableHours,
    capacityRemainingHours: Math.max(0, capacity.availableHours - billableHours),
    billability: percent(billableHours, capacity.availableHours),
    revenuePerLoggedHour: divideCurrency(revenue, loggedHours),
    revenuePerBillableHour: divideCurrency(revenue, billableHours),
    invoiceCount,
    hourCount,
    employeeCount: capacity.employeeCount,
    fallbackWorkingHoursEmployeeCount: capacity.fallbackWorkingHoursEmployeeCount,
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
  const invoiceLineId = relationId(hour, "invoiceline");
  const invoiceLine = invoiceLineId === null ? undefined : billabilitySources.invoiceLines.get(invoiceLineId);
  if (invoiceLine) {
    return invoiceLine.hasPositiveValue;
  }

  const offerProjectLineId = relationId(hour, "offerprojectline");
  const offerProjectLine = offerProjectLineId === null ? undefined : billabilitySources.offerProjectLines.get(offerProjectLineId);
  if (offerProjectLine) {
    return offerProjectLine.invoiceBasis !== "NONBILLABLE" && offerProjectLine.hasPositiveValue;
  }

  return Boolean(directInvoiceBasis && directInvoiceBasis !== "NONBILLABLE" && lineHasPositiveValue(hour));
}

function lineHasPositiveValue(line: JsonRecord) {
  const sellingPrice = numberFrom(readField(line, "sellingprice"));
  if (sellingPrice === null || sellingPrice <= 0) {
    return false;
  }

  const amount = numberFrom(readField(line, "amount"));
  if (amount !== null && amount <= 0) {
    return false;
  }

  const discount = numberFrom(readField(line, "discount"));
  return discount === null || discount < 100;
}

function buildCapacitySummary(capacitySources: CapacitySources, hours: JsonRecord[], period: Period): CapacitySummary {
  const employeesById = new Map<number, JsonRecord>();
  for (const employee of capacitySources.employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (employeeId !== null) {
      employeesById.set(employeeId, employee);
    }
  }

  const leaveByEmployeeId = buildLeaveByEmployeeId(capacitySources.absenceRequestLines, capacitySources.absenceRequestsById, period);
  const referencedEmployeeIds = new Set<number>([
    ...Array.from(capacitySources.workingHoursByEmployeeId.keys()),
    ...Array.from(leaveByEmployeeId.keys()),
    ...hours.map((hour) => relationId(hour, "employee")).filter((employeeId): employeeId is number => employeeId !== null)
  ]);

  for (const employeeId of referencedEmployeeIds) {
    if (!employeesById.has(employeeId)) {
      employeesById.set(employeeId, { id: employeeId, active: true });
    }
  }

  const employees = Array.from(employeesById.entries())
    .filter(([employeeId, employee]) => booleanFrom(readField(employee, "active")) !== false || referencedEmployeeIds.has(employeeId))
    .map(([employeeId, employee]) => ({ employeeId, employee }));
  let contractHours = 0;
  let leaveHours = 0;
  let fallbackWorkingHoursEmployeeCount = 0;
  let countedEmployees = 0;

  for (const { employeeId, employee } of employees) {
    const employeeStart = employeeStartDate(employee);
    const capacityStart = maxDateKey(period.start, employeeStart);
    if (capacityStart > period.end) {
      continue;
    }

    countedEmployees += 1;
    const workingHours = capacitySources.workingHoursByEmployeeId.get(employeeId);
    if (workingHours === undefined) {
      contractHours += calculateDefaultContractHours(capacityStart, period.end);
      fallbackWorkingHoursEmployeeCount += 1;
    } else {
      contractHours += Math.max(0, workingHours);
    }

    const leaveFromRequestLines = leaveHoursForEmployee(leaveByEmployeeId.get(employeeId) ?? [], capacityStart, period.end);
    const leaveFromWorkingHours = capacitySources.leaveHoursFromWorkingHoursByEmployeeId.get(employeeId) ?? 0;
    leaveHours += Math.max(leaveFromRequestLines, leaveFromWorkingHours);
  }

  const availableHours = Math.max(0, contractHours - leaveHours);

  return {
    contractHours,
    leaveHours,
    availableHours,
    employeeCount: countedEmployees,
    fallbackWorkingHoursEmployeeCount
  };
}

function buildLeaveByEmployeeId(absenceRequestLines: JsonRecord[], absenceRequestsById: Map<number, JsonRecord>, period: Period) {
  const leaveByEmployeeId = new Map<number, JsonRecord[]>();

  for (const line of absenceRequestLines) {
    const status = stringFrom(readField(line, "absencerequeststatus"))?.toUpperCase();
    if (status && status !== "APPROVED") {
      continue;
    }

    const date = dateKeyFromValue(readField(line, "date"));
    if (!date || date < period.start || date > period.end) {
      continue;
    }

    const absenceRequestId = relationId(line, "absencerequest");
    const absenceRequest = absenceRequestId === null ? undefined : absenceRequestsById.get(absenceRequestId);
    const employeeId = relationId(absenceRequest ?? line, "employee");
    if (employeeId === null) {
      continue;
    }

    const values = leaveByEmployeeId.get(employeeId) ?? [];
    values.push(line);
    leaveByEmployeeId.set(employeeId, values);
  }

  return leaveByEmployeeId;
}

function workingHourEmployeeEntries(
  employees: JsonRecord[],
  hours: JsonRecord[],
  leaveByEmployeeId: Map<number, JsonRecord[]>,
  period: Period
) {
  const employeesById = new Map<number, JsonRecord>();
  const referencedEmployeeIds = new Set<number>([
    ...Array.from(leaveByEmployeeId.keys()),
    ...hours.map((hour) => relationId(hour, "employee")).filter((employeeId): employeeId is number => employeeId !== null)
  ]);

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (employeeId !== null) {
      employeesById.set(employeeId, employee);
    }
  }

  for (const employeeId of referencedEmployeeIds) {
    if (!employeesById.has(employeeId)) {
      employeesById.set(employeeId, { id: employeeId, active: true });
    }
  }

  return Array.from(employeesById.entries())
    .filter(([employeeId, employee]) => booleanFrom(readField(employee, "active")) !== false || referencedEmployeeIds.has(employeeId))
    .map(([employeeId, employee]) => ({
      employeeId,
      start: maxDateKey(period.start, employeeStartDate(employee))
    }));
}

function workingHoursTotalFromResult(value: unknown) {
  const explicitTotal = explicitWorkingHoursTotal(value);
  const total = explicitTotal ?? sumWorkingHourEntries(value);
  return Math.max(0, total);
}

function explicitWorkingHoursTotal(value: unknown): number | null {
  const primitive = primitiveNumberFrom(value);
  if (primitive !== null) {
    return primitive;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 0;
    }

    const firstPrimitive = primitiveNumberFrom(value[0]);
    if (firstPrimitive !== null) {
      return firstPrimitive;
    }

    for (const item of value) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }

      const recordTotal = explicitTotalFromRecord(record);
      if (recordTotal !== null) {
        return recordTotal;
      }

      if (!hasDateMarker(record)) {
        const nestedTotal = explicitWorkingHoursTotalFromSingleValueRecord(record);
        if (nestedTotal !== null) {
          return nestedTotal;
        }
      }
    }

    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return explicitTotalFromRecord(record) ?? explicitWorkingHoursTotalFromSingleValueRecord(record);
}

function explicitWorkingHoursTotalFromSingleValueRecord(record: JsonRecord) {
  const meaningfulEntries = Object.entries(record).filter(([key]) => !isIgnoredWorkingHoursKey(key));
  if (meaningfulEntries.length !== 1) {
    return null;
  }

  return explicitWorkingHoursTotal(meaningfulEntries[0][1]);
}

function explicitTotalFromRecord(record: JsonRecord) {
  for (const field of ["totalworkinghours", "totalWorkingHours", "workinghourstotal", "workingHoursTotal", "totalhours", "totalHours", "total", "sum"]) {
    const value = numberFrom(readField(record, field));
    if (value !== null) {
      return value;
    }
  }

  if (hasDateMarker(record)) {
    return null;
  }

  for (const field of ["workinghours", "workingHours", "working_hours", "hours", "amount", "value", "rawValue", "rawvalue"]) {
    const value = numberFrom(readField(record, field));
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function sumWorkingHourEntries(value: unknown): number {
  const primitive = primitiveNumberFrom(value);
  if (primitive !== null) {
    return primitive;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + sumWorkingHourEntries(item), 0);
  }

  const record = asRecord(value);
  if (!record) {
    return 0;
  }

  const rowAmount = workingHourAmountFromRecord(record);
  if (rowAmount !== null) {
    return rowAmount;
  }

  return Object.entries(record).reduce((total, [key, nestedValue]) => {
    if (isIgnoredWorkingHoursKey(key)) {
      return total;
    }

    return total + sumWorkingHourEntries(nestedValue);
  }, 0);
}

function workingHourAmountFromRecord(record: JsonRecord) {
  if (hasDateMarker(record)) {
    for (const field of ["workinghours", "workingHours", "working_hours", "hours", "amount", "value", "rawValue", "rawvalue"]) {
      const value = numberFrom(readField(record, field));
      if (value !== null) {
        return value;
      }
    }
  }

  return explicitTotalFromRecord(record);
}

function primitiveNumberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = normalizeNumberString(value);
    if (normalized && Number.isFinite(Number(normalized))) {
      return Number(normalized);
    }
  }

  return null;
}

function hasDateMarker(record: JsonRecord) {
  return Boolean(
    dateKeyFromValue(readField(record, "date")) ||
      dateKeyFromValue(readField(record, "day")) ||
      dateKeyFromValue(readField(record, "datum")) ||
      Object.keys(record).some((key) => isDateKey(key))
  );
}

function isIgnoredWorkingHoursKey(key: string) {
  return [
    "id",
    "employee",
    "employeeid",
    "medewerker",
    "medewerkerid",
    "date",
    "day",
    "datum",
    "startdate",
    "stopdate",
    "enddate",
    "name",
    "screenname",
    "searchname",
    "label",
    "displayvalue",
    "active",
    "status"
  ].includes(key.toLowerCase().replace(/[._-]/g, ""));
}

function employeeStartDate(employee: JsonRecord) {
  return dateKeyFromValue(readField(employee, "employeesince")) ?? "0001-01-01";
}

function calculateDefaultContractHours(start: string, end: string) {
  return datesInRange(start, end).reduce((total, date) => total + defaultDailyContractHours(date), 0);
}

function defaultDailyContractHours(date: string) {
  const parsedDate = parseDateKey(date);
  if (!parsedDate) {
    return 0;
  }

  const day = parsedDate.getDay();
  return day === 0 || day === 6 ? 0 : DEFAULT_WEEKLY_CONTRACT_HOURS / 5;
}

function leaveHoursForEmployee(absenceRequestLines: JsonRecord[], start: string, end: string) {
  return absenceRequestLines.reduce((total, line) => {
    const date = dateKeyFromValue(readField(line, "date"));
    if (!date || date < start || date > end) {
      return total;
    }

    return total + Math.max(0, numberFrom(readField(line, "amount")) ?? 0);
  }, 0);
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
    record[`invoiceline.${field}`] ??
    record[`employee.${field}`] ??
    record[`employmentcontract.${field}`] ??
    record[`absencerequestline.${field}`] ??
    record[`absencerequest.${field}`];
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
    idFrom(record[`employee.${field}.id`]) ??
    idFrom(record[`employmentcontract.${field}.id`]) ??
    idFrom(record[`absencerequestline.${field}.id`]) ??
    idFrom(record[`absencerequest.${field}.id`]) ??
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

function booleanFrom(value: unknown): boolean | undefined {
  const scalar = scalarFrom(value);
  if (typeof scalar === "boolean") {
    return scalar;
  }

  if (typeof scalar === "number") {
    return scalar !== 0;
  }

  if (typeof scalar === "string") {
    if (["true", "1", "yes"].includes(scalar.toLowerCase())) {
      return true;
    }
    if (["false", "0", "no"].includes(scalar.toLowerCase())) {
      return false;
    }
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
  return ["id", "amount", "date", "reportdate", "searchname", "offerprojectline", "totalincldiscountexclvat", "employee", "startdate"].some(
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

function datesInRange(start: string, end: string) {
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function maxDateKey(left: string, right: string) {
  return left > right ? left : right;
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
  const offerProjectLines = new Map<number, LineBillability>();
  const invoiceLines = new Map<number, LineBillability>();

  uniqueRelationIds(hours, "offerprojectline").forEach((id, index) => {
    offerProjectLines.set(id, {
      invoiceBasis: index % 5 === 4 ? "NONBILLABLE" : "COSTING",
      hasPositiveValue: index % 5 !== 4
    });
  });

  return { offerProjectLines, invoiceLines };
}

function createDemoInvoices(period: Period): JsonRecord[] {
  return makeMonthBuckets(period).map((bucket, index) => ({
    id: 9000 + index,
    reportdate: `${bucket.key}-15`,
    status: "SENT",
    totalincldiscountexclvat: [18500, 22400, 26350, 19800, 28900, 24400][index % 6]
  }));
}

function createDemoCapacitySources(period: Period): CapacitySources {
  const employees = [
    { id: 1, screenname: "Noor de Vries", employeesince: `${period.year}-01-01`, active: true },
    { id: 2, screenname: "Milan Jansen", employeesince: `${period.year}-02-01`, active: true },
    { id: 3, screenname: "Jasmijn Bakker", employeesince: `${period.year}-01-15`, active: true },
    { id: 4, screenname: "Daan Smit", employeesince: `${period.year}-03-01`, active: true }
  ];
  const workingHoursByEmployeeId = new Map<number, number>([
    [1, calculateDefaultContractHours(`${period.year}-01-01`, period.end)],
    [2, calculateDefaultContractHours(`${period.year}-02-01`, period.end)],
    [3, calculateDefaultContractHours(`${period.year}-01-15`, period.end) * 0.8]
  ]);
  const absenceRequestsById = new Map<number, JsonRecord>([
    [1, { id: 1, employee: 1 }],
    [2, { id: 2, employee: 2 }],
    [3, { id: 3, employee: 3 }]
  ]);
  const absenceRequestLines = [
    { id: 1, absencerequest: 1, date: `${period.year}-02-14`, amount: 8, absencerequeststatus: "APPROVED" },
    { id: 2, absencerequest: 2, date: `${period.year}-04-08`, amount: 16, absencerequeststatus: "APPROVED" },
    { id: 3, absencerequest: 3, date: `${period.year}-07-18`, amount: 8, absencerequeststatus: "APPROVED" }
  ];

  return {
    employees,
    workingHoursByEmployeeId,
    leaveHoursFromWorkingHoursByEmployeeId: new Map<number, number>(),
    absenceRequestLines,
    absenceRequestsById
  };
}

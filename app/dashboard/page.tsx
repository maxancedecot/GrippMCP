import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type DashboardSearchParams = Record<string, string | string[] | undefined>;

type Period = {
  start: string;
  end: string;
  label: string;
  shortMonth: string;
  weekBuckets: WeekBucket[];
  isCustom: boolean;
};

type WeekBucket = {
  key: string;
  label: string;
};

type DashboardSource = {
  mode: "live" | "demo";
  message: string;
};

type Aggregate = {
  declarable: number;
  internal: number;
  revenue: number;
  untracked: number;
  overtime: number;
  total: number;
  written: number;
};

type EmployeeRow = Aggregate & {
  id: string;
  name: string;
  declarability: number;
};

type WeekRow = Aggregate & {
  key: string;
  label: string;
  declarability: number;
};

type DashboardData = Aggregate & {
  period: Period;
  source: DashboardSource;
  declarability: number;
  employeeFilters: EmployeeFilterOption[];
  employeeRows: EmployeeRow[];
  internalRows: EmployeeRow[];
  weekRows: WeekRow[];
  lastUpdated: string;
};

type EmployeeFilterOption = {
  id: string;
  name: string;
  included: boolean;
};

type WorkingHoursSummary = {
  total: number;
  byDate: Map<string, number>;
};

type RevenuePriceSources = {
  invoiceLines: Map<number, RevenueLine>;
  offerProjectLines: Map<number, RevenueLine>;
};

type RevenueLine = {
  invoiceBasis: string;
  maxAmount: number | null;
  netSellingPrice: number;
  spentAmount: number | null;
};

const INTERNAL_OFFERPROJECTBASE_ID = 318;
const INTERNAL_PROJECT_LABEL = "Ledoux intern";
const NORMAL_DAILY_HOURS = 8;
const DEFAULT_EXCLUDED_DASHBOARD_EMPLOYEE_NAMES = new Set(["pieter", "maxance", "tom"]);

const hoursFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const percentFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const currencyFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const params = (await searchParams) ?? {};
  const requestedPeriod = getPeriodFromParams(params);
  const dashboard = await getDashboardData(requestedPeriod, params);
  const gaugeProgress = Math.max(0, Math.min(dashboard.declarability, 100));
  const maxWeeklyRevenue = Math.max(1, ...dashboard.weekRows.map((week) => week.revenue));

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Gripp uren</p>
          <h1>Declarabiliteit</h1>
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

      <form className="period-form" action="/dashboard">
        <input type="hidden" name="employeeFilter" value="1" />
        <label>
          Van
          <input type="date" name="start" defaultValue={dashboard.period.start} />
        </label>
        <label>
          Tot
          <input type="date" name="end" defaultValue={dashboard.period.end} />
        </label>
        <button type="submit">Periode laden</button>
        {dashboard.employeeFilters.length > 0 ? (
          <fieldset className="employee-filter">
            <legend>Wel meerekenen</legend>
            <div className="employee-filter-list">
              {dashboard.employeeFilters.map((employee) => (
                <label key={employee.id} className="employee-filter-option">
                  <input type="checkbox" name="include" value={employee.id} defaultChecked={employee.included} />
                  <span>{employee.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </form>

      <section className="metric-grid" aria-label="Kerncijfers declarabiliteit">
        <MetricCard label="Declarabiliteit" value={`${formatPercent(dashboard.declarability)}%`} detail="Declarabele uren / voorziene uren" tone="good" />
        <MetricCard label="Declarabele uren" value={formatHours(dashboard.declarable)} detail={`Niet geboekt op ${INTERNAL_PROJECT_LABEL}`} tone="blue" />
        <MetricCard label="Overuren" value={formatHours(dashboard.overtime)} detail="Geschreven boven 8u per werkdag" tone="overtime" />
        <MetricCard label={INTERNAL_PROJECT_LABEL} value={formatHours(dashboard.internal)} detail={`Project ${INTERNAL_OFFERPROJECTBASE_ID}`} tone="warning" />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--distribution">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Verdeling</p>
              <h2>Geschreven uren</h2>
            </div>
            <span className="panel-total">{formatOvertimeLabel(dashboard.overtime)}</span>
          </div>

          <div className="distribution-layout">
            <div className="gauge" aria-label={`Declarabiliteit ${formatPercent(dashboard.declarability)} procent`}>
              <svg className="gauge-ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="gauge-ring-track" cx="60" cy="60" r="52" pathLength={100} />
                <circle className="gauge-ring-fill" cx="60" cy="60" r="52" pathLength={100} strokeDasharray={`${gaugeProgress} ${100 - gaugeProgress}`} />
              </svg>
              <div className="gauge-inner">
                <strong>{formatPercent(dashboard.declarability)}%</strong>
                <span>declarabel</span>
              </div>
            </div>

            <dl className="legend-list">
              <LegendItem label="Declarabel" value={dashboard.declarable} className="legend-dot--good" />
              <LegendItem label={INTERNAL_PROJECT_LABEL} value={dashboard.internal} className="legend-dot--warning" />
              <LegendItem label="Niet geschreven" value={dashboard.untracked} className="legend-dot--neutral" />
              <LegendItem label="Overuren" value={dashboard.overtime} className="legend-dot--overtime" formatter={formatOvertimeLabel} />
            </dl>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Omzet</p>
              <h2>Opgebracht per week</h2>
            </div>
            <span className="panel-total">{formatCurrency(dashboard.revenue)}</span>
          </div>

          <div className="revenue-list">
            {dashboard.weekRows.map((week) => (
              <RevenueBar key={week.key} label={week.label} revenue={week.revenue} maxRevenue={maxWeeklyRevenue} />
            ))}
          </div>
        </article>
      </section>

      <section className="table-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Team</p>
              <h2>Medewerkers</h2>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medewerker</th>
                  <th>Overuren</th>
                  <th>Declarabel</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.employeeRows.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <span className="row-title">{employee.name}</span>
                      <span className="cell-muted">{formatHours(employee.written)} geschreven</span>
                    </td>
                    <td>{formatHours(employee.overtime)}</td>
                    <td>
                      <InlineBar aggregate={employee} />
                      <span className="cell-muted">{formatPercent(employee.declarability)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Intern</p>
              <h2>{INTERNAL_PROJECT_LABEL}</h2>
            </div>
          </div>

          {dashboard.internalRows.length > 0 ? (
            <div className="status-list">
              {dashboard.internalRows.map((employee) => (
                <StackedBar
                  key={employee.id}
                  label={employee.name}
                  aggregate={employee}
                  trailing={`${formatHours(employee.internal)} uur`}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">Geen uren op {INTERNAL_PROJECT_LABEL} gevonden in deze periode.</p>
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Proxy</p>
            <h2>Declarabiliteit</h2>
          </div>
          <span className="panel-total">Excl. {INTERNAL_PROJECT_LABEL} / voorziene uren</span>
        </div>

        <div className="project-line-list">
          <div className="project-line-row">
            <div>
              <span className="row-title">Teller</span>
              <span className="cell-muted">
                Geschreven uren exclusief {INTERNAL_PROJECT_LABEL} (project {INTERNAL_OFFERPROJECTBASE_ID})
              </span>
            </div>
            <div className="project-line-metrics">
              <span>{formatHours(dashboard.declarable)} uur</span>
            </div>
          </div>
          <div className="project-line-row">
            <div>
              <span className="row-title">Overuren</span>
              <span className="cell-muted">Totaal geschreven min 8u per werkdag per medewerker</span>
            </div>
            <div className="project-line-metrics">
              <span>{formatHours(dashboard.overtime)} uur</span>
            </div>
          </div>
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
  tone: "good" | "blue" | "warning" | "neutral" | "overtime";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function LegendItem({
  label,
  value,
  className,
  formatter = (amount) => `${formatHours(amount)} uur`
}: {
  label: string;
  value: number;
  className: string;
  formatter?: (value: number) => string;
}) {
  return (
    <div>
      <dt>
        <span className={`legend-dot ${className}`} />
        {label}
      </dt>
      <dd>{formatter(value)}</dd>
    </div>
  );
}

function StackedBar({ label, aggregate, trailing }: { label: string; aggregate: Aggregate; trailing: string }) {
  return (
    <div className="stack-row">
      <div className="stack-label">
        <span>{label}</span>
        <span>{trailing}</span>
      </div>
      <InlineBar aggregate={aggregate} />
      <span className="cell-muted">{formatOvertimeLabel(aggregate.overtime)}</span>
    </div>
  );
}

function RevenueBar({ label, revenue, maxRevenue }: { label: string; revenue: number; maxRevenue: number }) {
  const width = Math.max(0, Math.min(100, percent(revenue, maxRevenue)));

  return (
    <div className="revenue-row">
      <div className="stack-label">
        <span>{label}</span>
        <span>{formatCurrency(revenue)}</span>
      </div>
      <div className="revenue-bar" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function InlineBar({ aggregate }: { aggregate: Aggregate }) {
  const denominator = Math.max(aggregate.total, aggregate.written, 1);
  const declarableWidth = cappedPercent(aggregate.declarable, denominator);
  const internalWidth = cappedPercent(aggregate.internal, denominator);
  const untrackedWidth = Math.max(0, 100 - declarableWidth - internalWidth);

  return (
    <div className="inline-bar" aria-hidden="true">
      <span className="bar-segment bar-segment--good" style={{ width: `${declarableWidth}%` }} />
      <span className="bar-segment bar-segment--warning" style={{ width: `${internalWidth}%` }} />
      <span className="bar-segment bar-segment--neutral" style={{ width: `${untrackedWidth}%` }} />
    </div>
  );
}

async function getDashboardData(period: Period, params: DashboardSearchParams): Promise<DashboardData> {
  if (!process.env.GRIPP_API_TOKEN) {
    const allEmployees = createDemoEmployees();
    const employeeSelection = getEmployeeSelection(allEmployees, params);
    const employeeIds = employeeIdsFromEmployees(employeeSelection.includedEmployees);
    const demoHours = createDemoHours(period);
    const hours = filterHoursByEmployeeIds(demoHours, employeeIds);
    const revenuePrices = createDemoRevenuePrices(demoHours);
    return buildDashboardData(hours, employeeSelection.includedEmployees, period, {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-uren te tonen."
    }, employeeSelection.options, revenuePrices, demoHours);
  }

  try {
    const client = new GrippClient();
    const allEmployees = await fetchEmployees(client);
    const employeeSelection = getEmployeeSelection(allEmployees, params);
    const employeeIds = employeeIdsFromEmployees(employeeSelection.includedEmployees);
    let effectivePeriod = period;
    const source: DashboardSource = {
      mode: "live",
      message: ""
    };
    let hours = employeeIds.length > 0 ? await fetchHoursForPeriod(client, period, employeeIds) : [];

    if (employeeIds.length > 0 && hours.length === 0 && !period.isCustom) {
      const latestHours = await fetchLatestHours(client, employeeIds);
      if (latestHours.length > 0) {
        effectivePeriod = periodFromHours(latestHours);
        hours = await fetchHoursForPeriod(client, effectivePeriod, employeeIds);
        source.message = `Geen uren gevonden tussen ${formatDate(period.start)} en ${formatDate(
          period.end
        )}; toont nu ${formatDate(effectivePeriod.start)} tot ${formatDate(effectivePeriod.end)}.`;
      }
    }

    const revenuePrices = await fetchRevenuePriceSources(client, hours);
    const revenueBasisHours = needsFixedFeeFallbackHours(hours, revenuePrices) ? await fetchHoursForPeriod(client, effectivePeriod, []) : hours;
    const dashboard = buildDashboardData(
      hours,
      employeeSelection.includedEmployees,
      effectivePeriod,
      source,
      employeeSelection.options,
      revenuePrices,
      revenueBasisHours
    );

    if (employeeIds.length === 0) {
      dashboard.source.message = "Geen medewerkers gevonden voor dit dashboard.";
    } else if (hours.length === 0) {
      dashboard.source.message = `Geen uren gevonden tussen ${formatDate(effectivePeriod.start)} en ${formatDate(effectivePeriod.end)}.`;
    }

    return dashboard;
  } catch (error) {
    const allEmployees = createDemoEmployees();
    const employeeSelection = getEmployeeSelection(allEmployees, params);
    const employeeIds = employeeIdsFromEmployees(employeeSelection.includedEmployees);
    const demoHours = createDemoHours(period);
    const hours = filterHoursByEmployeeIds(demoHours, employeeIds);
    const revenuePrices = createDemoRevenuePrices(demoHours);
    return buildDashboardData(hours, employeeSelection.includedEmployees, period, {
      mode: "demo",
      message: `Live data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    }, employeeSelection.options, revenuePrices, demoHours);
  }
}

async function fetchEmployees(client: GrippClient) {
  const employees = await fetchEmployeePages(client);
  const activeEmployees = employees.filter((employee) => booleanFrom(readField(employee, "active")) !== false);
  return activeEmployees.length > 0 ? activeEmployees : employees;
}

async function fetchEmployeePages(client: GrippClient) {
  const pageSize = 250;
  const records: JsonRecord[] = [];

  for (let page = 0; page < 4; page += 1) {
    const result = await client.call("employee.get", [
      [],
      {
        paging: { firstresult: page * pageSize, maxresults: pageSize },
        orderings: [{ field: "employee.screenname", direction: "asc" }]
      }
    ] as JsonValue[]);
    const pageRecords = asRecords(result);
    records.push(...pageRecords);

    if (pageRecords.length < pageSize) {
      break;
    }
  }

  return records;
}

async function fetchHoursForPeriod(client: GrippClient, period: Period, employeeIds: number[]) {
  return fetchHourPages(client, hourFilters(period, employeeIds));
}

async function fetchLatestHours(client: GrippClient, employeeIds: number[]) {
  return fetchHourPages(client, employeeIds.length > 0 ? [{ field: "hour.employee", operator: "in", value: employeeIds }] : [], [
    { field: "hour.date", direction: "desc" }
  ], 1);
}

async function fetchHourPages(
  client: GrippClient,
  filters: JsonValue[],
  orderings: JsonValue[] = [{ field: "hour.date", direction: "asc" }],
  maxPages = 8
) {
  const pageSize = 250;
  const records: JsonRecord[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const result = await client.call("hour.get", [
      filters,
      {
        paging: { firstresult: page * pageSize, maxresults: pageSize },
        orderings
      }
    ] as JsonValue[]);
    const pageRecords = asRecords(result);
    records.push(...pageRecords);

    if (pageRecords.length < pageSize) {
      break;
    }
  }

  return records;
}

async function fetchRevenuePriceSources(client: GrippClient, hours: JsonRecord[]): Promise<RevenuePriceSources> {
  const invoiceLineIds = uniqueRelationIds(hours, "invoiceline");
  const offerProjectLineIds = uniqueRelationIds(hours, "offerprojectline");

  const [invoiceLines, offerProjectLines] = await Promise.all([
    fetchLinePriceMap(client, "invoiceline", invoiceLineIds),
    fetchLinePriceMap(client, "offerprojectline", offerProjectLineIds)
  ]);

  return {
    invoiceLines,
    offerProjectLines
  };
}

async function fetchLinePriceMap(
  client: GrippClient,
  entity: "invoiceline" | "offerprojectline",
  ids: number[]
): Promise<Map<number, RevenueLine>> {
  const prices = new Map<number, RevenueLine>();
  const uniqueIds = Array.from(new Set(ids));

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const idChunk = uniqueIds.slice(index, index + 100);
    if (idChunk.length === 0) {
      continue;
    }

    const result = await client.call(`${entity}.get`, [
      [{ field: `${entity}.id`, operator: "in", value: idChunk }],
      {
        paging: { firstresult: 0, maxresults: 250 },
        orderings: [{ field: `${entity}.id`, direction: "asc" }]
      }
    ] as JsonValue[]);

    for (const line of asRecords(result)) {
      const id = idFrom(readField(line, "id"));
      if (id !== null) {
        prices.set(id, revenueLineFromRecord(line));
      }
    }
  }

  return prices;
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

function hourFilters(period: Period, employeeIds: number[]) {
  const filters: JsonValue[] = [
    { field: "hour.date", operator: "greaterequals", value: period.start },
    { field: "hour.date", operator: "lessequals", value: period.end }
  ];

  if (employeeIds.length > 0) {
    filters.push({ field: "hour.employee", operator: "in", value: employeeIds });
  }

  return filters;
}

function buildDashboardData(
  hours: JsonRecord[],
  employees: JsonRecord[],
  period: Period,
  source: DashboardSource,
  employeeFilters: EmployeeFilterOption[],
  revenuePrices: RevenuePriceSources,
  revenueBasisHours = hours
): DashboardData {
  const employeesById = new Map<number, JsonRecord>();
  const minimumWorkingHours = createMinimumWorkingHours(period);
  const employeeMap = new Map<string, EmployeeRow>();
  const cappedRevenueUsageByLine = new Map<string, number>();
  const fixedRevenueHoursByLine = fixedFeeHoursByLine(revenueBasisHours, revenuePrices);
  const weekMap = new Map<string, WeekRow>(
    period.weekBuckets.map((bucket) => [bucket.key, withDeclarability({ ...emptyAggregate(), key: bucket.key, label: bucket.label })])
  );
  const assignMinimumHours = (employeeRow: EmployeeRow) => {
    employeeRow.total = minimumWorkingHours.total;
    addWorkingHoursToWeeks(weekMap, minimumWorkingHours, period);
  };

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (employeeId === null) {
      continue;
    }

    employeesById.set(employeeId, employee);
    const employeeRow = withDeclarability({
      ...emptyAggregate(),
      id: String(employeeId),
      name: employeeName(undefined, employee)
    });

    assignMinimumHours(employeeRow);
    employeeMap.set(employeeRow.id, employeeRow);
  }

  for (const hour of hours) {
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (amount === 0) {
      continue;
    }

    const employeeId = relationId(hour, "employee");
    const employeeKey = employeeId !== null ? String(employeeId) : "unknown";
    const hourDate = dateKeyFromValue(readField(hour, "date"));
    let employeeRow = employeeMap.get(employeeKey);
    if (!employeeRow) {
      employeeRow = withDeclarability({
        ...emptyAggregate(),
        id: employeeKey,
        name: employeeName(hour, employeeId !== null ? employeesById.get(employeeId) : undefined)
      });
      assignMinimumHours(employeeRow);
      employeeMap.set(employeeKey, employeeRow);
    }
    const weekKey = weekKeyForDate(hourDate, period);
    const weekRow = weekMap.get(weekKey);
    const targetField = relationId(hour, "offerprojectbase") === INTERNAL_OFFERPROJECTBASE_ID ? "internal" : "declarable";
    const revenue =
      targetField === "declarable" ? revenueForHour(hour, amount, revenuePrices, cappedRevenueUsageByLine, fixedRevenueHoursByLine) : 0;

    employeeRow[targetField] += amount;
    employeeRow.revenue += revenue;
    employeeRow.written += amount;
    employeeMap.set(employeeKey, employeeRow);

    if (weekRow) {
      weekRow[targetField] += amount;
      weekRow.revenue += revenue;
      weekRow.written += amount;
    }
  }

  const employeeRows = Array.from(employeeMap.values())
    .map(finalizeAggregate)
    .sort((left, right) => right.total - left.total || right.written - left.written);

  const weekRows = Array.from(weekMap.values()).map(finalizeAggregate);
  const internalRows = employeeRows
    .filter((row) => row.internal > 0)
    .sort((left, right) => right.internal - left.internal)
    .slice(0, 8);

  const teamTotals = sumAggregates(employeeRows);

  return {
    ...teamTotals,
    period,
    source,
    declarability: teamTotals.declarability,
    employeeFilters,
    employeeRows,
    internalRows,
    weekRows,
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date())
  };
}

function addWorkingHoursToWeeks(weekMap: Map<string, WeekRow>, workingHours: WorkingHoursSummary, period: Period) {
  for (const [date, amount] of workingHours.byDate) {
    const weekRow = weekMap.get(weekKeyForDate(date, period));
    if (weekRow) {
      weekRow.total += amount;
    }
  }
}

function createMinimumWorkingHours(period: Period): WorkingHoursSummary {
  const byDate = new Map<string, number>();
  datesInPeriod(period).forEach((date) => {
    const day = parseDateKey(date)?.getDay();
    if (day !== 0 && day !== 6) {
      byDate.set(date, NORMAL_DAILY_HOURS);
    }
  });

  return {
    total: sumValues(byDate),
    byDate
  };
}

function revenueForHour(
  hour: JsonRecord,
  amount: number,
  revenuePrices: RevenuePriceSources,
  usageByLine: Map<string, number>,
  fixedHoursByLine: Map<string, number>
) {
  const source = revenueLineForHour(hour, revenuePrices);
  if (!source || source.line.invoiceBasis === "NONBILLABLE") {
    return 0;
  }

  if (source.line.invoiceBasis === "FIXED") {
    const spentAmount = Math.max(source.line.spentAmount ?? 0, fixedHoursByLine.get(source.key) ?? 0);
    return spentAmount > 0 ? (source.line.netSellingPrice / spentAmount) * amount : 0;
  }

  const consumed = usageByLine.get(source.key) ?? 0;
  usageByLine.set(source.key, consumed + amount);
  const billableAmount = source.line.maxAmount === null ? amount : cappedLineAmount(amount, consumed, source.line.maxAmount);
  return billableAmount * source.line.netSellingPrice;
}

function revenueLineForHour(hour: JsonRecord, revenuePrices: RevenuePriceSources) {
  const offerProjectLineId = relationId(hour, "offerprojectline");
  const offerProjectLine = offerProjectLineId !== null ? revenuePrices.offerProjectLines.get(offerProjectLineId) : undefined;
  if (offerProjectLine && ["FIXED", "NONBILLABLE"].includes(offerProjectLine.invoiceBasis)) {
    return { key: `offerprojectline:${offerProjectLineId}`, line: offerProjectLine };
  }

  const invoiceLineId = relationId(hour, "invoiceline");
  const invoiceLine = invoiceLineId !== null ? revenuePrices.invoiceLines.get(invoiceLineId) : undefined;
  if (invoiceLine) {
    return { key: `invoiceline:${invoiceLineId}`, line: invoiceLine };
  }

  if (offerProjectLine) {
    return { key: `offerprojectline:${offerProjectLineId}`, line: offerProjectLine };
  }

  return null;
}

function cappedLineAmount(amount: number, consumed: number, maxAmount: number) {
  return Math.max(0, Math.min(amount, maxAmount - consumed));
}

function fixedFeeHoursByLine(hours: JsonRecord[], revenuePrices: RevenuePriceSources) {
  const totals = new Map<string, number>();

  for (const hour of hours) {
    if (relationId(hour, "offerprojectbase") === INTERNAL_OFFERPROJECTBASE_ID) {
      continue;
    }

    const source = revenueLineForHour(hour, revenuePrices);
    if (source?.line.invoiceBasis !== "FIXED") {
      continue;
    }

    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (amount > 0) {
      totals.set(source.key, (totals.get(source.key) ?? 0) + amount);
    }
  }

  return totals;
}

function needsFixedFeeFallbackHours(hours: JsonRecord[], revenuePrices: RevenuePriceSources) {
  return hours.some((hour) => {
    const source = revenueLineForHour(hour, revenuePrices);
    return source?.line.invoiceBasis === "FIXED" && (source.line.spentAmount ?? 0) <= 0;
  });
}

function revenueLineFromRecord(line: JsonRecord): RevenueLine {
  const sellingPrice = Math.max(0, numberFrom(readField(line, "sellingprice")) ?? 0);
  const discount = Math.max(0, Math.min(100, numberFrom(readField(line, "discount")) ?? 0));
  const amount = numberFrom(readField(line, "amount"));
  const spentAmount = numberFrom(readField(line, "amountwritten"));

  return {
    invoiceBasis: stringFrom(readField(line, "invoicebasis"))?.toUpperCase() ?? "COSTING",
    maxAmount: amount !== null && amount > 0 ? amount : null,
    netSellingPrice: sellingPrice * (1 - discount / 100),
    spentAmount: spentAmount !== null && spentAmount > 0 ? spentAmount : null
  };
}

function getEmployeeSelection(employees: JsonRecord[], params: DashboardSearchParams) {
  const employeeById = new Map<string, JsonRecord>();
  employees.forEach((employee) => {
    const id = employeeFilterId(employee);
    if (id) {
      employeeById.set(id, employee);
    }
  });

  const submitted = firstParam(params.employeeFilter) === "1";
  const includedIds = submitted
    ? new Set(paramValues(params.include).filter((id) => employeeById.has(id)))
    : new Set(Array.from(employeeById.entries()).filter(([, employee]) => !isDefaultExcludedDashboardEmployee(employee)).map(([id]) => id));
  const options = Array.from(employeeById.entries())
    .map(([id, employee]) => ({
      id,
      name: employeeName(undefined, employee),
      included: includedIds.has(id)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "nl"));
  const includedEmployees = Array.from(employeeById.entries())
    .filter(([id]) => includedIds.has(id))
    .map(([, employee]) => employee);

  return {
    includedEmployees,
    options
  };
}

function employeeIdsFromEmployees(employees: JsonRecord[]) {
  return employees.map((employee) => idFrom(readField(employee, "id"))).filter((id): id is number => id !== null);
}

function filterHoursByEmployeeIds(hours: JsonRecord[], employeeIds: number[]) {
  const allowedEmployeeIds = new Set(employeeIds);
  return hours.filter((hour) => {
    const employeeId = relationId(hour, "employee");
    return employeeId !== null && allowedEmployeeIds.has(employeeId);
  });
}

function employeeFilterId(employee: JsonRecord) {
  const id = idFrom(readField(employee, "id"));
  return id === null ? null : String(id);
}

function employeeName(hour: JsonRecord | undefined, employee: JsonRecord | undefined) {
  const relation = asRecord(readField(hour, "employee"));
  const record = relation ?? employee;
  const firstName = stringFrom(readField(record, "firstname"));
  const infix = stringFrom(readField(record, "infix"));
  const lastName = stringFrom(readField(record, "lastname"));
  const fullName = [firstName, infix, lastName].filter(Boolean).join(" ");

  return (
    stringFrom(readField(record, "screenname")) ||
    fullName ||
    stringFrom(readField(record, "searchname")) ||
    stringFrom(readField(record, "displayvalue")) ||
    stringFrom(readField(record, "email")) ||
    "Onbekende medewerker"
  );
}

function isDefaultExcludedDashboardEmployee(employee: JsonRecord) {
  const nameValues = [
    employeeName(undefined, employee),
    stringFrom(readField(employee, "firstname")),
    stringFrom(readField(employee, "screenname")),
    stringFrom(readField(employee, "searchname")),
    stringFrom(readField(employee, "displayvalue")),
    stringFrom(readField(employee, "email"))
  ];

  return nameValues.some((value) => nameTokens(value).some((token) => DEFAULT_EXCLUDED_DASHBOARD_EMPLOYEE_NAMES.has(token)));
}

function nameTokens(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function finalizeAggregate<T extends Aggregate>(aggregate: T) {
  return withDeclarability({
    ...aggregate,
    untracked: Math.max(0, aggregate.total - aggregate.written),
    overtime: Math.max(0, aggregate.written - aggregate.total)
  });
}

function sumAggregates(aggregates: Aggregate[]) {
  const total = emptyAggregate();
  for (const aggregate of aggregates) {
    total.declarable += aggregate.declarable;
    total.internal += aggregate.internal;
    total.revenue += aggregate.revenue;
    total.untracked += aggregate.untracked;
    total.overtime += aggregate.overtime;
    total.total += aggregate.total;
    total.written += aggregate.written;
  }
  return withDeclarability(total);
}

function withDeclarability<T extends Aggregate>(aggregate: T) {
  return {
    ...aggregate,
    declarability: percent(aggregate.declarable, aggregate.total)
  };
}

function emptyAggregate(): Aggregate {
  return {
    declarable: 0,
    internal: 0,
    revenue: 0,
    untracked: 0,
    overtime: 0,
    total: 0,
    written: 0
  };
}

function getCurrentMonthPeriod(): Period {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const label = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(start);
  const shortMonth = new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(start);

  return {
    start: dateKey(start),
    end: dateKey(end),
    label,
    shortMonth,
    weekBuckets: makeWeekBuckets(start, end, shortMonth),
    isCustom: false
  };
}

function getPeriodFromParams(params: DashboardSearchParams): Period {
  const start = firstParam(params.start);
  const end = firstParam(params.end);
  if (!isDateKey(start) || !isDateKey(end)) {
    return getCurrentMonthPeriod();
  }

  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  if (!startDate || !endDate || startDate > endDate) {
    return getCurrentMonthPeriod();
  }

  const label = `${formatDate(start)} - ${formatDate(end)}`;
  const shortMonth = new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(startDate);

  return {
    start,
    end,
    label,
    shortMonth,
    weekBuckets: makeWeekBuckets(startDate, endDate, shortMonth),
    isCustom: true
  };
}

function periodFromHours(hours: JsonRecord[]): Period {
  const dates = hours
    .map((hour) => dateKeyFromValue(readField(hour, "date")))
    .filter((value): value is string => isDateKey(value))
    .sort();

  if (dates.length === 0) {
    return getCurrentMonthPeriod();
  }

  const start = dates[0];
  const end = dates[dates.length - 1];
  const startDate = parseDateKey(start) ?? new Date();
  const endDate = parseDateKey(end) ?? startDate;
  const shortMonth = new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(startDate);

  return {
    start,
    end,
    label: `Laatste uren: ${formatDate(start)} - ${formatDate(end)}`,
    shortMonth,
    weekBuckets: makeWeekBuckets(startDate, endDate, shortMonth),
    isCustom: false
  };
}

function makeWeekBuckets(startDate: Date, endDate: Date, shortMonth: string) {
  const buckets: WeekBucket[] = [];
  const periodStart = startOfDay(startDate);
  const stop = startOfDay(endDate);
  const cursor = startOfIsoWeek(periodStart);

  while (cursor <= stop) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);
    bucketEnd.setDate(bucketEnd.getDate() + 6);
    const labelStart = bucketStart < periodStart ? periodStart : bucketStart;
    const labelEnd = bucketEnd > stop ? stop : bucketEnd;

    const key = dateKey(bucketStart);
    const label = formatWeekBucketLabel(labelStart, labelEnd, shortMonth);
    buckets.push({
      key,
      label
    });
    cursor.setDate(cursor.getDate() + 7);
  }

  return buckets;
}

function formatWeekBucketLabel(startDate: Date, endDate: Date, fallbackMonth: string) {
  if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
    const month = new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(startDate) || fallbackMonth;
    return `${startDate.getDate()}-${endDate.getDate()} ${month}`;
  }

  return `${formatShortDate(dateKey(startDate))} - ${formatShortDate(dateKey(endDate))}`;
}

function startOfIsoWeek(date: Date) {
  const start = startOfDay(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function startOfDay(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function weekKeyForDate(value: string | undefined, period: Period) {
  const normalizedValue = dateKeyFromValue(value);
  const date = normalizedValue ? parseDateKey(normalizedValue) : null;
  if (!date) {
    return period.weekBuckets[0]?.key ?? period.start;
  }

  for (const bucket of period.weekBuckets) {
    const bucketStart = parseDateKey(bucket.key);
    if (!bucketStart) {
      continue;
    }
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketEnd.getDate() + 6);
    if (date >= bucketStart && date <= bucketEnd) {
      return bucket.key;
    }
  }

  return period.weekBuckets[0]?.key ?? period.start;
}

function datesInPeriod(period: Period) {
  const start = parseDateKey(period.start);
  const end = parseDateKey(period.end);
  if (!start || !end) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromValue(value: unknown) {
  const rawValue = stringFrom(value);
  if (!rawValue) {
    return undefined;
  }

  const dateKeyMatch = rawValue.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isDateKey(dateKeyMatch)) {
    return dateKeyMatch;
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? undefined : dateKey(parsed);
}

function createDemoEmployees(): JsonRecord[] {
  return [
    { id: 1, screenname: "Noor de Vries", active: true },
    { id: 2, screenname: "Milan Jansen", active: true },
    { id: 3, screenname: "Jasmijn Bakker", active: true },
    { id: 4, screenname: "Daan Smit", active: true }
  ];
}

function createDemoHours(period: Period): JsonRecord[] {
  const days = [2, 4, 7, 9, 12, 15, 18, 21, 23, 26, 28];
  return days.flatMap((day, index) => {
    const date = `${period.start.slice(0, 8)}${String(day).padStart(2, "0")}`;
    const firstIsInternal = index % 5 === 0;
    const secondIsInternal = index % 3 === 0;
    return [
      {
        id: index * 3 + 1,
        date,
        amount: 5.5 + (index % 3),
        employee: (index % 4) + 1,
        offerprojectbase: firstIsInternal ? INTERNAL_OFFERPROJECTBASE_ID : 120 + index,
        offerprojectline: firstIsInternal ? null : 1000 + index,
        status: index % 4 === 0 ? "AUTHORIZED" : "DEFINITIVE"
      },
      {
        id: index * 3 + 2,
        date,
        amount: 2 + (index % 2),
        employee: ((index + 1) % 4) + 1,
        offerprojectbase: secondIsInternal ? INTERNAL_OFFERPROJECTBASE_ID : 220 + index,
        offerprojectline: secondIsInternal ? null : 2000 + index,
        status: index % 3 === 0 ? "CONCEPT" : "DEFINITIVE"
      }
    ];
  });
}

function createDemoRevenuePrices(hours: JsonRecord[]): RevenuePriceSources {
  const offerProjectLines = new Map<number, RevenueLine>();
  const spentHoursByLine = new Map<number, number>();

  for (const hour of hours) {
    const offerProjectLineId = relationId(hour, "offerprojectline");
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (offerProjectLineId !== null && amount > 0) {
      spentHoursByLine.set(offerProjectLineId, (spentHoursByLine.get(offerProjectLineId) ?? 0) + amount);
    }
  }

  uniqueRelationIds(hours, "offerprojectline").forEach((id, index) => {
    const fixedFee = index % 4 === 0;
    offerProjectLines.set(id, {
      invoiceBasis: fixedFee ? "FIXED" : "COSTING",
      maxAmount: [6, 8, 10, 12][index % 4],
      netSellingPrice: fixedFee ? [850, 1250, 1650][index % 3] : [95, 110, 125, 140][index % 4],
      spentAmount: fixedFee ? spentHoursByLine.get(id) ?? null : null
    });
  });

  return {
    invoiceLines: new Map(),
    offerProjectLines
  };
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
    const nested = record[key];
    const nestedRecords = asRecords(nested as JsonValue);
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
    record[`employee.${field}`] ??
    record[`project.${field}`];
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
    idFrom(record[`employee.${field}.id`]) ??
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
  const id = record
    ? numberFrom(record.id ?? record.value ?? record.rawValue ?? record.rawvalue ?? record.key ?? readField(record, "id"))
    : null;
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

function booleanFrom(value: unknown): boolean | undefined {
  const scalar = scalarFrom(value);
  if (typeof scalar === "boolean") {
    return scalar;
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
  return ["id", "amount", "date", "searchname", "screenname", "offerprojectbase"].some((field) => readField(record, field) !== undefined);
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

function sumValues(values: Map<string, number>) {
  return Array.from(values.values()).reduce((total, value) => total + value, 0);
}

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function cappedPercent(value: number, total: number) {
  return Math.max(0, Math.min(100, percent(value, total)));
}

function formatHours(value: number) {
  return hoursFormatter.format(value);
}

function formatOvertimeLabel(value: number) {
  return `${formatHours(value)} overuren`;
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function paramValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function isDateKey(value: string | undefined): value is string {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/) && parseDateKey(value));
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
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

function formatShortDate(value: string) {
  const date = parseDateKey(value);
  return date
    ? new Intl.DateTimeFormat("nl-NL", {
        day: "2-digit",
        month: "short"
      }).format(date)
    : value;
}

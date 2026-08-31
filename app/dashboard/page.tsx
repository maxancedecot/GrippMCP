import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";
import { smoothAreaPath, smoothLinePath, type ChartPoint } from "../chart-paths.js";
import { DashboardFrame } from "../dashboard-frame.js";

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

type RevenueBucket = {
  key: string;
  label: string;
  revenue: number;
};

type DashboardData = Aggregate & {
  period: Period;
  source: DashboardSource;
  declarability: number;
  employeeFilters: EmployeeFilterOption[];
  employeeRows: EmployeeRow[];
  internalRows: EmployeeRow[];
  revenueMonthRows: RevenueBucket[];
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

type BillabilitySources = {
  offerProjectLineInvoiceBasis: Map<number, string>;
};

type RevenueSummary = {
  total: number;
  byWeek: Map<string, number>;
  byMonth: Map<string, number>;
};

type DashboardTab = "declarability" | "revenue";

const INTERNAL_OFFERPROJECTBASE_ID = 318;
const INTERNAL_PROJECT_LABEL = "Ledoux intern";
const NORMAL_DAILY_HOURS = 8;
const REVENUE_INVOICE_MAX_PAGES = 40;
const REVENUE_SERIES_LABEL = "Verkoopfacturen";
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
  const activeTab = getDashboardTab(params);
  const requestedPeriod = getPeriodFromParams(params);
  const dashboard = await getDashboardData(requestedPeriod, params, activeTab);
  const gaugeProgress = Math.max(0, Math.min(dashboard.declarability, 100));

  return (
    <DashboardFrame>
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Gripp uren</p>
            <h1>{activeTab === "revenue" ? "Omzet" : "Declarabiliteit"}</h1>
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

      <nav className="dashboard-tabs" aria-label="Dashboard tabs">
        <a className={`dashboard-tab ${activeTab === "declarability" ? "dashboard-tab--active" : ""}`} href={dashboardTabHref(params, "declarability")} aria-current={activeTab === "declarability" ? "page" : undefined}>
          Declarabiliteit
        </a>
        <a className={`dashboard-tab ${activeTab === "revenue" ? "dashboard-tab--active" : ""}`} href={dashboardTabHref(params, "revenue")} aria-current={activeTab === "revenue" ? "page" : undefined}>
          Omzet
        </a>
      </nav>

      <form className="period-form" action="/dashboard">
        {activeTab === "revenue" ? (
          <>
            <input type="hidden" name="tab" value="revenue" />
            {firstParam(params.employeeFilter) === "1" ? <input type="hidden" name="employeeFilter" value="1" /> : null}
            {paramValues(params.include).map((employeeId) => (
              <input key={employeeId} type="hidden" name="include" value={employeeId} />
            ))}
          </>
        ) : (
          <input type="hidden" name="employeeFilter" value="1" />
        )}
        <label>
          Van
          <input type="date" name="start" defaultValue={dashboard.period.start} />
        </label>
        <label>
          Tot
          <input type="date" name="end" defaultValue={dashboard.period.end} />
        </label>
        <button type="submit">Periode laden</button>
        {activeTab === "declarability" && dashboard.employeeFilters.length > 0 ? (
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

      {activeTab === "declarability" ? (
        <>
          <section className="metric-grid" aria-label="Kerncijfers declarabiliteit">
            <MetricCard label="Declarabiliteit" value={`${formatPercent(dashboard.declarability)}%`} detail="Declarabele uren / geschreven uren" tone="good" />
            <MetricCard label="Declarabele uren" value={formatHours(dashboard.declarable)} detail="Uren op declarabele opdrachtregels" tone="blue" />
            <MetricCard label="Overuren" value={formatHours(dashboard.overtime)} detail="Geschreven boven 8u per werkdag vanaf startdatum" tone="overtime" />
            <MetricCard label={INTERNAL_PROJECT_LABEL} value={formatHours(dashboard.internal)} detail={`Project ${INTERNAL_OFFERPROJECTBASE_ID}`} tone="warning" />
          </section>

          <section className="dashboard-grid dashboard-grid--single">
            <article className="panel panel--distribution">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Uren</p>
                  <h2>Declarabiliteit</h2>
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
                  <LegendItem label="Niet declarabel" value={Math.max(0, dashboard.written - dashboard.declarable)} className="legend-dot--neutral" />
                  <LegendItem label={INTERNAL_PROJECT_LABEL} value={dashboard.internal} className="legend-dot--warning" />
                  <LegendItem label="Overuren" value={dashboard.overtime} className="legend-dot--overtime" formatter={formatOvertimeLabel} />
                </dl>
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
                <p className="eyebrow">Berekening</p>
                <h2>Declarabiliteit</h2>
              </div>
              <span className="panel-total">Declarabele opdrachtregels / geschreven uren</span>
            </div>

            <div className="project-line-list">
              <div className="project-line-row">
                <div>
                  <span className="row-title">Teller</span>
                  <span className="cell-muted">
                    Uren op opdrachtregels met een declarabele facturatiebasis
                  </span>
                </div>
                <div className="project-line-metrics">
                  <span>{formatHours(dashboard.declarable)} uur</span>
                </div>
              </div>
              <div className="project-line-row">
                <div>
                  <span className="row-title">Overuren</span>
                  <span className="cell-muted">Totaal geschreven min 8u per werkdag vanaf startdatum medewerker</span>
                </div>
                <div className="project-line-metrics">
                  <span>{formatHours(dashboard.overtime)} uur</span>
                </div>
              </div>
              <div className="project-line-row">
                <div>
                  <span className="row-title">Noemer</span>
                  <span className="cell-muted">Alle geschreven uren</span>
                </div>
                <div className="project-line-metrics">
                  <span>{formatHours(dashboard.written)} uur</span>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="dashboard-grid dashboard-grid--single">
          <article className="panel">
            <div className="panel-heading panel-heading--revenue">
              <div>
                <p className="eyebrow">Omzet draaitabel</p>
                <h2>Omzet per maand</h2>
              </div>
              <div className="panel-actions">
                <span className="panel-total">{formatCurrency(dashboard.revenue)}</span>
              </div>
            </div>

            <RevenueLineChart rows={dashboard.revenueMonthRows} />
          </article>
        </section>
      )}
      </main>
    </DashboardFrame>
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
      <InternalBar aggregate={aggregate} />
      <span className="cell-muted">{formatOvertimeLabel(aggregate.overtime)}</span>
    </div>
  );
}

function RevenueLineChart({ rows }: { rows: RevenueBucket[] }) {
  const width = Math.max(720, rows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const rawMaximum = Math.max(0, ...rows.map((row) => row.revenue));
  const minimum = Math.min(0, ...rows.map((row) => row.revenue));
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const chartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenue) }));
  const linePath = smoothLinePath(chartPoints);
  const areaPath = smoothAreaPath(chartPoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "dashboard-revenue-line-gradient";

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot" />{REVENUE_SERIES_LABEL}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Omzet per maand: ${rows.map((row) => `${row.label} ${REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)}`).join(", ")}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="revenue-line-gradient-start" offset="0%" />
            <stop className="revenue-line-gradient-end" offset="100%" />
          </linearGradient>
        </defs>
        <rect className="revenue-line-plot-bg" x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="6" />
        {gridTicks.map((tick) => (
          <g key={tick.key}>
            <line className="revenue-line-grid" x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
            <text className="revenue-line-y-label" x={padding.left - 12} y={tick.y + 4} textAnchor="end">
              {formatCurrency(tick.value)}
            </text>
          </g>
        ))}
        <line className="revenue-line-axis" x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} />
        {rows.length > 1 ? <path className="revenue-line-area" d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path" d={linePath} /> : null}
        {rows.map((row, index) => {
          const { x, y } = chartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const valueY = y < padding.top + 24 ? y + 22 : y - 12;

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)}`}</title>
              <circle className="revenue-line-point" cx={x} cy={y} r="4" />
              <text className="revenue-line-value" x={x} y={valueY} textAnchor={anchor}>{formatCurrency(row.revenue)}</text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function InlineBar({ aggregate }: { aggregate: Aggregate }) {
  const denominator = Math.max(aggregate.written, 1);
  const declarableWidth = cappedPercent(aggregate.declarable, denominator);
  const nonDeclarableWidth = Math.max(0, 100 - declarableWidth);

  return (
    <div className="inline-bar" aria-hidden="true">
      <span className="bar-segment bar-segment--good" style={{ width: `${declarableWidth}%` }} />
      <span className="bar-segment bar-segment--neutral" style={{ width: `${nonDeclarableWidth}%` }} />
    </div>
  );
}

function InternalBar({ aggregate }: { aggregate: Aggregate }) {
  const denominator = Math.max(aggregate.written, 1);
  const internalWidth = cappedPercent(aggregate.internal, denominator);
  const externalWidth = Math.max(0, 100 - internalWidth);

  return (
    <div className="inline-bar" aria-hidden="true">
      <span className="bar-segment bar-segment--warning" style={{ width: `${internalWidth}%` }} />
      <span className="bar-segment bar-segment--neutral" style={{ width: `${externalWidth}%` }} />
    </div>
  );
}

async function getDashboardData(period: Period, params: DashboardSearchParams, activeTab: DashboardTab): Promise<DashboardData> {
  if (!process.env.GRIPP_API_TOKEN) {
    const allEmployees = createDemoEmployees();
    const employeeSelection = getEmployeeSelection(allEmployees, params);
    const employeeIds = employeeIdsFromEmployees(employeeSelection.includedEmployees);
    const demoHours = createDemoHours(period);
    const hours = filterHoursByEmployeeIds(demoHours, employeeIds);
    const revenueSummary = activeTab === "revenue" ? buildRevenueSummary(createDemoInvoices(period), period) : emptyRevenueSummary();
    return buildDashboardData(hours, employeeSelection.includedEmployees, period, {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-uren te tonen."
    }, employeeSelection.options, revenueSummary, createDemoBillabilitySources(demoHours));
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
    let hours = activeTab === "declarability" && employeeIds.length > 0 ? await fetchHoursForPeriod(client, period, employeeIds) : [];

    if (activeTab === "declarability" && employeeIds.length > 0 && hours.length === 0 && !period.isCustom) {
      const latestHours = await fetchLatestHours(client, employeeIds);
      if (latestHours.length > 0) {
        effectivePeriod = periodFromHours(latestHours);
        hours = await fetchHoursForPeriod(client, effectivePeriod, employeeIds);
        source.message = `Geen uren gevonden tussen ${formatDate(period.start)} en ${formatDate(
          period.end
        )}; toont nu ${formatDate(effectivePeriod.start)} tot ${formatDate(effectivePeriod.end)}.`;
      }
    }

    const revenueSummary = activeTab === "revenue"
      ? buildRevenueSummary(await fetchInvoicesForPeriod(client, effectivePeriod), effectivePeriod)
      : emptyRevenueSummary();
    const billabilitySources = activeTab === "declarability"
      ? await fetchBillabilitySources(client, hours)
      : emptyBillabilitySources();
    const dashboard = buildDashboardData(
      hours,
      employeeSelection.includedEmployees,
      effectivePeriod,
      source,
      employeeSelection.options,
      revenueSummary,
      billabilitySources
    );

    if (activeTab === "declarability" && employeeIds.length === 0) {
      dashboard.source.message = "Geen medewerkers gevonden voor dit dashboard.";
    } else if (activeTab === "declarability" && hours.length === 0) {
      dashboard.source.message = `Geen uren gevonden tussen ${formatDate(effectivePeriod.start)} en ${formatDate(effectivePeriod.end)}.`;
    }

    return dashboard;
  } catch (error) {
    const allEmployees = createDemoEmployees();
    const employeeSelection = getEmployeeSelection(allEmployees, params);
    const employeeIds = employeeIdsFromEmployees(employeeSelection.includedEmployees);
    const demoHours = createDemoHours(period);
    const hours = filterHoursByEmployeeIds(demoHours, employeeIds);
    const revenueSummary = activeTab === "revenue" ? buildRevenueSummary(createDemoInvoices(period), period) : emptyRevenueSummary();
    return buildDashboardData(hours, employeeSelection.includedEmployees, period, {
      mode: "demo",
      message: `Live data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    }, employeeSelection.options, revenueSummary, createDemoBillabilitySources(demoHours));
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

async function fetchHoursForPeriod(client: GrippClient, period: Period, employeeIds: number[], maxPages?: number) {
  return fetchHourPages(client, hourFilters(period, employeeIds), [{ field: "hour.date", direction: "asc" }], maxPages);
}

async function fetchBillabilitySources(client: GrippClient, hours: JsonRecord[]): Promise<BillabilitySources> {
  const invoiceBases = new Map<number, string>();
  const offerProjectLineIds = uniqueRelationIds(hours, "offerprojectline");

  for (let index = 0; index < offerProjectLineIds.length; index += 100) {
    const idChunk = offerProjectLineIds.slice(index, index + 100);
    const result = await client.call("offerprojectline.get", [
      [{ field: "offerprojectline.id", operator: "in", value: idChunk }],
      {
        paging: { firstresult: 0, maxresults: 250 },
        orderings: [{ field: "offerprojectline.id", direction: "asc" }]
      }
    ] as JsonValue[]);

    for (const offerProjectLine of asRecords(result)) {
      const id = idFrom(readField(offerProjectLine, "id"));
      const invoiceBasis = stringFrom(readField(offerProjectLine, "invoicebasis"))?.toUpperCase();
      if (id !== null && invoiceBasis) {
        invoiceBases.set(id, invoiceBasis);
      }
    }
  }

  return { offerProjectLineInvoiceBasis: invoiceBases };
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

function isDeclarableHour(hour: JsonRecord, billabilitySources: BillabilitySources) {
  const offerProjectLineId = relationId(hour, "offerprojectline");
  const invoiceBasis = offerProjectLineId === null
    ? undefined
    : billabilitySources.offerProjectLineInvoiceBasis.get(offerProjectLineId);

  if (invoiceBasis) {
    return invoiceBasis !== "NONBILLABLE";
  }

  return relationId(hour, "offerprojectbase") !== INTERNAL_OFFERPROJECTBASE_ID;
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

async function fetchInvoicesForPeriod(client: GrippClient, period: Period) {
  const pageSize = 250;
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "invoice.reportdate", operator: "greaterequals", value: period.start },
    { field: "invoice.reportdate", operator: "lessequals", value: period.end }
  ];

  for (let page = 0; page < REVENUE_INVOICE_MAX_PAGES; page += 1) {
    const result = await client.call("invoice.get", [
      filters,
      {
        paging: { firstresult: page * pageSize, maxresults: pageSize },
        orderings: [{ field: "invoice.reportdate", direction: "asc" }]
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
  revenueSummary: RevenueSummary,
  billabilitySources: BillabilitySources
): DashboardData {
  const employeesById = new Map<number, JsonRecord>();
  const employeeMap = new Map<string, EmployeeRow>();
  const weekMap = new Map<string, WeekRow>(
    period.weekBuckets.map((bucket) => [bucket.key, withDeclarability({ ...emptyAggregate(), key: bucket.key, label: bucket.label })])
  );
  const assignMinimumHours = (employeeRow: EmployeeRow, employee?: JsonRecord) => {
    const minimumWorkingHours = createMinimumWorkingHours(period, employeeStartDate(employee));
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

    assignMinimumHours(employeeRow, employee);
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
      const hourEmployee = asRecord(readField(hour, "employee"));
      const employee = employeeId !== null ? employeesById.get(employeeId) : undefined;
      employeeRow = withDeclarability({
        ...emptyAggregate(),
        id: employeeKey,
        name: employeeName(hour, employee)
      });
      assignMinimumHours(employeeRow, employee ?? hourEmployee);
      employeeMap.set(employeeKey, employeeRow);
    }
    const weekKey = weekKeyForDate(hourDate, period);
    const weekRow = weekMap.get(weekKey);
    const isInternal = relationId(hour, "offerprojectbase") === INTERNAL_OFFERPROJECTBASE_ID;
    const isDeclarable = isDeclarableHour(hour, billabilitySources);

    if (isDeclarable) {
      employeeRow.declarable += amount;
    }
    if (isInternal) {
      employeeRow.internal += amount;
    }
    employeeRow.written += amount;
    employeeMap.set(employeeKey, employeeRow);

    if (weekRow) {
      if (isDeclarable) {
        weekRow.declarable += amount;
      }
      if (isInternal) {
        weekRow.internal += amount;
      }
      weekRow.written += amount;
    }
  }

  const employeeRows = Array.from(employeeMap.values())
    .map(finalizeAggregate)
    .sort((left, right) => right.total - left.total || right.written - left.written);

  addRevenueToWeeks(weekMap, revenueSummary.byWeek);
  const weekRows = Array.from(weekMap.values()).map(finalizeAggregate);
  const revenueMonthRows = createRevenueMonthRows(period, revenueSummary.byMonth);
  const internalRows = employeeRows
    .filter((row) => row.internal > 0)
    .sort((left, right) => right.internal - left.internal)
    .slice(0, 8);

  const teamTotals = {
    ...sumAggregates(employeeRows),
    revenue: revenueSummary.total
  };

  return {
    ...teamTotals,
    period,
    source,
    declarability: teamTotals.declarability,
    employeeFilters,
    employeeRows,
    internalRows,
    revenueMonthRows,
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

function addRevenueToWeeks(weekMap: Map<string, WeekRow>, revenueByWeek: Map<string, number>) {
  for (const [weekKey, revenue] of revenueByWeek) {
    const weekRow = weekMap.get(weekKey);
    if (weekRow) {
      weekRow.revenue += revenue;
    }
  }
}

function createRevenueMonthRows(period: Period, revenueByMonth: Map<string, number>): RevenueBucket[] {
  return makeMonthBuckets(period).map((bucket) => ({
    ...bucket,
    revenue: revenueByMonth.get(bucket.key) ?? 0
  }));
}

function createMinimumWorkingHours(period: Period, employeeSince?: string): WorkingHoursSummary {
  const byDate = new Map<string, number>();
  const minimumStart = employeeSince && employeeSince > period.start ? employeeSince : period.start;

  datesInPeriod(period).forEach((date) => {
    if (date < minimumStart) {
      return;
    }

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

function employeeStartDate(employee: JsonRecord | undefined) {
  return dateKeyFromValue(readField(employee, "employeesince")) ?? dateKeyFromValue(readField(employee, "startdate"));
}

function buildRevenueSummary(invoices: JsonRecord[], period: Period): RevenueSummary {
  const byWeek = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let total = 0;

  for (const invoice of invoices) {
    const weekKey = weekKeyForDateInPeriod(readField(invoice, "reportdate"), period);
    const monthKey = monthKeyForDateInPeriod(readField(invoice, "reportdate"), period);
    if (!weekKey || !monthKey) {
      continue;
    }

    const amount = numberFrom(readField(invoice, "totalincldiscountexclvat")) ?? 0;
    if (amount === 0) {
      continue;
    }

    total += amount;
    byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + amount);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount);
  }

  return {
    total,
    byWeek,
    byMonth
  };
}

function emptyRevenueSummary(): RevenueSummary {
  return {
    total: 0,
    byWeek: new Map(),
    byMonth: new Map()
  };
}

function emptyBillabilitySources(): BillabilitySources {
  return { offerProjectLineInvoiceBasis: new Map() };
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
    declarability: percent(aggregate.declarable, aggregate.written)
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

function getDashboardTab(params: DashboardSearchParams): DashboardTab {
  return firstParam(params.tab) === "revenue" ? "revenue" : "declarability";
}

function dashboardTabHref(params: DashboardSearchParams, tab: DashboardTab) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || key === "revenueView") {
      continue;
    }

    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  if (tab === "revenue") {
    search.set("tab", "revenue");
  }

  const query = search.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
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

function makeMonthBuckets(period: Period) {
  const start = parseDateKey(period.start);
  const end = parseDateKey(period.end);
  if (!start || !end) {
    return [];
  }

  const buckets: WeekBucket[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const stop = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= stop) {
    buckets.push({
      key: monthKey(cursor),
      label: formatMonthBucketLabel(cursor)
    });
    cursor.setMonth(cursor.getMonth() + 1);
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

function formatMonthBucketLabel(date: Date) {
  return new Intl.DateTimeFormat("nl-NL", { month: "short", year: "numeric" }).format(date);
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
  return weekKeyForDateInPeriod(value, period) ?? period.weekBuckets[0]?.key ?? period.start;
}

function weekKeyForDateInPeriod(value: unknown, period: Period) {
  const normalizedValue = dateKeyFromValue(value);
  const date = normalizedValue ? parseDateKey(normalizedValue) : null;
  const periodStart = parseDateKey(period.start);
  const periodEnd = parseDateKey(period.end);
  if (!date || !periodStart || !periodEnd || date < periodStart || date > periodEnd) {
    return null;
  }

  return weekKeyForParsedDate(date, period);
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

function weekKeyForParsedDate(date: Date, period: Period) {
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

  return null;
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

function monthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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

function createDemoEmployees(): JsonRecord[] {
  return [
    { id: 1, screenname: "Noor de Vries", active: true },
    { id: 2, screenname: "Milan Jansen", active: true },
    { id: 3, screenname: "Jasmijn Bakker", active: true },
    { id: 4, screenname: "Daan Smit", active: true }
  ];
}

function createDemoHours(period: Period): JsonRecord[] {
  return demoDatesInPeriod(period, 11).flatMap((date, index) => {
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

function createDemoBillabilitySources(hours: JsonRecord[]): BillabilitySources {
  const offerProjectLineInvoiceBasis = new Map<number, string>();

  uniqueRelationIds(hours, "offerprojectline").forEach((id, index) => {
    offerProjectLineInvoiceBasis.set(id, index % 6 === 0 ? "NONBILLABLE" : "COSTING");
  });

  return { offerProjectLineInvoiceBasis };
}

function demoDatesInPeriod(period: Period, count: number) {
  const periodDates = datesInPeriod(period);
  const workingDates = periodDates.filter((date) => {
    const day = parseDateKey(date)?.getDay();
    return day !== 0 && day !== 6;
  });
  const sourceDates = workingDates.length > 0 ? workingDates : periodDates;

  if (sourceDates.length <= count) {
    return sourceDates;
  }

  return Array.from(
    new Set(
      Array.from({ length: count }, (_, index) => {
        const sourceIndex = Math.round((index * (sourceDates.length - 1)) / Math.max(1, count - 1));
        return sourceDates[sourceIndex];
      })
    )
  );
}

function createDemoInvoices(period: Period): JsonRecord[] {
  const workingDates = datesInPeriod(period).filter((date) => {
    const day = parseDateKey(date)?.getDay();
    return day !== 0 && day !== 6;
  });

  return workingDates
    .filter((_, index) => index % 5 === 2)
    .map((reportdate, index) => ({
      id: 9_000 + index,
      reportdate,
      totalincldiscountexclvat: [1850, 2400, 3250, 1450, 2800][index % 5]
    }));
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

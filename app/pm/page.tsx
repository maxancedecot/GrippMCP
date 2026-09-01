import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";
import { smoothAreaPath, smoothLinePath, type ChartPoint } from "../chart-paths.js";
import { DashboardFrame } from "../dashboard-frame.js";

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
  hasPositiveUnitPrice: boolean;
};

type BillabilitySources = {
  offerProjectLines: Map<number, LineBillability>;
  taskOfferProjectLineIds: Map<number, number>;
};

type CapacitySources = {
  employees: JsonRecord[];
  workingHoursByEmployeeId: Map<number, number>;
  leaveHoursFromWorkingHoursByEmployeeId: Map<number, number>;
  paidOvertimeHoursByEmployeeId: Map<number, number>;
  absenceRequestLines: JsonRecord[];
  absenceRequestsById: Map<number, JsonRecord>;
};

type WorkingHoursCapacity = {
  workingHoursByEmployeeId: Map<number, number>;
  leaveHoursByEmployeeId: Map<number, number>;
};

type PmEmployeeScope = {
  employees: JsonRecord[];
  excludedEmployeeIds: Set<number>;
  excludedEmployeeCount: number;
};

type CapacitySummary = {
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  employeeCount: number;
  fallbackWorkingHoursEmployeeCount: number;
};

type CalendarItemHoursSummary = {
  hours: number;
};

type EmployeeCapacityRow = {
  employeeId: number;
  name: string;
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  paidOvertimeHours: number;
  usedWorkingHoursFallback: boolean;
};

type EmployeeBillabilityRow = EmployeeCapacityRow & {
  loggedHours: number;
  billableHours: number;
  unbillableLoggedHours: number;
  capacityRemainingHours: number;
  calendarItemHours: number;
  planningWithoutTaskHours: number;
  billability: number;
};

type MonthRevenue = {
  key: string;
  label: string;
  revenue: number;
};

type MonthRevenuePerBillableHour = MonthRevenue & {
  billableHours: number;
  revenuePerBillableHour: number;
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
  calendarItemHours: number;
  billability: number;
  revenuePerCalendarItemHour: number;
  revenuePerBillableHour: number;
  invoiceCount: number;
  hourCount: number;
  employeeCount: number;
  excludedEmployeeCount: number;
  fallbackWorkingHoursEmployeeCount: number;
  employeeBillability: EmployeeBillabilityRow[];
  revenueByMonth: MonthRevenue[];
  revenuePerBillableHourByMonth: MonthRevenuePerBillableHour[];
  lastUpdated: string;
};

const PAGE_SIZE = 250;
const MAX_INVOICE_PAGES = 80;
const MAX_HOUR_PAGES = 160;
const MAX_EMPLOYEE_PAGES = 20;
const MAX_ABSENCE_LINE_PAGES = 80;
const MAX_CALENDAR_ITEM_PAGES = 160;
const INVOICE_REVENUE_SERIES_LABEL = "Verkoopfacturen";
const REVENUE_PER_BILLABLE_HOUR_GOAL = 135;
const WORKING_HOURS_BATCH_SIZE = 25;
const DEFAULT_WEEKLY_CONTRACT_HOURS = 40;
const REST_TONE_MAX_HOURS = 160;
const EXCLUDED_PM_ROLE_NAMES = ["beheerder", "admin", "administrator"];
const FORCED_BILLABLE_TASK_IDS = new Set([2844]);

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

  return (
    <DashboardFrame>
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
        <MetricCard href="#pm-revenue-detail" label="Omzet dit jaar" value={formatCurrency(dashboard.revenue)} detail="Verkoopfacturen, excl. btw netto" tone="good" />
        <MetricCard href="#pm-billability-detail" label="Billableheid" value={`${formatPercent(dashboard.billability)}%`} detail={`${formatHours(dashboard.billableHours)} / ${formatHours(dashboard.availableHours)} beschikbare uren`} tone="blue" />
        <MetricCard label="Omzet / agenda-uur" value={formatCurrencyPerHour(dashboard.revenuePerCalendarItemHour)} detail="Omzet gedeeld door agenda-uren zonder beheerder" tone="neutral" />
        <MetricCard href="#pm-revenue-per-billable-hour-detail" label="Omzet / billable uur" value={formatCurrencyPerHour(dashboard.revenuePerBillableHour)} detail="Omzet gedeeld door billable uren" tone="warning" />
      </section>

      <section className="panel pm-detail-panel" id="pm-billability-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Medewerkers</p>
            <h2>Billableheid per medewerker</h2>
          </div>
          <span className="panel-total">{formatEmployeeCount(dashboard.employeeBillability.length)}</span>
        </div>

        {dashboard.employeeBillability.length > 0 ? (
          <div className="pm-employee-table-wrap">
            <table className="pm-employee-table">
              <thead>
                <tr>
                  <th scope="col">Medewerker</th>
                  <th scope="col">Billableheid</th>
                  <th scope="col">Billable</th>
                  <th scope="col">Beschikbaar</th>
                  <th scope="col">Agenda-uren</th>
                  <th scope="col">Betaalde overuren</th>
                  <th scope="col">Agenda niet geassigned</th>
                  <th scope="col">Verlof</th>
                  <th scope="col">Rest</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.employeeBillability.map((employee) => (
                  <tr key={employee.employeeId}>
                    <th scope="row">
                      <span className="pm-employee-name">
                        <strong>{employee.name}</strong>
                        <span>{employee.usedWorkingHoursFallback ? "40u/week fallback" : "Gripp werktijden"}</span>
                      </span>
                    </th>
                    <td className="pm-employee-percent">
                      <strong>{formatPercent(employee.billability)}%</strong>
                      <span className="pm-employee-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(0, Math.min(employee.billability, 100))}%` }} />
                      </span>
                    </td>
                    <td>{formatHours(employee.billableHours)}</td>
                    <td>{formatHours(employee.availableHours)}</td>
                    <td>{formatHours(employee.calendarItemHours)}</td>
                    <td>{formatHours(employee.paidOvertimeHours)}</td>
                    <td>{formatHours(employee.planningWithoutTaskHours)}</td>
                    <td>{formatHours(employee.leaveHours)}</td>
                    <td className={restCellClassName(employee.capacityRemainingHours)} style={restCellStyle(employee.capacityRemainingHours)}>
                      {formatHours(employee.capacityRemainingHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Geen medewerkers beschikbaar.</p>
        )}
      </section>

      <section className="panel pm-detail-panel" id="pm-revenue-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Omzet</p>
            <h2>Per maand</h2>
          </div>
          <div className="panel-actions">
            <span className="panel-total panel-total--invoice">{INVOICE_REVENUE_SERIES_LABEL} {formatCurrency(dashboard.revenue)}</span>
          </div>
        </div>

        <RevenueLineChart rows={dashboard.revenueByMonth} />
      </section>

      <section className="panel pm-detail-panel" id="pm-revenue-per-billable-hour-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Rendement</p>
            <h2>Omzet / billable uur per maand</h2>
          </div>
          <div className="panel-actions">
            <span className="panel-total panel-total--goal">Doel {formatCurrencyPerHour(REVENUE_PER_BILLABLE_HOUR_GOAL)}</span>
          </div>
        </div>

        <RevenuePerBillableHourLineChart rows={dashboard.revenuePerBillableHourByMonth} goal={REVENUE_PER_BILLABLE_HOUR_GOAL} />
      </section>
      </main>
    </DashboardFrame>
  );
}

function MetricCard({
  href,
  label,
  value,
  detail,
  tone
}: {
  href?: string;
  label: string;
  value: string;
  detail: string;
  tone: "good" | "blue" | "warning" | "neutral";
}) {
  const className = `metric-card metric-card--${tone}${href ? " metric-card--link" : ""}`;
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href}>
        {content}
      </a>
    );
  }

  return (
    <article className={className}>
      {content}
    </article>
  );
}

function RevenueLineChart({ rows }: { rows: MonthRevenue[] }) {
  const width = Math.max(720, rows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = rows.map((row) => row.revenue);
  const rawMaximum = Math.max(0, ...values);
  const minimum = Math.min(0, ...values);
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const chartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenue) }));
  const invoiceLinePath = smoothLinePath(chartPoints);
  const invoiceAreaPath = smoothAreaPath(chartPoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "pm-revenue-line-gradient";

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--invoice" />{INVOICE_REVENUE_SERIES_LABEL}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Omzet per maand: ${rows.map((row) => `${row.label} ${INVOICE_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)}`).join(", ")}`}
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
        {rows.length > 1 ? <path className="revenue-line-area revenue-line-area--invoice" d={invoiceAreaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--invoice" d={invoiceLinePath} /> : null}
        {rows.map((row, index) => {
          const { x, y: invoiceY } = chartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const valueY = invoiceY < padding.top + 24 ? invoiceY + 22 : invoiceY - 12;

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${INVOICE_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)}`}</title>
              <circle className="revenue-line-point revenue-line-point--invoice" cx={x} cy={invoiceY} r="4" />
              <text className="revenue-line-value revenue-line-value--invoice" x={x} y={valueY} textAnchor={anchor}>{formatCurrency(row.revenue)}</text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RevenuePerBillableHourLineChart({ rows, goal }: { rows: MonthRevenuePerBillableHour[]; goal: number }) {
  const width = Math.max(720, rows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = rows.map((row) => row.revenuePerBillableHour);
  const rawMaximum = Math.max(goal, 0, ...values);
  const minimum = Math.min(0, ...values);
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum * 1.12;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const chartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenuePerBillableHour) }));
  const linePath = smoothLinePath(chartPoints);
  const areaPath = smoothAreaPath(chartPoints, yFor(0));
  const goalY = yFor(goal);
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "pm-revenue-per-billable-hour-gradient";

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot" />Omzet / billable uur</span>
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--goal" />Doel {formatCurrencyPerHour(goal)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Omzet per billable uur per maand met doel ${formatCurrencyPerHour(goal)}: ${rows
          .map((row) => `${row.label} ${formatCurrencyPerHour(row.revenuePerBillableHour)} bij ${formatHours(row.billableHours)} billable uren`)
          .join(", ")}`}
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
              {formatCurrencyPerHour(tick.value)}
            </text>
          </g>
        ))}
        <line className="revenue-line-axis" x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} />
        <line className="revenue-line-goal" x1={padding.left} x2={width - padding.right} y1={goalY} y2={goalY} />
        <text className="revenue-line-goal-label" x={width - padding.right} y={goalY - 8} textAnchor="end">
          Doel {formatCurrencyPerHour(goal)}
        </text>
        {rows.length > 1 ? <path className="revenue-line-area" d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path" d={linePath} /> : null}
        {rows.map((row, index) => {
          const { x, y } = chartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const valueY = y < padding.top + 24 ? y + 22 : y - 12;

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${formatCurrencyPerHour(row.revenuePerBillableHour)} uit ${formatCurrency(row.revenue)} en ${formatHours(row.billableHours)} billable uren`}</title>
              <circle className="revenue-line-point" cx={x} cy={y} r="4" />
              <text className="revenue-line-value" x={x} y={valueY} textAnchor={anchor}>{formatCurrencyPerHour(row.revenuePerBillableHour)}</text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

async function getPmDashboardData(): Promise<PmDashboardData> {
  const period = getYearToDatePeriod();

  if (!process.env.GRIPP_API_TOKEN) {
    return buildDemoPmDashboardData(period, {
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
    const [employees, absenceRequestLines, calendarItems] = await Promise.all([
      optionalData(issues, "medewerkers", [], () => fetchEmployees(client)),
      optionalData(issues, "verlofmutaties", [], () => fetchAbsenceRequestLinesForPeriod(client, period)),
      optionalData(issues, "planning", [], () => fetchCalendarItemsForPeriod(client, period))
    ]);
    const employeeScope = buildPmEmployeeScope(employees);
    const scopedHours = hoursForEmployeeScope(hours, employeeScope);
    const scopedCalendarItems = calendarItemsForEmployeeScope(calendarItems, employeeScope);
    const absenceRequestsById = await optionalData(issues, "verlofaanvragen", new Map<number, JsonRecord>(), () =>
      fetchAbsenceRequestsById(client, absenceRequestLines)
    );
    const scopedAbsenceRequestLines = absenceRequestLinesForEmployeeScope(absenceRequestLines, absenceRequestsById, employeeScope);
    const paidOvertimeHoursByEmployeeId = buildPaidOvertimeHoursByEmployeeId(scopedAbsenceRequestLines, absenceRequestsById, period);
    const billabilitySources = await fetchBillabilitySources(client, scopedHours, issues);
    const workingHoursCapacity = await optionalData(issues, "werktijden", emptyWorkingHoursCapacity(), () =>
      fetchWorkingHoursForEmployees(client, employeeScope.employees, scopedHours, scopedAbsenceRequestLines, absenceRequestsById, period)
    );

    return buildPmDashboardData(
      invoices,
      scopedHours,
      billabilitySources,
      {
        employees: employeeScope.employees,
        workingHoursByEmployeeId: workingHoursCapacity.workingHoursByEmployeeId,
        leaveHoursFromWorkingHoursByEmployeeId: workingHoursCapacity.leaveHoursByEmployeeId,
        paidOvertimeHoursByEmployeeId: numberMapForEmployeeScope(paidOvertimeHoursByEmployeeId, employeeScope),
        absenceRequestLines: scopedAbsenceRequestLines,
        absenceRequestsById
      },
      period,
      {
        mode: "live",
        message: liveSourceMessage(issues)
      },
      employeeScope.excludedEmployeeCount,
      scopedCalendarItems
    );
  } catch (error) {
    return buildDemoPmDashboardData(period, {
      mode: "demo",
      message: `Live PM-data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    });
  }
}

function buildDemoPmDashboardData(period: Period, source: DashboardSource) {
  const demoHours = createDemoHours(period);
  const capacitySources = createDemoCapacitySources(period);
  const employeeScope = buildPmEmployeeScope(capacitySources.employees);
  const scopedHours = hoursForEmployeeScope(demoHours, employeeScope);
  const scopedCalendarItems = calendarItemsForEmployeeScope(createDemoCalendarItems(period), employeeScope);
  const scopedCapacitySources = capacitySourcesForEmployeeScope(capacitySources, employeeScope);
  const billabilitySources = createDemoBillabilitySources(scopedHours);

  return buildPmDashboardData(
    createDemoInvoices(period),
    scopedHours,
    billabilitySources,
    scopedCapacitySources,
    period,
    source,
    employeeScope.excludedEmployeeCount,
    scopedCalendarItems
  );
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

function emptyBillabilitySources(): BillabilitySources {
  return {
    offerProjectLines: new Map<number, LineBillability>(),
    taskOfferProjectLineIds: new Map<number, number>()
  };
}

function buildPmEmployeeScope(employees: JsonRecord[]): PmEmployeeScope {
  const excludedRoleIds = excludedPmRoleIds();
  const excludedEmployeeIds = new Set<number>();
  const scopedEmployees: JsonRecord[] = [];
  let excludedEmployeeCount = 0;

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (employeeHasExcludedPmRole(employee, excludedRoleIds)) {
      excludedEmployeeCount += 1;
      if (employeeId !== null) {
        excludedEmployeeIds.add(employeeId);
      }
      continue;
    }

    scopedEmployees.push(employee);
  }

  return {
    employees: scopedEmployees,
    excludedEmployeeIds,
    excludedEmployeeCount
  };
}

function hoursForEmployeeScope(hours: JsonRecord[], employeeScope: PmEmployeeScope) {
  if (employeeScope.excludedEmployeeIds.size === 0) {
    return hours;
  }

  return hours.filter((hour) => {
    const employeeId = relationId(hour, "employee");
    return employeeId === null || !employeeScope.excludedEmployeeIds.has(employeeId);
  });
}

function absenceRequestLinesForEmployeeScope(
  absenceRequestLines: JsonRecord[],
  absenceRequestsById: Map<number, JsonRecord>,
  employeeScope: PmEmployeeScope
) {
  if (employeeScope.excludedEmployeeIds.size === 0) {
    return absenceRequestLines;
  }

  return absenceRequestLines.filter((line) => {
    const absenceRequestId = relationId(line, "absencerequest");
    const absenceRequest = absenceRequestId === null ? undefined : absenceRequestsById.get(absenceRequestId);
    const employeeId = relationId(absenceRequest ?? line, "employee");
    return employeeId === null || !employeeScope.excludedEmployeeIds.has(employeeId);
  });
}

function calendarItemsForEmployeeScope(calendarItems: JsonRecord[], employeeScope: PmEmployeeScope) {
  if (employeeScope.excludedEmployeeIds.size === 0) {
    return calendarItems;
  }

  return calendarItems.filter((calendarItem) => {
    const employeeId = relationId(calendarItem, "calendaritememployee") ?? relationId(calendarItem, "employee");
    return employeeId === null || !employeeScope.excludedEmployeeIds.has(employeeId);
  });
}

function capacitySourcesForEmployeeScope(capacitySources: CapacitySources, employeeScope: PmEmployeeScope): CapacitySources {
  const scopedAbsenceRequestLines = absenceRequestLinesForEmployeeScope(
    capacitySources.absenceRequestLines,
    capacitySources.absenceRequestsById,
    employeeScope
  );

  return {
    employees: employeeScope.employees,
    workingHoursByEmployeeId: numberMapForEmployeeScope(capacitySources.workingHoursByEmployeeId, employeeScope),
    leaveHoursFromWorkingHoursByEmployeeId: numberMapForEmployeeScope(capacitySources.leaveHoursFromWorkingHoursByEmployeeId, employeeScope),
    paidOvertimeHoursByEmployeeId: numberMapForEmployeeScope(capacitySources.paidOvertimeHoursByEmployeeId, employeeScope),
    absenceRequestLines: scopedAbsenceRequestLines,
    absenceRequestsById: capacitySources.absenceRequestsById
  };
}

function numberMapForEmployeeScope(source: Map<number, number>, employeeScope: PmEmployeeScope) {
  if (employeeScope.excludedEmployeeIds.size === 0) {
    return source;
  }

  return new Map(Array.from(source.entries()).filter(([employeeId]) => !employeeScope.excludedEmployeeIds.has(employeeId)));
}

function employeeHasExcludedPmRole(employee: JsonRecord, excludedRoleIds: Set<number>) {
  const roleId = relationId(employee, "role");
  if (roleId !== null && excludedRoleIds.has(roleId)) {
    return true;
  }

  return employeeRoleTextValues(employee).some((value) => isExcludedPmRoleName(value));
}

function excludedPmRoleIds() {
  return new Set(
    (process.env.PM_EXCLUDED_ROLE_IDS ?? process.env.GRIPP_PM_EXCLUDED_ROLE_IDS ?? "")
      .split(/[,\s;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value))
  );
}

function employeeRoleTextValues(employee: JsonRecord) {
  const values: string[] = [];
  const seen = new Set<unknown>();
  collectRoleTextValues(readField(employee, "role"), values, seen);

  for (const [key, value] of Object.entries(employee)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("role") && !normalizedKey.endsWith(".id") && normalizedKey !== "role.id") {
      collectRoleTextValues(value, values, seen);
    }
  }

  return values;
}

function collectRoleTextValues(value: unknown, values: string[], seen: Set<unknown>) {
  if (typeof value === "string") {
    values.push(value);
    return;
  }

  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);
  const record = asRecord(value);
  if (!record) {
    return;
  }

  for (const key of ["displayvalue", "displayValue", "label", "name", "searchname", "screenname", "value", "rawValue", "rawvalue"]) {
    const nestedValue = record[key];
    if (nestedValue !== undefined && nestedValue !== null) {
      collectRoleTextValues(nestedValue, values, seen);
    }
  }
}

function isExcludedPmRoleName(value: string) {
  const normalizedValue = normalizeComparisonValue(value);
  return EXCLUDED_PM_ROLE_NAMES.some((roleName) => {
    const normalizedRoleName = normalizeComparisonValue(roleName);
    return normalizedValue === normalizedRoleName || normalizedValue.includes(normalizedRoleName);
  });
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

async function fetchCalendarItemsForPeriod(client: GrippClient, period: Period) {
  const records: JsonRecord[] = [];
  const filters: JsonValue[] = [
    { field: "calendaritem.date", operator: "greaterequals", value: period.start },
    { field: "calendaritem.date", operator: "lessequals", value: period.end }
  ];

  for (let page = 0; page < MAX_CALENDAR_ITEM_PAGES; page += 1) {
    const result = await client.call("calendaritem.get", [
      filters,
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings: [{ field: "calendaritem.date", direction: "asc" }]
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
      const workingHoursWithoutAbsenceFlag = workingHoursTotalFromResult(results[chunkIndex * 2]);
      const workingHoursWithAbsenceFlag = workingHoursTotalFromResult(results[chunkIndex * 2 + 1]);
      const grossWorkingHours = Math.max(workingHoursWithoutAbsenceFlag, workingHoursWithAbsenceFlag);
      const absenceHours = Math.abs(workingHoursWithAbsenceFlag - workingHoursWithoutAbsenceFlag);
      workingHoursByEmployeeId.set(entry.employeeId, grossWorkingHours);
      leaveHoursByEmployeeId.set(entry.employeeId, absenceHours);
    });
  }

  return { workingHoursByEmployeeId, leaveHoursByEmployeeId };
}

async function fetchBillabilitySources(client: GrippClient, hours: JsonRecord[], issues: string[] = []): Promise<BillabilitySources> {
  const offerProjectLines = new Map<number, LineBillability>();
  const taskOfferProjectLineIds = new Map<number, number>();
  const directOfferProjectLineIds = uniqueRelationIds(hours, "offerprojectline");
  const taskIds = uniqueRelationIds(hours, "task");

  try {
    for (let index = 0; index < taskIds.length; index += 100) {
      const idChunk = taskIds.slice(index, index + 100);
      const result = await client.call("task.get", [
        [{ field: "task.id", operator: "in", value: idChunk }],
        {
          paging: { firstresult: 0, maxresults: PAGE_SIZE },
          orderings: [{ field: "task.id", direction: "asc" }]
        }
      ] as JsonValue[]);

      for (const task of asRecords(result)) {
        const taskId = idFrom(readField(task, "id"));
        const offerProjectLineId = relationId(task, "offerprojectline");
        if (taskId !== null && offerProjectLineId !== null) {
          taskOfferProjectLineIds.set(taskId, offerProjectLineId);
        }
      }
    }
  } catch (error) {
    issues.push(`taakkoppelingen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  try {
    const offerProjectLineIds = Array.from(new Set([...directOfferProjectLineIds, ...taskOfferProjectLineIds.values()]));
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
        if (id !== null) {
          offerProjectLines.set(id, lineBillabilityFromRecord(offerProjectLine));
        }
      }
    }
  } catch (error) {
    issues.push(`opdrachtregelprijzen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  return { offerProjectLines, taskOfferProjectLineIds };
}

async function fetchPagedRecords(
  client: GrippClient,
  entity: string,
  filters: JsonValue[],
  orderings: JsonValue[],
  maxPages: number
) {
  const records: JsonRecord[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const result = await client.call(`${entity}.get`, [
      filters,
      {
        paging: { firstresult: page * PAGE_SIZE, maxresults: PAGE_SIZE },
        orderings
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

function buildPmDashboardData(
  invoices: JsonRecord[],
  hours: JsonRecord[],
  billabilitySources: BillabilitySources,
  capacitySources: CapacitySources,
  period: Period,
  source: DashboardSource,
  excludedEmployeeCount = 0,
  calendarItems: JsonRecord[] = []
): PmDashboardData {
  let revenue = 0;
  let invoiceCount = 0;
  let loggedHours = 0;
  let billableHours = 0;
  let hourCount = 0;
  const revenueByMonth = new Map<string, number>();
  const billableHoursByMonth = new Map<string, number>();

  for (const invoice of invoices) {
    const revenueEntry = invoiceRevenueEntry(invoice, period);
    if (!revenueEntry) {
      continue;
    }

    revenue += revenueEntry.amount;
    invoiceCount += 1;
    revenueByMonth.set(revenueEntry.monthKey, (revenueByMonth.get(revenueEntry.monthKey) ?? 0) + revenueEntry.amount);
  }

  for (const hour of hours) {
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    const hourDate = dateKeyFromValue(readField(hour, "date"));
    if (amount === 0 || !hourDate) {
      continue;
    }

    loggedHours += amount;
    hourCount += 1;

    if (isBillableHour(hour, billabilitySources)) {
      billableHours += amount;
      const monthKey = monthKeyForDateInPeriod(hourDate, period);
      if (monthKey) {
        billableHoursByMonth.set(monthKey, (billableHoursByMonth.get(monthKey) ?? 0) + amount);
      }
    }
  }

  const employeeCapacityRows = buildEmployeeCapacityRows(capacitySources, hours, period);
  const capacity = buildCapacitySummary(employeeCapacityRows);
  const employeeBillability = buildEmployeeBillabilityRows(employeeCapacityRows, hours, billabilitySources, calendarItems, period);
  const capacityRemainingHours = employeeBillability.reduce((total, row) => total + row.capacityRemainingHours, 0);
  const calendarItemHours = employeeBillability.reduce((total, row) => total + row.calendarItemHours, 0);
  const monthBuckets = makeMonthBuckets(period);
  const revenueByMonthRows = monthBuckets.map((bucket) => ({
    ...bucket,
    revenue: revenueByMonth.get(bucket.key) ?? 0
  }));
  const revenuePerBillableHourByMonth = monthBuckets.map((bucket) => {
    const monthlyRevenue = revenueByMonth.get(bucket.key) ?? 0;
    const monthlyBillableHours = billableHoursByMonth.get(bucket.key) ?? 0;

    return {
      ...bucket,
      revenue: monthlyRevenue,
      billableHours: monthlyBillableHours,
      revenuePerBillableHour: divideCurrency(monthlyRevenue, monthlyBillableHours)
    };
  });

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
    capacityRemainingHours,
    calendarItemHours,
    billability: percent(billableHours, capacity.availableHours),
    revenuePerCalendarItemHour: divideCurrency(revenue, calendarItemHours),
    revenuePerBillableHour: divideCurrency(revenue, billableHours),
    invoiceCount,
    hourCount,
    employeeCount: capacity.employeeCount,
    excludedEmployeeCount,
    fallbackWorkingHoursEmployeeCount: capacity.fallbackWorkingHoursEmployeeCount,
    employeeBillability,
    revenueByMonth: revenueByMonthRows,
    revenuePerBillableHourByMonth,
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date())
  };
}

function lineBillabilityFromRecord(line: JsonRecord): LineBillability {
  const sellingPrice = Math.max(0, numberFrom(readField(line, "sellingprice")) ?? 0);

  return {
    hasPositiveUnitPrice: sellingPrice > 0
  };
}

function isBillableHour(hour: JsonRecord, billabilitySources: BillabilitySources) {
  const taskId = relationId(hour, "task");
  if (taskId !== null && FORCED_BILLABLE_TASK_IDS.has(taskId)) {
    return true;
  }

  const directOfferProjectLineId = relationId(hour, "offerprojectline");
  const directOfferProjectLine = directOfferProjectLineId === null ? undefined : billabilitySources.offerProjectLines.get(directOfferProjectLineId);
  if (directOfferProjectLine) {
    return directOfferProjectLine.hasPositiveUnitPrice;
  }

  const offerProjectLineId = taskId === null ? undefined : billabilitySources.taskOfferProjectLineIds.get(taskId);
  const offerProjectLine = offerProjectLineId === undefined ? undefined : billabilitySources.offerProjectLines.get(offerProjectLineId);
  return offerProjectLine?.hasPositiveUnitPrice === true;
}

function invoiceRevenueEntry(invoice: JsonRecord, period: Period) {
  if (stringFrom(readField(invoice, "status"))?.toUpperCase() === "CONCEPT") {
    return null;
  }

  const reportDate = dateKeyFromValue(readField(invoice, "reportdate"));
  const monthKey = monthKeyForDateInPeriod(reportDate, period);
  if (!monthKey) {
    return null;
  }

  const amount = numberFrom(readField(invoice, "totalincldiscountexclvat"));
  return amount === null ? null : { amount, monthKey };
}

function buildEmployeeCapacityRows(capacitySources: CapacitySources, hours: JsonRecord[], period: Period): EmployeeCapacityRow[] {
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
    ...Array.from(capacitySources.paidOvertimeHoursByEmployeeId.keys()),
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
  const rows: EmployeeCapacityRow[] = [];

  for (const { employeeId, employee } of employees) {
    const employeeStart = employeeStartDate(employee);
    const capacityStart = maxDateKey(period.start, employeeStart);
    if (capacityStart > period.end) {
      continue;
    }

    const workingHours = capacitySources.workingHoursByEmployeeId.get(employeeId);
    let contractHours = 0;
    let usedWorkingHoursFallback = false;
    if (workingHours === undefined) {
      contractHours += calculateDefaultContractHours(capacityStart, period.end);
      usedWorkingHoursFallback = true;
    } else {
      contractHours += Math.max(0, workingHours);
    }

    const leaveFromRequestLines = leaveHoursForEmployee(leaveByEmployeeId.get(employeeId) ?? [], capacityStart, period.end);
    const leaveFromWorkingHours = capacitySources.leaveHoursFromWorkingHoursByEmployeeId.get(employeeId) ?? 0;
    const leaveHours = Math.max(leaveFromRequestLines, leaveFromWorkingHours);
    const paidOvertimeHours = Math.max(0, capacitySources.paidOvertimeHoursByEmployeeId.get(employeeId) ?? 0);

    rows.push({
      employeeId,
      name: employeeDisplayName(employee, employeeId),
      contractHours,
      leaveHours,
      availableHours: Math.max(0, contractHours - leaveHours),
      paidOvertimeHours,
      usedWorkingHoursFallback
    });
  }

  return rows.sort(compareEmployeeCapacityRows);
}

function buildCapacitySummary(employeeCapacityRows: EmployeeCapacityRow[]): CapacitySummary {
  const contractHours = employeeCapacityRows.reduce((total, row) => total + row.contractHours, 0);
  const leaveHours = employeeCapacityRows.reduce((total, row) => total + row.leaveHours, 0);
  const availableHours = Math.max(0, contractHours - leaveHours);
  return {
    contractHours,
    leaveHours,
    availableHours,
    employeeCount: employeeCapacityRows.length,
    fallbackWorkingHoursEmployeeCount: employeeCapacityRows.filter((row) => row.usedWorkingHoursFallback).length
  };
}

function buildCalendarItemHoursByEmployeeId(calendarItems: JsonRecord[], period: Period, onlyWithoutTask = false) {
  const calendarItemHoursByEmployeeId = new Map<number, CalendarItemHoursSummary>();

  for (const calendarItem of calendarItems) {
    const date = dateKeyFromValue(readField(calendarItem, "date"));
    if (!date || date < period.start || date > period.end || (onlyWithoutTask && hasAssignedTask(calendarItem))) {
      continue;
    }

    const employeeId = relationId(calendarItem, "calendaritememployee") ?? relationId(calendarItem, "employee");
    if (employeeId === null) {
      continue;
    }

    const amount = Math.max(0, numberFrom(readField(calendarItem, "hours")) ?? 0);
    if (amount === 0) {
      continue;
    }

    const current = calendarItemHoursByEmployeeId.get(employeeId) ?? { hours: 0 };
    current.hours += amount;
    calendarItemHoursByEmployeeId.set(employeeId, current);
  }

  return calendarItemHoursByEmployeeId;
}

function hasAssignedTask(record: JsonRecord) {
  const taskId = relationId(record, "task");
  if (taskId !== null) {
    return taskId > 0;
  }

  const value = readField(record, "task");
  if (value === undefined || value === null) {
    return false;
  }

  const scalar = scalarFrom(value);
  if (typeof scalar === "number") {
    return scalar > 0;
  }
  if (typeof scalar === "string") {
    const trimmed = scalar.trim();
    return trimmed !== "" && trimmed !== "0";
  }
  if (typeof scalar === "boolean") {
    return scalar;
  }

  return true;
}

function buildEmployeeBillabilityRows(
  employeeCapacityRows: EmployeeCapacityRow[],
  hours: JsonRecord[],
  billabilitySources: BillabilitySources,
  calendarItems: JsonRecord[],
  period: Period
) {
  const loggedHoursByEmployeeId = new Map<number, number>();
  const billableHoursByEmployeeId = new Map<number, number>();
  const calendarItemHoursByEmployeeId = buildCalendarItemHoursByEmployeeId(calendarItems, period);
  const planningWithoutTaskByEmployeeId = buildCalendarItemHoursByEmployeeId(calendarItems, period, true);

  for (const hour of hours) {
    const employeeId = relationId(hour, "employee");
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (employeeId === null || amount === 0 || !dateKeyFromValue(readField(hour, "date"))) {
      continue;
    }

    loggedHoursByEmployeeId.set(employeeId, (loggedHoursByEmployeeId.get(employeeId) ?? 0) + amount);
    if (isBillableHour(hour, billabilitySources)) {
      billableHoursByEmployeeId.set(employeeId, (billableHoursByEmployeeId.get(employeeId) ?? 0) + amount);
    }
  }

  return employeeCapacityRows
    .map((row) => {
      const loggedHours = loggedHoursByEmployeeId.get(row.employeeId) ?? 0;
      const billableHours = billableHoursByEmployeeId.get(row.employeeId) ?? 0;
      const calendarItemHours = calendarItemHoursByEmployeeId.get(row.employeeId) ?? { hours: 0 };
      const planningWithoutTask = planningWithoutTaskByEmployeeId.get(row.employeeId) ?? { hours: 0 };

      return {
        ...row,
        loggedHours,
        billableHours,
        unbillableLoggedHours: Math.max(0, loggedHours - billableHours),
        capacityRemainingHours: row.availableHours - calendarItemHours.hours - row.paidOvertimeHours,
        calendarItemHours: calendarItemHours.hours,
        planningWithoutTaskHours: planningWithoutTask.hours,
        billability: percent(billableHours, row.availableHours)
      };
    })
    .sort(compareEmployeeBillabilityRows);
}

function compareEmployeeCapacityRows(left: EmployeeCapacityRow, right: EmployeeCapacityRow) {
  return left.name.localeCompare(right.name, "nl") || left.employeeId - right.employeeId;
}

function compareEmployeeBillabilityRows(left: EmployeeBillabilityRow, right: EmployeeBillabilityRow) {
  return right.billability - left.billability || right.billableHours - left.billableHours || compareEmployeeCapacityRows(left, right);
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
    if (isPaidOvertimeAbsenceLine(line, absenceRequest)) {
      continue;
    }

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

function buildPaidOvertimeHoursByEmployeeId(absenceRequestLines: JsonRecord[], absenceRequestsById: Map<number, JsonRecord>, period: Period) {
  const paidOvertimeHoursByEmployeeId = new Map<number, number>();

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
    if (!isPaidOvertimeAbsenceLine(line, absenceRequest)) {
      continue;
    }

    const employeeId = relationId(absenceRequest ?? line, "employee");
    if (employeeId === null) {
      continue;
    }

    const amount = Math.max(0, numberFrom(readField(line, "amount")) ?? 0);
    if (amount === 0) {
      continue;
    }

    paidOvertimeHoursByEmployeeId.set(employeeId, (paidOvertimeHoursByEmployeeId.get(employeeId) ?? 0) + amount);
  }

  return paidOvertimeHoursByEmployeeId;
}

function isPaidOvertimeAbsenceLine(line: JsonRecord, absenceRequest?: JsonRecord) {
  const text = [line, absenceRequest].flatMap((record) => (record ? recordTextValues(record) : [])).join(" ");
  const normalizedText = normalizeComparisonValue(text);
  return normalizedText.includes("opbouwoveruren") || (normalizedText.includes("opbouw") && normalizedText.includes("overuren"));
}

function recordTextValues(record: JsonRecord) {
  const values: string[] = [];
  collectTextValues(record, values, new Set<unknown>());
  return values;
}

function collectTextValues(value: unknown, values: string[], seen: Set<unknown>) {
  if (typeof value === "string") {
    values.push(value);
    return;
  }

  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextValues(item, values, seen));
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as JsonRecord)) {
    if (isIgnoredAbsenceTextKey(key)) {
      continue;
    }

    collectTextValues(nestedValue, values, seen);
  }
}

function isIgnoredAbsenceTextKey(key: string) {
  return ["id", "amount", "date", "startingtime", "createdon", "updatedon", "employee"].includes(key.toLowerCase().replace(/[._-]/g, ""));
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

function employeeDisplayName(employee: JsonRecord, employeeId: number) {
  const fullName = [stringFrom(readField(employee, "firstname")), stringFrom(readField(employee, "infix")), stringFrom(readField(employee, "lastname"))]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName =
    stringFrom(readField(employee, "screenname")) ??
    stringFrom(readField(employee, "searchname")) ??
    (fullName || undefined) ??
    stringFrom(readField(employee, "username")) ??
    stringFrom(readField(employee, "email"));

  return displayName ?? `Medewerker ${employeeId}`;
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
        .flatMap((record) => relationIds(record, field))
        .filter((id): id is number => id !== null)
    )
  );
}

function relationIds(record: JsonRecord, field: string) {
  const relation = readField(record, field);
  if (Array.isArray(relation)) {
    return relation.map(idFrom).filter((id): id is number => id !== null);
  }

  const id = relationId(record, field);
  return id === null ? [] : [id];
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
    record[`project.${field}`] ??
    record[`offerprojectline.${field}`] ??
    record[`contract.${field}`] ??
    record[`contractline.${field}`] ??
    record[`invoiceline.${field}`] ??
    record[`task.${field}`] ??
    record[`tag.${field}`] ??
    record[`employee.${field}`] ??
    record[`employmentcontract.${field}`] ??
    record[`absencerequestline.${field}`] ??
    record[`absencerequest.${field}`] ??
    record[`calendaritem.${field}`];
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
    idFrom(record[`project.${field}.id`]) ??
    idFrom(record[`offerprojectline.${field}.id`]) ??
    idFrom(record[`contract.${field}.id`]) ??
    idFrom(record[`contractline.${field}.id`]) ??
    idFrom(record[`task.${field}.id`]) ??
    idFrom(record[`tag.${field}.id`]) ??
    idFrom(record[`employee.${field}.id`]) ??
    idFrom(record[`employmentcontract.${field}.id`]) ??
    idFrom(record[`absencerequestline.${field}.id`]) ??
    idFrom(record[`absencerequest.${field}.id`]) ??
    idFrom(record[`calendaritem.${field}.id`]) ??
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
  return [
    "id",
    "amount",
    "hours",
    "date",
    "reportdate",
    "enddate",
    "searchname",
    "offerprojectline",
    "calendaritememployee",
    "totalincldiscountexclvat",
    "totalexclvat",
    "employee",
    "startdate",
    "contract",
    "frequency",
    "invoicebasis"
  ].some((field) => readField(record, field) !== undefined);
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

function normalizeComparisonValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function restCellClassName(value: number) {
  if (Math.abs(value) < 0.05) {
    return "pm-rest-cell pm-rest-cell--neutral";
  }

  return `pm-rest-cell ${value < 0 ? "pm-rest-cell--negative" : "pm-rest-cell--positive"}`;
}

function restCellStyle(value: number): CSSProperties | undefined {
  if (Math.abs(value) < 0.05) {
    return undefined;
  }

  const intensity = Math.min(1, Math.abs(value) / REST_TONE_MAX_HOURS);
  return { "--rest-color-weight": `${Math.round(35 + intensity * 45)}%` } as CSSProperties;
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

function formatEmployeeCount(value: number) {
  return `${value} werknemer${value === 1 ? "" : "s"}`;
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
      { id: index * 4 + 1, date: `${month}-05`, amount: 138 + (index % 3) * 4, employee: 1, task: 6000 + index * 4, offerprojectline: 1000 + index * 4 },
      { id: index * 4 + 2, date: `${month}-12`, amount: 126 + (index % 4) * 3, employee: 2, task: 6001 + index * 4, offerprojectline: 1001 + index * 4 },
      { id: index * 4 + 3, date: `${month}-19`, amount: 114 + (index % 2) * 5, employee: 3, task: 6002 + index * 4, offerprojectline: 1002 + index * 4 },
      { id: index * 4 + 4, date: `${month}-24`, amount: 32 + (index % 3) * 2, employee: 4, task: 6003 + index * 4, offerprojectline: 1003 + index * 4 }
    ];
  });
}

function createDemoCalendarItems(period: Period): JsonRecord[] {
  return makeMonthBuckets(period).flatMap((bucket, index) => {
    const month = bucket.key;
    return [
      { id: index * 3 + 7000, date: `${month}-06`, hours: 6 + (index % 3), calendaritememployee: 1, task: null },
      { id: index * 3 + 7001, date: `${month}-13`, hours: 4, calendaritememployee: 2, task: 8000 + index },
      { id: index * 3 + 7002, date: `${month}-20`, hours: 3, calendaritememployee: 4, task: null }
    ];
  });
}

function createDemoBillabilitySources(hours: JsonRecord[]): BillabilitySources {
  const offerProjectLines = new Map<number, LineBillability>();
  const taskOfferProjectLineIds = new Map<number, number>();

  uniqueRelationIds(hours, "offerprojectline").forEach((id, index) => {
    const sellingPrice = index % 5 === 4 ? 0 : 95 + (index % 4) * 10;
    offerProjectLines.set(id, {
      hasPositiveUnitPrice: sellingPrice > 0
    });
  });

  for (const hour of hours) {
    const taskId = relationId(hour, "task");
    const offerProjectLineId = relationId(hour, "offerprojectline");
    if (taskId !== null && offerProjectLineId !== null) {
      taskOfferProjectLineIds.set(taskId, offerProjectLineId);
    }
  }

  return { offerProjectLines, taskOfferProjectLineIds };
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
    { id: 1, screenname: "Noor de Vries", employeesince: `${period.year}-01-01`, active: true, role: { id: 2, searchname: "Medewerker" } },
    { id: 2, screenname: "Milan Jansen", employeesince: `${period.year}-02-01`, active: true, role: { id: 2, searchname: "Medewerker" } },
    { id: 3, screenname: "Jasmijn Bakker", employeesince: `${period.year}-01-15`, active: false, role: { id: 2, searchname: "Medewerker" } },
    { id: 4, screenname: "Daan Smit", employeesince: `${period.year}-03-01`, active: true, role: { id: 1, searchname: "Beheerder" } }
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
    paidOvertimeHoursByEmployeeId: new Map<number, number>([
      [1, 12],
      [2, 8],
      [3, 4]
    ]),
    absenceRequestLines,
    absenceRequestsById
  };
}

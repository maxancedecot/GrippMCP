import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation.js";
import type { GrippClient } from "../../src/grippClient.js";
import { signedGrippInvoiceRevenueAmount } from "../../src/grippInvoiceRevenue.js";
import { readJsonCache, writeJsonCache } from "../../src/jsonCache.js";
import { demoStripeCrmRevenue, fetchStripeCrmRevenueForPeriod, unavailableStripeCrmRevenue, type StripeCrmRevenue } from "../../src/stripeRevenue.js";
import type { JsonValue } from "../../src/types.js";
import { smoothAreaPath, smoothLinePath, type ChartPoint } from "../chart-paths.js";
import { createDashboardGrippClient, DASHBOARD_GRIPP_API_TOKEN_ENV, hasDashboardGrippApiToken } from "../dashboard-gripp.js";
import { DashboardFrame } from "../dashboard-frame.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "PM dashboard | Gripp",
  description: "Managementdashboard met omzet, billableheid en omzet per uur uit Gripp."
};

type JsonRecord = Record<string, unknown>;
type PmSearchParams = Record<string, string | string[] | undefined>;
type PmBillabilityView = "employees" | "monthly";
type PmRevenueView = "revenue" | "profit";
type PmEmployeeBillabilityPeriodPreset = "week" | "month" | "year" | "custom";

type Period = {
  start: string;
  end: string;
  year: string;
  label: string;
};

type EmployeeBillabilityPeriod = Period & {
  preset: PmEmployeeBillabilityPeriodPreset;
};

type DashboardSource = {
  mode: "live" | "cache" | "demo";
  message: string;
  noticeTone?: "success" | "warning" | "error";
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
  excludedEmployees: JsonRecord[];
  excludedEmployeeIds: Set<number>;
  excludedEmployeeCount: number;
};

type CapacitySummary = {
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  employeeCost: number;
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
  costPerHour: number | null;
  employeeCost: number | null;
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

type EmployeeBillabilityOverheadRow = EmployeeBillabilityRow & {
  employeeCount: number;
};

type EmployeeBillabilityOverheadSources = {
  capacitySources: CapacitySources;
};

type MonthRevenue = {
  key: string;
  label: string;
  revenue: number;
};

type MonthRevenuePerBillableHour = MonthRevenue & {
  billableHours: number;
  calendarItemHours: number;
  revenuePerBillableHour: number;
  revenuePerCalendarItemHour: number;
};

type MonthRevenueCostProfit = MonthRevenue & {
  employeeCost: number;
  profit: number;
};

type MonthBillability = {
  key: string;
  label: string;
  billableHours: number;
  availableHours: number;
  billability: number;
};

type BillabilitySummary = {
  billableHours: number;
  availableHours: number;
  employeeCost: number;
  missingCostPerHourCount: number;
  billability: number;
};

type PmDashboardData = {
  period: Period;
  employeeBillabilityPeriod: EmployeeBillabilityPeriod;
  employeeBillabilitySummary: BillabilitySummary;
  source: DashboardSource;
  revenue: number;
  crmRevenue: StripeCrmRevenue;
  loggedHours: number;
  billableHours: number;
  unbillableLoggedHours: number;
  contractHours: number;
  leaveHours: number;
  availableHours: number;
  employeeCost: number;
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
  employeeBillabilityOverhead: EmployeeBillabilityOverheadRow | null;
  billabilityByMonth: MonthBillability[];
  revenueByMonth: MonthRevenue[];
  agencyCostProfitByMonth: MonthRevenueCostProfit[];
  revenuePerBillableHourByMonth: MonthRevenuePerBillableHour[];
  lastUpdated: string;
};

type CachedPmDashboardData = {
  version: number;
  savedAt: string;
  dashboard: PmDashboardData;
};

type FreshPmDashboardData = {
  dashboard: PmDashboardData;
  issues: string[];
};

type PmCacheNotice = "refreshed" | "refresh_failed";

const PAGE_SIZE = 250;
const PAGE_FETCH_BATCH_SIZE = 8;
const MAX_INVOICE_PAGES = 80;
const MAX_HOUR_PAGES = 160;
const MAX_EMPLOYEE_PAGES = 20;
const MAX_ABSENCE_LINE_PAGES = 80;
const MAX_CALENDAR_ITEM_PAGES = 160;
const INVOICE_REVENUE_SERIES_LABEL = "Agency Omzet";
const CRM_REVENUE_SERIES_LABEL = "CRM omzet";
const AGENCY_REVENUE_WITH_CRM_SERIES_LABEL = "Agency Omzet incl. CRM";
const REVENUE_PER_BILLABLE_HOUR_GOAL = 135;
const WORKING_HOURS_BATCH_SIZE = 25;
const DEFAULT_WEEKLY_CONTRACT_HOURS = 40;
const OVERHEAD_DAILY_HOURS = 8;
const REST_TONE_MAX_HOURS = 160;
const EXCLUDED_PM_ROLE_NAMES = ["beheerder", "admin", "administrator", "facturen"];
const EMPLOYEE_ROLE_TEXT_FIELD_KEY_MARKERS = ["role", "rechtenprofiel", "rightsprofile", "accessprofile", "permissionprofile", "functie", "function"];
const OVERHEAD_EMPLOYEE_ID = -1;
const COUNTED_LEAVE_ABSENCE_STATUSES = new Set(["approved", "goedgekeurd", "pending", "inaanvraag", "aangevraagd"]);
const REJECTED_ABSENCE_STATUSES = new Set(["REJECTED", "rejected", "afgewezen", "geweigerd"]);
const DEFAULT_PAID_OVERTIME_ABSENCE_TYPE_NAMES = ["Aanwezigheid - Opbouw overuren", "Opbouw overuren"];
const PAID_OVERTIME_ABSENCE_TYPE_ID_ENV_NAMES = ["PM_PAID_OVERTIME_ABSENCE_TYPE_IDS", "GRIPP_PAID_OVERTIME_ABSENCE_TYPE_IDS"];
const PAID_OVERTIME_ABSENCE_TYPE_NAME_ENV_NAMES = ["PM_PAID_OVERTIME_ABSENCE_TYPE_NAMES", "GRIPP_PAID_OVERTIME_ABSENCE_TYPE_NAMES"];
const FORCED_BILLABLE_TASK_IDS = new Set([2844]);
const EMPLOYEE_COST_PER_HOUR_FIELD_NAME_ENV_NAMES = ["PM_EMPLOYEE_COST_PER_HOUR_FIELD_NAMES", "GRIPP_EMPLOYEE_COST_PER_HOUR_FIELD_NAMES"];
const EMPLOYEE_COST_PER_HOUR_CUSTOM_FIELD_ID_ENV_NAMES = [
  "PM_EMPLOYEE_COST_PER_HOUR_CUSTOM_FIELD_IDS",
  "GRIPP_EMPLOYEE_COST_PER_HOUR_CUSTOM_FIELD_IDS"
];
const EMPLOYEE_COST_PER_HOUR_FIELD_NAMES = [
  "customfield_internekostprijsperuur",
  "interne kostprijs per uur",
  "interne kostprijs van medewerker",
  "interne kostprijs medewerker",
  "internekostprijsperuur",
  "internekostprijsvanmedewerker",
  "internekostprijsmedewerker",
  "cost per medewerker per uur",
  "cost per employee per hour",
  "cost per medewerker",
  "cost per employee",
  "costpermedewerkerperuur",
  "costperemployeeperhour",
  "costpermedewerker",
  "costperemployee",
  "costperuur",
  "costperhour",
  "employee cost per hour",
  "employee hourly cost",
  "employeecostperhour",
  "employeehourlycost",
  "hourlycost",
  "kost per medewerker per uur",
  "kost per medewerker",
  "kost per uur",
  "kostpermedewerkerperuur",
  "kostpermedewerker",
  "kostperuur",
  "kostprijs per medewerker per uur",
  "kostprijs per uur",
  "kostprijspermedewerkerperuur",
  "kostprijsperuur",
  "medewerker uurkost",
  "medewerkeruurkost",
  "uurkost"
];
const EMPLOYEE_COST_PER_HOUR_FIELD_KEYS = new Set(EMPLOYEE_COST_PER_HOUR_FIELD_NAMES.map(normalizeComparisonValue));
const CUSTOM_FIELD_NAME_KEYS = new Set(
  [
    "name",
    "label",
    "title",
    "caption",
    "key",
    "code",
    "identifier",
    "customfield",
    "customField",
    "field",
    "fieldname",
    "fieldName",
    "displayname",
    "displayName",
    "searchname",
    "screenname"
  ].map(normalizeComparisonValue)
);
const CUSTOM_FIELD_VALUE_KEYS = new Set(
  ["value", "values", "rawValue", "rawvalue", "displayvalue", "displayValue", "amount", "number", "content", "data"].map(normalizeComparisonValue)
);
const CUSTOM_FIELD_RELATION_NAME_KEYS = new Set([...CUSTOM_FIELD_NAME_KEYS, "displayvalue", "displayValue"].map(normalizeComparisonValue));
const CUSTOM_FIELD_META_KEYS = new Set([...CUSTOM_FIELD_NAME_KEYS, "id", "type", "readonly", "required"].map(normalizeComparisonValue));
const PM_DASHBOARD_CACHE_VERSION = 16;
const LEGACY_PM_DASHBOARD_CACHE_VERSIONS = [15, 14, 13, 12, 11, 10, 9, 8];
const PM_CACHE_NOTICE_PARAM = "pmCacheNotice";
const PM_CACHE_ERROR_PARAM = "pmCacheError";
const PM_CACHE_REFRESH_ID_PARAM = "pmCacheRefresh";
const PM_DASHBOARD_TIME_ZONE = "Europe/Brussels";

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

export default async function PmDashboardPage({ searchParams }: { searchParams?: Promise<PmSearchParams> }) {
  const params = (await searchParams) ?? {};
  const billabilityView = getPmBillabilityView(params);
  const revenueView = getPmRevenueView(params);
  const employeeBillabilityPeriod = getEmployeeBillabilityPeriodFromParams(params);
  const cacheNotice = pmCacheNoticeFromParams(params);
  const cacheError = pmCacheErrorFromParams(params);
  const dashboard = await getPmDashboardData(employeeBillabilityPeriod, cacheNotice, cacheError);
  const canRefresh = hasDashboardGrippApiToken();
  const employeeBillabilityOverhead = dashboard.employeeBillabilityOverhead;
  const employeeBillabilityTableRows = employeeBillabilityOverhead
    ? [...dashboard.employeeBillability, employeeBillabilityOverhead]
    : dashboard.employeeBillability;
  const employeeBillabilityTotals = buildEmployeeBillabilityTableTotals(dashboard.employeeBillability, employeeBillabilityOverhead);
  const employeeBillabilityDisplayCount = dashboard.employeeBillability.length + (employeeBillabilityOverhead?.employeeCount ?? 0);
  const agencyCostProfitTotals = buildRevenueCostProfitTotals(dashboard.agencyCostProfitByMonth);

  return (
    <DashboardFrame>
      <main className="dashboard-shell pm-shell">
        <header className="dashboard-header">
          <div>
            <h1>PM dashboard</h1>
          </div>
          <div className="header-meta">
            <span className={`source-badge source-badge--${dashboard.source.mode}`}>
              {sourceBadgeLabel(dashboard.source.mode)}
            </span>
            <span>{dashboard.period.label}</span>
            <span>Bijgewerkt {dashboard.lastUpdated}</span>
            {canRefresh ? <PmDashboardRefreshForm params={params} /> : null}
          </div>
        </header>

      {dashboard.source.message ? <p className={dataNoticeClassName(dashboard.source)}>{dashboard.source.message}</p> : null}

      <section className="metric-grid pm-metric-grid" aria-label="Kerncijfers management">
        <MetricCard href="#pm-revenue-detail" label="Agency Omzet" value={formatCurrency(dashboard.revenue)} detail="Verkoopfacturen min creditnota's, excl. btw netto" tone="good" />
        <MetricCard href="#pm-revenue-detail" label="CRM omzet" value={formatCurrency(dashboard.crmRevenue.amount)} detail={crmRevenueMetricDetail(dashboard.crmRevenue)} tone="neutral" />
        <MetricCard href="#pm-billability-detail" label="Billableheid" value={`${formatPercent(dashboard.billability)}%`} detail={`${formatHours(dashboard.billableHours)} / ${formatHours(dashboard.availableHours)} beschikbare uren`} tone="blue" />
        <MetricCard label="Omzet / agenda-uur" value={formatCurrencyPerHour(dashboard.revenuePerCalendarItemHour)} detail="Agency Omzet gedeeld door agenda-uren zonder overhead" tone="neutral" />
        <MetricCard href="#pm-revenue-per-billable-hour-detail" label="Omzet / billable uur" value={formatCurrencyPerHour(dashboard.revenuePerBillableHour)} detail="Agency Omzet gedeeld door billable uren" tone="warning" />
      </section>

      <section className="panel pm-detail-panel" id="pm-billability-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Billableheid</p>
            <h2>{billabilityView === "monthly" ? "Billableheid per maand" : "Billableheid per medewerker"}</h2>
          </div>
          <div className="panel-actions">
            {billabilityView === "monthly" ? (
              <span className="panel-total">{formatPercent(dashboard.billability)}% dit jaar</span>
            ) : (
              <>
                <span className="panel-total panel-total--billability">{formatPercent(dashboard.employeeBillabilitySummary.billability)}%</span>
                <span className="panel-total">{dashboard.employeeBillabilityPeriod.label}</span>
                <span className="panel-total panel-total--cost">Kost o.b.v. interne kostprijs {formatCurrency(dashboard.employeeBillabilitySummary.employeeCost)}</span>
                {dashboard.employeeBillabilitySummary.missingCostPerHourCount > 0 ? (
                  <span className="panel-total panel-total--warning">Interne kostprijs ontbreekt: {formatEmployeeCount(dashboard.employeeBillabilitySummary.missingCostPerHourCount)}</span>
                ) : null}
                <span className="panel-total">{formatEmployeeCount(employeeBillabilityDisplayCount)}</span>
              </>
            )}
          </div>
        </div>

        <nav className="dashboard-tabs pm-panel-tabs" aria-label="Billableheid tabs">
          <a
            className={`dashboard-tab ${billabilityView === "employees" ? "dashboard-tab--active" : ""}`}
            href={pmBillabilityTabHref(params, "employees")}
            aria-current={billabilityView === "employees" ? "page" : undefined}
          >
            Per medewerker
          </a>
          <a
            className={`dashboard-tab ${billabilityView === "monthly" ? "dashboard-tab--active" : ""}`}
            href={pmBillabilityTabHref(params, "monthly")}
            aria-current={billabilityView === "monthly" ? "page" : undefined}
          >
            Per maand
          </a>
        </nav>

        {billabilityView === "monthly" ? (
          <BillabilityLineChart rows={dashboard.billabilityByMonth} />
        ) : employeeBillabilityTableRows.length > 0 ? (
          <>
            <EmployeeBillabilityPeriodControls params={params} period={dashboard.employeeBillabilityPeriod} />
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
                    <th scope="col">Interne kostprijs van medewerker</th>
                    <th scope="col">Kost</th>
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
                      <td>{formatOptionalCurrencyPerHour(employee.costPerHour)}</td>
                      <td>{formatOptionalCurrency(employee.employeeCost)}</td>
                      <td className={restCellClassName(employee.capacityRemainingHours)} style={restCellStyle(employee.capacityRemainingHours)}>
                        {formatHours(employee.capacityRemainingHours)}
                      </td>
                    </tr>
                  ))}
                  {employeeBillabilityOverhead ? (
                    <tr className="pm-employee-overhead-row" key="overhead">
                      <th scope="row">
                        <span className="pm-employee-name">
                          <strong>Overhead</strong>
                          <span>{formatOverheadEmployeeCount(employeeBillabilityOverhead.employeeCount)}, 8u/werkdag</span>
                        </span>
                      </th>
                      <td className="pm-employee-percent pm-employee-percent--muted">
                        <strong>-</strong>
                      </td>
                      <td className="pm-employee-na">-</td>
                      <td>{formatHours(employeeBillabilityOverhead.availableHours)}</td>
                      <td className="pm-employee-na">-</td>
                      <td className="pm-employee-na">-</td>
                      <td className="pm-employee-na">-</td>
                      <td className="pm-employee-na">-</td>
                      <td>{formatOptionalCurrencyPerHour(employeeBillabilityOverhead.costPerHour)}</td>
                      <td>{formatOptionalCurrency(employeeBillabilityOverhead.employeeCost)}</td>
                      <td className="pm-employee-na">-</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">
                      <span className="pm-employee-name">
                        <strong>Totaal</strong>
                        <span>{dashboard.employeeBillabilityPeriod.label}</span>
                      </span>
                    </th>
                    <td className="pm-employee-percent">
                      <strong>{formatPercent(employeeBillabilityTotals.billability)}%</strong>
                      <span className="pm-employee-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(0, Math.min(employeeBillabilityTotals.billability, 100))}%` }} />
                      </span>
                    </td>
                    <td>{formatHours(employeeBillabilityTotals.billableHours)}</td>
                    <td>{formatHours(employeeBillabilityTotals.availableHours)}</td>
                    <td>{formatHours(employeeBillabilityTotals.calendarItemHours)}</td>
                    <td>{formatHours(employeeBillabilityTotals.paidOvertimeHours)}</td>
                    <td>{formatHours(employeeBillabilityTotals.planningWithoutTaskHours)}</td>
                    <td>{formatHours(employeeBillabilityTotals.leaveHours)}</td>
                    <td>{formatOptionalCurrencyPerHour(employeeBillabilityTotals.costPerHour)}</td>
                    <td>{formatCurrency(employeeBillabilityTotals.employeeCost)}</td>
                    <td className={restCellClassName(employeeBillabilityTotals.capacityRemainingHours)} style={restCellStyle(employeeBillabilityTotals.capacityRemainingHours)}>
                      {formatHours(employeeBillabilityTotals.capacityRemainingHours)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <EmployeeBillabilityPeriodControls params={params} period={dashboard.employeeBillabilityPeriod} />
            <p className="empty-state">Geen medewerkers beschikbaar.</p>
          </>
        )}
      </section>

      <section className="panel pm-detail-panel" id="pm-revenue-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Omzet</p>
            <h2>{revenueView === "profit" ? "Kost & winst cumulatief" : "Per maand"}</h2>
          </div>
          <div className="panel-actions">
            {revenueView === "profit" ? (
              <>
                <span className="panel-total panel-total--invoice">{AGENCY_REVENUE_WITH_CRM_SERIES_LABEL} {formatCurrency(agencyCostProfitTotals.revenue)}</span>
                <span className="panel-total panel-total--cost">Kost {formatCurrency(agencyCostProfitTotals.employeeCost)}</span>
                <span className={`panel-total ${agencyCostProfitTotals.profit < 0 ? "panel-total--warning" : "panel-total--profit"}`}>
                  Winst {formatCurrency(agencyCostProfitTotals.profit)}
                </span>
              </>
            ) : (
              <>
                <span className="panel-total panel-total--invoice">{INVOICE_REVENUE_SERIES_LABEL} {formatCurrency(dashboard.revenue)}</span>
                <span className="panel-total panel-total--crm">{CRM_REVENUE_SERIES_LABEL} {formatCurrency(dashboard.crmRevenue.amount)}</span>
              </>
            )}
          </div>
        </div>

        <nav className="dashboard-tabs pm-panel-tabs" aria-label="Agency omzet tabs">
          <a
            className={`dashboard-tab ${revenueView === "revenue" ? "dashboard-tab--active" : ""}`}
            href={pmRevenueTabHref(params, "revenue")}
            aria-current={revenueView === "revenue" ? "page" : undefined}
          >
            Omzet
          </a>
          <a
            className={`dashboard-tab ${revenueView === "profit" ? "dashboard-tab--active" : ""}`}
            href={pmRevenueTabHref(params, "profit")}
            aria-current={revenueView === "profit" ? "page" : undefined}
          >
            Kost & winst
          </a>
        </nav>

        {revenueView === "profit" ? (
          <RevenueCostProfitLineChart rows={dashboard.agencyCostProfitByMonth} />
        ) : (
          <RevenueLineChart rows={dashboard.revenueByMonth} crmRows={dashboard.crmRevenue.byMonth} />
        )}
      </section>

      <section className="panel pm-detail-panel" id="pm-revenue-per-billable-hour-detail" tabIndex={-1}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Rendement</p>
            <h2>Omzet / uur per maand</h2>
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

function crmRevenueMetricDetail(crmRevenue: StripeCrmRevenue) {
  if (crmRevenue.source.mode === "live") {
    if (crmRevenue.transactionCount === 0) {
      return crmRevenue.source.message;
    }

    return `${crmRevenue.transactionCount} Stripe mutaties; excl. ${formatVatRate(crmRevenue.vatRate)}% btw`;
  }
  if (crmRevenue.source.mode === "demo") {
    return "Demo uit Stripe balance transactions";
  }

  return crmRevenue.source.message;
}

function PmDashboardRefreshForm({ params }: { params: PmSearchParams }) {
  const hiddenInputs = preservedPmParamInputs(params, new Set([PM_CACHE_NOTICE_PARAM, PM_CACHE_ERROR_PARAM, PM_CACHE_REFRESH_ID_PARAM]));

  return (
    <form className="pm-refresh-form" action={refreshPmDashboardAction}>
      {hiddenInputs.map(({ key, value }, index) => (
        <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
      ))}
      <button className="pm-refresh-button" type="submit">
        Bijwerken
      </button>
    </form>
  );
}

async function refreshPmDashboardAction(formData: FormData) {
  "use server";

  const params = pmSearchParamsFromFormData(formData);
  const employeeBillabilityPeriod = getEmployeeBillabilityPeriodFromParams(params);
  let notice: PmCacheNotice = "refreshed";
  let errorMessage = "";

  try {
    await refreshCachedPmDashboardData(employeeBillabilityPeriod);
    revalidatePath("/pm");
  } catch (error) {
    notice = "refresh_failed";
    errorMessage = refreshFailureMessage(error);
    console.error("PM dashboard refresh failed", {
      message: error instanceof Error ? error.message : String(error),
      code: errorCode(error)
    });
  }

  redirect(pmHrefWithCacheNotice(params, notice, errorMessage));
}

function EmployeeBillabilityPeriodControls({ params, period }: { params: PmSearchParams; period: EmployeeBillabilityPeriod }) {
  const hiddenInputs = preservedPmParamInputs(params, new Set(["billabilityView", "employeePeriod", "employeeStart", "employeeEnd"]));

  return (
    <div className="pm-billability-period-controls">
      <nav className="dashboard-tabs pm-period-tabs" aria-label="Periode billableheid per medewerker">
        {(["week", "month", "year", "custom"] as PmEmployeeBillabilityPeriodPreset[]).map((preset) => (
          <a
            key={preset}
            className={`dashboard-tab ${period.preset === preset ? "dashboard-tab--active" : ""}`}
            href={pmEmployeeBillabilityPeriodHref(params, preset)}
            aria-current={period.preset === preset ? "page" : undefined}
          >
            {employeeBillabilityPeriodPresetLabel(preset)}
          </a>
        ))}
      </nav>

      <form className="pm-period-form" action="/pm#pm-billability-detail">
        {hiddenInputs.map(({ key, value }, index) => (
          <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
        ))}
        <input type="hidden" name="billabilityView" value="employees" />
        <input type="hidden" name="employeePeriod" value="custom" />
        <label>
          Van
          <input type="date" name="employeeStart" defaultValue={period.start} />
        </label>
        <label>
          Tot
          <input type="date" name="employeeEnd" defaultValue={period.end} />
        </label>
        <button type="submit">Laden</button>
      </form>
    </div>
  );
}

function getPmBillabilityView(params: PmSearchParams): PmBillabilityView {
  return firstParam(params.billabilityView) === "monthly" ? "monthly" : "employees";
}

function getPmRevenueView(params: PmSearchParams): PmRevenueView {
  return firstParam(params.revenueView) === "profit" ? "profit" : "revenue";
}

function getEmployeeBillabilityPeriodFromParams(params: PmSearchParams): EmployeeBillabilityPeriod {
  const preset = firstParam(params.employeePeriod);
  if (preset === "week") {
    return employeeBillabilityPeriodFromPeriod(getCurrentWeekPeriod(), "week");
  }
  if (preset === "month") {
    return employeeBillabilityPeriodFromPeriod(getCurrentMonthPeriod(), "month");
  }
  if (preset === "custom") {
    const customPeriod = customEmployeeBillabilityPeriodFromParams(params);
    return employeeBillabilityPeriodFromPeriod(customPeriod ?? getCurrentMonthPeriod(), "custom");
  }

  return employeeBillabilityPeriodFromPeriod(getYearToDatePeriod(), "year");
}

function pmBillabilityTabHref(params: PmSearchParams, view: PmBillabilityView) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (["billabilityView", PM_CACHE_NOTICE_PARAM, PM_CACHE_ERROR_PARAM].includes(key)) {
      continue;
    }

    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  if (view === "monthly") {
    search.set("billabilityView", "monthly");
  }

  const query = search.toString();
  return query ? `/pm?${query}#pm-billability-detail` : "/pm#pm-billability-detail";
}

function pmRevenueTabHref(params: PmSearchParams, view: PmRevenueView) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (["revenueView", PM_CACHE_NOTICE_PARAM, PM_CACHE_ERROR_PARAM].includes(key)) {
      continue;
    }

    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  if (view === "profit") {
    search.set("revenueView", "profit");
  }

  const query = search.toString();
  return query ? `/pm?${query}#pm-revenue-detail` : "/pm#pm-revenue-detail";
}

function pmEmployeeBillabilityPeriodHref(params: PmSearchParams, preset: PmEmployeeBillabilityPeriodPreset) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (["billabilityView", "employeePeriod", "employeeStart", "employeeEnd", PM_CACHE_NOTICE_PARAM, PM_CACHE_ERROR_PARAM].includes(key)) {
      continue;
    }

    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  search.set("billabilityView", "employees");
  search.set("employeePeriod", preset);

  if (preset === "custom") {
    const customPeriod = customEmployeeBillabilityPeriodFromParams(params) ?? getCurrentMonthPeriod();
    search.set("employeeStart", customPeriod.start);
    search.set("employeeEnd", customPeriod.end);
  }

  return `/pm?${search.toString()}#pm-billability-detail`;
}

function preservedPmParamInputs(params: PmSearchParams, excludedKeys: Set<string>) {
  const inputs: { key: string; value: string }[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (excludedKeys.has(key) || key === PM_CACHE_NOTICE_PARAM || key === PM_CACHE_ERROR_PARAM) {
      continue;
    }

    paramValues(value).forEach((entry) => {
      inputs.push({ key, value: entry });
    });
  }

  return inputs;
}

function employeeBillabilityPeriodPresetLabel(preset: PmEmployeeBillabilityPeriodPreset) {
  if (preset === "week") {
    return "Week";
  }
  if (preset === "month") {
    return "Maand";
  }
  if (preset === "custom") {
    return "Aangepast";
  }

  return "Jaar";
}

function RevenueLineChart({ rows, crmRows }: { rows: MonthRevenue[]; crmRows: MonthRevenue[] }) {
  const width = Math.max(720, rows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const crmRevenueByMonth = new Map(crmRows.map((row) => [row.key, row.revenue]));
  const crmValues = rows.map((row) => crmRevenueByMonth.get(row.key) ?? 0);
  const values = rows.flatMap((row, index) => [row.revenue, crmValues[index]]);
  const rawMaximum = Math.max(0, ...values);
  const minimum = Math.min(0, ...values);
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const chartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenue) }));
  const crmChartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(crmValues[index]) }));
  const invoiceLinePath = smoothLinePath(chartPoints);
  const crmLinePath = smoothLinePath(crmChartPoints);
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
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--crm" />{CRM_REVENUE_SERIES_LABEL}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Omzet per maand: ${rows
          .map(
            (row, index) =>
              `${row.label} ${INVOICE_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)} en ${CRM_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(
                crmValues[index]
              )}`
          )
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
              {formatCurrency(tick.value)}
            </text>
          </g>
        ))}
        <line className="revenue-line-axis" x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} />
        {rows.length > 1 ? <path className="revenue-line-area revenue-line-area--invoice" d={invoiceAreaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--invoice" d={invoiceLinePath} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--crm" d={crmLinePath} /> : null}
        {rows.map((row, index) => {
          const { x, y: invoiceY } = chartPoints[index];
          const { y: crmY } = crmChartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const valueY = invoiceY < padding.top + 24 ? invoiceY + 22 : invoiceY - 12;
          const crmValueY = crmY < padding.top + 24 ? crmY + 22 : crmY - 12;

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${INVOICE_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(row.revenue)} en ${CRM_REVENUE_SERIES_LABEL.toLowerCase()} ${formatCurrency(
                crmValues[index]
              )}`}</title>
              <circle className="revenue-line-point revenue-line-point--invoice" cx={x} cy={invoiceY} r="4" />
              <circle className="revenue-line-point revenue-line-point--crm" cx={x} cy={crmY} r="4" />
              <text className="revenue-line-value revenue-line-value--invoice" x={x} y={valueY} textAnchor={anchor}>{formatCurrency(row.revenue)}</text>
              <text className="revenue-line-value revenue-line-value--crm" x={x} y={crmValueY} textAnchor={anchor}>{formatCurrency(crmValues[index])}</text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RevenueCostProfitLineChart({ rows }: { rows: MonthRevenueCostProfit[] }) {
  const cumulativeRows = cumulativeRevenueCostProfitRows(rows);
  const width = Math.max(720, cumulativeRows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = cumulativeRows.flatMap((row) => [row.revenue, row.employeeCost, row.profit]);
  const rawMaximum = Math.max(0, ...values);
  const minimum = Math.min(0, ...values);
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum > 0 ? rawMaximum * 1.08 : rawMaximum;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) =>
    padding.left + (cumulativeRows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (cumulativeRows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const revenuePoints: ChartPoint[] = cumulativeRows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenue) }));
  const costPoints: ChartPoint[] = cumulativeRows.map((row, index) => ({ x: xFor(index), y: yFor(row.employeeCost) }));
  const profitPoints: ChartPoint[] = cumulativeRows.map((row, index) => ({ x: xFor(index), y: yFor(row.profit) }));
  const revenueLinePath = smoothLinePath(revenuePoints);
  const costLinePath = smoothLinePath(costPoints);
  const profitLinePath = smoothLinePath(profitPoints);
  const profitAreaPath = smoothAreaPath(profitPoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "pm-revenue-profit-line-gradient";
  const valueYFor = (y: number, offset: number) =>
    Math.max(padding.top + 12, Math.min(height - padding.bottom - 8, y + offset));

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--invoice" />{AGENCY_REVENUE_WITH_CRM_SERIES_LABEL}</span>
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--employee-cost" />Kost</span>
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--profit" />Winst</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Agency omzet incl. CRM, kost en winst cumulatief per maand: ${cumulativeRows
          .map(
            (row) =>
              `${row.label} totaal omzet ${formatCurrency(row.revenue)}, totaal kost ${formatCurrency(row.employeeCost)} en totaal winst ${formatCurrency(
                row.profit
              )}`
          )
          .join(", ")}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="revenue-line-gradient-start revenue-line-gradient-start--profit" offset="0%" />
            <stop className="revenue-line-gradient-end revenue-line-gradient-end--profit" offset="100%" />
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
        {cumulativeRows.length > 1 ? <path className="revenue-line-area revenue-line-area--profit" d={profitAreaPath} fill={`url(#${gradientId})`} /> : null}
        {cumulativeRows.length > 1 ? <path className="revenue-line-path revenue-line-path--invoice" d={revenueLinePath} /> : null}
        {cumulativeRows.length > 1 ? <path className="revenue-line-path revenue-line-path--employee-cost" d={costLinePath} /> : null}
        {cumulativeRows.length > 1 ? <path className="revenue-line-path revenue-line-path--profit" d={profitLinePath} /> : null}
        {cumulativeRows.map((row, index) => {
          const { x, y: revenueY } = revenuePoints[index];
          const { y: costY } = costPoints[index];
          const { y: profitY } = profitPoints[index];
          const anchor = index === 0 ? "start" : index === cumulativeRows.length - 1 ? "end" : "middle";

          return (
            <g key={row.key}>
              <title>{`${row.label}: totaal omzet ${formatCurrency(row.revenue)}, totaal kost ${formatCurrency(row.employeeCost)} en totaal winst ${formatCurrency(
                row.profit
              )}`}</title>
              <circle className="revenue-line-point revenue-line-point--invoice" cx={x} cy={revenueY} r="4" />
              <circle className="revenue-line-point revenue-line-point--employee-cost" cx={x} cy={costY} r="4" />
              <circle className="revenue-line-point revenue-line-point--profit" cx={x} cy={profitY} r="4" />
              <text className="revenue-line-value revenue-line-value--invoice" x={x} y={valueYFor(revenueY, -12)} textAnchor={anchor}>
                {formatCurrency(row.revenue)}
              </text>
              <text className="revenue-line-value revenue-line-value--employee-cost" x={x} y={valueYFor(costY, 22)} textAnchor={anchor}>
                {formatCurrency(row.employeeCost)}
              </text>
              <text className="revenue-line-value revenue-line-value--profit" x={x} y={valueYFor(profitY, -12)} textAnchor={anchor}>
                {formatCurrency(row.profit)}
              </text>
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
  const values = rows.flatMap((row) => [row.revenuePerBillableHour, row.revenuePerCalendarItemHour]);
  const rawMaximum = Math.max(goal, 0, ...values);
  const minimum = Math.min(0, ...values);
  const maximum = rawMaximum === minimum ? rawMaximum + 1 : rawMaximum * 1.12;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const billableChartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenuePerBillableHour) }));
  const calendarChartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.revenuePerCalendarItemHour) }));
  const billableLinePath = smoothLinePath(billableChartPoints);
  const calendarLinePath = smoothLinePath(calendarChartPoints);
  const billableAreaPath = smoothAreaPath(billableChartPoints, yFor(0));
  const goalY = yFor(goal);
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "pm-revenue-per-billable-hour-gradient";
  const valueYFor = (y: number, siblingY: number, preferAbove: boolean) => {
    const offset = Math.abs(y - siblingY) < 24 ? (preferAbove ? -12 : 22) : y < padding.top + 24 ? 22 : -12;
    return Math.max(padding.top + 12, Math.min(height - padding.bottom - 8, y + offset));
  };

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--billable-hour" />Omzet / billable uur</span>
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--calendar-hour" />Omzet / agenda-uur</span>
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--goal" />Doel {formatCurrencyPerHour(goal)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Omzet per billable uur en per agenda-uur per maand met doel ${formatCurrencyPerHour(goal)}: ${rows
          .map(
            (row) =>
              `${row.label} ${formatCurrencyPerHour(row.revenuePerBillableHour)} per billable uur bij ${formatHours(
                row.billableHours
              )} billable uren en ${formatCurrencyPerHour(row.revenuePerCalendarItemHour)} per agenda-uur bij ${formatHours(
                row.calendarItemHours
              )} agenda-uren`
          )
          .join(", ")}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="revenue-line-gradient-start revenue-line-gradient-start--billable-hour" offset="0%" />
            <stop className="revenue-line-gradient-end revenue-line-gradient-end--billable-hour" offset="100%" />
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
        {rows.length > 1 ? <path className="revenue-line-area revenue-line-area--billable-hour" d={billableAreaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--calendar-hour" d={calendarLinePath} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--billable-hour" d={billableLinePath} /> : null}
        {rows.map((row, index) => {
          const { x, y: billableY } = billableChartPoints[index];
          const { y: calendarY } = calendarChartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const billableValueY = valueYFor(billableY, calendarY, true);
          const calendarValueY = valueYFor(calendarY, billableY, false);

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${formatCurrencyPerHour(row.revenuePerBillableHour)} per billable uur en ${formatCurrencyPerHour(
                row.revenuePerCalendarItemHour
              )} per agenda-uur uit ${formatCurrency(row.revenue)}`}</title>
              <circle className="revenue-line-point revenue-line-point--billable-hour" cx={x} cy={billableY} r="4" />
              <circle className="revenue-line-point revenue-line-point--calendar-hour" cx={x} cy={calendarY} r="4" />
              <text className="revenue-line-value revenue-line-value--billable-hour" x={x} y={billableValueY} textAnchor={anchor}>
                {formatCurrencyPerHour(row.revenuePerBillableHour)}
              </text>
              <text className="revenue-line-value revenue-line-value--calendar-hour" x={x} y={calendarValueY} textAnchor={anchor}>
                {formatCurrencyPerHour(row.revenuePerCalendarItemHour)}
              </text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BillabilityLineChart({ rows }: { rows: MonthBillability[] }) {
  const width = Math.max(720, rows.length * 112);
  const height = 300;
  const padding = { top: 26, right: 30, bottom: 48, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = rows.map((row) => row.billability);
  const rawMaximum = Math.max(100, 0, ...values);
  const minimum = 0;
  const maximum = rawMaximum > 100 ? rawMaximum * 1.08 : 100;
  const range = Math.max(1, maximum - minimum);
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / range) * chartHeight;
  const chartPoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.billability) }));
  const linePath = smoothLinePath(chartPoints);
  const areaPath = smoothAreaPath(chartPoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum - (range * index) / 4;
    return { key: index, value, y: yFor(value) };
  });
  const zeroY = yFor(0);
  const gradientId = "pm-billability-line-gradient";

  return (
    <div className="revenue-line-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="revenue-line-legend-dot revenue-line-legend-dot--billability" />Billableheid</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Billableheid per maand: ${rows
          .map((row) => `${row.label} ${formatPercent(row.billability)} procent bij ${formatHours(row.billableHours)} billable uren en ${formatHours(row.availableHours)} beschikbare uren`)
          .join(", ")}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="revenue-line-gradient-start revenue-line-gradient-start--billability" offset="0%" />
            <stop className="revenue-line-gradient-end revenue-line-gradient-end--billability" offset="100%" />
          </linearGradient>
        </defs>
        <rect className="revenue-line-plot-bg" x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="6" />
        {gridTicks.map((tick) => (
          <g key={tick.key}>
            <line className="revenue-line-grid" x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
            <text className="revenue-line-y-label" x={padding.left - 12} y={tick.y + 4} textAnchor="end">
              {formatPercent(tick.value)}%
            </text>
          </g>
        ))}
        <line className="revenue-line-axis" x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} />
        {rows.length > 1 ? <path className="revenue-line-area revenue-line-area--billability" d={areaPath} fill={`url(#${gradientId})`} /> : null}
        {rows.length > 1 ? <path className="revenue-line-path revenue-line-path--billability" d={linePath} /> : null}
        {rows.map((row, index) => {
          const { x, y } = chartPoints[index];
          const anchor = index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle";
          const valueY = y < padding.top + 24 ? y + 22 : y - 12;

          return (
            <g key={row.key}>
              <title>{`${row.label}: ${formatPercent(row.billability)}% uit ${formatHours(row.billableHours)} billable uren en ${formatHours(row.availableHours)} beschikbare uren`}</title>
              <circle className="revenue-line-point revenue-line-point--billability" cx={x} cy={y} r="4" />
              <text className="revenue-line-value" x={x} y={valueY} textAnchor={anchor}>{formatPercent(row.billability)}%</text>
              <text className="revenue-line-label" x={x} y={height - 22} textAnchor={anchor}>{row.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

async function getPmDashboardData(
  employeeBillabilityPeriod: EmployeeBillabilityPeriod,
  cacheNotice?: PmCacheNotice,
  cacheError?: string
): Promise<PmDashboardData> {
  const period = getYearToDatePeriod();

  if (!hasDashboardGrippApiToken()) {
    return dashboardWithCacheNotice(
      buildDemoPmDashboardData(period, employeeBillabilityPeriod, {
        mode: "demo",
        message: `Demo-data zichtbaar. Zet ${DASHBOARD_GRIPP_API_TOKEN_ENV} om live Gripp-cijfers te tonen.`
      }),
      cacheNotice,
      cacheError
    );
  }

  const cacheKey = pmDashboardCacheKey(period, employeeBillabilityPeriod);
  const cached = (await safeReadCachedPmDashboardData(cacheKey)) ?? (await safeReadLegacyCachedPmDashboardData(period, employeeBillabilityPeriod));
  if (cached) {
    return dashboardFromCache(cached, cacheNotice, cacheError);
  }

  return dashboardWithCacheNotice(
    buildDemoPmDashboardData(period, employeeBillabilityPeriod, {
      mode: "demo",
      message: "Geen PM-cache beschikbaar. Klik op Bijwerken om live Gripp-cijfers op te halen."
    }),
    cacheNotice,
    cacheError
  );
}

async function refreshCachedPmDashboardData(employeeBillabilityPeriod: EmployeeBillabilityPeriod): Promise<void> {
  if (!hasDashboardGrippApiToken()) {
    throw new Error(`${DASHBOARD_GRIPP_API_TOKEN_ENV} ontbreekt.`);
  }

  const period = getYearToDatePeriod();
  const fresh = await loadFreshPmDashboardData(period, employeeBillabilityPeriod);
  const cacheWriteIssue = await safeWriteCachedPmDashboardData(pmDashboardCacheKey(period, employeeBillabilityPeriod), fresh.dashboard);
  if (cacheWriteIssue) {
    throw new Error(cacheWriteIssue);
  }
}

async function loadFreshPmDashboardData(
  period: Period,
  employeeBillabilityPeriod: EmployeeBillabilityPeriod
): Promise<FreshPmDashboardData> {
  const dataPeriod = mergePeriods(period, employeeBillabilityPeriod);
  const client = createDashboardGrippClient();
  const issues: string[] = [];
  const crmRevenuePromise = loadOptionalStripeCrmRevenue(issues, period);
  const [invoices, hours, crmRevenue] = await Promise.all([
    optionalData(issues, "verkoopfacturen", [], () => fetchInvoicesForPeriod(client, period)),
    requiredData("uren", () => fetchHoursForPeriod(client, dataPeriod)),
    crmRevenuePromise
  ]);
  const [employees, fetchedAbsenceRequestLines, calendarItems] = await Promise.all([
    optionalData(issues, "medewerkers", [], () => fetchEmployees(client)),
    optionalData(issues, "verlofmutaties", [], () => fetchAbsenceRequestLinesForPeriod(client, dataPeriod)),
    optionalData(issues, "planning", [], () => fetchCalendarItemsForPeriod(client, dataPeriod))
  ]);
  const detailedEmployees = await optionalData(issues, "medewerkerdetails", employees, () =>
    fetchEmployeeDetailsForEmployees(client, employees, employeeDetailCandidateIds(employees, hours, fetchedAbsenceRequestLines, calendarItems))
  );
  const employeeScope = buildPmEmployeeScope(detailedEmployees);
  const scopedHours = hoursForEmployeeScope(hours, employeeScope);
  const scopedCalendarItems = calendarItemsForEmployeeScope(calendarItems, employeeScope);
  const absenceRequestLines = fetchedAbsenceRequestLines;
  const absenceRequestsById = await optionalData(issues, "verlofaanvraagdetails", new Map<number, JsonRecord>(), () =>
    fetchAbsenceRequestsById(client, absenceRequestLines)
  );
  const scopedAbsenceRequestLines = absenceRequestLinesForEmployeeScope(absenceRequestLines, absenceRequestsById, employeeScope);
  const billabilitySources = await fetchBillabilitySources(client, scopedHours, issues);
  const yearHours = recordsForPeriod(scopedHours, period);
  const yearCalendarItems = recordsForPeriod(scopedCalendarItems, period);
  const yearAbsenceRequestLines = recordsForPeriod(scopedAbsenceRequestLines, period);
  const employeePeriodHours = recordsForPeriod(scopedHours, employeeBillabilityPeriod);
  const employeePeriodCalendarItems = recordsForPeriod(scopedCalendarItems, employeeBillabilityPeriod);
  const employeePeriodAbsenceRequestLines = recordsForPeriod(scopedAbsenceRequestLines, employeeBillabilityPeriod);
  const paidOvertimeHoursByEmployeeId = buildPaidOvertimeHoursByEmployeeId(yearAbsenceRequestLines, absenceRequestsById, period);
  const employeePeriodPaidOvertimeHoursByEmployeeId = buildPaidOvertimeHoursByEmployeeId(
    employeePeriodAbsenceRequestLines,
    absenceRequestsById,
    employeeBillabilityPeriod
  );
  const overheadEmployees = overheadEmployeesFromEmployeeScope(employeeScope);
  const workingHoursCapacity = await optionalData(issues, "werktijden", emptyWorkingHoursCapacity(), () =>
    fetchWorkingHoursForEmployees(client, employeeScope.employees, yearHours, yearAbsenceRequestLines, absenceRequestsById, period)
  );
  const employeePeriodWorkingHoursCapacity = samePeriod(period, employeeBillabilityPeriod)
    ? workingHoursCapacity
    : await optionalData(issues, "werktijden medewerkerperiode", emptyWorkingHoursCapacity(), () =>
        fetchWorkingHoursForEmployees(
          client,
          employeeScope.employees,
          employeePeriodHours,
          employeePeriodAbsenceRequestLines,
          absenceRequestsById,
          employeeBillabilityPeriod
        )
      );
  const employeeBillabilityOverheadSources =
    overheadEmployees.length === 0
      ? null
      : {
          capacitySources: overheadCapacitySources(overheadEmployees)
        };

  const dashboard = buildPmDashboardData(
    invoices,
    crmRevenue,
    yearHours,
    billabilitySources,
    {
      employees: employeeScope.employees,
      workingHoursByEmployeeId: workingHoursCapacity.workingHoursByEmployeeId,
      leaveHoursFromWorkingHoursByEmployeeId: workingHoursCapacity.leaveHoursByEmployeeId,
      paidOvertimeHoursByEmployeeId: numberMapForEmployeeScope(paidOvertimeHoursByEmployeeId, employeeScope),
      absenceRequestLines: yearAbsenceRequestLines,
      absenceRequestsById
    },
    period,
    {
      mode: "live",
      message: liveSourceMessage(issues),
      noticeTone: issues.length > 0 ? "warning" : undefined
    },
    employeeScope.excludedEmployeeCount,
    yearCalendarItems,
    employeeBillabilityPeriod,
    employeePeriodHours,
    {
      employees: employeeScope.employees,
      workingHoursByEmployeeId: employeePeriodWorkingHoursCapacity.workingHoursByEmployeeId,
      leaveHoursFromWorkingHoursByEmployeeId: employeePeriodWorkingHoursCapacity.leaveHoursByEmployeeId,
      paidOvertimeHoursByEmployeeId: numberMapForEmployeeScope(employeePeriodPaidOvertimeHoursByEmployeeId, employeeScope),
      absenceRequestLines: employeePeriodAbsenceRequestLines,
      absenceRequestsById
    },
    employeePeriodCalendarItems,
    employeeBillabilityOverheadSources
  );

  return { dashboard, issues };
}

async function safeReadCachedPmDashboardData(cacheKey: string): Promise<CachedPmDashboardData | null> {
  try {
    const cached = await readJsonCache<unknown>(cacheKey);
    return cachedPmDashboardDataFromCacheValue(cached);
  } catch {
    return null;
  }
}

async function safeReadLegacyCachedPmDashboardData(period: Period, employeeBillabilityPeriod: EmployeeBillabilityPeriod) {
  for (const version of LEGACY_PM_DASHBOARD_CACHE_VERSIONS) {
    const cached = await safeReadCachedPmDashboardData(pmDashboardCacheKey(period, employeeBillabilityPeriod, version));
    if (cached) {
      return cached;
    }
  }

  return null;
}

async function safeWriteCachedPmDashboardData(cacheKey: string, dashboard: PmDashboardData) {
  try {
    await writeCachedPmDashboardData(cacheKey, dashboard);
    return "";
  } catch (error) {
    return `Cache kon niet worden opgeslagen${errorCode(error) ? ` (${errorCode(error)})` : ""}.`;
  }
}

async function writeCachedPmDashboardData(cacheKey: string, dashboard: PmDashboardData): Promise<void> {
  await writeJsonCache(cacheKey, {
    version: PM_DASHBOARD_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    dashboard
  } satisfies CachedPmDashboardData);
}

function dashboardFromCache(cached: CachedPmDashboardData, notice?: PmCacheNotice, errorMessage?: string): PmDashboardData {
  const messages = [
    cacheNoticeMessage(notice, errorMessage),
    "Cache-data zichtbaar.",
    cached.dashboard.source.message
  ].filter(Boolean);
  const noticeTone = cacheNoticeTone(notice, cached.dashboard.source.noticeTone);

  return {
    ...cached.dashboard,
    source: {
      mode: "cache",
      message: messages.join(" "),
      noticeTone
    }
  };
}

function dashboardWithCacheNotice(dashboard: PmDashboardData, notice?: PmCacheNotice, errorMessage?: string): PmDashboardData {
  const noticeMessage = cacheNoticeMessage(notice, errorMessage);
  if (!noticeMessage) {
    return dashboard;
  }

  return {
    ...dashboard,
    source: {
      ...dashboard.source,
      message: [noticeMessage, dashboard.source.message].filter(Boolean).join(" "),
      noticeTone: cacheNoticeTone(notice, dashboard.source.noticeTone)
    }
  };
}

function cachedPmDashboardDataFromCacheValue(value: unknown): CachedPmDashboardData | null {
  if (!isCachedPmDashboardData(value)) {
    return null;
  }

  return {
    version: value.version,
    savedAt: value.savedAt,
    dashboard: dashboardWithEmployeeCostDefaults(value.dashboard, value.version)
  };
}

function isCachedPmDashboardData(value: unknown): value is CachedPmDashboardData {
  const record = asRecord(value);
  return (
    typeof record?.version === "number" &&
    (record.version === PM_DASHBOARD_CACHE_VERSION || LEGACY_PM_DASHBOARD_CACHE_VERSIONS.includes(record.version)) &&
    typeof record.savedAt === "string" &&
    asRecord(record.dashboard) !== undefined
  );
}

function dashboardWithEmployeeCostDefaults(dashboard: PmDashboardData, cacheVersion = PM_DASHBOARD_CACHE_VERSION): PmDashboardData {
  const rows = Array.isArray(dashboard.employeeBillability)
    ? dashboard.employeeBillability.map((row) => {
        const record = row as EmployeeBillabilityRow & JsonRecord;
        const costPerHour = numberFrom(record.costPerHour) ?? null;
        const employeeCost = numberFrom(record.employeeCost) ?? null;

        return {
          ...row,
          costPerHour,
          employeeCost
        };
      })
    : [];
  const employeeCost = numberFrom((dashboard as JsonRecord).employeeCost) ?? rows.reduce((total, row) => total + (row.employeeCost ?? 0), 0);
  const employeeBillabilityOverhead = employeeBillabilityOverheadFromValue(
    (dashboard as JsonRecord).employeeBillabilityOverhead,
    cacheVersion < PM_DASHBOARD_CACHE_VERSION ? dashboard.employeeBillabilityPeriod : undefined
  );
  const summary = asRecord(dashboard.employeeBillabilitySummary) ?? {};
  const employeeBillabilitySummary = {
    ...summary,
    ...buildBillabilitySummary(rows, employeeBillabilityOverhead ? [employeeBillabilityOverhead] : [])
  };
  const revenueByMonthRows = Array.isArray(dashboard.revenueByMonth) ? dashboard.revenueByMonth : [];
  const crmRevenueRows = monthRevenueRowsFromValue(asRecord((dashboard as JsonRecord).crmRevenue)?.byMonth);
  const agencyRevenueByMonthRows = revenueRowsIncludingCrmRevenue(revenueByMonthRows, crmRevenueRows);
  const agencyCostProfitByMonth = agencyCostProfitByMonthFromValue(
    (dashboard as JsonRecord).agencyCostProfitByMonth,
    agencyRevenueByMonthRows,
    dashboard.period,
    employeeCost + (employeeBillabilityOverhead?.employeeCost ?? 0),
    cacheVersion >= PM_DASHBOARD_CACHE_VERSION
  );

  return {
    ...dashboard,
    employeeCost,
    employeeBillability: rows,
    employeeBillabilityOverhead,
    employeeBillabilitySummary,
    revenueByMonth: revenueByMonthRows,
    agencyCostProfitByMonth
  };
}

function employeeBillabilityOverheadFromValue(
  value: unknown,
  period?: Pick<Period, "start" | "end">
): EmployeeBillabilityOverheadRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const row = {
    ...(record as EmployeeBillabilityOverheadRow),
    employeeId: numberFrom(record.employeeId) ?? OVERHEAD_EMPLOYEE_ID,
    name: stringFrom(record.name) ?? "Overhead",
    contractHours: numberFrom(record.contractHours) ?? 0,
    leaveHours: numberFrom(record.leaveHours) ?? 0,
    availableHours: numberFrom(record.availableHours) ?? 0,
    costPerHour: numberFrom(record.costPerHour) ?? null,
    employeeCost: numberFrom(record.employeeCost) ?? null,
    paidOvertimeHours: numberFrom(record.paidOvertimeHours) ?? 0,
    usedWorkingHoursFallback: booleanFrom(record.usedWorkingHoursFallback) ?? false,
    loggedHours: numberFrom(record.loggedHours) ?? 0,
    billableHours: numberFrom(record.billableHours) ?? 0,
    unbillableLoggedHours: numberFrom(record.unbillableLoggedHours) ?? 0,
    capacityRemainingHours: numberFrom(record.capacityRemainingHours) ?? 0,
    calendarItemHours: numberFrom(record.calendarItemHours) ?? 0,
    planningWithoutTaskHours: numberFrom(record.planningWithoutTaskHours) ?? 0,
    billability: numberFrom(record.billability) ?? 0,
    employeeCount: numberFrom(record.employeeCount) ?? 0
  };

  return normalizeCachedEmployeeBillabilityOverhead(row, period);
}

function normalizeCachedEmployeeBillabilityOverhead(
  row: EmployeeBillabilityOverheadRow,
  period?: Pick<Period, "start" | "end">
): EmployeeBillabilityOverheadRow {
  if (!period || !isDateKey(period.start) || !isDateKey(period.end) || period.start > period.end || row.employeeCount <= 0) {
    return {
      ...row,
      billability: 0
    };
  }

  const contractHours = row.employeeCount * calculateOverheadContractHours(period.start, period.end);
  const employeeCost = row.costPerHour === null ? row.employeeCost : employeeCostFromHours(contractHours, 0, row.costPerHour);

  return {
    ...row,
    contractHours,
    leaveHours: 0,
    availableHours: contractHours,
    employeeCost,
    paidOvertimeHours: 0,
    usedWorkingHoursFallback: false,
    loggedHours: 0,
    billableHours: 0,
    unbillableLoggedHours: 0,
    capacityRemainingHours: 0,
    calendarItemHours: 0,
    planningWithoutTaskHours: 0,
    billability: 0
  };
}

function agencyCostProfitByMonthFromValue(
  value: unknown,
  revenueRows: MonthRevenue[],
  period: Period,
  fallbackTotalCost: number,
  useCachedRevenue = true
): MonthRevenueCostProfit[] {
  const recordsByKey = new Map<string, JsonRecord>();
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      const key = stringFrom(record?.key);
      if (record && key) {
        recordsByKey.set(key, record);
      }
    }
  }

  const fallbackCostsByMonth =
    recordsByKey.size === 0 ? distributeTotalCostByMonth(revenueRows, period, fallbackTotalCost) : new Map<string, number>();

  return revenueRows.map((row) => {
    const record = recordsByKey.get(row.key);
    const revenue = useCachedRevenue ? numberFrom(record?.revenue) ?? row.revenue : row.revenue;
    const employeeCost = numberFrom(record?.employeeCost) ?? fallbackCostsByMonth.get(row.key) ?? 0;

    return {
      ...row,
      revenue,
      employeeCost,
      profit: useCachedRevenue ? numberFrom(record?.profit) ?? revenue - employeeCost : revenue - employeeCost
    };
  });
}

function monthRevenueRowsFromValue(value: unknown): MonthRevenue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = asRecord(item);
    const key = stringFrom(record?.key);
    const label = stringFrom(record?.label);
    const revenue = numberFrom(record?.revenue);

    return key && label && revenue !== null ? [{ key, label, revenue }] : [];
  });
}

function revenueRowsIncludingCrmRevenue(revenueRows: MonthRevenue[], crmRevenueRows: MonthRevenue[]): MonthRevenue[] {
  const crmRevenueByMonth = new Map<string, number>();
  for (const row of crmRevenueRows) {
    crmRevenueByMonth.set(row.key, (crmRevenueByMonth.get(row.key) ?? 0) + row.revenue);
  }

  return revenueRows.map((row) => ({
    ...row,
    revenue: row.revenue + (crmRevenueByMonth.get(row.key) ?? 0)
  }));
}

function cumulativeRevenueCostProfitRows(rows: MonthRevenueCostProfit[]): MonthRevenueCostProfit[] {
  let revenue = 0;
  let employeeCost = 0;

  return rows.map((row) => {
    revenue += row.revenue;
    employeeCost += row.employeeCost;

    return {
      ...row,
      revenue,
      employeeCost,
      profit: revenue - employeeCost
    };
  });
}

function distributeTotalCostByMonth(revenueRows: MonthRevenue[], period: Period, fallbackTotalCost: number) {
  const costsByMonth = new Map(revenueRows.map((row) => [row.key, 0]));
  const totalCost = Math.max(0, fallbackTotalCost);
  if (totalCost === 0 || revenueRows.length === 0 || !isDateKey(period.start) || !isDateKey(period.end) || period.start > period.end) {
    return costsByMonth;
  }

  const weights = revenueRows.map((row) => {
    const monthStart = maxDateKey(period.start, `${row.key}-01`);
    const monthEnd = minDateKey(period.end, monthEndDateKey(row.key));
    return monthStart > monthEnd ? 0 : calculateDefaultContractHours(monthStart, monthEnd);
  });
  const totalWeight = weights.reduce((total, value) => total + value, 0);
  if (totalWeight <= 0) {
    return costsByMonth;
  }

  revenueRows.forEach((row, index) => {
    costsByMonth.set(row.key, totalCost * (weights[index] / totalWeight));
  });

  return costsByMonth;
}

function buildRevenueCostProfitTotals(rows: MonthRevenueCostProfit[]) {
  const revenue = rows.reduce((total, row) => total + row.revenue, 0);
  const employeeCost = rows.reduce((total, row) => total + row.employeeCost, 0);

  return {
    revenue,
    employeeCost,
    profit: revenue - employeeCost
  };
}

function pmDashboardCacheKey(period: Period, employeeBillabilityPeriod: EmployeeBillabilityPeriod, version = PM_DASHBOARD_CACHE_VERSION) {
  const employeePeriodKey =
    employeeBillabilityPeriod.preset === "custom"
      ? `custom:${employeeBillabilityPeriod.start}:${employeeBillabilityPeriod.end}`
      : employeeBillabilityPeriod.preset;

  return `${pmDashboardCachePrefix(version)}:${period.year}:employee-billability:${employeePeriodKey}:${stripeCrmRevenueCacheKeySegment()}`;
}

function pmDashboardCachePrefix(version: number) {
  return `pm-dashboard:v${version}`;
}

function stripeCrmRevenueCacheKeySegment() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return "stripe:none";
  }

  const currency = safeCacheKeySegment(process.env.PM_STRIPE_REVENUE_CURRENCY ?? "eur");
  const vatRate = safeCacheKeySegment(process.env.PM_STRIPE_REVENUE_VAT_RATE ?? "21");
  const accountId = process.env.PM_STRIPE_ACCOUNT_ID?.trim();
  const accountScope = accountId ? `account:${safeCacheKeySegment(accountId)}` : "platform";

  return `stripe:${stripeKeyMode(secretKey)}:${currency}:vat:${vatRate}:${accountScope}`;
}

function stripeKeyMode(secretKey: string) {
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live";
  }
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) {
    return "test";
  }

  return "configured";
}

function safeCacheKeySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function sourceBadgeLabel(mode: DashboardSource["mode"]) {
  if (mode === "live") {
    return "Live uit Gripp";
  }
  if (mode === "cache") {
    return "Cache uit Gripp";
  }

  return "Demo-data";
}

function dataNoticeClassName(source: DashboardSource) {
  return `data-notice${source.noticeTone ? ` data-notice--${source.noticeTone}` : ""}`;
}

function pmCacheNoticeFromParams(params: PmSearchParams): PmCacheNotice | undefined {
  const notice = firstParam(params[PM_CACHE_NOTICE_PARAM]);
  return notice === "refreshed" || notice === "refresh_failed" ? notice : undefined;
}

function pmCacheErrorFromParams(params: PmSearchParams) {
  return safeRefreshErrorMessage(firstParam(params[PM_CACHE_ERROR_PARAM]) ?? "");
}

function cacheNoticeMessage(notice?: PmCacheNotice, errorMessage?: string) {
  if (notice === "refreshed") {
    return "Data bijgewerkt.";
  }
  if (notice === "refresh_failed") {
    return `Verversing mislukt${errorMessage ? `: ${errorMessage}` : ""}. Vorige cache blijft zichtbaar.`;
  }

  return "";
}

function refreshFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("uren niet geladen")) {
    return safeRefreshErrorMessage(message);
  }
  if (message.startsWith("Cache kon niet worden opgeslagen")) {
    return safeRefreshErrorMessage(message);
  }
  if (message.includes(DASHBOARD_GRIPP_API_TOKEN_ENV)) {
    return `${DASHBOARD_GRIPP_API_TOKEN_ENV} ontbreekt.`;
  }

  const code = errorCode(error);
  if (code) {
    return `Technische fout (${code})`;
  }

  return "Technische fout tijdens verversen";
}

function safeRefreshErrorMessage(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function cacheNoticeTone(notice?: PmCacheNotice, sourceTone?: DashboardSource["noticeTone"]): DashboardSource["noticeTone"] {
  if (notice === "refresh_failed" || sourceTone === "error") {
    return "error";
  }
  if (sourceTone === "warning") {
    return "warning";
  }
  if (notice === "refreshed") {
    return "success";
  }

  return sourceTone;
}

function pmSearchParamsFromFormData(formData: FormData): PmSearchParams {
  const params: PmSearchParams = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_") || key === PM_CACHE_NOTICE_PARAM || key === PM_CACHE_ERROR_PARAM || typeof value !== "string") {
      continue;
    }

    const current = params[key];
    if (Array.isArray(current)) {
      current.push(value);
    } else if (typeof current === "string") {
      params[key] = [current, value];
    } else {
      params[key] = value;
    }
  }

  return params;
}

function pmHrefWithCacheNotice(params: PmSearchParams, notice: PmCacheNotice, errorMessage = "") {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === PM_CACHE_NOTICE_PARAM || key === PM_CACHE_ERROR_PARAM || key === PM_CACHE_REFRESH_ID_PARAM) {
      continue;
    }

    for (const item of paramValues(value)) {
      search.append(key, item);
    }
  }

  search.set(PM_CACHE_NOTICE_PARAM, notice);
  search.set(PM_CACHE_REFRESH_ID_PARAM, String(Date.now()));
  const safeErrorMessage = safeRefreshErrorMessage(errorMessage);
  if (notice === "refresh_failed" && safeErrorMessage) {
    search.set(PM_CACHE_ERROR_PARAM, safeErrorMessage);
  }
  return `/pm?${search.toString()}`;
}

function buildDemoPmDashboardData(period: Period, employeeBillabilityPeriod: EmployeeBillabilityPeriod, source: DashboardSource) {
  const dataPeriod = mergePeriods(period, employeeBillabilityPeriod);
  const demoHours = createDemoHours(dataPeriod);
  const demoCalendarItems = createDemoCalendarItems(dataPeriod);
  const capacitySources = createDemoCapacitySources(period);
  const employeePeriodCapacitySources = createDemoCapacitySources(employeeBillabilityPeriod);
  const employeeScope = buildPmEmployeeScope(capacitySources.employees);
  const employeePeriodScope = buildPmEmployeeScope(employeePeriodCapacitySources.employees);
  const overheadEmployees = overheadEmployeesFromEmployeeScope(employeePeriodScope);
  const scopedHours = hoursForEmployeeScope(demoHours, employeeScope);
  const scopedCalendarItems = calendarItemsForEmployeeScope(demoCalendarItems, employeeScope);
  const scopedCapacitySources = capacitySourcesForEmployeeScope(capacitySources, employeeScope);
  const scopedEmployeePeriodCapacitySources = capacitySourcesForEmployeeScope(employeePeriodCapacitySources, employeeScope);
  const billabilitySources = createDemoBillabilitySources(scopedHours);
  const employeeBillabilityOverheadSources =
    overheadEmployees.length === 0
      ? null
      : {
          capacitySources: overheadCapacitySources(overheadEmployees)
        };

  return buildPmDashboardData(
    createDemoInvoices(period),
    demoStripeCrmRevenue(period),
    recordsForPeriod(scopedHours, period),
    billabilitySources,
    scopedCapacitySources,
    period,
    source,
    employeeScope.excludedEmployeeCount,
    recordsForPeriod(scopedCalendarItems, period),
    employeeBillabilityPeriod,
    recordsForPeriod(scopedHours, employeeBillabilityPeriod),
    scopedEmployeePeriodCapacitySources,
    recordsForPeriod(scopedCalendarItems, employeeBillabilityPeriod),
    employeeBillabilityOverheadSources
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

async function loadOptionalStripeCrmRevenue(issues: string[], period: Period) {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    return fetchStripeCrmRevenueForPeriod(period);
  }

  try {
    return await fetchStripeCrmRevenueForPeriod(period);
  } catch (error) {
    const issue = stripeRevenueIssueMessage(error);
    issues.push(issue);
    return unavailableStripeCrmRevenue(period, undefined, issue);
  }
}

function stripeRevenueIssueMessage(error: unknown) {
  const code = errorCode(error);
  const message = sanitizeExternalErrorMessage(error instanceof Error ? error.message : "");
  if (message) {
    return `CRM omzet via Stripe niet geladen${code ? ` (${code})` : ""}: ${message}`;
  }

  return `CRM omzet via Stripe niet geladen${code ? ` (${code})` : ""}`;
}

function sanitizeExternalErrorMessage(value: string) {
  return safeRefreshErrorMessage(
    value
      .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_:-]+/g, (key) => `${key.slice(0, key.indexOf("_", key.indexOf("_") + 1) + 1)}...`)
      .replace(/\bpk_(?:live|test)_[A-Za-z0-9_:-]+/g, (key) => `${key.slice(0, key.indexOf("_", key.indexOf("_") + 1) + 1)}...`)
      .replace(/\bacct_[A-Za-z0-9_:-]+/g, "acct_...")
  );
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
  const excludedEmployees: JsonRecord[] = [];
  const scopedEmployees: JsonRecord[] = [];
  let excludedEmployeeCount = 0;

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (employeeHasExcludedPmRole(employee, excludedRoleIds)) {
      excludedEmployeeCount += 1;
      excludedEmployees.push(employee);
      if (employeeId !== null) {
        excludedEmployeeIds.add(employeeId);
      }
      continue;
    }

    scopedEmployees.push(employee);
  }

  return {
    employees: scopedEmployees,
    excludedEmployees,
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

function overheadEmployeesFromEmployeeScope(employeeScope: PmEmployeeScope) {
  return employeeScope.excludedEmployees.filter((employee) => employeeCostPerHour(employee) !== null);
}

function recordsForPeriod(records: JsonRecord[], period: Period, field = "date") {
  return records.filter((record) => {
    const date = dateKeyFromValue(readField(record, field));
    return Boolean(date && date >= period.start && date <= period.end);
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

function overheadCapacitySources(employees: JsonRecord[]): CapacitySources {
  return {
    employees,
    workingHoursByEmployeeId: new Map<number, number>(),
    leaveHoursFromWorkingHoursByEmployeeId: new Map<number, number>(),
    paidOvertimeHoursByEmployeeId: new Map<number, number>(),
    absenceRequestLines: [],
    absenceRequestsById: new Map<number, JsonRecord>()
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
  return numberSetFromEnv(process.env.PM_EXCLUDED_ROLE_IDS ?? process.env.GRIPP_PM_EXCLUDED_ROLE_IDS ?? "");
}

function paidOvertimeAbsenceTypeIds() {
  return numberSetFromEnv(firstConfiguredEnvValue(PAID_OVERTIME_ABSENCE_TYPE_ID_ENV_NAMES));
}

function paidOvertimeAbsenceTypeNames() {
  return [...DEFAULT_PAID_OVERTIME_ABSENCE_TYPE_NAMES, ...listFromEnv(firstConfiguredEnvValue(PAID_OVERTIME_ABSENCE_TYPE_NAME_ENV_NAMES))].map(
    normalizeComparisonValue
  );
}

function firstConfiguredEnvValue(envNames: string[]) {
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value?.trim()) {
      return value;
    }
  }

  return "";
}

function numberSetFromEnv(value: string) {
  return new Set(
    value
      .split(/[,\s;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(Number)
      .filter((entry) => Number.isFinite(entry))
  );
}

function listFromEnv(value: string) {
  return value
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function employeeRoleTextValues(employee: JsonRecord) {
  const values: string[] = [];
  const seen = new Set<unknown>();
  collectRoleTextValues(readField(employee, "role"), values, seen);

  for (const [key, value] of Object.entries(employee)) {
    if (isEmployeeRoleTextFieldKey(key)) {
      collectRoleTextValues(value, values, seen);
    }
  }

  return values;
}

function isEmployeeRoleTextFieldKey(key: string) {
  const normalizedKey = normalizeComparisonValue(key);
  const normalizedSegment = normalizeComparisonValue(lastFieldSegment(key));
  if (normalizedSegment === "id" || normalizedKey.endsWith("id")) {
    return false;
  }

  return EMPLOYEE_ROLE_TEXT_FIELD_KEY_MARKERS.some((marker) => normalizedKey.includes(marker));
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
  const filters: JsonValue[] = [
    { field: "invoice.reportdate", operator: "greaterequals", value: period.start },
    { field: "invoice.reportdate", operator: "lessequals", value: period.end }
  ];

  return fetchPagedRecords(client, "invoice", filters, [{ field: "invoice.reportdate", direction: "asc" }], MAX_INVOICE_PAGES);
}

async function fetchHoursForPeriod(client: GrippClient, period: Period) {
  const filters: JsonValue[] = [
    { field: "hour.date", operator: "greaterequals", value: period.start },
    { field: "hour.date", operator: "lessequals", value: period.end }
  ];

  return fetchPagedRecords(client, "hour", filters, [{ field: "hour.date", direction: "asc" }], MAX_HOUR_PAGES);
}

async function fetchCalendarItemsForPeriod(client: GrippClient, period: Period) {
  const filters: JsonValue[] = [
    { field: "calendaritem.date", operator: "greaterequals", value: period.start },
    { field: "calendaritem.date", operator: "lessequals", value: period.end }
  ];

  return fetchPagedRecords(client, "calendaritem", filters, [{ field: "calendaritem.date", direction: "asc" }], MAX_CALENDAR_ITEM_PAGES);
}

async function fetchEmployees(client: GrippClient) {
  return fetchPagedRecords(client, "employee", [], [{ field: "employee.id", direction: "asc" }], MAX_EMPLOYEE_PAGES);
}

async function fetchEmployeeDetailsForEmployees(client: GrippClient, employees: JsonRecord[], candidateEmployeeIds?: Set<number>) {
  const employeeIds = Array.from(
    new Set(
      employees
        .map((employee) => idFrom(readField(employee, "id")))
        .filter((employeeId): employeeId is number => employeeId !== null && (!candidateEmployeeIds || candidateEmployeeIds.has(employeeId)))
    )
  ).sort((left, right) => left - right);
  if (employeeIds.length === 0) {
    return employees;
  }

  const detailsById = new Map<number, JsonRecord>();
  for (let index = 0; index < employeeIds.length; index += PAGE_FETCH_BATCH_SIZE) {
    const idChunk = employeeIds.slice(index, index + PAGE_FETCH_BATCH_SIZE);
    const results = await fetchEmployeeDetailChunk(client, idChunk).catch(async () => {
      const fallbackResults: Array<JsonValue | null> = [];
      for (const employeeId of idChunk) {
        try {
          fallbackResults.push(await fetchEmployeeDetail(client, employeeId));
        } catch {
          fallbackResults.push(null);
        }
      }

      return fallbackResults;
    });

    results.forEach((result, resultIndex) => {
      if (result === null) {
        return;
      }

      const detail = asRecords(result)[0];
      if (!detail) {
        return;
      }

      const requestedEmployeeId = idChunk[resultIndex];
      const employeeId = idFrom(readField(detail, "id")) ?? requestedEmployeeId;
      detailsById.set(employeeId, detail);
    });
  }

  if (detailsById.size === 0) {
    throw new Error("Geen medewerkerdetails ontvangen via employee.getone.");
  }

  return employees.map((employee) => {
    const employeeId = idFrom(readField(employee, "id"));
    const detail = employeeId === null ? undefined : detailsById.get(employeeId);
    return detail ? mergeEmployeeDetailRecord(employee, detail) : employee;
  });
}

function employeeDetailCandidateIds(
  employees: JsonRecord[],
  hours: JsonRecord[],
  absenceRequestLines: JsonRecord[],
  calendarItems: JsonRecord[]
) {
  const excludedRoleIds = excludedPmRoleIds();
  const employeeIds = new Set<number>();

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    if (
      employeeId !== null &&
      (booleanFrom(readField(employee, "active")) !== false || employeeHasExcludedPmRole(employee, excludedRoleIds))
    ) {
      employeeIds.add(employeeId);
    }
  }

  for (const id of [
    ...uniqueRelationIds(hours, "employee"),
    ...uniqueRelationIds(absenceRequestLines, "employee"),
    ...uniqueRelationIds(calendarItems, "calendaritememployee"),
    ...uniqueRelationIds(calendarItems, "employee")
  ]) {
    employeeIds.add(id);
  }

  return employeeIds;
}

async function fetchEmployeeDetailChunk(client: GrippClient, employeeIds: number[]) {
  return client.batch(employeeIds.map((employeeId) => employeeDetailBatchItem(employeeId)));
}

async function fetchEmployeeDetail(client: GrippClient, employeeId: number) {
  return client.call("employee.getone", employeeDetailParams(employeeId));
}

function employeeDetailBatchItem(employeeId: number) {
  return {
    method: "employee.getone",
    params: employeeDetailParams(employeeId)
  };
}

function employeeDetailParams(employeeId: number): JsonValue[] {
  return [[{ field: "employee.id", operator: "equals", value: employeeId }]] as JsonValue[];
}

function mergeEmployeeDetailRecord(employee: JsonRecord, detail: JsonRecord): JsonRecord {
  const merged = { ...employee };

  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  return merged;
}

async function fetchAbsenceRequestLinesForPeriod(client: GrippClient, period: Period) {
  const filters: JsonValue[] = [
    { field: "absencerequestline.date", operator: "greaterequals", value: period.start },
    { field: "absencerequestline.date", operator: "lessequals", value: period.end }
  ];

  return fetchPagedRecords(client, "absencerequestline", filters, [{ field: "absencerequestline.date", direction: "asc" }], MAX_ABSENCE_LINE_PAGES);
}

async function fetchAbsenceRequestsById(client: GrippClient, absenceRequestLines: JsonRecord[], seed = new Map<number, JsonRecord>()) {
  const absenceRequestsById = new Map(seed);
  const absenceRequestIds = uniqueRelationIds(absenceRequestLines, "absencerequest").filter((id) => !absenceRequestsById.has(id));

  const absenceRequestIdChunks = chunksOf(absenceRequestIds, 100);
  for (let index = 0; index < absenceRequestIdChunks.length; index += PAGE_FETCH_BATCH_SIZE) {
    const results = await client.batch(
      absenceRequestIdChunks.slice(index, index + PAGE_FETCH_BATCH_SIZE).map((idChunk) => ({
        method: "absencerequest.get",
        params: [
          [{ field: "absencerequest.id", operator: "in", value: idChunk }],
          {
            paging: { firstresult: 0, maxresults: PAGE_SIZE },
            orderings: [{ field: "absencerequest.id", direction: "asc" }]
          }
        ] as JsonValue[]
      }))
    );

    for (const result of results) {
      for (const absenceRequest of asRecords(result)) {
        const id = idFrom(readField(absenceRequest, "id"));
        if (id !== null) {
          absenceRequestsById.set(id, absenceRequest);
        }
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
      chunk.map((entry) => ({
        method: "employee.getWorkingHours",
        params: [[entry.employeeId], entry.start, period.end, false] as JsonValue[]
      }))
    );

    chunk.forEach((entry, chunkIndex) => {
      workingHoursByEmployeeId.set(entry.employeeId, workingHoursTotalFromResult(results[chunkIndex]));
      leaveHoursByEmployeeId.set(entry.employeeId, 0);
    });
  }

  return { workingHoursByEmployeeId, leaveHoursByEmployeeId };
}

async function fetchBillabilitySources(client: GrippClient, hours: JsonRecord[], issues: string[] = []): Promise<BillabilitySources> {
  const offerProjectLines = new Map<number, LineBillability>();
  const taskOfferProjectLineIds = new Map<number, number>();
  const directOfferProjectLineIds = new Set<number>();

  for (const hour of hours) {
    const directOfferProjectLineId = relationId(hour, "offerprojectline");
    if (directOfferProjectLineId !== null) {
      directOfferProjectLineIds.add(directOfferProjectLineId);
      const directLineBillability = lineBillabilityFromEmbeddedRecord(asRecord(readField(hour, "offerprojectline")));
      if (directLineBillability) {
        offerProjectLines.set(directOfferProjectLineId, directLineBillability);
      }
    }

    const taskId = relationId(hour, "task");
    const task = asRecord(readField(hour, "task"));
    const taskOfferProjectLineId = task ? relationId(task, "offerprojectline") : null;
    if (taskId !== null && taskOfferProjectLineId !== null) {
      taskOfferProjectLineIds.set(taskId, taskOfferProjectLineId);
      const taskLineBillability = lineBillabilityFromEmbeddedRecord(asRecord(readField(task, "offerprojectline")));
      if (taskLineBillability) {
        offerProjectLines.set(taskOfferProjectLineId, taskLineBillability);
      }
    }
  }

  const taskIds = uniqueRelationIds(hours, "task").filter((taskId) => !taskOfferProjectLineIds.has(taskId));

  try {
    const taskIdChunks = chunksOf(taskIds, 100);
    for (let index = 0; index < taskIdChunks.length; index += PAGE_FETCH_BATCH_SIZE) {
      const results = await client.batch(
        taskIdChunks.slice(index, index + PAGE_FETCH_BATCH_SIZE).map((idChunk) => ({
          method: "task.get",
          params: [
            [{ field: "task.id", operator: "in", value: idChunk }],
            {
              paging: { firstresult: 0, maxresults: PAGE_SIZE },
              orderings: [{ field: "task.id", direction: "asc" }]
            }
          ] as JsonValue[]
        }))
      );

      for (const result of results) {
        for (const task of asRecords(result)) {
          const taskId = idFrom(readField(task, "id"));
          const offerProjectLineId = relationId(task, "offerprojectline");
          if (taskId !== null && offerProjectLineId !== null) {
            taskOfferProjectLineIds.set(taskId, offerProjectLineId);
            const taskLineBillability = lineBillabilityFromEmbeddedRecord(asRecord(readField(task, "offerprojectline")));
            if (taskLineBillability) {
              offerProjectLines.set(offerProjectLineId, taskLineBillability);
            }
          }
        }
      }
    }
  } catch (error) {
    issues.push(`taakkoppelingen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  try {
    const offerProjectLineIds = Array.from(new Set([...directOfferProjectLineIds, ...taskOfferProjectLineIds.values()])).filter(
      (offerProjectLineId) => !offerProjectLines.has(offerProjectLineId)
    );
    const offerProjectLineIdChunks = chunksOf(offerProjectLineIds, 100);
    for (let index = 0; index < offerProjectLineIdChunks.length; index += PAGE_FETCH_BATCH_SIZE) {
      const results = await client.batch(
        offerProjectLineIdChunks.slice(index, index + PAGE_FETCH_BATCH_SIZE).map((idChunk) => ({
          method: "offerprojectline.get",
          params: [
            [{ field: "offerprojectline.id", operator: "in", value: idChunk }],
            {
              paging: { firstresult: 0, maxresults: PAGE_SIZE },
              orderings: [{ field: "offerprojectline.id", direction: "asc" }]
            }
          ] as JsonValue[]
        }))
      );

      for (const result of results) {
        for (const offerProjectLine of asRecords(result)) {
          const id = idFrom(readField(offerProjectLine, "id"));
          if (id !== null) {
            offerProjectLines.set(id, lineBillabilityFromRecord(offerProjectLine));
          }
        }
      }
    }
  } catch (error) {
    issues.push(`opdrachtregelprijzen niet geladen${errorCode(error) ? ` (${errorCode(error)})` : ""}`);
  }

  return { offerProjectLines, taskOfferProjectLineIds };
}

function lineBillabilityFromEmbeddedRecord(record: JsonRecord | undefined) {
  if (!record || readField(record, "sellingprice") === undefined) {
    return null;
  }

  return lineBillabilityFromRecord(record);
}

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function fetchPagedRecords(
  client: GrippClient,
  entity: string,
  filters: JsonValue[],
  orderings: JsonValue[],
  maxPages: number
) {
  const records: JsonRecord[] = [];
  const maxFirstResult = maxPages * PAGE_SIZE;
  let firstResult = 0;
  let pageSize = PAGE_SIZE;

  while (firstResult < maxFirstResult) {
    if (firstResult === 0) {
      const page = await fetchPagedRecordPage(client, entity, filters, orderings, firstResult, pageSize);
      records.push(...page.records);
      pageSize = page.maxResults;
      firstResult += page.maxResults;
      if (page.records.length < page.maxResults) {
        break;
      }
      continue;
    }

    const offsets = Array.from(
      { length: Math.min(PAGE_FETCH_BATCH_SIZE, Math.ceil((maxFirstResult - firstResult) / pageSize)) },
      (_, index) => firstResult + index * pageSize
    );
    const results = await client
      .batch(
        offsets.map((offset) => ({
          method: `${entity}.get`,
          params: pagedGetParams(filters, orderings, offset, pageSize)
        }))
      )
      .catch(() => null);

    if (!results) {
      const page = await fetchPagedRecordPage(client, entity, filters, orderings, firstResult, pageSize);
      records.push(...page.records);
      pageSize = page.maxResults;
      firstResult += page.maxResults;
      if (page.records.length < page.maxResults) {
        break;
      }
      continue;
    }

    let reachedLastPage = false;
    for (const [index, result] of results.entries()) {
      const pageRecords = asRecords(result);
      records.push(...pageRecords);
      firstResult = offsets[index] + pageSize;
      if (pageRecords.length < pageSize) {
        reachedLastPage = true;
        break;
      }
    }

    if (reachedLastPage) {
      break;
    }
  }

  return records;
}

async function fetchPagedRecordPage(
  client: GrippClient,
  entity: string,
  filters: JsonValue[],
  orderings: JsonValue[],
  firstResult: number,
  maxResults: number
) {
  let lastError: unknown;

  for (const pageSize of pagedRecordPageSizes(maxResults)) {
    try {
      return {
        records: asRecords(await client.call(`${entity}.get`, pagedGetParams(filters, orderings, firstResult, pageSize))),
        maxResults: pageSize
      };
    } catch (error) {
      if (!shouldRetryWithSmallerPage(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function pagedRecordPageSizes(maxResults: number) {
  return Array.from(new Set([maxResults, 100, 50].filter((size) => size > 0 && size <= maxResults)));
}

function shouldRetryWithSmallerPage(error: unknown) {
  return ["timeout", "upstream_http_error"].includes(errorCode(error));
}

function pagedGetParams(filters: JsonValue[], orderings: JsonValue[], firstResult: number, maxResults: number): JsonValue[] {
  return [
    filters,
    {
      paging: { firstresult: firstResult, maxresults: maxResults },
      orderings
    }
  ] as JsonValue[];
}

function buildPmDashboardData(
  invoices: JsonRecord[],
  crmRevenue: StripeCrmRevenue,
  hours: JsonRecord[],
  billabilitySources: BillabilitySources,
  capacitySources: CapacitySources,
  period: Period,
  source: DashboardSource,
  excludedEmployeeCount = 0,
  calendarItems: JsonRecord[] = [],
  employeeBillabilityPeriod: EmployeeBillabilityPeriod = employeeBillabilityPeriodFromPeriod(period, "year"),
  employeeBillabilityHours: JsonRecord[] = hours,
  employeeBillabilityCapacitySources: CapacitySources = capacitySources,
  employeeBillabilityCalendarItems: JsonRecord[] = calendarItems,
  employeeBillabilityOverheadSources: EmployeeBillabilityOverheadSources | null = null
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
  const yearEmployeeBillability = buildEmployeeBillabilityRows(employeeCapacityRows, hours, billabilitySources, calendarItems, period);
  const employeeBillabilityCapacityRows = buildEmployeeCapacityRows(
    employeeBillabilityCapacitySources,
    employeeBillabilityHours,
    employeeBillabilityPeriod
  );
  const employeeBillability = buildEmployeeBillabilityRows(
    employeeBillabilityCapacityRows,
    employeeBillabilityHours,
    billabilitySources,
    employeeBillabilityCalendarItems,
    employeeBillabilityPeriod
  );
  const employeeBillabilityOverhead = buildEmployeeBillabilityOverheadRow(
    employeeBillabilityOverheadSources,
    employeeBillabilityPeriod
  );
  const employeeBillabilitySummary = buildBillabilitySummary(
    employeeBillability,
    employeeBillabilityOverhead ? [employeeBillabilityOverhead] : []
  );
  const capacityRemainingHours = yearEmployeeBillability.reduce((total, row) => total + row.capacityRemainingHours, 0);
  const calendarItemHours = yearEmployeeBillability.reduce((total, row) => total + row.calendarItemHours, 0);
  const monthBuckets = makeMonthBuckets(period);
  const availableHoursByMonth = buildAvailableHoursByMonth(capacitySources, hours, period, monthBuckets);
  const employeeCostByMonth = buildEmployeeCostByMonth(capacitySources, hours, period, monthBuckets, employeeBillabilityOverheadSources);
  const calendarItemHoursByMonth = buildCalendarItemHoursByMonth(calendarItems, period);
  const revenueByMonthRows = monthBuckets.map((bucket) => ({
    ...bucket,
    revenue: revenueByMonth.get(bucket.key) ?? 0
  }));
  const agencyRevenueByMonthRows = revenueRowsIncludingCrmRevenue(revenueByMonthRows, crmRevenue.byMonth);
  const agencyCostProfitByMonth = agencyRevenueByMonthRows.map((row) => {
    const employeeCost = employeeCostByMonth.get(row.key) ?? 0;

    return {
      ...row,
      employeeCost,
      profit: row.revenue - employeeCost
    };
  });
  const billabilityByMonth = monthBuckets.map((bucket) => {
    const monthlyBillableHours = billableHoursByMonth.get(bucket.key) ?? 0;
    const monthlyAvailableHours = availableHoursByMonth.get(bucket.key) ?? 0;

    return {
      key: bucket.key,
      label: bucket.label,
      billableHours: monthlyBillableHours,
      availableHours: monthlyAvailableHours,
      billability: percent(monthlyBillableHours, monthlyAvailableHours)
    };
  });
  const revenuePerBillableHourByMonth = monthBuckets.map((bucket) => {
    const monthlyRevenue = revenueByMonth.get(bucket.key) ?? 0;
    const monthlyBillableHours = billableHoursByMonth.get(bucket.key) ?? 0;
    const monthlyCalendarItemHours = calendarItemHoursByMonth.get(bucket.key) ?? 0;

    return {
      ...bucket,
      revenue: monthlyRevenue,
      billableHours: monthlyBillableHours,
      calendarItemHours: monthlyCalendarItemHours,
      revenuePerBillableHour: divideCurrency(monthlyRevenue, monthlyBillableHours),
      revenuePerCalendarItemHour: divideCurrency(monthlyRevenue, monthlyCalendarItemHours)
    };
  });

  return {
    period,
    employeeBillabilityPeriod,
    employeeBillabilitySummary,
    source,
    revenue,
    crmRevenue,
    loggedHours,
    billableHours,
    unbillableLoggedHours: Math.max(0, loggedHours - billableHours),
    contractHours: capacity.contractHours,
    leaveHours: capacity.leaveHours,
    availableHours: capacity.availableHours,
    employeeCost: capacity.employeeCost,
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
    employeeBillabilityOverhead,
    billabilityByMonth,
    revenueByMonth: revenueByMonthRows,
    agencyCostProfitByMonth,
    revenuePerBillableHourByMonth,
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      timeZone: PM_DASHBOARD_TIME_ZONE,
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
  return amount === null ? null : { amount: signedGrippInvoiceRevenueAmount(invoice, amount), monthKey };
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

    const leaveLines = leaveByEmployeeId.get(employeeId) ?? [];
    const leaveFromRequestLines = leaveHoursForEmployee(leaveLines, capacityStart, period.end);
    const leaveFromWorkingHours = capacitySources.leaveHoursFromWorkingHoursByEmployeeId.get(employeeId) ?? 0;
    const leaveHours = leaveLines.length > 0 ? leaveFromRequestLines : leaveFromWorkingHours;
    const paidOvertimeHours = Math.max(0, capacitySources.paidOvertimeHoursByEmployeeId.get(employeeId) ?? 0);
    const availableHours = Math.max(0, contractHours - leaveHours);
    const costPerHour = employeeCostPerHour(employee);

    rows.push({
      employeeId,
      name: employeeDisplayName(employee, employeeId),
      contractHours,
      leaveHours,
      availableHours,
      costPerHour,
      employeeCost: employeeCostFromHours(availableHours, leaveHours, costPerHour),
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
  const employeeCost = employeeCapacityRows.reduce((total, row) => total + (row.employeeCost ?? 0), 0);
  return {
    contractHours,
    leaveHours,
    availableHours,
    employeeCost,
    employeeCount: employeeCapacityRows.length,
    fallbackWorkingHoursEmployeeCount: employeeCapacityRows.filter((row) => row.usedWorkingHoursFallback).length
  };
}

function buildBillabilitySummary(
  employeeBillabilityRows: EmployeeBillabilityRow[],
  extraCostRows: EmployeeBillabilityRow[] = []
): BillabilitySummary {
  const costRows = [...employeeBillabilityRows, ...extraCostRows];
  const billableHours = employeeBillabilityRows.reduce((total, row) => total + row.billableHours, 0);
  const availableHours = employeeBillabilityRows.reduce((total, row) => total + row.availableHours, 0);
  const employeeCost = costRows.reduce((total, row) => total + (row.employeeCost ?? 0), 0);

  return {
    billableHours,
    availableHours,
    employeeCost,
    missingCostPerHourCount: missingCostPerHourCount(costRows),
    billability: percent(billableHours, availableHours)
  };
}

function buildEmployeeBillabilityOverheadRow(
  sources: EmployeeBillabilityOverheadSources | null,
  period: Period
): EmployeeBillabilityOverheadRow | null {
  if (!sources) {
    return null;
  }

  const capacityRows = buildOverheadCapacityRows(sources.capacitySources.employees, period);
  if (capacityRows.length === 0) {
    return null;
  }

  const contractHours = capacityRows.reduce((total, row) => total + row.contractHours, 0);
  const availableHours = capacityRows.reduce((total, row) => total + row.availableHours, 0);
  const employeeCost = capacityRows.reduce((total, row) => total + (row.employeeCost ?? 0), 0);
  const costedHours = capacityRows.reduce((total, row) => total + Math.max(0, row.availableHours + row.leaveHours), 0);
  const costPerHourValues = capacityRows.map((row) => row.costPerHour).filter((value): value is number => value !== null);

  return {
    employeeId: OVERHEAD_EMPLOYEE_ID,
    name: "Overhead",
    contractHours,
    leaveHours: 0,
    availableHours,
    costPerHour: costedHours > 0 ? employeeCost / costedHours : averageNumber(costPerHourValues),
    employeeCost,
    paidOvertimeHours: 0,
    usedWorkingHoursFallback: false,
    employeeCount: capacityRows.length,
    loggedHours: 0,
    billableHours: 0,
    unbillableLoggedHours: 0,
    capacityRemainingHours: 0,
    calendarItemHours: 0,
    planningWithoutTaskHours: 0,
    billability: 0
  };
}

function buildOverheadCapacityRows(employees: JsonRecord[], period: Period): EmployeeCapacityRow[] {
  const rows: EmployeeCapacityRow[] = [];

  for (const employee of employees) {
    const employeeId = idFrom(readField(employee, "id"));
    const costPerHour = employeeCostPerHour(employee);
    if (employeeId === null || costPerHour === null) {
      continue;
    }

    const capacityStart = maxDateKey(period.start, employeeStartDate(employee));
    if (capacityStart > period.end) {
      continue;
    }

    const contractHours = calculateOverheadContractHours(capacityStart, period.end);

    rows.push({
      employeeId,
      name: employeeDisplayName(employee, employeeId),
      contractHours,
      leaveHours: 0,
      availableHours: contractHours,
      costPerHour,
      employeeCost: employeeCostFromHours(contractHours, 0, costPerHour),
      paidOvertimeHours: 0,
      usedWorkingHoursFallback: false
    });
  }

  return rows.sort(compareEmployeeCapacityRows);
}

function buildEmployeeBillabilityTableTotals(
  employeeBillabilityRows: EmployeeBillabilityRow[],
  overheadRow: EmployeeBillabilityOverheadRow | null = null
) {
  const costRows = overheadRow ? [...employeeBillabilityRows, overheadRow] : employeeBillabilityRows;
  const billableHours = employeeBillabilityRows.reduce((total, row) => total + row.billableHours, 0);
  const availableHours = employeeBillabilityRows.reduce((total, row) => total + row.availableHours, 0);
  const calendarItemHours = employeeBillabilityRows.reduce((total, row) => total + row.calendarItemHours, 0);
  const paidOvertimeHours = employeeBillabilityRows.reduce((total, row) => total + row.paidOvertimeHours, 0);
  const planningWithoutTaskHours = employeeBillabilityRows.reduce((total, row) => total + row.planningWithoutTaskHours, 0);
  const leaveHours = employeeBillabilityRows.reduce((total, row) => total + row.leaveHours, 0);
  const employeeCost = costRows.reduce((total, row) => total + (row.employeeCost ?? 0), 0);
  const capacityRemainingHours = employeeBillabilityRows.reduce((total, row) => total + row.capacityRemainingHours, 0);
  const costedHours = employeeBillabilityRows.reduce(
    (total, row) => total + (row.costPerHour === null ? 0 : Math.max(0, row.availableHours + row.leaveHours)),
    0
  );

  return {
    billableHours,
    availableHours,
    calendarItemHours,
    paidOvertimeHours,
    planningWithoutTaskHours,
    leaveHours,
    employeeCost,
    capacityRemainingHours,
    costPerHour: costedHours > 0 ? employeeCost / costedHours : null,
    billability: percent(billableHours, availableHours)
  };
}

function averageNumber(values: number[]) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function buildEmployeeCostByMonth(
  capacitySources: CapacitySources,
  hours: JsonRecord[],
  period: Period,
  monthBuckets: MonthRevenue[],
  overheadSources: EmployeeBillabilityOverheadSources | null = null
) {
  const employeeCostByMonth = new Map(monthBuckets.map((bucket) => [bucket.key, 0]));
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

  for (const [employeeId, employee] of employeesById.entries()) {
    if (booleanFrom(readField(employee, "active")) === false && !referencedEmployeeIds.has(employeeId)) {
      continue;
    }

    const costPerHour = employeeCostPerHour(employee);
    if (costPerHour === null) {
      continue;
    }

    addMonthlyEmployeeContractCost(employeeCostByMonth, monthBuckets, period, employee, costPerHour, (start, end) => {
      const capacityStart = maxDateKey(period.start, employeeStartDate(employee));
      const totalDefaultContractHours = calculateDefaultContractHours(capacityStart, period.end);
      const workingHours = capacitySources.workingHoursByEmployeeId.get(employeeId);
      const contractScale =
        workingHours === undefined || totalDefaultContractHours <= 0 ? 1 : Math.max(0, workingHours) / totalDefaultContractHours;
      const defaultContractHours = calculateDefaultContractHours(start, end);

      return workingHours === undefined ? defaultContractHours : defaultContractHours * contractScale;
    });
  }

  if (overheadSources) {
    for (const employee of overheadSources.capacitySources.employees) {
      const costPerHour = employeeCostPerHour(employee);
      if (costPerHour === null) {
        continue;
      }

      addMonthlyEmployeeContractCost(employeeCostByMonth, monthBuckets, period, employee, costPerHour, calculateOverheadContractHours);
    }
  }

  return employeeCostByMonth;
}

function addMonthlyEmployeeContractCost(
  employeeCostByMonth: Map<string, number>,
  monthBuckets: MonthRevenue[],
  period: Period,
  employee: JsonRecord,
  costPerHour: number,
  contractHoursForRange: (start: string, end: string) => number
) {
  const capacityStart = maxDateKey(period.start, employeeStartDate(employee));
  if (capacityStart > period.end) {
    return;
  }

  for (const bucket of monthBuckets) {
    const monthStart = maxDateKey(capacityStart, `${bucket.key}-01`);
    const monthEnd = minDateKey(period.end, monthEndDateKey(bucket.key));
    if (monthStart > monthEnd) {
      continue;
    }

    const contractHours = contractHoursForRange(monthStart, monthEnd);
    const employeeCost = employeeCostFromHours(contractHours, 0, costPerHour) ?? 0;
    employeeCostByMonth.set(bucket.key, (employeeCostByMonth.get(bucket.key) ?? 0) + employeeCost);
  }
}

function buildAvailableHoursByMonth(capacitySources: CapacitySources, hours: JsonRecord[], period: Period, monthBuckets: MonthRevenue[]) {
  const availableHoursByMonth = new Map(monthBuckets.map((bucket) => [bucket.key, 0]));
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

  for (const [employeeId, employee] of employeesById.entries()) {
    if (booleanFrom(readField(employee, "active")) === false && !referencedEmployeeIds.has(employeeId)) {
      continue;
    }

    const capacityStart = maxDateKey(period.start, employeeStartDate(employee));
    if (capacityStart > period.end) {
      continue;
    }

    const leaveLines = leaveByEmployeeId.get(employeeId) ?? [];
    const lineLeaveHours = leaveHoursForEmployee(leaveLines, capacityStart, period.end);
    const workingHoursLeave = capacitySources.leaveHoursFromWorkingHoursByEmployeeId.get(employeeId) ?? 0;
    const extraLeaveHours = Math.max(0, workingHoursLeave - lineLeaveHours);
    const totalDefaultContractHours = calculateDefaultContractHours(capacityStart, period.end);
    const workingHours = capacitySources.workingHoursByEmployeeId.get(employeeId);
    const contractScale =
      workingHours === undefined || totalDefaultContractHours <= 0 ? 1 : Math.max(0, workingHours) / totalDefaultContractHours;

    for (const bucket of monthBuckets) {
      const monthStart = maxDateKey(capacityStart, `${bucket.key}-01`);
      const monthEnd = minDateKey(period.end, monthEndDateKey(bucket.key));
      if (monthStart > monthEnd) {
        continue;
      }

      const defaultContractHours = calculateDefaultContractHours(monthStart, monthEnd);
      const contractHours = workingHours === undefined ? defaultContractHours : defaultContractHours * contractScale;
      const monthlyLineLeaveHours = leaveHoursForEmployee(leaveLines, monthStart, monthEnd);
      const monthlyExtraLeaveHours =
        totalDefaultContractHours > 0 ? extraLeaveHours * (defaultContractHours / totalDefaultContractHours) : 0;
      const availableHours = Math.max(0, contractHours - monthlyLineLeaveHours - monthlyExtraLeaveHours);

      availableHoursByMonth.set(bucket.key, (availableHoursByMonth.get(bucket.key) ?? 0) + availableHours);
    }
  }

  return availableHoursByMonth;
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

function buildCalendarItemHoursByMonth(calendarItems: JsonRecord[], period: Period) {
  const calendarItemHoursByMonth = new Map<string, number>();

  for (const calendarItem of calendarItems) {
    const date = dateKeyFromValue(readField(calendarItem, "date"));
    const monthKey = monthKeyForDateInPeriod(date, period);
    if (!monthKey) {
      continue;
    }

    const amount = Math.max(0, numberFrom(readField(calendarItem, "hours")) ?? 0);
    if (amount === 0) {
      continue;
    }

    calendarItemHoursByMonth.set(monthKey, (calendarItemHoursByMonth.get(monthKey) ?? 0) + amount);
  }

  return calendarItemHoursByMonth;
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
        capacityRemainingHours: row.availableHours - calendarItemHours.hours + row.paidOvertimeHours,
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
    const absenceRequestId = relationId(line, "absencerequest");
    const absenceRequest = absenceRequestId === null ? undefined : absenceRequestsById.get(absenceRequestId);
    if (!isCountedLeaveAbsenceStatus(absenceStatusValue(line), absenceRequest ? absenceStatusValue(absenceRequest) : undefined)) {
      continue;
    }

    const date = dateKeyFromValue(readField(line, "date"));
    if (!date || date < period.start || date > period.end) {
      continue;
    }

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
    if (!isCountedPaidOvertimeAbsenceStatus(readField(line, "absencerequeststatus"))) {
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

    const amount = Math.abs(numberFrom(readField(line, "amount")) ?? 0);
    if (amount === 0) {
      continue;
    }

    paidOvertimeHoursByEmployeeId.set(employeeId, (paidOvertimeHoursByEmployeeId.get(employeeId) ?? 0) + amount);
  }

  return paidOvertimeHoursByEmployeeId;
}

function isCountedLeaveAbsenceStatus(lineStatus: unknown, requestStatus: unknown) {
  const lineStatusValues = absenceStatusComparisonValues(lineStatus);
  const statusValues = lineStatusValues.length > 0 ? lineStatusValues : absenceStatusComparisonValues(requestStatus);
  if (statusValues.length === 0) {
    return true;
  }

  return statusValues.some((status) => COUNTED_LEAVE_ABSENCE_STATUSES.has(status));
}

function isCountedPaidOvertimeAbsenceStatus(value: unknown) {
  const statusValues = absenceStatusComparisonValues(value);
  if (statusValues.length === 0) {
    return true;
  }

  return !statusValues.some((status) => REJECTED_ABSENCE_STATUSES.has(status.toUpperCase()) || REJECTED_ABSENCE_STATUSES.has(status));
}

function absenceStatusComparisonValues(value: unknown) {
  const values = new Set<string>();
  const scalar = stringFrom(value);
  if (scalar) {
    values.add(scalar);
  }

  const record = asRecord(value);
  if (record) {
    recordTextValues(record).forEach((entry) => values.add(entry));
  } else if (Array.isArray(value)) {
    value.forEach((entry) => absenceStatusComparisonValues(entry).forEach((status) => values.add(status)));
  }

  return Array.from(values).map(normalizeComparisonValue).filter(Boolean);
}

function absenceStatusValue(record: JsonRecord) {
  for (const field of ["absencerequeststatus", "status", "state"]) {
    const value = readField(record, field);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function isPaidOvertimeAbsenceLine(line: JsonRecord, absenceRequest?: JsonRecord) {
  const absenceTypeId = relationId(line, "absencetype") ?? (absenceRequest ? relationId(absenceRequest, "absencetype") : null);
  if (absenceTypeId !== null && paidOvertimeAbsenceTypeIds().has(absenceTypeId)) {
    return true;
  }

  const text = [line, absenceRequest].flatMap((record) => (record ? recordTextValues(record) : [])).join(" ");
  const normalizedText = normalizeComparisonValue(text);
  return (
    paidOvertimeAbsenceTypeNames().some((absenceTypeName) => absenceTypeName && normalizedText.includes(absenceTypeName)) ||
    normalizedText.includes("opbouwoveruren") ||
    normalizedText.includes("opbouwoveruur") ||
    (normalizedText.includes("opbouw") && (normalizedText.includes("overuren") || normalizedText.includes("overuur")))
  );
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

function employeeCostPerHour(employee: JsonRecord): number | null {
  const directCost = numberFromMatchingField(employee, isEmployeeCostPerHourFieldName);
  if (directCost !== null) {
    return Math.max(0, directCost);
  }

  const customFieldCost = customFieldNumberFrom(readField(employee, "customfields"), isEmployeeCostPerHourFieldName);
  return customFieldCost === null ? null : Math.max(0, customFieldCost);
}

function employeeCostFromHours(availableHours: number, leaveHours: number, costPerHour: number | null) {
  if (costPerHour === null) {
    return null;
  }

  return Math.max(0, availableHours + leaveHours) * costPerHour;
}

function numberFromMatchingField(record: JsonRecord, matches: (field: string) => boolean) {
  for (const [key, value] of Object.entries(record)) {
    if (!matches(key) && !matches(lastFieldSegment(key))) {
      continue;
    }

    const number = employeeCostNumberFrom(value);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function customFieldNumberFrom(value: unknown, matches: (field: string) => boolean, seen = new Set<unknown>()): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const parsed = jsonValueFromString(value);
    return parsed === null ? null : customFieldNumberFrom(parsed, matches, seen);
  }

  if (typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const number = customFieldNumberFrom(item, matches, seen);
      if (number !== null) {
        return number;
      }
    }

    return null;
  }

  const record = value as JsonRecord;
  const customFieldIds = employeeCostPerHourCustomFieldIds();
  const customFieldId = customFieldIdFromRecord(record);
  if (customFieldId !== null && customFieldIds.has(customFieldId)) {
    const number = customFieldValueNumber(record);
    if (number !== null) {
      return number;
    }
  }

  if (customFieldNames(record).some(matches)) {
    const number = customFieldValueNumber(record);
    if (number !== null) {
      return number;
    }
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    const customFieldKeyId = customFieldIdFromKey(key);
    if (!matches(key) && !matches(lastFieldSegment(key)) && (customFieldKeyId === null || !customFieldIds.has(customFieldKeyId))) {
      continue;
    }

    const number = customFieldValueNumber(nestedValue);
    if (number !== null) {
      return number;
    }
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (CUSTOM_FIELD_META_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      continue;
    }

    const number = customFieldNumberFrom(nestedValue, matches, seen);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function customFieldNames(record: JsonRecord) {
  const names: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (!CUSTOM_FIELD_NAME_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      continue;
    }

    collectCustomFieldNames(value, names, new Set<unknown>());
  }

  return names;
}

function collectCustomFieldNames(value: unknown, names: string[], seen: Set<unknown>) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value !== "object") {
    const name = stringFrom(value);
    if (name) {
      names.push(name);
    }
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  const record = asRecord(value);
  if (!record) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (CUSTOM_FIELD_RELATION_NAME_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      collectCustomFieldNames(nestedValue, names, seen);
    }
  }
}

function customFieldValueNumber(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) {
    return employeeCostNumberFrom(value);
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (!CUSTOM_FIELD_VALUE_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      continue;
    }

    const number = customFieldPrimitiveNumber(nestedValue);
    if (number !== null) {
      return number;
    }
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (CUSTOM_FIELD_META_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      continue;
    }

    const number = customFieldPrimitiveNumber(nestedValue);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function customFieldPrimitiveNumber(value: unknown, seen = new Set<unknown>()): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object") {
    return employeeCostNumberFrom(value);
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const number = customFieldPrimitiveNumber(item, seen);
      if (number !== null) {
        return number;
      }
    }

    return null;
  }

  for (const [key, nestedValue] of Object.entries(value as JsonRecord)) {
    if (CUSTOM_FIELD_META_KEYS.has(normalizeComparisonValue(lastFieldSegment(key)))) {
      continue;
    }

    const number = customFieldPrimitiveNumber(nestedValue, seen);
    if (number !== null) {
      return number;
    }
  }

  return null;
}

function employeeCostNumberFrom(value: unknown): number | null {
  const number = numberFrom(value);
  if (number !== null) {
    return number;
  }

  const scalar = scalarFrom(value);
  if (typeof scalar !== "string") {
    return null;
  }

  const normalized = normalizeCurrencyNumberString(scalar);
  return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}

function isEmployeeCostPerHourFieldName(value: string) {
  const normalizedValue = normalizeComparisonValue(lastFieldSegment(value));
  if (employeeCostPerHourFieldKeys().has(normalizedValue)) {
    return true;
  }

  const hasCost = normalizedValue.includes("cost") || normalizedValue.includes("kost");
  const hasHour = normalizedValue.includes("hour") || normalizedValue.includes("uur");
  const hasEmployee = normalizedValue.includes("employee") || normalizedValue.includes("medewerker");

  return hasCost && hasHour && (hasEmployee || normalizedValue.includes("perhour") || normalizedValue.includes("peruur"));
}

function employeeCostPerHourFieldKeys() {
  return new Set([
    ...EMPLOYEE_COST_PER_HOUR_FIELD_KEYS,
    ...listFromEnv(firstConfiguredEnvValue(EMPLOYEE_COST_PER_HOUR_FIELD_NAME_ENV_NAMES)).map(normalizeComparisonValue)
  ]);
}

function employeeCostPerHourCustomFieldIds() {
  return numberSetFromEnv(firstConfiguredEnvValue(EMPLOYEE_COST_PER_HOUR_CUSTOM_FIELD_ID_ENV_NAMES));
}

function customFieldIdFromRecord(record: JsonRecord) {
  return (
    idFrom(readField(record, "id")) ??
    idFrom(readField(record, "customfield")) ??
    idFrom(readField(record, "customfieldid")) ??
    idFrom(readField(record, "customField")) ??
    idFrom(readField(record, "customFieldId"))
  );
}

function customFieldIdFromKey(key: string) {
  const segment = lastFieldSegment(key);
  const direct = numberFrom(segment);
  if (direct !== null) {
    return direct;
  }

  const match = segment.match(/\d+/g);
  if (!match) {
    return null;
  }

  return numberFrom(match[match.length - 1]);
}

function missingCostPerHourCount(rows: Pick<EmployeeCapacityRow, "availableHours" | "leaveHours" | "costPerHour">[]) {
  return rows.filter((row) => row.costPerHour === null && Math.max(0, row.availableHours + row.leaveHours) > 0).length;
}

function lastFieldSegment(value: string) {
  const parts = value.split(".");
  return parts[parts.length - 1] ?? value;
}

function jsonValueFromString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeCurrencyNumberString(value: string) {
  const compact = value.replace(/\s+/g, "").replace(/[^0-9,.-]+/g, "");
  return normalizeNumberString(compact);
}

function calculateDefaultContractHours(start: string, end: string) {
  return datesInRange(start, end).reduce((total, date) => total + defaultDailyContractHours(date), 0);
}

function calculateOverheadContractHours(start: string, end: string) {
  return datesInRange(start, end).reduce((total, date) => total + overheadDailyHours(date), 0);
}

function overheadDailyHours(date: string) {
  const parsedDate = parseDateKey(date);
  if (!parsedDate) {
    return 0;
  }

  const day = parsedDate.getDay();
  return day === 0 || day === 6 ? 0 : OVERHEAD_DAILY_HOURS;
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

function getCurrentMonthPeriod(): Period {
  const end = currentDateKey();
  return buildPeriod(`${end.slice(0, 7)}-01`, end);
}

function getCurrentWeekPeriod(): Period {
  const end = currentDateKey();
  const endDate = parseDateKey(end) ?? new Date();
  const daysSinceMonday = (endDate.getDay() + 6) % 7;
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - daysSinceMonday);

  return buildPeriod(dateKey(startDate), end);
}

function customEmployeeBillabilityPeriodFromParams(params: PmSearchParams): Period | null {
  const start = firstParam(params.employeeStart);
  const end = firstParam(params.employeeEnd);
  if (!isDateKey(start) || !isDateKey(end)) {
    return null;
  }

  return start <= end ? buildPeriod(start, end) : buildPeriod(end, start);
}

function employeeBillabilityPeriodFromPeriod(period: Period, preset: PmEmployeeBillabilityPeriodPreset): EmployeeBillabilityPeriod {
  return {
    ...period,
    preset
  };
}

function buildPeriod(start: string, end: string): Period {
  return {
    start,
    end,
    year: start.slice(0, 4),
    label: `${formatDate(start)} - ${formatDate(end)}`
  };
}

function mergePeriods(left: Period, right: Period): Period {
  return buildPeriod(minDateKey(left.start, right.start), maxDateKey(left.end, right.end));
}

function samePeriod(left: Period, right: Period) {
  return left.start === right.start && left.end === right.end;
}

function currentDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PM_DASHBOARD_TIME_ZONE,
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

function minDateKey(left: string, right: string) {
  return left < right ? left : right;
}

function monthEndDateKey(value: string) {
  const [year, month] = value.split("-").map(Number);
  return dateKey(new Date(year, month, 0));
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

function formatOptionalCurrency(value: number | null) {
  return value === null ? "-" : formatCurrency(value);
}

function formatOptionalCurrencyPerHour(value: number | null) {
  return value === null ? "-" : formatCurrencyPerHour(value);
}

function formatVatRate(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function formatEmployeeCount(value: number) {
  return `${value} werknemer${value === 1 ? "" : "s"}`;
}

function formatOverheadEmployeeCount(value: number) {
  return `${value} overheadmedewerker${value === 1 ? "" : "s"}`;
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

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function paramValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
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
    {
      id: 1,
      screenname: "Noor de Vries",
      employeesince: `${period.year}-01-01`,
      active: true,
      role: { id: 2, searchname: "Medewerker" },
      customfield_internekostprijsperuur: 72
    },
    {
      id: 2,
      screenname: "Milan Jansen",
      employeesince: `${period.year}-02-01`,
      active: true,
      role: { id: 2, searchname: "Medewerker" },
      customfields: [{ name: "Interne kostprijs per uur", value: 64 }]
    },
    {
      id: 3,
      screenname: "Jasmijn Bakker",
      employeesince: `${period.year}-01-15`,
      active: false,
      role: { id: 2, searchname: "Medewerker" },
      "Interne kostprijs van medewerker": 58
    },
    {
      id: 4,
      screenname: "Daan Smit",
      employeesince: `${period.year}-03-01`,
      active: true,
      role: { id: 1, searchname: "Beheerder" },
      "Interne kostprijs van medewerker": 80
    }
  ];
  const workingHoursByEmployeeId = new Map<number, number>([
    [1, calculateDefaultContractHours(maxDateKey(period.start, `${period.year}-01-01`), period.end)],
    [2, calculateDefaultContractHours(maxDateKey(period.start, `${period.year}-02-01`), period.end)],
    [3, calculateDefaultContractHours(maxDateKey(period.start, `${period.year}-01-15`), period.end) * 0.8]
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

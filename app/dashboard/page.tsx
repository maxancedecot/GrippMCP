import type { CSSProperties } from "react";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type Classification = "billable" | "nonbillable" | "unknown";

type Period = {
  start: string;
  end: string;
  label: string;
  shortMonth: string;
  weekBuckets: WeekBucket[];
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
  billable: number;
  nonbillable: number;
  unknown: number;
  total: number;
};

type EmployeeRow = Aggregate & {
  id: string;
  name: string;
  billability: number;
};

type WeekRow = Aggregate & {
  key: string;
  label: string;
};

type StatusRow = Aggregate & {
  status: string;
  billability: number;
};

type ProjectLineRow = Aggregate & {
  id: string;
  name: string;
  invoiceBasis: string;
  billability: number;
};

type DashboardData = Aggregate & {
  period: Period;
  source: DashboardSource;
  billability: number;
  employeeRows: EmployeeRow[];
  weekRows: WeekRow[];
  statusRows: StatusRow[];
  projectLineRows: ProjectLineRow[];
  lastUpdated: string;
};

const hoursFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const percentFormatter = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export default async function DashboardPage() {
  const dashboard = await getDashboardData();
  const gaugeStyle = {
    "--gauge": `${dashboard.billability * 3.6}deg`
  } as CSSProperties;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Gripp uren</p>
          <h1>Billabelheid</h1>
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

      <section className="metric-grid" aria-label="Kerncijfers billabelheid">
        <MetricCard label="Billabelheid" value={`${formatPercent(dashboard.billability)}%`} detail="Billabel / totaal geschreven" tone="good" />
        <MetricCard label="Billabele uren" value={formatHours(dashboard.billable)} detail="Gekoppeld aan factureerbare regels" tone="blue" />
        <MetricCard label="Niet-billabel" value={formatHours(dashboard.nonbillable)} detail="Projectregels met NONBILLABLE" tone="warning" />
        <MetricCard label="Onbekend" value={formatHours(dashboard.unknown)} detail="Niet te classificeren uit de urenregel" tone="neutral" />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--distribution">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Verdeling</p>
              <h2>Geschreven uren</h2>
            </div>
            <span className="panel-total">{formatHours(dashboard.total)} uur</span>
          </div>

          <div className="distribution-layout">
            <div className="gauge" style={gaugeStyle} aria-label={`Billabelheid ${formatPercent(dashboard.billability)} procent`}>
              <div className="gauge-inner">
                <strong>{formatPercent(dashboard.billability)}%</strong>
                <span>billabel</span>
              </div>
            </div>

            <dl className="legend-list">
              <LegendItem label="Billabel" value={dashboard.billable} className="legend-dot--good" />
              <LegendItem label="Niet-billabel" value={dashboard.nonbillable} className="legend-dot--warning" />
              <LegendItem label="Onbekend" value={dashboard.unknown} className="legend-dot--neutral" />
            </dl>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Trend</p>
              <h2>Per week</h2>
            </div>
          </div>

          <div className="weekly-list">
            {dashboard.weekRows.map((week) => (
              <StackedBar
                key={week.key}
                label={week.label}
                aggregate={week}
                trailing={`${formatPercent(percent(week.billable, week.total))}%`}
              />
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
                  <th>Uren</th>
                  <th>Billabel</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.employeeRows.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <span className="row-title">{employee.name}</span>
                    </td>
                    <td>{formatHours(employee.total)}</td>
                    <td>
                      <InlineBar aggregate={employee} />
                      <span className="cell-muted">{formatPercent(employee.billability)}%</span>
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
              <p className="eyebrow">Status</p>
              <h2>Urenstatus</h2>
            </div>
          </div>

          <div className="status-list">
            {dashboard.statusRows.map((status) => (
              <StackedBar
                key={status.status}
                label={formatStatus(status.status)}
                aggregate={status}
                trailing={`${formatPercent(status.billability)}%`}
              />
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Projectregels</p>
            <h2>Niet-billabele impact</h2>
          </div>
        </div>

        {dashboard.projectLineRows.length > 0 ? (
          <div className="project-line-list">
            {dashboard.projectLineRows.map((line) => (
              <div className="project-line-row" key={line.id}>
                <div>
                  <span className="row-title">{line.name}</span>
                  <span className="cell-muted">{line.invoiceBasis}</span>
                </div>
                <div className="project-line-metrics">
                  <span>{formatHours(line.nonbillable)} niet-billabel</span>
                  <span>{formatHours(line.total)} totaal</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Geen niet-billabele uren gevonden in deze periode.</p>
        )}
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

function LegendItem({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div>
      <dt>
        <span className={`legend-dot ${className}`} />
        {label}
      </dt>
      <dd>{formatHours(value)} uur</dd>
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
      <span className="cell-muted">{formatHours(aggregate.total)} uur</span>
    </div>
  );
}

function InlineBar({ aggregate }: { aggregate: Aggregate }) {
  const billableWidth = percent(aggregate.billable, aggregate.total);
  const nonBillableWidth = percent(aggregate.nonbillable, aggregate.total);
  const unknownWidth = Math.max(0, 100 - billableWidth - nonBillableWidth);

  return (
    <div className="inline-bar" aria-hidden="true">
      <span className="bar-segment bar-segment--good" style={{ width: `${billableWidth}%` }} />
      <span className="bar-segment bar-segment--warning" style={{ width: `${nonBillableWidth}%` }} />
      <span className="bar-segment bar-segment--neutral" style={{ width: `${unknownWidth}%` }} />
    </div>
  );
}

async function getDashboardData(): Promise<DashboardData> {
  const period = getCurrentMonthPeriod();

  if (!process.env.GRIPP_API_TOKEN) {
    return buildDashboardData(createDemoHours(period), createDemoEmployees(), createDemoProjectLines(), period, {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-uren te tonen."
    });
  }

  try {
    const client = new GrippClient();
    const [hoursResult, employeesResult] = await client.batch([
      {
        method: "hour.get",
        params: [
          [
            { field: "hour.date", operator: "greaterequals", value: period.start },
            { field: "hour.date", operator: "lessequals", value: period.end }
          ],
          {
            paging: { firstresult: 0, maxresults: 250 },
            orderings: [{ field: "hour.date", direction: "asc" }]
          }
        ] as JsonValue[]
      },
      {
        method: "employee.get",
        params: [
          [],
          {
            paging: { firstresult: 0, maxresults: 250 },
            orderings: [{ field: "employee.screenname", direction: "asc" }]
          }
        ] as JsonValue[]
      }
    ]);

    const hours = asRecords(hoursResult);
    const employees = asRecords(employeesResult);
    const projectLines = await fetchProjectLines(client, hours);

    return buildDashboardData(hours, employees, projectLines, period, {
      mode: "live",
      message: ""
    });
  } catch (error) {
    return buildDashboardData(createDemoHours(period), createDemoEmployees(), createDemoProjectLines(), period, {
      mode: "demo",
      message: `Live data kon niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    });
  }
}

async function fetchProjectLines(client: GrippClient, hours: JsonRecord[]) {
  const ids = Array.from(
    new Set(
      hours
        .map((hour) => idFrom(readField(hour, "offerprojectline")))
        .filter((id): id is number => id !== null)
    )
  );

  if (ids.length === 0) {
    return [];
  }

  const chunks = chunk(ids, 75);
  const calls = chunks.map((idsChunk) => ({
    method: "offerprojectline.get",
    params: [
      [{ field: "offerprojectline.id", operator: "in", value: idsChunk }],
      {
        paging: { firstresult: 0, maxresults: 250 },
        orderings: [{ field: "offerprojectline.id", direction: "asc" }]
      }
    ] as JsonValue[]
  }));

  const results = await client.batch(calls);
  return results.flatMap((result) => asRecords(result));
}

function buildDashboardData(
  hours: JsonRecord[],
  employees: JsonRecord[],
  projectLines: JsonRecord[],
  period: Period,
  source: DashboardSource
): DashboardData {
  const employeesById = new Map<number, JsonRecord>();
  const linesById = new Map<number, JsonRecord>();

  employees.forEach((employee) => {
    const id = idFrom(readField(employee, "id"));
    if (id !== null) {
      employeesById.set(id, employee);
    }
  });

  projectLines.forEach((line) => {
    const id = idFrom(readField(line, "id"));
    if (id !== null) {
      linesById.set(id, line);
    }
  });

  const totals = emptyAggregate();
  const employeeMap = new Map<string, EmployeeRow>();
  const statusMap = new Map<string, StatusRow>();
  const projectLineMap = new Map<string, ProjectLineRow>();
  const weekMap = new Map<string, WeekRow>(
    period.weekBuckets.map((bucket) => [bucket.key, { ...emptyAggregate(), key: bucket.key, label: bucket.label }])
  );

  for (const hour of hours) {
    const amount = Math.max(0, numberFrom(readField(hour, "amount")) ?? 0);
    if (amount === 0) {
      continue;
    }

    const classification = classifyHour(hour, linesById);
    addToAggregate(totals, classification, amount);

    const employeeId = idFrom(readField(hour, "employee"));
    const employeeKey = employeeId !== null ? String(employeeId) : "unknown";
    const employeeRow =
      employeeMap.get(employeeKey) ??
      ({
        ...emptyAggregate(),
        id: employeeKey,
        name: employeeName(hour, employeeId !== null ? employeesById.get(employeeId) : undefined),
        billability: 0
      } satisfies EmployeeRow);
    addToAggregate(employeeRow, classification, amount);
    employeeMap.set(employeeKey, employeeRow);

    const status = stringFrom(readField(hour, "status")) || "UNKNOWN";
    const statusRow =
      statusMap.get(status) ??
      ({
        ...emptyAggregate(),
        status,
        billability: 0
      } satisfies StatusRow);
    addToAggregate(statusRow, classification, amount);
    statusMap.set(status, statusRow);

    const weekKey = weekKeyForDate(stringFrom(readField(hour, "date")), period);
    const weekRow = weekMap.get(weekKey);
    if (weekRow) {
      addToAggregate(weekRow, classification, amount);
    }

    const projectLineId = idFrom(readField(hour, "offerprojectline"));
    if (projectLineId !== null) {
      const line = linesById.get(projectLineId);
      const lineKey = String(projectLineId);
      const lineRow =
        projectLineMap.get(lineKey) ??
        ({
          ...emptyAggregate(),
          id: lineKey,
          name: projectLineName(line, projectLineId),
          invoiceBasis: invoiceBasisForLine(line),
          billability: 0
        } satisfies ProjectLineRow);
      addToAggregate(lineRow, classification, amount);
      projectLineMap.set(lineKey, lineRow);
    }
  }

  const employeeRows = Array.from(employeeMap.values())
    .map(withBillability)
    .sort((left, right) => right.total - left.total)
    .slice(0, 8);

  const statusRows = Array.from(statusMap.values())
    .map(withBillability)
    .sort((left, right) => right.total - left.total);

  const projectLineRows = Array.from(projectLineMap.values())
    .map(withBillability)
    .filter((row) => row.nonbillable > 0)
    .sort((left, right) => right.nonbillable - left.nonbillable)
    .slice(0, 6);

  return {
    ...totals,
    period,
    source,
    billability: percent(totals.billable, totals.total),
    employeeRows,
    weekRows: Array.from(weekMap.values()),
    statusRows,
    projectLineRows,
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date())
  };
}

function classifyHour(hour: JsonRecord, linesById: Map<number, JsonRecord>): Classification {
  if (idFrom(readField(hour, "invoiceline")) !== null) {
    return "billable";
  }

  const relation = readField(hour, "offerprojectline");
  const lineId = idFrom(relation);
  const lineRecord = asRecord(relation) ?? (lineId !== null ? linesById.get(lineId) : undefined);
  const invoiceBasis = invoiceBasisForLine(lineRecord);

  if (invoiceBasis === "NONBILLABLE") {
    return "nonbillable";
  }

  if (invoiceBasis === "FIXED" || invoiceBasis === "COSTING" || invoiceBasis === "BUDGETED") {
    return "billable";
  }

  return "unknown";
}

function invoiceBasisForLine(line: JsonRecord | undefined) {
  return (stringFrom(readField(line, "invoicebasis")) || "ONBEKEND").toUpperCase();
}

function projectLineName(line: JsonRecord | undefined, id: number) {
  return (
    stringFrom(readField(line, "additionalsubject")) ||
    stringFrom(readField(line, "description")) ||
    stringFrom(readField(line, "searchname")) ||
    `Projectregel ${id}`
  );
}

function employeeName(hour: JsonRecord, employee: JsonRecord | undefined) {
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
    stringFrom(readField(record, "email")) ||
    "Onbekende medewerker"
  );
}

function withBillability<T extends Aggregate>(row: T) {
  return {
    ...row,
    billability: percent(row.billable, row.total)
  };
}

function addToAggregate(aggregate: Aggregate, classification: Classification, amount: number) {
  aggregate[classification] += amount;
  aggregate.total += amount;
}

function emptyAggregate(): Aggregate {
  return {
    billable: 0,
    nonbillable: 0,
    unknown: 0,
    total: 0
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
    weekBuckets: makeWeekBuckets(end.getDate(), shortMonth)
  };
}

function makeWeekBuckets(lastDay: number, shortMonth: string) {
  const buckets: WeekBucket[] = [];
  for (let startDay = 1; startDay <= lastDay; startDay += 7) {
    const endDay = Math.min(startDay + 6, lastDay);
    const key = String(Math.floor((startDay - 1) / 7));
    buckets.push({
      key,
      label: `${startDay}-${endDay} ${shortMonth}`
    });
  }
  return buckets;
}

function weekKeyForDate(value: string | undefined, period: Period) {
  if (!value) {
    return period.weekBuckets[0]?.key ?? "0";
  }

  const day = Number(value.slice(8, 10));
  if (!Number.isFinite(day) || day < 1) {
    return period.weekBuckets[0]?.key ?? "0";
  }

  return String(Math.floor((day - 1) / 7));
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDemoEmployees(): JsonRecord[] {
  return [
    { id: 1, screenname: "Noor de Vries" },
    { id: 2, screenname: "Milan Jansen" },
    { id: 3, screenname: "Sofia Bakker" },
    { id: 4, screenname: "Daan Smit" }
  ];
}

function createDemoProjectLines(): JsonRecord[] {
  return [
    { id: 101, additionalsubject: "Implementatie", invoicebasis: "COSTING" },
    { id: 102, additionalsubject: "Support retainer", invoicebasis: "FIXED" },
    { id: 103, additionalsubject: "Interne meeting", invoicebasis: "NONBILLABLE" },
    { id: 104, additionalsubject: "Vooronderzoek", invoicebasis: "BUDGETED" },
    { id: 105, additionalsubject: "Nazorg zonder contract", invoicebasis: "NONBILLABLE" }
  ];
}

function createDemoHours(period: Period): JsonRecord[] {
  const days = [2, 4, 7, 9, 12, 15, 18, 21, 23, 26, 28];
  const lineIds = [101, 102, 103, 104, 105];
  return days.flatMap((day, index) => {
    const date = `${period.start.slice(0, 8)}${String(day).padStart(2, "0")}`;
    return [
      {
        id: index * 3 + 1,
        date,
        amount: 5.5 + (index % 3),
        employee: (index % 4) + 1,
        offerprojectline: lineIds[index % lineIds.length],
        status: index % 4 === 0 ? "AUTHORIZED" : "DEFINITIVE"
      },
      {
        id: index * 3 + 2,
        date,
        amount: 2 + (index % 2),
        employee: ((index + 1) % 4) + 1,
        offerprojectline: lineIds[(index + 2) % lineIds.length],
        status: index % 3 === 0 ? "CONCEPT" : "DEFINITIVE"
      },
      {
        id: index * 3 + 3,
        date,
        amount: index % 5 === 0 ? 1.5 : 0,
        employee: ((index + 2) % 4) + 1,
        status: "CONCEPT"
      }
    ];
  });
}

function asRecords(value: JsonValue): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((record): record is JsonRecord => Boolean(record)) : [];
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function readField(record: JsonRecord | undefined, field: string) {
  if (!record) {
    return undefined;
  }

  return (
    record[field] ??
    record[`hour.${field}`] ??
    record[`employee.${field}`] ??
    record[`offerprojectline.${field}`] ??
    record[`project.${field}`]
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
  const id = record ? numberFrom(readField(record, "id")) : null;
  return id ?? null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace(",", ".")))) {
    return Number(value.replace(",", "."));
  }

  return null;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatHours(value: number) {
  return hoursFormatter.format(value);
}

function formatPercent(value: number) {
  return percentFormatter.format(value);
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    AUTHORIZED: "Geautoriseerd",
    CONCEPT: "Concept",
    DEFINITIVE: "Definitief",
    UNKNOWN: "Onbekend"
  };

  return labels[status] ?? status;
}

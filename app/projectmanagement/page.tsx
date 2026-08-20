import type { Metadata } from "next";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";
import { ProjectManagementAutoRefresh } from "./auto-refresh.js";
import { CompleteProjectForm } from "./complete-project-form.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projectmanagement | Gripp",
  description: "Overzicht van alle Gripp-opdrachten."
};

type JsonRecord = Record<string, unknown>;
type ProjectSearchParams = Record<string, string | string[] | undefined>;
type RelationEntity = "company" | "employee" | "projectphase" | "tag";

type ProjectSource = {
  mode: "live" | "demo";
  message: string;
};

type ProjectRow = {
  id: number;
  code: string;
  name: string;
  company: string;
  manager: string;
  phase: string;
  deadline?: string;
  startDate?: string;
  deliveryDate?: string;
  completedDate?: string;
  tags: string[];
  value: number;
  archived: boolean;
};

type ProjectManagementData = {
  source: ProjectSource;
  projects: ProjectRow[];
  totalProjects: number;
  overdueProjects: number;
  upcomingProjects: number;
  totalValue: number;
  lastUpdated: string;
};

type ProjectTimelineTick = {
  date: string;
  label: string;
};

type ProjectTimelineData = {
  start: string;
  end: string;
  ticks: ProjectTimelineTick[];
};

const PROJECT_PAGE_SIZE = 250;
const PROJECT_MAX_PAGES = 40;
const TIMELINE_DAY_WIDTH = 10;
const TIMELINE_FIXED_WIDTH = 388;
const currencyFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const monthFormatter = new Intl.DateTimeFormat("nl-NL", {
  month: "short",
  year: "numeric"
});

export default async function ProjectManagementPage({ searchParams }: { searchParams?: Promise<ProjectSearchParams> }) {
  const params = (await searchParams) ?? {};
  const completionNotice = completionNoticeFromParams(params);
  const data = await getProjectManagementData();
  const timeline = createProjectTimeline(data.projects);

  return (
    <main className="dashboard-shell project-shell">
      <ProjectManagementAutoRefresh />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Gripp opdrachten</p>
          <h1>Projectmanagement</h1>
        </div>
        <div className="header-meta">
          <span className={`source-badge source-badge--${data.source.mode}`}>
            {data.source.mode === "live" ? "Live uit Gripp" : "Demo-data"}
          </span>
          <span>{data.totalProjects} lopende projecten</span>
          <span>Bijgewerkt {data.lastUpdated}</span>
        </div>
      </header>

      {data.source.message ? <p className="data-notice">{data.source.message}</p> : null}
      {completionNotice ? <p className={`data-notice data-notice--${completionNotice.tone}`}>{completionNotice.message}</p> : null}

      <section className="metric-grid project-metric-grid" aria-label="Kerncijfers projecten">
        <ProjectMetric label="Lopend" value={String(data.totalProjects)} detail="Tag Project met alle projectdatums" tone="good" />
        <ProjectMetric label="Achter deadline" value={String(data.overdueProjects)} detail="Lopende projecten met verstreken deadline" tone="warning" />
        <ProjectMetric label="Binnen 14 dagen" value={String(data.upcomingProjects)} detail="Lopende projecten met aankomende deadline" tone="blue" />
        <ProjectMetric label="Totale waarde" value={formatCurrency(data.totalValue)} detail="Exclusief btw, van zichtbare projecten" tone="neutral" />
      </section>

      <section className="panel project-list-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Planning</p>
            <h2>Projecttijdlijn</h2>
          </div>
          <span className="panel-total">{data.projects.length} zichtbaar</span>
        </div>

        {timeline ? (
          <ProjectTimeline projects={data.projects} timeline={timeline} sourceMode={data.source.mode} />
        ) : (
          <p className="empty-state">Geen lopende projecten met tag Project en alle datums gevonden.</p>
        )}
      </section>
    </main>
  );
}

function ProjectMetric({
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

function ProjectTimeline({
  projects,
  timeline,
  sourceMode
}: {
  projects: ProjectRow[];
  timeline: ProjectTimelineData;
  sourceMode: ProjectSource["mode"];
}) {
  const today = currentDateKey();
  const todayPosition = isDateOnTimeline(today, timeline) ? timelinePosition(today, timeline) : null;

  return (
    <div className="project-timeline-wrap">
      <div
        className="project-timeline"
        role="list"
        aria-label={`Projectplanning van ${formatDate(timeline.start)} tot ${formatDate(timeline.end)}`}
        style={{ minWidth: `${timelineMinimumWidth(timeline)}px` }}
      >
        <div className="project-timeline-header" aria-hidden="true">
          <span className="project-timeline-fixed project-timeline-fixed--left">Project</span>
          <div className="project-timeline-axis">
            {timeline.ticks.map((tick, index) => (
              <span
                className={`project-timeline-axis__tick ${index === 0 ? "project-timeline-axis__tick--start" : ""}`}
                key={tick.date}
                style={{ left: `${timelinePosition(tick.date, timeline)}%` }}
              >
                <span>{tick.label}</span>
              </span>
            ))}
            {todayPosition !== null ? (
              <span className="project-timeline-today project-timeline-today--axis" style={{ left: `${todayPosition}%` }} title={`Vandaag, ${formatDate(today)}`} />
            ) : null}
          </div>
          <span className="project-timeline-fixed project-timeline-fixed--right project-timeline-summary-heading">Waarde</span>
        </div>

        <div className="project-timeline-body">
          <div className="project-timeline-shared-grid" aria-hidden="true">
            {timeline.ticks.map((tick) => (
              <span className="project-timeline-gridline" key={tick.date} style={{ left: `${timelinePosition(tick.date, timeline)}%` }} />
            ))}
          </div>
          {todayPosition !== null ? (
            <div className="project-timeline-today-layer" aria-hidden="true">
              <span className="project-timeline-today" style={{ left: `${todayPosition}%` }} />
            </div>
          ) : null}

          {projects.map((project) => {
            const startDate = project.startDate ?? timeline.start;
            const deliveryDate = project.deliveryDate ?? timeline.end;
            const deadlineDate = project.deadline ?? deliveryDate;
            const deadlineTone = deadlineToneFor(deadlineDate);
            const deadlinePosition = timelineDeadlinePosition(deadlineDate, startDate, deliveryDate, timeline);
            const deadlineProgress = timelineDeadlineProgress(deadlineDate, startDate, deliveryDate);

            return (
              <article className="project-timeline-row" key={project.id} role="listitem">
                <div className="project-timeline-details project-timeline-fixed project-timeline-fixed--left">
                  <div className="project-timeline-title-row">
                    <span className="row-title">{project.name}</span>
                    <span className="project-tag project-tag--good">{project.phase}</span>
                  </div>
                  <span className="cell-muted">{project.code} · {project.company}</span>
                  <span className="cell-muted">{project.manager}</span>
                </div>

                <div className="project-timeline-track" aria-label={`${project.name}: van ${formatDate(startDate)} tot ${formatDate(deliveryDate)}; interne oplevering ${formatDate(deadlineDate)}`}>
                  <span className="project-timeline-block" style={timelineBarStyle(startDate, deliveryDate, timeline)}>
                    <span
                      className="project-timeline-block__before"
                      style={{ width: `${deadlineProgress}%` }}
                      title={`Interne oplevering ${formatDate(deadlineDate)}`}
                      aria-hidden="true"
                    />
                    <span
                      className="project-timeline-block__after"
                      style={{ left: `${deadlineProgress}%` }}
                      title={`Oplevering ${formatDate(deliveryDate)}`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">Projectperiode</span>
                  </span>
                  <span
                    className={`project-timeline-deadline project-timeline-deadline--${deadlineTone}`}
                    style={{ left: `${deadlinePosition}%` }}
                    title={`Interne oplevering ${formatDate(deadlineDate)}`}
                  >
                    <span className="sr-only">Interne oplevering {formatDate(deadlineDate)}</span>
                  </span>
                </div>

                <div className="project-timeline-summary project-timeline-fixed project-timeline-fixed--right">
                  <strong>{project.value > 0 ? formatCurrency(project.value) : "-"}</strong>
                  {sourceMode === "live" ? (
                    <CompleteProjectForm projectId={project.id} projectName={project.name} />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

async function getProjectManagementData(): Promise<ProjectManagementData> {
  if (!process.env.GRIPP_API_TOKEN) {
    return buildProjectManagementData(createDemoProjects(), {
      mode: "demo",
      message: "Demo-data zichtbaar. Zet GRIPP_API_TOKEN om live Gripp-opdrachten te tonen."
    });
  }

  try {
    const client = new GrippClient();
    const projectRecords = await fetchProjectPages(client);
    const relationIds = {
      companies: uniqueRelationIds(projectRecords, "company"),
      employees: uniqueRelationIds(projectRecords, "accountmanager"),
      phases: uniqueRelationIds(projectRecords, "phase"),
      tags: uniqueRelationIds(projectRecords, "tags")
    };
    const [companies, employees, phases, tags] = await Promise.all([
      fetchRelationNames(client, "company", relationIds.companies),
      fetchRelationNames(client, "employee", relationIds.employees),
      fetchRelationNames(client, "projectphase", relationIds.phases),
      fetchRelationNames(client, "tag", relationIds.tags)
    ]);

    const projects = projectRecords.map((project) => projectRowFromRecord(project, { companies, employees, phases, tags }));
    return buildProjectManagementData(projects, { mode: "live", message: "" });
  } catch (error) {
    return buildProjectManagementData(createDemoProjects(), {
      mode: "demo",
      message: `Live opdrachten konden niet worden geladen. Demo-data zichtbaar. ${error instanceof Error ? error.message : ""}`.trim()
    });
  }
}

async function fetchProjectPages(client: GrippClient) {
  const records: JsonRecord[] = [];

  for (let page = 0; page < PROJECT_MAX_PAGES; page += 1) {
    const result = await client.call("project.get", [
      [],
      {
        paging: { firstresult: page * PROJECT_PAGE_SIZE, maxresults: PROJECT_PAGE_SIZE },
        orderings: [{ field: "project.deadline", direction: "asc" }]
      }
    ] as JsonValue[]);
    const pageRecords = asRecords(result);
    records.push(...pageRecords);

    if (pageRecords.length < PROJECT_PAGE_SIZE) {
      break;
    }
  }

  return records;
}

async function fetchRelationNames(client: GrippClient, entity: RelationEntity, ids: number[]) {
  const names = new Map<number, string>();

  for (let index = 0; index < ids.length; index += 100) {
    const idChunk = ids.slice(index, index + 100);
    const result = await client.call(`${entity}.get`, [
      [{ field: `${entity}.id`, operator: "in", value: idChunk }],
      {
        paging: { firstresult: 0, maxresults: 250 },
        orderings: [{ field: `${entity}.id`, direction: "asc" }]
      }
    ] as JsonValue[]);

    for (const record of asRecords(result)) {
      const id = idFrom(readField(record, "id"));
      if (id !== null) {
        names.set(id, recordDisplayName(record, "Onbekend"));
      }
    }
  }

  return names;
}

function buildProjectManagementData(projects: ProjectRow[], source: ProjectSource): ProjectManagementData {
  const filteredProjects = projects
    .filter(isOngoingProject)
    .sort((left, right) => {
      const leftDeadline = left.deadline ?? "9999-12-31";
      const rightDeadline = right.deadline ?? "9999-12-31";
      const leftStart = left.startDate ?? "9999-12-31";
      const rightStart = right.startDate ?? "9999-12-31";
      return leftDeadline.localeCompare(rightDeadline) || leftStart.localeCompare(rightStart) || left.name.localeCompare(right.name, "nl");
    });

  return {
    source,
    projects: filteredProjects,
    totalProjects: filteredProjects.length,
    overdueProjects: filteredProjects.filter((project) => project.deadline && daysUntil(project.deadline) < 0).length,
    upcomingProjects: filteredProjects.filter((project) => {
      if (!project.deadline) {
        return false;
      }

      const days = daysUntil(project.deadline);
      return days >= 0 && days <= 14;
    }).length,
    totalValue: filteredProjects.reduce((total, project) => total + project.value, 0),
    lastUpdated: new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date())
  };
}

function projectRowFromRecord(
  project: JsonRecord,
  relations: { companies: Map<number, string>; employees: Map<number, string>; phases: Map<number, string>; tags: Map<number, string> }
): ProjectRow {
  const id = idFrom(readField(project, "id")) ?? 0;
  const number = stringFrom(readField(project, "number"));

  return {
    id,
    code: number ? `#${number}` : `#${id}`,
    name: stringFrom(readField(project, "name")) ?? recordDisplayName(project, "Naamloze opdracht"),
    company: relationDisplayName(project, "company", relations.companies, "Geen klant"),
    manager: relationDisplayName(project, "accountmanager", relations.employees, "Niet toegewezen"),
    phase: relationDisplayName(project, "phase", relations.phases, "Geen fase"),
    deadline: dateKeyFromValue(readField(project, "deadline")),
    startDate: dateKeyFromValue(readField(project, "startdate")),
    deliveryDate: dateKeyFromValue(readField(project, "deliverydate")),
    completedDate: dateKeyFromValue(readField(project, "enddate")),
    tags: relationIds(project, "tags").map((id) => relations.tags.get(id)).filter((tag): tag is string => Boolean(tag)),
    value: Math.max(0, numberFrom(readField(project, "totalexclvat")) ?? 0),
    archived: booleanFrom(readField(project, "archived")) === true
  };
}

function relationDisplayName(project: JsonRecord, field: string, names: Map<number, string>, fallback: string) {
  const relationValue = readField(project, field);
  const relation = asRecord(relationValue);
  const embeddedName = relation ? recordDisplayName(relation, "") : "";
  if (embeddedName) {
    return embeddedName;
  }

  const directName = stringFrom(relationValue);
  if (directName && idFrom(relationValue) === null) {
    return directName;
  }

  const id = relationId(project, field);
  return id !== null ? names.get(id) ?? fallback : fallback;
}

function completionNoticeFromParams(params: ProjectSearchParams) {
  switch (firstParam(params.notice)) {
    case "completed":
      return { tone: "success", message: "Opdracht afgerond." };
    case "failed":
      return { tone: "error", message: "De opdracht kon niet worden afgerond." };
    case "invalid":
      return { tone: "error", message: "Ongeldige opdracht." };
    default:
      return null;
  }
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function uniqueRelationIds(records: JsonRecord[], field: string) {
  return Array.from(new Set(records.flatMap((record) => relationIds(record, field))));
}

function relationIds(record: JsonRecord, field: string) {
  const relation = readField(record, field);
  if (Array.isArray(relation)) {
    return relation.map(idFrom).filter((id): id is number => id !== null);
  }

  const id = relationId(record, field);
  return id === null ? [] : [id];
}

function relationId(record: JsonRecord, field: string) {
  return idFrom(readField(record, field)) ?? idFrom(record[`${field}.id`]) ?? idFrom(record[`project.${field}.id`]);
}

function readField(record: JsonRecord | undefined, field: string) {
  if (!record) {
    return undefined;
  }

  const direct = record[field] ?? record[`project.${field}`] ?? record[`employee.${field}`] ?? record[`company.${field}`];
  if (direct !== undefined) {
    return direct;
  }

  const suffix = `.${field.toLowerCase()}`;
  const matchingKey = Object.keys(record).find((key) => key.toLowerCase().endsWith(suffix));
  return matchingKey ? record[matchingKey] : undefined;
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

function idFrom(value: unknown): number | null {
  const scalar = scalarFrom(value);
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }

  if (typeof scalar === "string" && scalar.trim() && Number.isFinite(Number(scalar))) {
    return Number(scalar);
  }

  return null;
}

function numberFrom(value: unknown): number | null {
  const scalar = scalarFrom(value);
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }

  if (typeof scalar === "string") {
    const normalized = scalar.trim().replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
  }

  return null;
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

function recordDisplayName(record: JsonRecord, fallback: string) {
  const firstName = stringFrom(readField(record, "firstname"));
  const infix = stringFrom(readField(record, "infix"));
  const lastName = stringFrom(readField(record, "lastname"));
  const fullName = [firstName, infix, lastName].filter(Boolean).join(" ");

  return (
    stringFrom(readField(record, "displayvalue")) ||
    stringFrom(readField(record, "name")) ||
    fullName ||
    stringFrom(readField(record, "screenname")) ||
    stringFrom(readField(record, "searchname")) ||
    fallback
  );
}

function dateKeyFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const dateKey = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return dateKey && isDateKey(dateKey) ? dateKey : undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ["rawValue", "rawvalue", "date", "value", "displayvalue", "displayValue"]) {
    const date = dateKeyFromValue(record[key]);
    if (date) {
      return date;
    }
  }

  return undefined;
}

function isDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day);
}

function daysUntil(value: string) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const date = new Date(`${value}T00:00:00`);
  return Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
}

function createProjectTimeline(projects: ProjectRow[]): ProjectTimelineData | null {
  const startDates = projects.map((project) => project.startDate).filter((date): date is string => Boolean(date));
  const deliveryDates = projects.map((project) => project.deliveryDate).filter((date): date is string => Boolean(date));
  if (startDates.length === 0 || deliveryDates.length === 0) {
    return null;
  }

  const earliestStart = [...startDates].sort()[0];
  const latestDelivery = [...deliveryDates].sort().at(-1);
  if (!earliestStart || !latestDelivery) {
    return null;
  }

  const calendarStart = dateFromKey(earliestStart);
  calendarStart.setDate(1);
  const start = dateKey(calendarStart);
  const minimumEnd = new Date(calendarStart.getFullYear(), calendarStart.getMonth() + 3, 0);
  const end = latestDelivery > dateKey(minimumEnd) ? latestDelivery : dateKey(minimumEnd);

  return { start, end, ticks: createTimelineTicks(start, end) };
}

function createTimelineTicks(start: string, end: string): ProjectTimelineTick[] {
  const currentMonth = dateFromKey(start);
  currentMonth.setDate(1);
  const tickDates: string[] = [];

  while (dateKey(currentMonth) <= end) {
    tickDates.push(dateKey(currentMonth));
    currentMonth.setMonth(currentMonth.getMonth() + 1);
  }

  return tickDates.map((date) => ({ date, label: monthFormatter.format(dateFromKey(date)) }));
}

function timelinePosition(date: string, timeline: ProjectTimelineData) {
  const dayCount = timelineDayCount(timeline);
  if (dayCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (daysBetween(timeline.start, date) / dayCount) * 100));
}

function timelineBarStyle(start: string, end: string, timeline: ProjectTimelineData) {
  const startPosition = timelinePosition(start, timeline);
  const endPosition = Math.max(startPosition, timelinePosition(addDays(end, 1), timeline));
  const width = Math.max(0.8, endPosition - startPosition);

  return {
    left: `${Math.min(startPosition, 100 - width)}%`,
    width: `${width}%`
  };
}

function timelineDeadlinePosition(deadline: string, start: string, end: string, timeline: ProjectTimelineData) {
  const startPosition = timelinePosition(start, timeline);
  const endPosition = Math.max(startPosition, timelinePosition(end, timeline));
  const deadlinePosition = timelinePosition(deadline, timeline);

  return Math.max(startPosition, Math.min(endPosition, deadlinePosition));
}

function timelineDeadlineProgress(deadline: string, start: string, end: string) {
  const dayCount = daysBetween(start, end) + 1;
  if (dayCount <= 0) {
    return 100;
  }

  return Math.max(0, Math.min(100, (daysBetween(start, deadline) / dayCount) * 100));
}

function timelineMinimumWidth(timeline: ProjectTimelineData) {
  return TIMELINE_FIXED_WIDTH + Math.max(3 * 30 * TIMELINE_DAY_WIDTH, timelineDayCount(timeline) * TIMELINE_DAY_WIDTH);
}

function deadlineToneFor(deadline: string) {
  const days = daysUntil(deadline);
  return days < 0 ? "danger" : days <= 14 ? "warning" : "good";
}

function daysBetween(start: string, end: string) {
  return Math.round((dateFromKey(end).getTime() - dateFromKey(start).getTime()) / 86_400_000);
}

function timelineDayCount(timeline: ProjectTimelineData) {
  return daysBetween(timeline.start, timeline.end) + 1;
}

function isDateOnTimeline(date: string, timeline: ProjectTimelineData) {
  return date >= timeline.start && date <= timeline.end;
}

function addDays(value: string, days: number) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isOngoingProject(project: ProjectRow) {
  return (
    !project.archived &&
    !project.completedDate &&
    !isCompletedProjectPhase(project.phase) &&
    project.tags.some((tag) => normalize(tag) === "project") &&
    Boolean(project.startDate && project.deadline && project.deliveryDate)
  );
}

function isCompletedProjectPhase(phase: string) {
  return normalize(phase).includes("afgerond");
}

function looksLikeEntity(record: JsonRecord) {
  return ["id", "name", "number", "deadline", "company"].some((field) => readField(record, field) !== undefined);
}

function createDemoProjects(): ProjectRow[] {
  const today = new Date();
  const relativeDate = (offset: number) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return dateKey(date);
  };

  return [
    { id: 601, code: "#2026-041", name: "Rebranding voorjaar", company: "Atelier Nova", manager: "Janneke Jacobs", phase: "Concept", deadline: relativeDate(-3), startDate: relativeDate(-42), deliveryDate: relativeDate(8), tags: ["Project"], value: 12400, archived: false },
    { id: 602, code: "#2026-042", name: "E-commerce campagne", company: "Korf & Co", manager: "Jasmijn Bakker", phase: "Productie", deadline: relativeDate(2), startDate: relativeDate(-21), deliveryDate: relativeDate(2), tags: ["Project"], value: 18600, archived: false },
    { id: 603, code: "#2026-043", name: "Website onderhoud Q3", company: "Veldhuis Groep", manager: "Noor de Vries", phase: "Uitvoering", deadline: relativeDate(6), startDate: relativeDate(-12), deliveryDate: relativeDate(6), tags: ["Project"], value: 7200, archived: false },
    { id: 604, code: "#2026-044", name: "Employer branding", company: "Meridian", manager: "Milan Jansen", phase: "Review", deadline: relativeDate(11), startDate: relativeDate(-28), deliveryDate: relativeDate(11), tags: ["Campagne"], value: 9500, archived: false },
    { id: 605, code: "#2026-045", name: "Jaarverslag 2026", company: "Hartman Industries", manager: "Janneke Jacobs", phase: "Uitvoering", deadline: relativeDate(28), startDate: relativeDate(8), deliveryDate: relativeDate(28), completedDate: relativeDate(-1), tags: ["Project"], value: 15750, archived: false },
    { id: 606, code: "#2026-031", name: "Contentretainer juni", company: "Studio Linden", manager: "Jasmijn Bakker", phase: "Uitvoering", deadline: relativeDate(35), startDate: relativeDate(-18), deliveryDate: relativeDate(35), tags: ["Project"], value: 5400, archived: false },
    { id: 607, code: "#2026-029", name: "Productlancering", company: "Penta Labs", manager: "Noor de Vries", phase: "Oplevering", deadline: relativeDate(-16), startDate: relativeDate(-62), deliveryDate: relativeDate(-16), tags: ["Project"], value: 22400, archived: true },
    { id: 608, code: "#2026-024", name: "Merkstrategie", company: "Lumen Partners", manager: "Milan Jansen", phase: "Afgerond", deadline: relativeDate(-49), startDate: relativeDate(-90), deliveryDate: relativeDate(-49), tags: ["Project"], value: 13800, archived: true }
  ];
}

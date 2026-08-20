import type { Metadata } from "next";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projectmanagement | Gripp",
  description: "Overzicht van alle Gripp-opdrachten."
};

type JsonRecord = Record<string, unknown>;
type ProjectSearchParams = Record<string, string | string[] | undefined>;
type ProjectFilter = "all" | "active" | "archived";
type RelationEntity = "company" | "employee" | "projectphase";

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
  value: number;
  archived: boolean;
};

type ProjectManagementData = {
  source: ProjectSource;
  projects: ProjectRow[];
  totalProjects: number;
  activeProjects: number;
  archivedProjects: number;
  overdueProjects: number;
  upcomingProjects: number;
  lastUpdated: string;
};

const PROJECT_PAGE_SIZE = 250;
const PROJECT_MAX_PAGES = 40;
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

export default async function ProjectManagementPage({ searchParams }: { searchParams?: Promise<ProjectSearchParams> }) {
  const params = (await searchParams) ?? {};
  const filter = projectFilterFromParams(params);
  const query = firstParam(params.query)?.trim() ?? "";
  const data = await getProjectManagementData(filter, query);

  return (
    <main className="dashboard-shell project-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Gripp opdrachten</p>
          <h1>Projectmanagement</h1>
        </div>
        <div className="header-meta">
          <span className={`source-badge source-badge--${data.source.mode}`}>
            {data.source.mode === "live" ? "Live uit Gripp" : "Demo-data"}
          </span>
          <span>{data.totalProjects} opdrachten</span>
          <span>Bijgewerkt {data.lastUpdated}</span>
        </div>
      </header>

      {data.source.message ? <p className="data-notice">{data.source.message}</p> : null}

      <nav className="dashboard-tabs" aria-label="Hoofdnavigatie">
        <a className="dashboard-tab" href="/dashboard">Declarabiliteit</a>
        <a className="dashboard-tab" href="/dashboard?tab=revenue">Omzet</a>
        <a className="dashboard-tab dashboard-tab--active" href="/projectmanagement" aria-current="page">Projectmanagement</a>
      </nav>

      <form className="project-filter-form" action="/projectmanagement">
        <label className="project-search-field">
          Zoeken
          <input type="search" name="query" defaultValue={query} placeholder="Opdracht, klant of verantwoordelijke" />
        </label>
        <label>
          Status
          <select name="filter" defaultValue={filter}>
            <option value="all">Alle opdrachten</option>
            <option value="active">Actief</option>
            <option value="archived">Gearchiveerd</option>
          </select>
        </label>
        <button type="submit">Zoeken</button>
      </form>

      <section className="metric-grid project-metric-grid" aria-label="Kerncijfers projecten">
        <ProjectMetric label="Actief" value={String(data.activeProjects)} detail="Niet gearchiveerde opdrachten" tone="good" />
        <ProjectMetric label="Achter deadline" value={String(data.overdueProjects)} detail="Actieve opdrachten met verstreken deadline" tone="warning" />
        <ProjectMetric label="Binnen 14 dagen" value={String(data.upcomingProjects)} detail="Actieve opdrachten met aankomende deadline" tone="blue" />
        <ProjectMetric label="Gearchiveerd" value={String(data.archivedProjects)} detail="Opdrachten in deze selectie" tone="neutral" />
      </section>

      <section className="panel project-list-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Opdrachten</p>
            <h2>Projectoverzicht</h2>
          </div>
          <span className="panel-total">{data.projects.length} zichtbaar</span>
        </div>

        {data.projects.length > 0 ? (
          <div className="table-wrap">
            <table className="project-table">
              <thead>
                <tr>
                  <th>Opdracht</th>
                  <th>Klant</th>
                  <th>Verantwoordelijke</th>
                  <th>Fase</th>
                  <th>Deadline</th>
                  <th>Periode</th>
                  <th className="table-number">Waarde</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <span className="row-title">{project.name}</span>
                      <span className="cell-muted">{project.code}</span>
                    </td>
                    <td>{project.company}</td>
                    <td>{project.manager}</td>
                    <td>
                      <span className={`project-tag ${project.archived ? "project-tag--neutral" : "project-tag--good"}`}>
                        {project.archived ? "Gearchiveerd" : project.phase}
                      </span>
                    </td>
                    <td><Deadline date={project.deadline} archived={project.archived} /></td>
                    <td><DateRange start={project.startDate} end={project.deliveryDate} /></td>
                    <td className="table-number">{project.value > 0 ? formatCurrency(project.value) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Geen opdrachten gevonden voor deze selectie.</p>
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

function Deadline({ date, archived }: { date?: string; archived: boolean }) {
  if (!date) {
    return <span className="cell-muted">Geen deadline</span>;
  }

  const days = daysUntil(date);
  const tone = archived ? "neutral" : days < 0 ? "danger" : days <= 14 ? "warning" : "good";
  const label = archived
    ? formatDate(date)
    : days < 0
      ? `${Math.abs(days)} d. te laat`
      : days === 0
        ? "Vandaag"
        : days === 1
          ? "Morgen"
          : formatDate(date);

  return <span className={`deadline deadline--${tone}`}>{label}</span>;
}

function DateRange({ start, end }: { start?: string; end?: string }) {
  if (!start && !end) {
    return <span className="cell-muted">Geen periode</span>;
  }

  return (
    <span className="date-range">
      <span>{start ? formatDate(start) : "-"}</span>
      <span aria-hidden="true"> tot </span>
      <span>{end ? formatDate(end) : "-"}</span>
    </span>
  );
}

async function getProjectManagementData(filter: ProjectFilter, query: string): Promise<ProjectManagementData> {
  if (!process.env.GRIPP_API_TOKEN) {
    return buildProjectManagementData(createDemoProjects(), filter, query, {
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
      phases: uniqueRelationIds(projectRecords, "phase")
    };
    const [companies, employees, phases] = await Promise.all([
      fetchRelationNames(client, "company", relationIds.companies),
      fetchRelationNames(client, "employee", relationIds.employees),
      fetchRelationNames(client, "projectphase", relationIds.phases)
    ]);

    const projects = projectRecords.map((project) => projectRowFromRecord(project, { companies, employees, phases }));
    return buildProjectManagementData(projects, filter, query, { mode: "live", message: "" });
  } catch (error) {
    return buildProjectManagementData(createDemoProjects(), filter, query, {
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

function buildProjectManagementData(projects: ProjectRow[], filter: ProjectFilter, query: string, source: ProjectSource): ProjectManagementData {
  const normalizedQuery = normalize(query);
  const filteredProjects = projects
    .filter((project) => filter === "all" || (filter === "archived" ? project.archived : !project.archived))
    .filter((project) => {
      if (!normalizedQuery) {
        return true;
      }

      return normalize([project.code, project.name, project.company, project.manager, project.phase].join(" ")).includes(normalizedQuery);
    })
    .sort((left, right) => {
      if (left.archived !== right.archived) {
        return Number(left.archived) - Number(right.archived);
      }

      const leftDeadline = left.deadline ?? "9999-12-31";
      const rightDeadline = right.deadline ?? "9999-12-31";
      return leftDeadline.localeCompare(rightDeadline) || left.name.localeCompare(right.name, "nl");
    });
  const activeProjects = filteredProjects.filter((project) => !project.archived);

  return {
    source,
    projects: filteredProjects,
    totalProjects: filteredProjects.length,
    activeProjects: activeProjects.length,
    archivedProjects: filteredProjects.filter((project) => project.archived).length,
    overdueProjects: activeProjects.filter((project) => project.deadline && daysUntil(project.deadline) < 0).length,
    upcomingProjects: activeProjects.filter((project) => {
      if (!project.deadline) {
        return false;
      }

      const days = daysUntil(project.deadline);
      return days >= 0 && days <= 14;
    }).length,
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
  relations: { companies: Map<number, string>; employees: Map<number, string>; phases: Map<number, string> }
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
    deliveryDate: dateKeyFromValue(readField(project, "deliverydate")) ?? dateKeyFromValue(readField(project, "enddate")),
    value: Math.max(0, numberFrom(readField(project, "totalexclvat")) ?? 0),
    archived: booleanFrom(readField(project, "archived")) === true
  };
}

function relationDisplayName(project: JsonRecord, field: string, names: Map<number, string>, fallback: string) {
  const relation = asRecord(readField(project, field));
  const embeddedName = relation ? recordDisplayName(relation, "") : "";
  if (embeddedName) {
    return embeddedName;
  }

  const id = relationId(project, field);
  return id !== null ? names.get(id) ?? fallback : fallback;
}

function projectFilterFromParams(params: ProjectSearchParams): ProjectFilter {
  const value = firstParam(params.filter);
  return value === "active" || value === "archived" ? value : "all";
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function uniqueRelationIds(records: JsonRecord[], field: string) {
  return Array.from(new Set(records.map((record) => relationId(record, field)).filter((id): id is number => id !== null)));
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

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
    { id: 601, code: "#2026-041", name: "Rebranding voorjaar", company: "Atelier Nova", manager: "Janneke Jacobs", phase: "Concept", deadline: relativeDate(-3), startDate: relativeDate(-42), deliveryDate: relativeDate(8), value: 12400, archived: false },
    { id: 602, code: "#2026-042", name: "E-commerce campagne", company: "Korf & Co", manager: "Jasmijn Bakker", phase: "Productie", deadline: relativeDate(2), startDate: relativeDate(-21), deliveryDate: relativeDate(2), value: 18600, archived: false },
    { id: 603, code: "#2026-043", name: "Website onderhoud Q3", company: "Veldhuis Groep", manager: "Noor de Vries", phase: "Uitvoering", deadline: relativeDate(6), startDate: relativeDate(-12), deliveryDate: relativeDate(6), value: 7200, archived: false },
    { id: 604, code: "#2026-044", name: "Employer branding", company: "Meridian", manager: "Milan Jansen", phase: "Review", deadline: relativeDate(11), startDate: relativeDate(-28), deliveryDate: relativeDate(11), value: 9500, archived: false },
    { id: 605, code: "#2026-045", name: "Jaarverslag 2026", company: "Hartman Industries", manager: "Janneke Jacobs", phase: "Planning", deadline: relativeDate(28), startDate: relativeDate(8), deliveryDate: relativeDate(28), value: 15750, archived: false },
    { id: 606, code: "#2026-031", name: "Contentretainer juni", company: "Studio Linden", manager: "Jasmijn Bakker", phase: "Uitvoering", deadline: relativeDate(35), startDate: relativeDate(-18), deliveryDate: relativeDate(35), value: 5400, archived: false },
    { id: 607, code: "#2026-029", name: "Productlancering", company: "Penta Labs", manager: "Noor de Vries", phase: "Oplevering", deadline: relativeDate(-16), startDate: relativeDate(-62), deliveryDate: relativeDate(-16), value: 22400, archived: true },
    { id: 608, code: "#2026-024", name: "Merkstrategie", company: "Lumen Partners", manager: "Milan Jansen", phase: "Afgerond", deadline: relativeDate(-49), startDate: relativeDate(-90), deliveryDate: relativeDate(-49), value: 13800, archived: true }
  ];
}

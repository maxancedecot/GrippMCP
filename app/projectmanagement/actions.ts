"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation.js";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

type JsonRecord = Record<string, unknown>;

export type ProjectTask = {
  id: number;
  title: string;
  startDate?: string;
  deadlineDate?: string;
  completed: boolean;
  estimatedHours?: number;
};

export type ProjectTasksResult = {
  tasks: ProjectTask[];
  error?: string;
};

const TASK_PAGE_SIZE = 250;
const TASK_MAX_PAGES = 10;

export async function completeProjectAction(formData: FormData) {
  const projectId = Number(formData.get("projectId"));

  if (!Number.isInteger(projectId) || projectId <= 0) {
    redirect(projectManagementHref("invalid"));
  }

  try {
    const client = new GrippClient();
    await client.call("project.update", [projectId, { enddate: completionDateKey(), archived: false }] as JsonValue[], true);
  } catch {
    redirect(projectManagementHref("failed"));
  }

  revalidatePath("/projectmanagement");
  redirect(projectManagementHref("completed"));
}

export async function getProjectTasksAction(projectId: number): Promise<ProjectTasksResult> {
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { tasks: [], error: "Ongeldige opdracht." };
  }

  if (!process.env.GRIPP_API_TOKEN) {
    return { tasks: createDemoProjectTasks(projectId) };
  }

  try {
    const client = new GrippClient();
    const taskRecords = await fetchProjectTaskRecords(client, projectId);
    return { tasks: taskRecords.map(projectTaskFromRecord) };
  } catch {
    return { tasks: [], error: "Taken konden niet uit Gripp worden geladen." };
  }
}

function projectManagementHref(notice: "completed" | "failed" | "invalid") {
  const params = new URLSearchParams({ notice });
  return `/projectmanagement?${params.toString()}`;
}

function completionDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

async function fetchProjectTaskRecords(client: GrippClient, projectId: number) {
  const records: JsonRecord[] = [];

  for (let page = 0; page < TASK_MAX_PAGES; page += 1) {
    const result = await client.call("task.get", [
      [{ field: "task.offerprojectbase", operator: "equals", value: projectId }],
      {
        paging: { firstresult: page * TASK_PAGE_SIZE, maxresults: TASK_PAGE_SIZE },
        orderings: [
          { field: "task.deadlinedate", direction: "asc" },
          { field: "task.id", direction: "asc" }
        ]
      }
    ] as JsonValue[]);
    const pageRecords = taskRecordsFrom(result);
    records.push(...pageRecords);

    if (pageRecords.length < TASK_PAGE_SIZE) {
      break;
    }
  }

  return records;
}

function projectTaskFromRecord(task: JsonRecord): ProjectTask {
  const id = taskNumber(taskField(task, "id")) ?? 0;
  const description = taskString(taskField(task, "description")) ?? taskString(taskField(task, "content"));

  return {
    id,
    title: description || `Taak ${id || "zonder nummer"}`,
    startDate: taskDate(taskField(task, "startdate")),
    deadlineDate: taskDate(taskField(task, "deadlinedate")),
    completed: taskBoolean(taskField(task, "isafgerond")) === true || Boolean(taskDate(taskField(task, "completedon"))),
    estimatedHours: taskNumber(taskField(task, "estimatedhours")) ?? undefined
  };
}

function taskRecordsFrom(value: JsonValue): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(taskRecord).filter((record): record is JsonRecord => Boolean(record));
  }

  const record = taskRecord(value);
  if (!record) {
    return [];
  }

  for (const key of ["result", "data", "rows", "records", "items", "entities"]) {
    const nested = taskRecordsFrom(record[key] as JsonValue);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [record];
}

function taskRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function taskField(record: JsonRecord, field: string) {
  const direct = record[field] ?? record[`task.${field}`];
  if (direct !== undefined) {
    return direct;
  }

  const suffix = `.${field.toLowerCase()}`;
  const matchingKey = Object.keys(record).find((key) => key.toLowerCase().endsWith(suffix));
  return matchingKey ? record[matchingKey] : undefined;
}

function taskScalar(value: unknown): unknown {
  const record = taskRecord(value);
  if (!record) {
    return value;
  }

  for (const key of ["value", "rawValue", "rawvalue", "id", "displayvalue", "displayValue", "label", "name", "searchname", "screenname"]) {
    if (record[key] !== undefined && record[key] !== null) {
      return taskScalar(record[key]);
    }
  }

  return value;
}

function taskString(value: unknown) {
  const scalar = taskScalar(value);
  if (typeof scalar === "string") {
    return scalar.trim() || undefined;
  }

  if (typeof scalar === "number" || typeof scalar === "boolean") {
    return String(scalar);
  }

  return undefined;
}

function taskNumber(value: unknown) {
  const scalar = taskScalar(value);
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }

  if (typeof scalar === "string" && scalar.trim() && Number.isFinite(Number(scalar))) {
    return Number(scalar);
  }

  return null;
}

function taskBoolean(value: unknown) {
  const scalar = taskScalar(value);
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

function taskDate(value: unknown): string | undefined {
  if (typeof value === "string") {
    const date = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return date || undefined;
  }

  const record = taskRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of ["rawValue", "rawvalue", "date", "value", "displayvalue", "displayValue"]) {
    const date = taskDate(record[key]);
    if (date) {
      return date;
    }
  }

  return undefined;
}

function createDemoProjectTasks(projectId: number): ProjectTask[] {
  const today = new Date();
  const date = (offset: number) => {
    const value = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  };

  return [
    { id: projectId * 10 + 1, title: "Planning en voorbereiding", startDate: date(-14), deadlineDate: date(-7), completed: true, estimatedHours: 4 },
    { id: projectId * 10 + 2, title: "Uitwerking", startDate: date(-6), deadlineDate: date(2), completed: false, estimatedHours: 12 },
    { id: projectId * 10 + 3, title: "Interne oplevering", startDate: date(3), deadlineDate: date(7), completed: false, estimatedHours: 2 }
  ];
}

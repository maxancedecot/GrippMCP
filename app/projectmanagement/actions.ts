"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation.js";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export async function completeProjectAction(formData: FormData) {
  const projectId = Number(formData.get("projectId"));
  const filter = formValue(formData, "filter");
  const query = formValue(formData, "query");

  if (!Number.isInteger(projectId) || projectId <= 0) {
    redirect(projectManagementHref(filter, query, "invalid"));
  }

  let client: GrippClient;
  let completedPhaseId: number | null;
  try {
    client = new GrippClient();
    completedPhaseId = await completedProjectPhaseId(client);
  } catch {
    redirect(projectManagementHref(filter, query, "failed"));
  }

  if (completedPhaseId === null) {
    redirect(projectManagementHref(filter, query, "missing_phase"));
  }

  try {
    await client.call("project.update", [projectId, { phase: completedPhaseId, archived: false }] as JsonValue[], true);
  } catch {
    redirect(projectManagementHref(filter, query, "failed"));
  }

  revalidatePath("/projectmanagement");
  redirect(projectManagementHref(filter, query, "completed"));
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function completedProjectPhaseId(client: GrippClient) {
  const result = await client.call("projectphase.get", [
    [],
    {
      paging: { firstresult: 0, maxresults: 250 },
      orderings: [{ field: "projectphase._ordering", direction: "asc" }]
    }
  ] as JsonValue[]);

  for (const phase of asRecords(result)) {
    if (normalize(stringFrom(phase.name)) === "afgerond") {
      return idFrom(phase.id);
    }
  }

  return null;
}

function projectManagementHref(filter: string, query: string, notice: "completed" | "failed" | "invalid" | "missing_phase") {
  const params = new URLSearchParams({ notice });
  if (filter === "active" || filter === "archived") {
    params.set("filter", filter);
  }
  if (query) {
    params.set("query", query);
  }

  return `/projectmanagement?${params.toString()}`;
}

function asRecords(value: JsonValue): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((record): record is Record<string, unknown> => record !== undefined);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of ["result", "data", "rows", "records", "items", "entities"]) {
    const records = asRecords(record[key] as JsonValue);
    if (records.length > 0) {
      return records;
    }
  }

  return record.id !== undefined ? [record] : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function idFrom(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && Number.isInteger(Number(value)) && Number(value) > 0) {
    return Number(value);
  }

  return null;
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

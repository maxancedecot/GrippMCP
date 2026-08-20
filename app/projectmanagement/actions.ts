"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation.js";
import { GrippClient } from "../../src/grippClient.js";
import type { JsonValue } from "../../src/types.js";

export async function completeProjectAction(formData: FormData) {
  const projectId = Number(formData.get("projectId"));
  const query = formValue(formData, "query");

  if (!Number.isInteger(projectId) || projectId <= 0) {
    redirect(projectManagementHref(query, "invalid"));
  }

  try {
    const client = new GrippClient();
    await client.call("project.update", [projectId, { enddate: completionDateKey(), archived: false }] as JsonValue[], true);
  } catch {
    redirect(projectManagementHref(query, "failed"));
  }

  revalidatePath("/projectmanagement");
  redirect(projectManagementHref(query, "completed"));
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function projectManagementHref(query: string, notice: "completed" | "failed" | "invalid") {
  const params = new URLSearchParams({ notice });
  if (query) {
    params.set("query", query);
  }

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

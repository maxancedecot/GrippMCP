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

  try {
    const client = new GrippClient();
    await client.call("project.update", [projectId, { archived: true }] as JsonValue[], true);
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

function projectManagementHref(filter: string, query: string, notice: "completed" | "failed" | "invalid") {
  const params = new URLSearchParams({ notice });
  if (filter === "active" || filter === "archived") {
    params.set("filter", filter);
  }
  if (query) {
    params.set("query", query);
  }

  return `/projectmanagement?${params.toString()}`;
}

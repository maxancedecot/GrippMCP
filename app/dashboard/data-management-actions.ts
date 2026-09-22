"use server";

import { revalidatePath } from "next/cache";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { deleteProjectPageGroup, saveProjectPageGroup, type ResolvedProjectPageGroup } from "../../src/projectPageGroupStore.js";
import { getProjectPageManagementData, invalidateProjectPageInventory, saveProjectPageManager, type ManagedProjectPage } from "../../src/projectPageManagement.js";

export async function saveAccountManagerAction(siteId: string, path: string, managerId: number | null): Promise<
  { ok: true; page: ManagedProjectPage } | { ok: false; error: string }
> {
  try {
    const page = await saveProjectPageManager({ siteId, path, managerId });
    revalidatePath("/dashboard");
    return { ok: true, page };
  } catch {
    return { ok: false, error: "De toewijzing is niet opgeslagen. Vernieuw de gegevens en probeer opnieuw." };
  }
}

export async function saveProjectPageGroupAction(input: {
  siteId: string;
  title: string;
  sourcePath: string;
  sourcePaths: string[];
}): Promise<{ ok: true; group: ResolvedProjectPageGroup } | { ok: false; error: string }> {
  try {
    const [dashboard, projectData] = await Promise.all([
      getSiteAnalyticsDashboardData({ days: 90 }),
      getProjectPageManagementData()
    ]);
    if (!projectData.fetchedAt) throw new Error("Project inventory unavailable");
    const group = await saveProjectPageGroup(input, { sites: dashboard.sites, pages: projectData.pages });
    await invalidateProjectPageInventory();
    revalidatePath("/dashboard");
    revalidatePath("/accountmanager");
    return { ok: true, group };
  } catch {
    return { ok: false, error: "De projectpagina’s zijn niet samengevoegd. Controleer de selectie en probeer opnieuw." };
  }
}

export async function deleteProjectPageGroupAction(groupId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!await deleteProjectPageGroup(groupId)) return { ok: false, error: "Deze projectgroep bestaat niet meer." };
    await invalidateProjectPageInventory();
    revalidatePath("/dashboard");
    revalidatePath("/accountmanager");
    return { ok: true };
  } catch {
    return { ok: false, error: "De projectgroep kon niet worden verwijderd. Probeer opnieuw." };
  }
}

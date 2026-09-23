"use server";

import { revalidatePath } from "next/cache";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { deleteProjectPageGroup, saveProjectPageGroup, type ResolvedProjectPageGroup } from "../../src/projectPageGroupStore.js";
import { getProjectPageManagementData, invalidateProjectPageInventory, saveProjectPageManager, type ManagedProjectPage } from "../../src/projectPageManagement.js";
import { deleteGoogleCampaignMatch, listGoogleCampaigns, saveGoogleCampaignMatch } from "../../src/googleCampaignManagement.js";

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

export async function loadGoogleCampaignsAction(customerId: string) {
  try { return { ok: true as const, ...await listGoogleCampaigns(customerId) }; }
  catch { return { ok: false as const, error: "De Google Ads-campagnes konden niet worden geladen. Controleer het klantnummer en de accounttoegang." }; }
}

export async function saveGoogleCampaignMatchAction(input: { siteId: string; accountId: string; campaignId: string; sourcePath: string }) {
  try {
    const match = await saveGoogleCampaignMatch({ channel: "google", siteId: input.siteId, accountId: input.accountId,
      campaignId: input.campaignId, sourcePaths: [input.sourcePath] });
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const, match };
  } catch { return { ok: false as const, error: "De Google-campagne kon niet worden gekoppeld. Vernieuw de gegevens en probeer opnieuw." }; }
}

export async function deleteGoogleCampaignMatchAction(accountId: string, campaignId: string) {
  try {
    await deleteGoogleCampaignMatch(accountId, campaignId);
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const };
  } catch { return { ok: false as const, error: "De Google-campagnekoppeling kon niet worden verwijderd." }; }
}

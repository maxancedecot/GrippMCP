"use server";

import { revalidatePath } from "next/cache";
import { getSiteAnalyticsDashboardData } from "../../src/siteAnalytics.js";
import { deleteProjectPageGroup, saveProjectPageGroup, type ResolvedProjectPageGroup } from "../../src/projectPageGroupStore.js";
import { getProjectPageManagementData, invalidateProjectPageInventory, saveProjectPageManager, type ManagedProjectPage } from "../../src/projectPageManagement.js";
import { deleteFacebookCampaignMatch, listFacebookAdAccounts, listFacebookCampaigns, saveFacebookCampaignMatches } from "../../src/facebookCampaignManagement.js";
import { deleteGoogleCampaignMatch, listGoogleCampaigns, saveGoogleCampaignMatches } from "../../src/googleCampaignManagement.js";
import { deleteCrmPipelineMatch, listCrmConnections, loadCrmPipelines, saveCrmPipelineMatches } from "../../src/crmPipelineManagement.js";
import { parseCampaignSiteMappings } from "../../src/campaignPerformance.js";
import { CrmPipelineLoadError, crmPipelineLoadErrorMessage } from "../../src/crmPipelineErrors.js";

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

export async function saveGoogleCampaignMatchesAction(input: { siteId: string; accountId: string; campaignIds: string[]; sourcePath: string }) {
  try {
    const matches = await saveGoogleCampaignMatches(input);
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const, matches };
  } catch { return { ok: false as const, error: "De Google-campagnes konden niet worden gekoppeld. Vernieuw de gegevens en probeer opnieuw." }; }
}

export async function deleteGoogleCampaignMatchAction(accountId: string, campaignId: string) {
  try {
    await deleteGoogleCampaignMatch(accountId, campaignId);
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const };
  } catch { return { ok: false as const, error: "De Google-campagnekoppeling kon niet worden verwijderd." }; }
}

export async function loadFacebookAdAccountsAction() {
  try { return { ok: true as const, accounts: await listFacebookAdAccounts() }; }
  catch { return { ok: false as const, error: "De Facebook-advertentieaccounts konden niet worden geladen. Controleer de Meta-toegang en probeer opnieuw." }; }
}

export async function loadFacebookCampaignsAction(accountId: string) {
  try { return { ok: true as const, ...await listFacebookCampaigns(accountId) }; }
  catch { return { ok: false as const, error: "De Facebook Ads-campagnes konden niet worden geladen. Controleer de toegang tot het gekozen advertentieaccount." }; }
}

export async function saveFacebookCampaignMatchesAction(input: { siteId: string; accountId: string; campaignIds: string[]; sourcePath: string }) {
  try {
    const matches = await saveFacebookCampaignMatches(input);
    await invalidateProjectPageInventory();
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const, matches };
  } catch { return { ok: false as const, error: "De Facebook-campagnes konden niet worden gekoppeld. Vernieuw de gegevens en probeer opnieuw." }; }
}

export async function deleteFacebookCampaignMatchAction(accountId: string, campaignId: string) {
  try {
    await deleteFacebookCampaignMatch(accountId, campaignId);
    await invalidateProjectPageInventory();
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const };
  } catch { return { ok: false as const, error: "De Facebook-campagnekoppeling kon niet worden verwijderd." }; }
}

async function crmConnections() {
  return listCrmConnections({ mappings: parseCampaignSiteMappings(process.env.CAMPAIGN_PERFORMANCE_SITES), resolveNames: false });
}

export async function loadCrmPipelinesAction(input: { locationId: string; installId?: string }) {
  try {
    const pipelines = await loadCrmPipelines(input, { connections: await crmConnections() });
    return { ok: true as const, pipelines };
  } catch (error) { return { ok: false as const, error: crmPipelineLoadErrorMessage(error) }; }
}

export async function saveCrmPipelineMatchesAction(input: {
  siteId: string; sourcePath: string; locationId: string; installId?: string; pipelineIds: string[];
}) {
  try {
    const matches = await saveCrmPipelineMatches(input, { connections: await crmConnections() });
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const, matches };
  } catch (error) { return { ok: false as const, error: error instanceof CrmPipelineLoadError ? crmPipelineLoadErrorMessage(error) : "De CRM-pipelines konden niet worden gekoppeld. Vernieuw de gegevens en controleer de selectie." }; }
}

export async function deleteCrmPipelineMatchAction(locationId: string, pipelineId: string) {
  try {
    await deleteCrmPipelineMatch(locationId, pipelineId);
    revalidatePath("/dashboard"); revalidatePath("/accountmanager");
    return { ok: true as const };
  } catch { return { ok: false as const, error: "De CRM-pipelinekoppeling kon niet worden verwijderd. Probeer opnieuw." }; }
}

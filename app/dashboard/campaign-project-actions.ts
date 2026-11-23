"use server";

import { revalidatePath } from "next/cache.js";
import { setCampaignProjectHidden } from "../../src/campaignProjectVisibility.js";
import { saveCampaignProjectTitle } from "../../src/campaignProjectTitles.js";

export async function saveCampaignProjectTitleAction(siteId: string, path: string, title: string): Promise<
  { ok: true; title: string } | { ok: false; error: string }
> {
  try {
    const savedTitle = await saveCampaignProjectTitle({ siteId, path, title });
    revalidatePath("/accountmanager");
    revalidatePath("/dashboard");
    return { ok: true, title: savedTitle };
  } catch {
    return { ok: false, error: "De projectnaam kon niet worden opgeslagen. Gebruik 1 tot 180 tekens en probeer opnieuw." };
  }
}

export async function setCampaignProjectHiddenAction(siteId: string, path: string, hidden: boolean): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    if (typeof hidden !== "boolean") throw new Error("Invalid visibility action");
    await setCampaignProjectHidden({ siteId, path }, hidden);
    revalidatePath("/accountmanager");
    return { ok: true };
  } catch {
    return { ok: false, error: hidden ? "De rij kon niet worden verwijderd. Probeer opnieuw." : "De rij kon niet worden hersteld. Probeer opnieuw." };
  }
}

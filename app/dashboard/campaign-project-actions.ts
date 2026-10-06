"use server";

import { revalidatePath } from "next/cache";
import { setCampaignProjectHidden } from "../../src/campaignProjectVisibility.js";

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

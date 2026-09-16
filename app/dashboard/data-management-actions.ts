"use server";

import { revalidatePath } from "next/cache";
import { saveProjectPageManager, type ManagedProjectPage } from "../../src/projectPageManagement.js";

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

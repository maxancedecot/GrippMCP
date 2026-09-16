"use server";

import { revalidatePath } from "next/cache";
import { saveClientAccountManager, type ClientAssignment } from "../../src/dataManagement.js";

export async function saveAccountManagerAction(clientId: number, managerId: number | null): Promise<
  { ok: true; assignment: ClientAssignment } | { ok: false; error: string }
> {
  try {
    const assignment = await saveClientAccountManager({ clientId, managerId });
    revalidatePath("/dashboard");
    return { ok: true, assignment };
  } catch {
    return { ok: false, error: "De koppeling is niet opgeslagen. Vernieuw de gegevens en probeer opnieuw." };
  }
}

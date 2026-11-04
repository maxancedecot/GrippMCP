import { cookies } from "next/headers.js";
import { redirect } from "next/navigation.js";
import { PM_SESSION_COOKIE, pmReturnPath, verifyPmSession } from "../../src/pmDashboardAuth.js";

export async function hasPmDashboardAccess(): Promise<boolean> {
  const token = (await cookies()).get(PM_SESSION_COOKIE)?.value;
  return verifyPmSession(token, process.env.PM_DASHBOARD_PASSWORD);
}

export async function requirePmDashboardAccess(returnTo: string): Promise<void> {
  if (!await hasPmDashboardAccess()) {
    redirect(`/pm/login?returnTo=${encodeURIComponent(pmReturnPath(returnTo))}`);
  }
}

"use server";

import { cookies } from "next/headers.js";
import { redirect } from "next/navigation.js";
import { createPmSession, PM_SESSION_COOKIE, PM_SESSION_SECONDS, pmReturnPath, verifyPmPassword } from "../../../src/pmDashboardAuth.js";

export async function loginPmDashboard(formData: FormData) {
  const returnTo = pmReturnPath(formData.get("returnTo"));
  const password = process.env.PM_DASHBOARD_PASSWORD;
  if (!verifyPmPassword(formData.get("password"), password)) {
    redirect(`/pm/login?error=invalid&returnTo=${encodeURIComponent(returnTo)}`);
  }
  (await cookies()).set(PM_SESSION_COOKIE, createPmSession(password!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/pm",
    maxAge: PM_SESSION_SECONDS
  });
  redirect(returnTo);
}

export async function logoutPmDashboard() {
  (await cookies()).set(PM_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/pm",
    maxAge: 0
  });
  redirect("/pm/login");
}

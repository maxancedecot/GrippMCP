import type { Metadata } from "next";
import { redirect } from "next/navigation.js";
import { pmReturnPath } from "../../../src/pmDashboardAuth.js";
import { DashboardFrame } from "../../dashboard-frame.js";
import { hasPmDashboardAccess } from "../auth.js";
import { loginPmDashboard } from "./actions.js";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inloggen | PM dashboard", robots: { index: false, follow: false } };

export default async function PmLoginPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const returnTo = pmReturnPath(params.returnTo);
  if (await hasPmDashboardAccess()) redirect(returnTo);
  const configured = Boolean(process.env.PM_DASHBOARD_PASSWORD);

  return <DashboardFrame showTopMenu={false}>
    <main className="dashboard-shell pm-login-shell">
      <section className="panel pm-login-card" aria-labelledby="pm-login-title">
        <img className="pm-login-logo" src="/ledoux/logo/ledoux-logo.svg" alt="Ledoux" />
        <h1 id="pm-login-title">PM dashboard</h1>
        <p>Voer het wachtwoord in om het dashboard te openen.</p>
        {configured ? <form className="pm-login-form" action={loginPmDashboard}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="pm-password">Wachtwoord</label>
          <input id="pm-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
          {params.error === "invalid" ? <p className="pm-login-error" role="alert">Het wachtwoord is niet juist. Probeer opnieuw.</p> : null}
          <button className="pm-refresh-button" type="submit">Inloggen</button>
        </form> : <p role="alert">Inloggen is nog niet beschikbaar. Neem contact op met de beheerder.</p>}
      </section>
    </main>
  </DashboardFrame>;
}

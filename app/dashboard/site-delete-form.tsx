"use client";

import type { FormEvent } from "react";
import type { SiteAnalyticsPublicSite } from "../../src/siteAnalytics.js";

type DashboardAction = (formData: FormData) => void | Promise<void>;

export function SiteDeleteForm({
  site,
  returnTo,
  action
}: {
  site?: SiteAnalyticsPublicSite;
  returnTo: string;
  action: DashboardAction;
}) {
  if (!site) return null;
  const selectedSite = site;

  function confirmDeletion(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `Website “${selectedSite.name}” verwijderen uit Websiteprestaties? De CVR-koppelingen van deze website worden ook verwijderd. Verwijder daarna de trackingcode van de website om te voorkomen dat ze opnieuw verschijnt.`
    );
    if (!confirmed) event.preventDefault();
  }

  return (
    <form className="site-delete-form" action={action} onSubmit={confirmDeletion}>
      <input type="hidden" name="site_id" value={selectedSite.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <span>{selectedSite.url}</span>
      <button className="site-delete-button" type="submit">Website verwijderen</button>
    </form>
  );
}

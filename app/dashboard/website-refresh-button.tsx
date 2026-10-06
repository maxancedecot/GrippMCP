"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

export function WebsiteRefreshButton({ action }: { action(): Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function refresh() {
    setNotice(""); setError("");
    startTransition(async () => {
      try {
        await action();
        setNotice("Gegevens bijgewerkt.");
      } catch {
        setError("Bijwerken is niet gelukt. Probeer opnieuw.");
      }
    });
  }

  return <div className="site-analytics-refresh-control">
    <button type="button" className="site-analytics-refresh-button" disabled={pending} aria-busy={pending}
      title="Websitegegevens en CVR-pagina’s opnieuw ophalen" onClick={refresh}>
      <RefreshCw size={16} aria-hidden="true" />
      {pending ? "Gegevens bijwerken…" : "Gegevens bijwerken"}
    </button>
    <p className="site-analytics-refresh-status" role="status" aria-live="polite">{pending ? "De nieuwste gegevens worden opgehaald…" : notice}</p>
    {error ? <p className="site-analytics-refresh-status site-analytics-refresh-error" role="alert">{error}</p> : null}
  </div>;
}

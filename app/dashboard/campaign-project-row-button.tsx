"use client";

import { useState, useTransition } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { setCampaignProjectHiddenAction } from "./campaign-project-actions.js";

export function CampaignProjectRowButton({ siteId, path, title, restore = false, disabled = false }: {
  siteId: string; path: string; title: string; restore?: boolean; disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const Icon = restore ? Undo2 : Trash2;
  const label = restore ? "Herstellen" : "Verwijderen";
  return <div className="campaign-project-row-action">
    <button className={restore ? "campaign-project-restore-button" : "cvr-delete-button"} type="button"
      disabled={disabled || pending} aria-label={`${title}: ${label.toLowerCase()}`}
      title={disabled ? "Opslag tijdelijk niet beschikbaar" : restore ? "Deze rij opnieuw tonen" : "Deze rij uit het overzicht verwijderen"}
      onClick={() => startTransition(async () => {
        setError("");
        try {
          const result = await setCampaignProjectHiddenAction(siteId, path, !restore);
          if (!result.ok) setError(result.error);
        } catch { setError(restore ? "De rij kon niet worden hersteld. Probeer opnieuw." : "De rij kon niet worden verwijderd. Probeer opnieuw."); }
      })}>
      <Icon size={14} aria-hidden="true" /> {pending ? `${label}…` : label}
    </button>
    {error ? <span className="campaign-project-row-error" role="alert">{error}</span> : null}
  </div>;
}

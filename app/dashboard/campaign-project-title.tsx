"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation.js";
import { Check, Pencil, X } from "lucide-react";
import { saveCampaignProjectTitleAction } from "./campaign-project-actions.js";

export function CampaignProjectTitle({ siteId, path, title, url, disabled = false }: {
  siteId: string; path: string; title: string; url: string; disabled?: boolean;
}) {
  const router = useRouter();
  const editButton = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(title);
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => { setName(title); }, [title]);

  function cancel() {
    setEditing(false); setError(""); editButton.current?.focus();
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !draft.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await saveCampaignProjectTitleAction(siteId, path, draft);
        if (!result.ok) { setError(result.error); return; }
        setName(result.title); setEditing(false); editButton.current?.focus(); router.refresh();
      } catch { setError("De projectnaam kon niet worden opgeslagen. Probeer opnieuw."); }
    });
  }

  return <div className="campaign-project-title-editor">
    <div className="campaign-project-title-line">
      <a className="row-title" href={url} target="_blank" rel="noreferrer">{name}</a>
      <button ref={editButton} type="button" className="campaign-project-title-button" disabled={disabled || pending}
        aria-label={`${name}: naam wijzigen`} aria-expanded={editing}
        title={disabled ? "Opslag tijdelijk niet beschikbaar" : "Projectnaam wijzigen"}
        onClick={() => { if (editing) cancel(); else { setDraft(name); setError(""); setEditing(true); } }}>
        <Pencil size={13} aria-hidden="true" />
      </button>
    </div>
    {editing ? <form className="campaign-project-title-form" onSubmit={save} aria-busy={pending}
      onKeyDown={(event) => { if (event.key === "Escape" && !pending) { event.preventDefault(); cancel(); } }}>
      <input aria-label="Projectnaam" autoFocus required maxLength={180} value={draft} disabled={pending}
        onFocus={(event) => event.target.select()} onChange={(event) => setDraft(event.target.value)} />
      <div className="campaign-project-title-controls">
        <button type="submit" disabled={pending || !draft.trim()}><Check size={13} aria-hidden="true" />{pending ? "Opslaan…" : "Opslaan"}</button>
        <button type="button" disabled={pending} onClick={cancel}><X size={13} aria-hidden="true" />Annuleren</button>
      </div>
      {error ? <span className="campaign-project-row-error" role="alert">{error}</span> : null}
    </form> : null}
  </div>;
}

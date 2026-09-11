"use client";

import { useState } from "react";
import { Code2, Copy, ExternalLink } from "lucide-react";
import { buildEmbedCode, type EmbedScene } from "./embed-config.js";

export function EmbedControls({ disabled, onCapture }: {
  disabled: boolean;
  onCapture: () => { scene: EmbedScene; localUploads: number };
}) {
  const [embed, setEmbed] = useState<{ url: string; code: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function generate() {
    setMessage(""); setError(""); setEmbed(null);
    try {
      const { scene, localUploads } = onCapture();
      setEmbed(buildEmbedCode(window.location.origin, scene));
      if (localUploads) setMessage(`${localUploads} ${localUploads === 1 ? "lokale upload is" : "lokale uploads zijn"} niet inbegrepen. Voeg die modellen eerst toe aan de website om ze met bezoekers te delen.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "De insluitcode kon niet worden gemaakt.");
    }
  }

  async function copy() {
    if (!embed) return;
    try {
      await navigator.clipboard.writeText(embed.code);
      setError("");
      setMessage((previous) => previous.includes("lokale upload") ? `Code gekopieerd. ${previous.replace(/^Code gekopieerd\. /, "")}` : "Code gekopieerd.");
    } catch { setError("Kopiëren lukt niet automatisch. Selecteer de code hieronder en kopieer deze handmatig."); }
  }

  return (
    <details className="gent-embed-controls">
      <summary><Code2 size={16} aria-hidden /> Insluiten op website</summary>
      <p>Maak een iframe met de zichtbare projectmodellen, hun huidige posities en deze kijkhoek. Bezoekers kunnen de kaart bekijken, zoomen en draaien.</p>
      <p>De viewer bevat geen bewerkfuncties of Ledoux-menu. Lokale uploads zijn alleen beschikbaar in jouw browser.</p>
      <button type="button" className="gent-project-focus" disabled={disabled} onClick={generate}>
        <Code2 size={15} aria-hidden /> {embed ? "Insluitcode vernieuwen" : "Insluitcode maken"}
      </button>
      {embed && <>
        <label htmlFor="gent-iframe-code">Iframe-code</label>
        <textarea id="gent-iframe-code" rows={6} readOnly spellCheck={false} value={embed.code} onFocus={(event) => event.target.select()} />
        <div className="gent-embed-actions">
          <button type="button" onClick={() => void copy()}><Copy size={14} aria-hidden /> Code kopiëren</button>
          <a href={embed.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden /> Voorbeeld openen</a>
        </div>
        <p>Plak de code in een HTML-blok op je website. Pas de hoogte van 600 pixels aan naar wens. Vernieuw de code als je de opstelling verandert.</p>
      </>}
      {message && <p role="status">{message}</p>}
      {error && <p className="gent-model-error" role="alert">{error}</p>}
    </details>
  );
}

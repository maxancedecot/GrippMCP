"use client";

import { useEffect, useState } from "react";

const trackingCode = `<script defer
  src="https://dashboard.ledouxmedia.be/site-analytics.js"
  data-project="ledoux">
</script>`;

export function CrmTrackingCopy() {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");

  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copy() {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(trackingCode);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return <>
    <button type="button" className="header-meta-link crm-tracking-copy" onClick={() => void copy()}
      disabled={status === "copying"} aria-label="CRM tracking code kopiëren" title="Kopieer de code om in de header van je CRM-website te plakken">
      {status === "copied" ? "Code gekopieerd!" : "CRM tracking code"}
    </button>
    <p className="sr-only" role="status">{status === "copied" ? "CRM tracking code gekopieerd." : ""}</p>
    {status === "error" ? <div className="crm-tracking-fallback">
      <p role="alert">Automatisch kopiëren lukt niet. Selecteer en kopieer de code hieronder.</p>
      <textarea aria-label="CRM tracking code" readOnly rows={5} spellCheck={false} value={trackingCode}
        onFocus={(event) => event.target.select()} />
    </div> : null}
  </>;
}

"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation.js";

export function WebsiteRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return <button type="button" className="site-analytics-refresh-button" disabled={pending} aria-busy={pending} aria-live="polite"
    title="Websitegegevens en CVR-pagina’s opnieuw ophalen"
    onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw size={16} aria-hidden="true" />
    {pending ? "Gegevens bijwerken…" : "Gegevens bijwerken"}
  </button>;
}

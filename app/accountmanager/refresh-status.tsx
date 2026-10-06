"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation.js";

type Props = { refreshId: string; refreshedAt: string; refreshing: boolean; refreshFailed?: boolean; cleanHref: string };

export function AccountManagerRefreshStatus({ refreshId, refreshedAt, refreshing, refreshFailed = false, cleanHref }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [failed, setFailed] = useState(refreshFailed);
  useEffect(() => {
    setFailed(refreshFailed);
    if (!refreshing) {
      // A cold forced load has already finished; do not repeat it on reload.
      if (new URL(window.location.href).searchParams.has("syncMeta")) window.history.replaceState(null, "", cleanHref);
      return;
    }
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const expiresAt = Date.now() + 6 * 60_000;
    async function poll() {
      if (cancelled) return;
      if (Date.now() >= expiresAt) { setFailed(true); return; }
      if (document.visibilityState === "hidden") { timeout = setTimeout(poll, 2000); return; }
      try {
        const response = await fetch(`/api/accountmanager/refresh-status?id=${encodeURIComponent(refreshId)}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
        });
        if (!response.ok) throw new Error("Refresh status unavailable");
        const status: { state?: string; refreshedAt?: string } | null = await response.json();
        if (cancelled) return;
        if (status?.state === "complete" && status.refreshedAt && Date.parse(status.refreshedAt) > Date.parse(refreshedAt)) {
          startTransition(() => {
            if (new URL(window.location.href).searchParams.has("syncMeta")) router.replace(cleanHref, { scroll: false });
            else router.refresh();
          });
          return;
        }
        if (status?.state === "failed") { setFailed(true); return; }
      } catch { if (cancelled) return; }
      timeout = setTimeout(poll, 2000);
    }
    timeout = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [refreshId, refreshedAt, refreshing, refreshFailed, cleanHref, router]);

  if (!refreshing && !failed) return null;
  return <span className={`accountmanager-refresh-status${failed ? " accountmanager-refresh-status--failed" : ""}`} role="status">
    {failed ? "Bijwerken niet gelukt. Opgeslagen cijfers blijven zichtbaar." : <>
      <span className="accountmanager-loading-spinner" aria-hidden="true" /> Gegevens bijwerken…
    </>}
  </span>;
}

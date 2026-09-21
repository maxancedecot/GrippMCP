"use client";

import { createContext, useContext, useEffect, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation.js";

const AccountManagerLoadingContext = createContext(false);

export function AccountManagerLoadingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    const navigate = (url: URL) => startTransition(() => router.push(`${url.pathname}${url.search}${url.hash}`));
    const handleSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !isAccountManagerNavigation(form.action, window.location.origin)) return;
      const url = new URL(form.action, window.location.origin);
      url.search = "";
      for (const [key, value] of new FormData(form)) {
        if (typeof value === "string") url.searchParams.append(key, value);
      }
      event.preventDefault();
      navigate(url);
    };
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (!isAccountManagerNavigation(anchor.href, window.location.origin)) return;
      event.preventDefault();
      navigate(new URL(anchor.href, window.location.origin));
    };

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [router]);

  return <AccountManagerLoadingContext.Provider value={loading}>{children}</AccountManagerLoadingContext.Provider>;
}

export function AccountManagerLoadingRegion({ children }: { children: ReactNode }) {
  const loading = useContext(AccountManagerLoadingContext);
  return <section className="accountmanager-loading-region" aria-busy={loading}>
    {children}
    {loading ? <div className="accountmanager-loading-overlay" role="status" aria-live="polite" aria-label="Nieuwe dashboardgegevens laden">
      <div className="accountmanager-loading-card">
        <span className="accountmanager-loading-spinner" aria-hidden="true" />
        <strong>Nieuwe data laden</strong>
        <span>Het dashboard wordt bijgewerkt…</span>
      </div>
    </div> : null}
  </section>;
}

export function isAccountManagerNavigation(href: string, origin: string) {
  try {
    const url = new URL(href, origin);
    return url.origin === origin && url.pathname.replace(/\/+$/, "") === "/accountmanager";
  } catch {
    return false;
  }
}

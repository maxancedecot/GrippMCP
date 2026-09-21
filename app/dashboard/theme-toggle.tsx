"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const scope = document.querySelector<HTMLElement>(".dashboard-app--accountmanager");
    if (!scope) return;
    const saved = window.localStorage.getItem("ledoux-accountmanager-theme");
    const initial = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    scope.dataset.theme = initial;
    setTheme(initial);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    const scope = document.querySelector<HTMLElement>(".dashboard-app--accountmanager");
    if (!scope) return;
    scope.dataset.theme = next;
    window.localStorage.setItem("ledoux-accountmanager-theme", next);
    setTheme(next);
  }

  return <button type="button" className="dashboard-sidebar-action dashboard-theme-toggle" onClick={toggleTheme}
    aria-pressed={theme === "light"} aria-label={`${theme === "dark" ? "Lichte" : "Donkere"} modus inschakelen`}>
    <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
    {theme === "dark" ? "Lichte modus" : "Donkere modus"}
  </button>;
}

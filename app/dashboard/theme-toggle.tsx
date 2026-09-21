"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    window.localStorage.setItem("ledoux-dashboard-theme", next);
    setTheme(next);
  }

  return <button type="button" className="dashboard-sidebar-action dashboard-theme-toggle" onClick={toggleTheme}
    aria-pressed={theme === "light"} aria-label={`${theme === "dark" ? "Lichte" : "Donkere"} modus inschakelen`}>
    <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
    {theme === "dark" ? "Lichte modus" : "Donkere modus"}
  </button>;
}

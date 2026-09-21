import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const themeScript = `(function(){try{var saved=localStorage.getItem("ledoux-dashboard-theme");var theme=saved==="light"||saved==="dark"?saved:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(e){}})()`;

export const metadata: Metadata = {
  title: "Billabelheid dashboard | Gripp MCP",
  description: "Dashboard voor billabele en niet-billabele Gripp-uren."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}

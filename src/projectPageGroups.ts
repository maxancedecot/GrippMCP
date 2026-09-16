export type ProjectPageGroup = { title: string; sourcePath: string; sourcePaths: string[] };

// Explicitly grouped versions of the same project; other sites keep exact paths.
const brusselskaai: ProjectPageGroup = {
  title: "Brusselskaai", sourcePath: "/", sourcePaths: ["/", "/home-fr", "/home-eng", "/teaser-fr"]
};

export function normalizeProjectPath(value: string): string {
  const url = new URL(value, "https://project.local");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const slug = url.searchParams.get("p_slug");
  return path + (slug !== null ? `?${new URLSearchParams({ p_slug: slug })}` : "");
}

export function projectPageGroupsForSite(siteUrl: string): ProjectPageGroup[] {
  return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "") === "brusselskaai.be" ? [brusselskaai] : [];
}

export function projectPageGroup(siteUrl: string, path: string) {
  return projectPageGroupsForSite(siteUrl).find((group) => group.sourcePaths.includes(normalizeProjectPath(path)));
}

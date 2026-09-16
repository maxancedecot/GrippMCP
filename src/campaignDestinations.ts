import type { CvrOverviewRow } from "./siteAnalyticsConversions.js";
import type { CampaignPageMatch } from "./campaignPerformance.js";

export function facebookDestinationUrls(creative: unknown): string[] {
  if (!creative || typeof creative !== "object" || Array.isArray(creative)) return [];
  const record = creative as Record<string, unknown>;
  const urls = ["link", "website_url", "object_url", "link_url"].flatMap((key) => typeof record[key] === "string" ? [record[key] as string] : []);
  // Read only destination fields, never match against ad copy or image URLs.
  for (const key of ["object_story_spec", "link_data", "video_data", "template_data", "call_to_action", "value", "child_attachments", "asset_feed_spec", "link_urls"]) {
    const value = record[key];
    for (const child of Array.isArray(value) ? value : [value]) urls.push(...facebookDestinationUrls(child));
  }
  return urls;
}

export function matchCampaignPages(siteUrl: string, destinations: string[], projects: CvrOverviewRow[]): CampaignPageMatch["pages"] {
  const site = new URL(siteUrl);
  const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  const pagePath = (url: URL) => (url.pathname.replace(/\/+$/, "") || "/")
    + (url.searchParams.has("p_slug") ? `?${new URLSearchParams({ p_slug: url.searchParams.get("p_slug")! })}` : "");
  const pages = new Map<string, CampaignPageMatch["pages"][number]>();
  const sitePath = site.pathname.replace(/\/+$/, "");
  for (const destination of destinations) {
    let url: URL;
    try { url = new URL(destination); } catch { continue; }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port !== site.port || host(url) !== host(site)) continue;
    if (sitePath && url.pathname !== sitePath && !url.pathname.startsWith(`${sitePath}/`)) continue;
    const path = pagePath(url);
    const project = projects.find((candidate) => pagePath(new URL(candidate.sourcePath, site)) === path);
    // Keep project selectors; remove tracking parameters and URL fragments.
    url.search = "";
    if (path.includes("?")) url.search = path.slice(path.indexOf("?"));
    url.hash = "";
    pages.set(path, { url: url.toString(), path, title: project?.sourceTitle || path, hasConversionMapping: !!project });
  }
  return [...pages.values()];
}

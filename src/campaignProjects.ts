import { z } from "zod";
import type { CampaignPerformanceRow, CampaignSource } from "./campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "./siteAnalytics.js";
import { cvrOverviewRowsFromLinks } from "./siteAnalyticsConversions.js";

export const CAMPAIGN_PROJECT_MATCHES_KEY = "campaign-project-matches:v1";
const identifier = z.string().trim().min(1);
const projectPath = identifier.refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), "Use a local project path")
  .transform(normalizeProjectPath);
const matchSchema = z.object({
  channel: z.enum(["facebook", "google"]).optional(),
  siteId: identifier,
  accountId: identifier.regex(/^\d+$/),
  campaignId: identifier.regex(/^\d+$/),
  sourcePaths: z.array(projectPath).min(1).transform((paths) => [...new Set(paths)])
}).strict();
export type CampaignProjectMatch = z.infer<typeof matchSchema>;

export function parseCampaignProjectMatches(value: unknown): CampaignProjectMatch[] {
  const matches = z.array(matchSchema).parse(value ?? []);
  const keys = matches.map((match) => `${match.channel ?? "facebook"}:${match.siteId}:${match.accountId}:${match.campaignId}`);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate campaign/project mapping");
  return matches;
}

export function normalizeProjectPath(value: string): string {
  const url = new URL(value, "https://project.local");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const slug = url.searchParams.get("p_slug");
  return path + (slug !== null ? `?${new URLSearchParams({ p_slug: slug })}` : "");
}

export type ProjectCampaign = {
  id: string;
  accountId: string;
  name: string;
  ctr: number | null;
  spend: number;
  currency: string;
  live: boolean | null;
  unavailable: boolean;
  projectCount: number;
};
export type CampaignProjectRow = {
  key: string;
  siteId: string;
  siteName: string;
  sourcePath: string;
  url: string;
  title: string;
  visitors: number | null;
  leads: number | null;
  appointments: number | null;
  cvr: number | null;
  hasConversionMapping: boolean;
  facebookState: CampaignSource<unknown>["state"];
  campaigns: ProjectCampaign[];
  googleState: CampaignSource<unknown>["state"];
  googleCampaigns: ProjectCampaign[];
};
export type UnmatchedProjectCampaign = { channel: "facebook" | "google"; siteId: string; siteName: string; campaignId: string; campaignName: string };

export function campaignProjectOverview(dashboard: SiteAnalyticsDashboardData, sites: CampaignPerformanceRow[]) {
  const projects = new Map<string, CampaignProjectRow>();
  const unmatchedCampaigns: UnmatchedProjectCampaign[] = [];
  const conversions = cvrOverviewRowsFromLinks(dashboard.cvrLinks);
  for (const site of sites) {
    const ensureProject = (sourcePath: string, title = ""): CampaignProjectRow => {
      const path = normalizeProjectPath(sourcePath);
      const key = `${site.siteId}:${path}`;
      const existing = projects.get(key);
      if (existing) return existing;
      const metrics = conversions.find((row) => row.siteId === site.siteId && normalizeProjectPath(row.sourcePath) === path);
      const candidate = dashboard.cvrPageCandidates?.find((row) => row.siteId === site.siteId && normalizeProjectPath(row.path) === path);
      const visitors = metrics?.sourceVisitors ?? candidate?.uniqueVisitors ?? null;
      const row: CampaignProjectRow = {
        key, siteId: site.siteId, siteName: site.name, sourcePath: metrics?.sourcePath ?? sourcePath,
        url: new URL(metrics?.sourcePath ?? sourcePath, site.url).toString(),
        title: metrics?.sourceTitle || candidate?.title || title || (path === "/" ? site.name : path),
        visitors, leads: metrics?.brochure.visitors ?? null, appointments: metrics?.appointment.visitors ?? null,
        cvr: metrics ? (metrics.sourceVisitors > 0 ? (metrics.brochure.visitors + metrics.appointment.visitors) / metrics.sourceVisitors * 100 : 0) : null,
        hasConversionMapping: !!metrics, facebookState: site.facebook.state, campaigns: [],
        googleState: site.google.state === "connected" ? site.googleCampaignPages.state : site.google.state, googleCampaigns: []
      };
      projects.set(key, row);
      return row;
    };
    for (const project of conversions.filter((row) => row.siteId === site.siteId)) ensureProject(project.sourcePath, project.sourceTitle);
    // Keep saved matches for stopped campaigns so their period spend and current
    // status remain visible. CTR still uses only the currently running selection.
    for (const campaign of site.facebook.data?.campaigns ?? []) {
      const pages = site.facebookCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
      const uniquePages = [...new Map(pages.map((page) => [normalizeProjectPath(page.path), page])).values()];
      if (uniquePages.length === 0) {
        if (campaign.live === true) unmatchedCampaigns.push({ channel: "facebook", siteId: site.siteId, siteName: site.name, campaignId: campaign.id, campaignName: campaign.name ?? campaign.id });
        continue;
      }
      for (const page of uniquePages) {
        const project = ensureProject(page.path, page.title);
        const accountId = site.facebook.data!.accountId;
        if (project.campaigns.some((item) => item.accountId === accountId && item.id === campaign.id)) continue;
        const ctr = campaign.live === true ? site.facebookLinkCtr.data?.campaigns.find((metric) => metric.id === campaign.id)?.ctr ?? null : null;
        project.campaigns.push({ id: campaign.id, accountId, name: campaign.name ?? campaign.id, ctr,
          spend: campaign.spend, currency: site.facebook.data!.currency, live: campaign.live,
          unavailable: campaign.live === true && site.facebookLinkCtr.state === "unavailable", projectCount: uniquePages.length });
      }
    }
    for (const campaign of site.google.data?.campaigns ?? []) {
      const pages = site.googleCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
      const uniquePages = [...new Map(pages.map((page) => [normalizeProjectPath(page.path), page])).values()];
      if (uniquePages.length === 0) {
        if (campaign.live === true || campaign.spend > 0) unmatchedCampaigns.push({ channel: "google", siteId: site.siteId, siteName: site.name,
          campaignId: campaign.id, campaignName: campaign.name ?? campaign.id });
        continue;
      }
      for (const page of uniquePages) {
        const project = ensureProject(page.path, page.title);
        const accountId = site.google.data!.accountId;
        if (project.googleCampaigns.some((item) => item.accountId === accountId && item.id === campaign.id)) continue;
        project.googleCampaigns.push({ id: campaign.id, accountId, name: campaign.name ?? campaign.id,
          ctr: campaign.impressions > 0 ? campaign.clicks / campaign.impressions * 100 : null,
          spend: campaign.spend, currency: site.google.data!.currency, live: campaign.live,
          unavailable: false, projectCount: uniquePages.length });
      }
    }
  }
  return {
    projects: [...projects.values()].sort((a, b) => a.siteName.localeCompare(b.siteName) || a.title.localeCompare(b.title)),
    unmatchedCampaigns
  };
}

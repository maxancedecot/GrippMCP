import { z } from "zod";
import type { CampaignPerformanceRow, CampaignSource } from "./campaignPerformance.js";
import type { SiteAnalyticsDashboardData } from "./siteAnalytics.js";
import { cvrOverviewRowsFromLinks } from "./siteAnalyticsConversions.js";
import { isExcludedAnalyticsLink } from "./analyticsPageFilter.js";
import { normalizeProjectPath, projectPageGroup } from "./projectPageGroups.js";
export { normalizeProjectPath } from "./projectPageGroups.js";

export const CAMPAIGN_PROJECT_MATCHES_KEY = "campaign-project-matches:v1";
export const META_DISCOVERED_PROJECT_MATCHES_KEY = "meta-discovered-project-matches:v1";
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

export type ProjectCampaign = {
  id: string;
  accountId: string;
  name: string;
  ctr: number | null;
  impressions: number;
  spend: number;
  currency: string;
  live: boolean | null;
  unavailable: boolean;
  projectCount: number;
};
export type GoogleProjectCampaign = ProjectCampaign & { clicks: number };

function summarizeProjectCampaignTotals(campaigns: ProjectCampaign[]) {
  const amounts = new Map<string, number>();
  for (const campaign of campaigns) amounts.set(campaign.currency, (amounts.get(campaign.currency) ?? 0) + campaign.spend);
  return {
    spend: [...amounts].map(([currency, amount]) => ({ currency, amount })),
    live: campaigns.some((campaign) => campaign.live === true) ? true
      : campaigns.length > 0 && campaigns.every((campaign) => campaign.live === false) ? false : null
  };
}

export function summarizeGoogleProjectCampaigns(campaigns: GoogleProjectCampaign[]) {
  const clicks = campaigns.reduce((sum, campaign) => sum + campaign.clicks, 0);
  const impressions = campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);
  return { ctr: impressions > 0 ? clicks / impressions * 100 : null, ...summarizeProjectCampaignTotals(campaigns) };
}

export function summarizeFacebookProjectCampaigns(campaigns: ProjectCampaign[]) {
  const measured = campaigns.filter((campaign) => campaign.impressions > 0);
  const impressions = measured.reduce((sum, campaign) => sum + campaign.impressions, 0);
  const complete = measured.length > 0 && measured.every((campaign) => !campaign.unavailable && campaign.ctr !== null);
  // Weight Meta's link-CTR with the impressions from that same measurement.
  // All-click counts are a different metric and must not be substituted here.
  const ctr = !complete ? null : measured.length === 1 ? measured[0].ctr
    : measured.reduce((sum, campaign) => sum + campaign.ctr! * campaign.impressions, 0) / impressions;
  return { ctr, ...summarizeProjectCampaignTotals(campaigns) };
}
export type CampaignProjectRow = {
  key: string;
  siteId: string;
  siteName: string;
  sourcePath: string;
  sourcePaths?: string[];
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
  googleCampaigns: GoogleProjectCampaign[];
};
export type UnmatchedProjectCampaign = { channel: "facebook" | "google"; siteId: string; siteName: string; accountId?: string; campaignId: string; campaignName: string };

export function campaignProjectOverview(dashboard: SiteAnalyticsDashboardData, sites: CampaignPerformanceRow[], ghlAppointments = new Map<string, number>()) {
  const projects = new Map<string, CampaignProjectRow>();
  const unmatchedCampaigns: UnmatchedProjectCampaign[] = [];
  const conversions = cvrOverviewRowsFromLinks(dashboard.cvrLinks);
  for (const site of sites) {
    if (isExcludedAnalyticsLink(site.url)) continue;
    const dashboardGroups = dashboard.projectPageGroups?.filter((group) => group.siteId === site.siteId) ?? [];
    const groupForPath = (path: string) => dashboardGroups.find((group) => group.sourcePaths.includes(normalizeProjectPath(path)))
      ?? projectPageGroup(site.url, path);
    const projectPath = (path: string) => groupForPath(path)?.sourcePath ?? normalizeProjectPath(path);
    const ensureProject = (sourcePath: string, title = ""): CampaignProjectRow => {
      const group = groupForPath(sourcePath);
      const path = projectPath(sourcePath);
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
        hasConversionMapping: !!metrics, facebookState: (site.facebookAccounts ?? [site]).some((account) => account.facebook.state === "connected") ? "connected" : site.facebook.state, campaigns: [],
        googleState: site.google.state === "connected" ? site.googleCampaignPages.state : site.google.state, googleCampaigns: []
      };
      if (group) {
        const grouped = dashboard.projectPageGroups?.find((item) => item.siteId === site.siteId && item.sourcePath === path);
        // Grouped unique counts come from visitor sets, never sums of page totals.
        Object.assign(row, {
          sourcePath: path, sourcePaths: group.sourcePaths, title: group.title, url: new URL(path, site.url).toString(),
          visitors: grouped?.visitors ?? null, leads: grouped?.leads ?? null, appointments: grouped?.appointments ?? null,
          cvr: grouped?.leads !== null && grouped?.leads !== undefined && grouped.appointments !== null
            ? grouped.visitors > 0 ? (grouped.leads + grouped.appointments) / grouped.visitors * 100 : 0 : null,
          hasConversionMapping: grouped?.leads !== null && grouped?.leads !== undefined
        });
      }
      projects.set(key, row);
      return row;
    };
    for (const group of dashboard.projectPageGroups?.filter((group) => group.siteId === site.siteId) ?? []) ensureProject(group.sourcePath);
    for (const project of conversions.filter((row) => row.siteId === site.siteId && !isExcludedAnalyticsLink(row.sourcePath))) ensureProject(project.sourcePath, project.sourceTitle);
    // Keep saved matches for stopped campaigns so their period spend and current
    // status remain visible. CTR follows the selected reporting period.
    for (const account of (site.facebookAccounts ?? [site])) {
      for (const campaign of account.facebook.data?.campaigns ?? []) {
        const pages = account.facebookCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
        const uniquePages = [...new Map(pages.filter((page) => !isExcludedAnalyticsLink(page.url) && !isExcludedAnalyticsLink(page.path)).map((page) => [projectPath(page.path), page])).values()];
        if (uniquePages.length === 0) {
          if (campaign.live === true || campaign.impressions > 0 || campaign.spend > 0) unmatchedCampaigns.push({ channel: "facebook", accountId: account.facebook.data?.accountId, siteId: site.siteId, siteName: site.name, campaignId: campaign.id, campaignName: campaign.name ?? campaign.id });
          continue;
        }
        for (const page of uniquePages) {
          const project = ensureProject(page.path, page.title);
          const accountId = account.facebook.data!.accountId;
          if (project.campaigns.some((item) => item.accountId === accountId && item.id === campaign.id)) continue;
          const metric = account.facebookLinkCtr.data?.campaigns.find((metric) => metric.id === campaign.id);
          const ctr = metric?.ctr ?? null;
          project.campaigns.push({ id: campaign.id, accountId, name: campaign.name ?? campaign.id, ctr, impressions: metric?.impressions ?? campaign.impressions,
            spend: campaign.spend, currency: account.facebook.data!.currency, live: campaign.live,
            unavailable: (campaign.live === true || campaign.impressions > 0 || campaign.spend > 0) && account.facebookLinkCtr.state === "unavailable", projectCount: uniquePages.length });
        }
      }
    }
    for (const campaign of site.google.data?.campaigns ?? []) {
      const pages = site.googleCampaignPages.data?.find((match) => match.campaignId === campaign.id)?.pages ?? [];
      const uniquePages = [...new Map(pages.filter((page) => !isExcludedAnalyticsLink(page.url) && !isExcludedAnalyticsLink(page.path)).map((page) => [projectPath(page.path), page])).values()];
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
          clicks: campaign.clicks, impressions: campaign.impressions,
          ctr: campaign.impressions > 0 ? campaign.clicks / campaign.impressions * 100 : null,
          spend: campaign.spend, currency: site.google.data!.currency, live: campaign.live,
          unavailable: false, projectCount: uniquePages.length });
      }
    }
  }
  for (const project of projects.values()) {
    const appointments = ghlAppointments.get(project.key);
    if (appointments === undefined) continue;
    project.appointments = appointments;
    project.cvr = project.visitors === null ? null : project.visitors > 0 ? ((project.leads ?? 0) + appointments) / project.visitors * 100 : 0;
    project.hasConversionMapping = true;
  }
  return {
    projects: [...projects.values()].sort((a, b) => a.siteName.localeCompare(b.siteName) || a.title.localeCompare(b.title)),
    unmatchedCampaigns
  };
}

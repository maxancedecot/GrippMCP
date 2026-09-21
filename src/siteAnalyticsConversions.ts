import type { SiteAnalyticsCvrLinkRow, SiteAnalyticsProjectPageGroup } from "./siteAnalytics.js";
import { normalizeProjectPath } from "./projectPageGroups.js";

type CvrOverviewColumn = "brochure" | "appointment";

export type CvrOverviewMetric = {
  visitors: number;
};

export type CvrOverviewRow = {
  key: string;
  siteId: string;
  siteName: string;
  sourcePath: string;
  sourceTitle: string;
  sourceVisitors: number;
  brochure: CvrOverviewMetric;
  appointment: CvrOverviewMetric;
};

export function cvrOverviewRowsFromLinks(links: SiteAnalyticsCvrLinkRow[], groups: SiteAnalyticsProjectPageGroup[] = []) {
  const rowsBySource = new Map<string, CvrOverviewRow>();
  const groupedPaths = new Set(groups.flatMap((group) => group.sourcePaths.map((path) => `${group.siteId}:${normalizeProjectPath(path)}`)));

  for (const link of links) {
    if (groupedPaths.has(`${link.siteId}:${normalizeProjectPath(link.sourcePath)}`)) continue;
    const key = `${link.siteId}:${link.sourcePath}`;
    const row = rowsBySource.get(key) ?? {
      key,
      siteId: link.siteId,
      siteName: link.siteName,
      sourcePath: link.sourcePath,
      sourceTitle: link.sourceTitle,
      sourceVisitors: 0,
      brochure: emptyCvrOverviewMetric(),
      appointment: emptyCvrOverviewMetric()
    };
    const column = cvrOverviewColumnFromLink(link);

    row.sourceVisitors = Math.max(row.sourceVisitors, link.sourceVisitors);
    row[column].visitors += link.targetVisitors;
    rowsBySource.set(key, row);
  }

  for (const group of groups) {
    if (group.leads === null && group.appointments === null) continue;
    const key = `${group.siteId}:${group.sourcePath}`;
    rowsBySource.set(key, {
      key,
      siteId: group.siteId,
      siteName: links.find((link) => link.siteId === group.siteId)?.siteName ?? group.siteId,
      sourcePath: group.sourcePath,
      sourceTitle: group.title,
      sourceVisitors: group.visitors,
      brochure: { visitors: group.leads ?? 0 },
      appointment: { visitors: group.appointments ?? 0 }
    });
  }

  return Array.from(rowsBySource.values()).sort((left, right) => {
    return (
      left.siteName.localeCompare(right.siteName) ||
      right.sourceVisitors - left.sourceVisitors ||
      left.sourceTitle.localeCompare(right.sourceTitle) ||
      left.sourcePath.localeCompare(right.sourcePath)
    );
  });
}

function cvrOverviewColumnFromLink(link: SiteAnalyticsCvrLinkRow): CvrOverviewColumn {
  const target = normalizeCvrTargetText(`${link.targetPath} ${link.targetTitle}`);
  return target.includes("brochure") ? "brochure" : "appointment";
}

function emptyCvrOverviewMetric(): CvrOverviewMetric {
  return {
    visitors: 0
  };
}

function normalizeCvrTargetText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

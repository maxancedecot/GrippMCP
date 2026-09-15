import type { SiteAnalyticsCvrLinkRow } from "./siteAnalytics.js";

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

export function cvrOverviewRowsFromLinks(links: SiteAnalyticsCvrLinkRow[]) {
  const rowsBySource = new Map<string, CvrOverviewRow>();

  for (const link of links) {
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


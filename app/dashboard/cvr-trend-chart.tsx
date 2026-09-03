"use client";

import { useMemo, useState } from "react";
import type { SiteAnalyticsCvrLinkRow } from "../../src/siteAnalytics.js";
import { smoothAreaPath, smoothLinePath, type ChartPoint } from "../chart-paths.js";

const numberFormatter = new Intl.NumberFormat("nl-BE");
const conversionRateFormatter = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

export function CvrTrendChart({ links, periodLabel }: { links: SiteAnalyticsCvrLinkRow[]; periodLabel: string }) {
  const [selectedLinkId, setSelectedLinkId] = useState(links[0]?.id ?? "");
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0];

  if (!selectedLink) {
    return <p className="empty-state">Geen projectpagina's gekoppeld aan bedankingspagina's.</p>;
  }

  return (
    <div className="cvr-trend-chart">
      <div className="cvr-trend-toolbar">
        <label className="cvr-site-field">
          <span>Project</span>
          <select value={selectedLink.id} onChange={(event) => setSelectedLinkId(event.target.value)}>
            {links.map((link) => (
              <option key={link.id} value={link.id}>
                {link.sourceTitle}
                {links.some((other) => other.id !== link.id && other.siteName !== link.siteName) ? ` — ${link.siteName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="panel-total">{periodLabel}</span>
      </div>
      <CvrTrendPlot rows={selectedLink.dailySeries} targetTitle={selectedLink.targetTitle} />
    </div>
  );
}

function CvrTrendPlot({ rows, targetTitle }: { rows: SiteAnalyticsCvrLinkRow["dailySeries"]; targetTitle: string }) {
  const width = Math.max(760, rows.length * 42);
  const height = 320;
  const padding = { top: 28, right: 34, bottom: 48, left: 74 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = useMemo(
    () => Math.max(10, ...rows.map((row) => Math.ceil(row.conversionRatePercent / 5) * 5)),
    [rows]
  );
  const xFor = (index: number) => padding.left + (rows.length <= 1 ? chartWidth / 2 : (chartWidth * index) / (rows.length - 1));
  const yFor = (value: number) => padding.top + ((maximum - value) / maximum) * chartHeight;
  const ratePoints: ChartPoint[] = rows.map((row, index) => ({ x: xFor(index), y: yFor(row.conversionRatePercent) }));
  const ratePath = smoothLinePath(ratePoints);
  const areaPath = smoothAreaPath(ratePoints, yFor(0));
  const gridTicks = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round(maximum - (maximum * index) / 4);
    return { key: index, value, y: yFor(value) };
  });
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div className="site-analytics-chart">
      <div className="revenue-line-legend" aria-hidden="true">
        <span><i className="site-analytics-legend-dot" />CVR naar {targetTitle}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`CVR-verloop: ${rows.map((row) => `${row.label} ${formatConversionRate(row.conversionRatePercent)}%`).join(", ")}`}
      >
        <defs>
          <linearGradient id="cvr-trend-gradient" x1="0" x2="0" y1={padding.top} y2={height - padding.bottom} gradientUnits="userSpaceOnUse">
            <stop className="site-analytics-gradient-start" offset="0%" />
            <stop className="site-analytics-gradient-end" offset="100%" />
          </linearGradient>
        </defs>
        <rect className="revenue-line-plot-bg" x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="6" />
        {gridTicks.map((tick) => (
          <g key={tick.key}>
            <line className="revenue-line-grid" x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} />
            <text className="revenue-line-y-label" x={padding.left - 12} y={tick.y + 4} textAnchor="end">
              {tick.value}%
            </text>
          </g>
        ))}
        {rows.length > 1 ? <path className="site-analytics-area" d={areaPath} fill="url(#cvr-trend-gradient)" /> : null}
        {rows.length > 1 ? <path className="site-analytics-line site-analytics-line--views" d={ratePath} /> : null}
        {rows.map((row, index) => (
          <g key={row.date}>
            <title>{`${row.label}: ${formatConversionRate(row.conversionRatePercent)}% (${formatNumber(row.targetVisitors)} / ${formatNumber(row.sourceVisitors)} bezoekers)`}</title>
            <circle className="site-analytics-point site-analytics-point--views" cx={ratePoints[index].x} cy={ratePoints[index].y} r="3.5" />
            {index % labelEvery === 0 || index === rows.length - 1 ? (
              <text className="revenue-line-label" x={ratePoints[index].x} y={height - 20} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"}>
                {row.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatConversionRate(value: number) {
  return conversionRateFormatter.format(Math.max(0, value));
}

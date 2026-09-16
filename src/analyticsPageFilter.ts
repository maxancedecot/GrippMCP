const excludedLinkParts = /preview|elementor|leadconnector|wordpress/i;

export function isExcludedAnalyticsLink(value: string): boolean {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  return excludedLinkParts.test(decoded);
}

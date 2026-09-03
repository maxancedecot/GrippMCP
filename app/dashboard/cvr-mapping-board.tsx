"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type {
  SiteAnalyticsCvrLinkRow,
  SiteAnalyticsCvrPageCandidate,
  SiteAnalyticsPublicSite
} from "../../src/siteAnalytics.js";

type DashboardAction = (formData: FormData) => void | Promise<void>;

type CvrMappingBoardProps = {
  sites: SiteAnalyticsPublicSite[];
  pages: SiteAnalyticsCvrPageCandidate[];
  links: SiteAnalyticsCvrLinkRow[];
  selectedSiteId?: string;
  returnTo: string;
  createAction: DashboardAction;
  deleteAction: DashboardAction;
};

type LinePair = {
  key: string;
  sourcePath: string;
  targetPath: string;
  preview: boolean;
};

type LinePath = {
  key: string;
  d: string;
  preview: boolean;
};

const ignoredPageQueryParams = new Set([
  "_ga",
  "_gl",
  "fbclid",
  "gbraid",
  "gclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ttclid",
  "utm_campaign",
  "utm_content",
  "utm_creative_format",
  "utm_id",
  "utm_marketing_tactic",
  "utm_medium",
  "utm_source",
  "utm_term",
  "wbraid"
]);

const numberFormatter = new Intl.NumberFormat("nl-BE");
const conversionRateFormatter = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

export function CvrMappingBoard({
  sites,
  pages,
  links,
  selectedSiteId,
  returnTo,
  createAction,
  deleteAction
}: CvrMappingBoardProps) {
  const siteOptions = useMemo(() => siteOptionsFromData(sites, pages, links), [sites, pages, links]);
  const defaultSiteId = selectedSiteId ?? siteOptions[0]?.id ?? "";
  const [activeSiteId, setActiveSiteId] = useState(defaultSiteId);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSourcePath, setSelectedSourcePath] = useState("");
  const [selectedTargetPath, setSelectedTargetPath] = useState("");
  const [sourceInputValue, setSourceInputValue] = useState("");
  const [targetInputValue, setTargetInputValue] = useState("");
  const [linePaths, setLinePaths] = useState<LinePath[]>([]);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const sourceRefs = useRef(new Map<string, HTMLButtonElement>());
  const targetRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (selectedSiteId && selectedSiteId !== activeSiteId) {
      setActiveSiteId(selectedSiteId);
      return;
    }
    if (!activeSiteId && defaultSiteId) {
      setActiveSiteId(defaultSiteId);
      return;
    }
    if (activeSiteId && siteOptions.length > 0 && !siteOptions.some((site) => site.id === activeSiteId)) {
      setActiveSiteId(defaultSiteId);
    }
  }, [activeSiteId, defaultSiteId, selectedSiteId, siteOptions]);

  useEffect(() => {
    setSelectedSourcePath("");
    setSelectedTargetPath("");
    setSourceInputValue("");
    setTargetInputValue("");
  }, [activeSiteId]);

  const activePages = useMemo(() => pages.filter((page) => page.siteId === activeSiteId), [activeSiteId, pages]);
  const activeLinks = useMemo(() => links.filter((link) => link.siteId === activeSiteId), [activeSiteId, links]);
  const sourceLinkedPaths = useMemo(() => new Set(activeLinks.map((link) => link.sourcePath)), [activeLinks]);
  const targetLinkedPaths = useMemo(() => new Set(activeLinks.map((link) => link.targetPath)), [activeLinks]);
  const sourcePages = useMemo(
    () => sortSourcePages(activePages.filter((page) => !isThankYouPage(page) || sourceLinkedPaths.has(page.path)), sourceLinkedPaths),
    [activePages, sourceLinkedPaths]
  );
  const targetPages = useMemo(
    () => sortTargetPages(activePages.filter((page) => isThankYouPage(page) || targetLinkedPaths.has(page.path)), targetLinkedPaths),
    [activePages, targetLinkedPaths]
  );
  const sourcePathValue = normalizeClientPagePath(sourceInputValue);
  const targetPathValue = normalizeClientPagePath(targetInputValue);
  const sourceTitleValue = activePages.find((page) => page.path === sourcePathValue)?.title ?? "";
  const targetTitleValue = activePages.find((page) => page.path === targetPathValue)?.title ?? "";
  const targetLooksValid = !targetInputValue.trim() || isThankYouPath(targetInputValue);
  const selectedLinkExists = activeLinks.some((link) => link.sourcePath === sourcePathValue && link.targetPath === targetPathValue);
  const samePathSelected = Boolean(sourcePathValue && targetPathValue && sourcePathValue === targetPathValue);
  const canCreate = Boolean(activeSiteId && sourcePathValue && targetPathValue && targetLooksValid && !selectedLinkExists && !samePathSelected);
  const linePairs = useMemo<LinePair[]>(
    () => {
      const pairs: LinePair[] = activeLinks.map((link) => ({
        key: link.id,
        sourcePath: link.sourcePath,
        targetPath: link.targetPath,
        preview: false
      }));
      if (canCreate) {
        pairs.push({
          key: "preview",
          sourcePath: sourcePathValue,
          targetPath: targetPathValue,
          preview: true
        });
      }

      return pairs;
    },
    [activeLinks, canCreate, sourcePathValue, targetPathValue]
  );

  useLayoutEffect(() => {
    const measureLines = () => {
      const board = boardRef.current;
      if (!board) {
        setLinePaths([]);
        return;
      }

      const boardRect = board.getBoundingClientRect();
      const nextLines = linePairs.flatMap((pair) => {
        const source = sourceRefs.current.get(pair.sourcePath);
        const target = targetRefs.current.get(pair.targetPath);
        if (!source || !target) {
          return [];
        }

        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const startX = sourceRect.right - boardRect.left;
        const startY = sourceRect.top + sourceRect.height / 2 - boardRect.top;
        const endX = targetRect.left - boardRect.left;
        const endY = targetRect.top + targetRect.height / 2 - boardRect.top;
        const curve = Math.max(46, Math.abs(endX - startX) * 0.42);

        return [{
          key: pair.key,
          preview: pair.preview,
          d: `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`
        }];
      });

      setLinePaths(nextLines);
    };

    measureLines();
    window.addEventListener("resize", measureLines);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", measureLines);
    }

    const observer = new ResizeObserver(measureLines);
    if (boardRef.current) {
      observer.observe(boardRef.current);
    }
    for (const element of [...sourceRefs.current.values(), ...targetRefs.current.values()]) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureLines);
    };
  }, [linePairs, sourcePages, targetPages]);

  const activeSiteName = siteOptions.find((site) => site.id === activeSiteId)?.name ?? "Site";
  const selectSourcePage = (path: string) => {
    setSelectedSourcePath(path);
    setSourceInputValue(path);
  };
  const selectTargetPage = (path: string) => {
    setSelectedTargetPath(path);
    setTargetInputValue(path);
  };

  return (
    <section className="panel cvr-mapping-panel">
      <div className="panel-heading cvr-mapping-heading">
        <button
          type="button"
          className="cvr-mapping-toggle"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
        >
          <span className={`cvr-mapping-toggle-icon ${isOpen ? "cvr-mapping-toggle-icon--open" : ""}`} aria-hidden="true" />
          <span>
            <p className="eyebrow">CVR</p>
            <h2>CVR-koppelingen</h2>
          </span>
        </button>
        <div className="cvr-mapping-toolbar">
          {siteOptions.length > 1 ? (
            <label className="cvr-site-field">
              <span>Site</span>
              <select value={activeSiteId} onChange={(event) => setActiveSiteId(event.target.value)}>
                {siteOptions.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="panel-total">{activeSiteName}</span>
          )}
          <span className="panel-total">{activeLinks.length} koppelingen</span>
        </div>
      </div>

      {isOpen ? (
        <>
          <div className="cvr-link-board" ref={boardRef}>
            <svg className="cvr-link-lines" width="100%" height="100%" aria-hidden="true">
              {linePaths.map((line) => (
                <path key={line.key} className={line.preview ? "cvr-link-line cvr-link-line--preview" : "cvr-link-line"} d={line.d} />
              ))}
            </svg>

            <PageColumn
              title="Projectpagina's"
              pages={sourcePages}
              selectedPath={selectedSourcePath}
              linkedPaths={sourceLinkedPaths}
              otherSelectedPath={selectedTargetPath}
              emptyLabel="Geen projectpagina's gemeten."
              refMap={sourceRefs}
              onSelect={selectSourcePage}
            />
            <PageColumn
              title="Thank-you pagina's"
              pages={targetPages}
              selectedPath={selectedTargetPath}
              linkedPaths={targetLinkedPaths}
              otherSelectedPath={selectedSourcePath}
              emptyLabel="Geen thank-you of bedankt pagina's gemeten."
              refMap={targetRefs}
              onSelect={selectTargetPage}
            />
          </div>

          <form action={createAction} className="cvr-action-bar">
            <input type="hidden" name="site_id" value={activeSiteId} />
            <input type="hidden" name="source_path" value={sourceInputValue} />
            <input type="hidden" name="target_path" value={targetInputValue} />
            <input type="hidden" name="source_title" value={sourceTitleValue} />
            <input type="hidden" name="target_title" value={targetTitleValue} />
            <input type="hidden" name="return_to" value={returnTo} />
            <div className="cvr-manual-fields">
              <label>
                <span>Project-URL</span>
                <input
                  type="text"
                  value={sourceInputValue}
                  placeholder="/projecten/crollet/"
                  onChange={(event) => {
                    setSourceInputValue(event.target.value);
                    setSelectedSourcePath(normalizeClientPagePath(event.target.value));
                  }}
                />
              </label>
              <label>
                <span>Bedankpagina-URL</span>
                <input
                  type="text"
                  value={targetInputValue}
                  placeholder="/bedankt-afspraak/?p_slug=crollet"
                  onChange={(event) => {
                    setTargetInputValue(event.target.value);
                    setSelectedTargetPath(normalizeClientPagePath(event.target.value));
                  }}
                />
              </label>
            </div>
            <button className="cvr-save-button" type="submit" disabled={!canCreate}>
              Koppeling opslaan
            </button>
          </form>

          {samePathSelected ? <p className="cvr-form-note cvr-form-note--error">Kies twee verschillende pagina's.</p> : null}
          {!targetLooksValid ? <p className="cvr-form-note cvr-form-note--error">Bedankpagina-URL moet thankyou of bedankt bevatten.</p> : null}
          {selectedLinkExists ? <p className="cvr-form-note">Deze koppeling bestaat al.</p> : null}

          <div className="cvr-links-list">
            {activeLinks.length === 0 ? (
              <p className="empty-state">Geen CVR-koppelingen voor deze site.</p>
            ) : (
              activeLinks.map((link) => (
            <div className="cvr-link-row" key={link.id}>
              <div>
                <span className="row-title">{link.sourceTitle}</span>
                <span className="cell-muted">{link.sourcePath}</span>
              </div>
              <span className="cvr-link-arrow">naar</span>
              <div>
                <span className="row-title">{link.targetTitle}</span>
                <span className="cell-muted">{link.targetPath}</span>
              </div>
              <div className="cvr-link-result">
                <strong>{formatConversionRate(link.conversionRatePercent)}%</strong>
                <span>{formatNumber(link.targetVisitors)} / {formatNumber(link.sourceVisitors)} bezoekers</span>
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="link_id" value={link.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <button className="cvr-delete-button" type="submit">
                  Verwijderen
                </button>
              </form>
            </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function PageColumn({
  title,
  pages,
  selectedPath,
  linkedPaths,
  otherSelectedPath,
  emptyLabel,
  refMap,
  onSelect
}: {
  title: string;
  pages: SiteAnalyticsCvrPageCandidate[];
  selectedPath: string;
  linkedPaths: Set<string>;
  otherSelectedPath: string;
  emptyLabel: string;
  refMap: MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="cvr-link-column">
      <div className="cvr-column-heading">
        <h3>{title}</h3>
        <span>{pages.length}</span>
      </div>
      {pages.length === 0 ? (
        <p className="empty-state">{emptyLabel}</p>
      ) : (
        pages.map((page) => {
          const selected = selectedPath === page.path;
          const linked = linkedPaths.has(page.path);
          const conflicts = Boolean(otherSelectedPath && otherSelectedPath === page.path);

          return (
            <button
              className={[
                "cvr-page-button",
                selected ? "cvr-page-button--selected" : "",
                linked ? "cvr-page-button--linked" : "",
                conflicts ? "cvr-page-button--conflict" : ""
              ].filter(Boolean).join(" ")}
              key={page.path}
              type="button"
              aria-pressed={selected}
              ref={refForPath(refMap, page.path)}
              onClick={() => onSelect(page.path)}
            >
              <span className="cvr-page-title">{page.title}</span>
              <span className="cvr-page-path">{page.path}</span>
              <span className="cvr-page-meta">{formatNumber(page.uniqueVisitors)} bezoekers - {formatNumber(page.pageViews)} weergaven</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function siteOptionsFromData(
  sites: SiteAnalyticsPublicSite[],
  pages: SiteAnalyticsCvrPageCandidate[],
  links: SiteAnalyticsCvrLinkRow[]
) {
  const byId = new Map<string, SiteAnalyticsPublicSite>();
  for (const site of sites) {
    byId.set(site.id, site);
  }
  for (const page of pages) {
    if (!byId.has(page.siteId)) {
      byId.set(page.siteId, {
        id: page.siteId,
        name: page.siteName,
        url: ""
      });
    }
  }
  for (const link of links) {
    if (!byId.has(link.siteId)) {
      byId.set(link.siteId, {
        id: link.siteId,
        name: link.siteName,
        url: ""
      });
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function sortSourcePages(pages: SiteAnalyticsCvrPageCandidate[], linkedPaths: Set<string>) {
  return [...pages].sort((left, right) => {
    return (
      Number(linkedPaths.has(right.path)) - Number(linkedPaths.has(left.path)) ||
      right.uniqueVisitors - left.uniqueVisitors ||
      right.pageViews - left.pageViews ||
      left.path.localeCompare(right.path)
    );
  });
}

function sortTargetPages(pages: SiteAnalyticsCvrPageCandidate[], linkedPaths: Set<string>) {
  return [...pages].sort((left, right) => {
    return (
      Number(linkedPaths.has(right.path)) - Number(linkedPaths.has(left.path)) ||
      right.uniqueVisitors - left.uniqueVisitors ||
      right.pageViews - left.pageViews ||
      left.path.localeCompare(right.path)
    );
  });
}

function isThankYouPage(page: SiteAnalyticsCvrPageCandidate) {
  return isThankYouPath(page.path);
}

function isThankYouPath(path: string) {
  const normalized = normalizeClientPagePath(path).toLowerCase();
  const spaced = normalized.replace(/%20|[_-]+/g, " ");
  return normalized.includes("thankyou") || spaced.includes("thank you") || normalized.includes("bedankt");
}

function normalizeClientPagePath(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw, "https://site-analytics.local");
    const pathname = (url.pathname || "/").replace(/\/{2,}/g, "/");
    const query = normalizedClientPageQuery(url.searchParams);
    return query ? `${pathname}?${query}` : pathname;
  } catch {
    return "";
  }
}

function normalizedClientPageQuery(params: URLSearchParams) {
  const entries: Array<[string, string]> = [];

  params.forEach((value, key) => {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue || ignoredPageQueryParams.has(normalizedKey.toLowerCase())) {
      return;
    }

    entries.push([normalizedKey, normalizedValue]);
  });

  entries.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    query.append(key, value);
  }

  return query.toString();
}

function refForPath(refMap: MutableRefObject<Map<string, HTMLButtonElement>>, path: string) {
  return (element: HTMLButtonElement | null) => {
    if (element) {
      refMap.current.set(path, element);
    } else {
      refMap.current.delete(path);
    }
  };
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatConversionRate(value: number) {
  return conversionRateFormatter.format(Math.max(0, value));
}

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

const numberFormatter = new Intl.NumberFormat("nl-BE");
const conversionRateFormatter = new Intl.NumberFormat("nl-BE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});
const likelyThankYouMarkers = ["thankyou", "thank-you", "thank_you", "thanks", "bedankt", "dankjewel", "dank-je", "dank-u", "danku", "merci"];

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
  const [selectedSourcePath, setSelectedSourcePath] = useState("");
  const [selectedTargetPath, setSelectedTargetPath] = useState("");
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
  }, [activeSiteId]);

  const activePages = useMemo(() => pages.filter((page) => page.siteId === activeSiteId), [activeSiteId, pages]);
  const activeLinks = useMemo(() => links.filter((link) => link.siteId === activeSiteId), [activeSiteId, links]);
  const sourceLinkedPaths = useMemo(() => new Set(activeLinks.map((link) => link.sourcePath)), [activeLinks]);
  const targetLinkedPaths = useMemo(() => new Set(activeLinks.map((link) => link.targetPath)), [activeLinks]);
  const sourcePages = useMemo(() => sortSourcePages(activePages, sourceLinkedPaths), [activePages, sourceLinkedPaths]);
  const targetPages = useMemo(() => sortTargetPages(activePages, targetLinkedPaths), [activePages, targetLinkedPaths]);
  const selectedLinkExists = activeLinks.some((link) => link.sourcePath === selectedSourcePath && link.targetPath === selectedTargetPath);
  const samePathSelected = Boolean(selectedSourcePath && selectedTargetPath && selectedSourcePath === selectedTargetPath);
  const canCreate = Boolean(activeSiteId && selectedSourcePath && selectedTargetPath && !selectedLinkExists && !samePathSelected);
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
          sourcePath: selectedSourcePath,
          targetPath: selectedTargetPath,
          preview: true
        });
      }

      return pairs;
    },
    [activeLinks, canCreate, selectedSourcePath, selectedTargetPath]
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

  return (
    <section className="panel cvr-mapping-panel">
      <div className="panel-heading cvr-mapping-heading">
        <div>
          <p className="eyebrow">CVR</p>
          <h2>CVR-koppelingen</h2>
        </div>
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
          onSelect={setSelectedSourcePath}
        />
        <PageColumn
          title="Thank-you pagina's"
          pages={targetPages}
          selectedPath={selectedTargetPath}
          linkedPaths={targetLinkedPaths}
          otherSelectedPath={selectedSourcePath}
          emptyLabel="Geen thank-you pagina's gemeten."
          refMap={targetRefs}
          onSelect={setSelectedTargetPath}
        />
      </div>

      <form action={createAction} className="cvr-action-bar">
        <input type="hidden" name="site_id" value={activeSiteId} />
        <input type="hidden" name="source_path" value={selectedSourcePath} />
        <input type="hidden" name="target_path" value={selectedTargetPath} />
        <input type="hidden" name="return_to" value={returnTo} />
        <div className="cvr-selection-summary">
          <span>{selectedSourcePath || "Projectpagina"}</span>
          <span>{selectedTargetPath || "Thank-you pagina"}</span>
        </div>
        <button className="cvr-save-button" type="submit" disabled={!canCreate}>
          Koppeling opslaan
        </button>
      </form>

      {samePathSelected ? <p className="cvr-form-note cvr-form-note--error">Kies twee verschillende pagina's.</p> : null}
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
      Number(isLikelyThankYouPath(left.path)) - Number(isLikelyThankYouPath(right.path)) ||
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
      Number(isLikelyThankYouPath(right.path)) - Number(isLikelyThankYouPath(left.path)) ||
      right.uniqueVisitors - left.uniqueVisitors ||
      right.pageViews - left.pageViews ||
      left.path.localeCompare(right.path)
    );
  });
}

function isLikelyThankYouPath(path: string) {
  const normalized = path.toLowerCase();
  return likelyThankYouMarkers.some((marker) => normalized.includes(marker));
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

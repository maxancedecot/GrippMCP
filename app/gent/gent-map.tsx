"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  Box,
  Building2,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  Focus,
  Layers,
  LoaderCircle,
  MapPin,
  Maximize,
  Minimize,
  Minus,
  Navigation2,
  Orbit,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  X
} from "lucide-react";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import type { GentBuildingsLayer } from "./buildings-layer.js";
import type { AliceProjectLayer } from "./project-layer.js";
import { ALICE_PROJECT, DEFAULT_PROJECT_MODEL, PROJECT_BOUNDS, projectPlacementKey, readProjectPlacement, type ProjectModelSource, type ProjectModelStatus, type ProjectPlacement } from "./project-model.js";
import { ProjectPlacementControls } from "./project-placement.js";
import { ModelLibrary } from "./model-library.js";
import {
  GENT_CAMERA,
  GENT_PLACES,
  GENT_PLACE_NUMERALS,
  GENT_STYLE,
  type GentPlace
} from "./map-style.js";

function MapButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  disabled = false
}: {
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className="gent-icon-button"
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={19} aria-hidden />
    </button>
  );
}

export function GentMap() {
  const container = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const map = useRef<LibreMap | null>(null);
  const buildings = useRef<GentBuildingsLayer | null>(null);
  const project = useRef<AliceProjectLayer | null>(null);
  const markers = useRef<Marker[]>([]);
  const selectPlace = useRef<(place: GentPlace) => void>(() => {});
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GentPlace | null>(GENT_PLACES[0]);
  const [is3d, setIs3d] = useState(true);
  const [showProject, setShowProject] = useState(true);
  const [projectStatus, setProjectStatus] = useState<ProjectModelStatus>("loading");
  const [activeModel, setActiveModel] = useState(DEFAULT_PROJECT_MODEL);
  const activeModelRef = useRef(activeModel);
  activeModelRef.current = activeModel;
  const [placement, setPlacement] = useState<ProjectPlacement>(ALICE_PROJECT);
  const [editingPlacement, setEditingPlacement] = useState(false);
  const [labels, setLabels] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [bearing, setBearing] = useState(GENT_CAMERA.bearing);
  const [pitch, setPitch] = useState(GENT_CAMERA.pitch);
  const [zoom, setZoom] = useState(GENT_CAMERA.zoom);
  const ready = status === "ready";
  const visiblePlaces = GENT_PLACES.filter((place) =>
    `${place.name} ${place.category}`
      .toLocaleLowerCase("nl")
      .includes(query.toLocaleLowerCase("nl").trim())
  );
  const duration = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100;
  const overviewZoom = () =>
    (container.current?.clientWidth ?? 1000) < 640 ? 16.5 : GENT_CAMERA.zoom;

  const selectModel = useCallback(async (source: ProjectModelSource) => {
    const layer = project.current;
    if (!layer) return false;
    setRotating(false);
    setEditingPlacement(false);
    if (!await layer.load(source) || layer !== project.current) return false;
    let saved: ProjectPlacement | null = null;
    try { saved = readProjectPlacement(window.localStorage.getItem(projectPlacementKey(source))); } catch { /* Use preview anchor when storage is unavailable. */ }
    const nextPlacement = saved ?? ALICE_PROJECT;
    activeModelRef.current = source;
    setActiveModel(source);
    setPlacement(nextPlacement);
    layer.setPlacement(nextPlacement);
    setShowProject(true);
    setIs3d(true);
    setSelected(null);
    map.current?.flyTo({
      center: nextPlacement.coordinates,
      zoom: 19,
      pitch: GENT_CAMERA.pitch,
      bearing: 0,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 800
    });
    return true;
  }, []);

  selectPlace.current = (place) => {
    setSelected(place);
    setRotating(false);
    map.current?.flyTo({
      center: place.coordinates,
      zoom: 17.4,
      duration: duration()
    });
  };

  useEffect(() => {
    let cancelled = false;
    let instance: LibreMap | undefined;
    let resize: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
    setError("");
    setRotating(false);
    setIs3d(true);
    setShowProject(true);
    setProjectStatus("loading");
    setPitch(GENT_CAMERA.pitch);
    setLabels(true);
    setShowPlaces(true);
    setSelected(GENT_PLACES[0]);

    async function initialize() {
      try {
        const [libre, { GentBuildingsLayer: BuildingsLayer }, { AliceProjectLayer }] =
          await Promise.all([
            import("maplibre-gl"),
            import("./buildings-layer.js"),
            import("./project-layer.js")
          ]);
        if (cancelled || !container.current) return;
        libre.setWorkerUrl("/gent-map/maplibre-gl-worker.mjs");
        instance = new libre.Map({
          container: container.current,
          style: GENT_STYLE,
          ...GENT_CAMERA,
          zoom: overviewZoom(),
          minZoom: 14,
          maxZoom: 19,
          maxPitch: 70,
          maxBounds: [
            [PROJECT_BOUNDS.west, PROJECT_BOUNDS.south],
            [PROJECT_BOUNDS.east, PROJECT_BOUNDS.north]
          ],
          canvasContextAttributes: { antialias: true },
          attributionControl: { compact: true },
          locale: {
            "AttributionControl.ToggleAttribution": "Kaartbronnen",
            "Map.Title": "Interactieve kaart van Alice Buyssehof, Nevele"
          }
        });
        map.current = instance;
        const currentMap = instance;
        const fail = (message: string) => {
          if (cancelled) return;
          setError(message);
          setStatus("error");
        };
        timeout = setTimeout(
          () =>
            fail(
              "De kaart kon niet worden geladen. Controleer je internetverbinding en probeer opnieuw."
            ),
          25000
        );
        currentMap.on("webglcontextlost", () =>
          fail("De 3D-weergave is onderbroken. Laad de kaart opnieuw.")
        );
        currentMap.on("error", (event) => {
          if (!currentMap.isStyleLoaded())
            fail(
              "De kaartdata is momenteel niet beschikbaar. Probeer opnieuw."
            );
          console.warn("Locatiekaart:", event.error.message);
        });
        currentMap.on("load", () => {
          if (cancelled) return;
          clearTimeout(timeout);
          if (
            !currentMap.queryRenderedFeatures({ layers: ["buildings"] }).length
          ) {
            fail(
              "De kaartdata is momenteel niet beschikbaar. Probeer opnieuw."
            );
            return;
          }
          // Stipple only mapped vegetation, like the planting hatch in a site drawing.
          const stipple = new Uint8Array(8 * 8 * 4);
          for (const [x, y] of [
            [1, 1],
            [5, 5]
          ])
            stipple.set([105, 87, 67, 110], (y * 8 + x) * 4);
          currentMap.addImage("planting-stipple", {
            width: 8,
            height: 8,
            data: stipple
          });
          for (const sourceLayer of ["landcover", "park"])
            currentMap.addLayer(
              {
                id: `${sourceLayer}-stipple`,
                type: "fill",
                source: "city",
                "source-layer": sourceLayer,
                ...(sourceLayer === "landcover"
                  ? {
                      filter: ["in", "class", "wood", "grass", "scrub"] as [
                        "in",
                        string,
                        ...string[]
                      ]
                    }
                  : {}),
                paint: { "fill-pattern": "planting-stipple" }
              },
              "water"
            );
          const layer = new BuildingsLayer();
          buildings.current = layer;
          currentMap.addLayer(layer, "street-labels");
          const projectLayer = new AliceProjectLayer((modelStatus) => {
            if (!cancelled) setProjectStatus(modelStatus);
          }, activeModelRef.current);
          project.current = projectLayer;
          currentMap.addLayer(projectLayer, "street-labels");
          currentMap.addControl(
            new libre.ScaleControl({ maxWidth: 100, unit: "metric" }),
            "bottom-left"
          );
          markers.current = GENT_PLACES.map((place, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "gent-marker";
            button.dataset.place = place.id;
            button.title = place.name;
            button.setAttribute("aria-label", `Bekijk ${place.name}`);
            button.setAttribute("aria-pressed", "false");
            button.textContent = GENT_PLACE_NUMERALS[index];
            button.addEventListener("click", () => selectPlace.current(place));
            return new libre.Marker({ element: button, anchor: "bottom" })
              .setLngLat(place.coordinates)
              .addTo(currentMap);
          });
          setStatus("ready");
        });
        currentMap.on("move", () => {
          setBearing(currentMap.getBearing());
          setPitch(currentMap.getPitch());
          setZoom(currentMap.getZoom());
        });
        currentMap.on("dragstart", () => setRotating(false));
        currentMap.on("zoomstart", (event) => {
          if (event.originalEvent) setRotating(false);
        });
        currentMap.on("rotatestart", (event) => {
          if (event.originalEvent) setRotating(false);
        });
        resize = new ResizeObserver(() => currentMap.resize());
        resize.observe(container.current);
      } catch {
        if (!cancelled) {
          setError(
            "Deze browser kan de 3D-kaart niet starten. Controleer of hardwareversnelling is ingeschakeld."
          );
          setStatus("error");
        }
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      resize?.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      instance?.remove();
      map.current = null;
      buildings.current = null;
      project.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    buildings.current?.setEnabled(is3d);
    map.current?.easeTo({
      pitch: is3d ? GENT_CAMERA.pitch : 0,
      duration: duration() / 2
    });
  }, [is3d]);

  useEffect(() => {
    project.current?.setEnabled(is3d && showProject);
  }, [is3d, showProject, ready]);

  useEffect(() => {
    if (ready) project.current?.setPlacement(placement);
  }, [placement, ready]);

  useEffect(() => {
    if (!ready) return;
    for (const id of ["street-labels", "water-labels", "place-labels"])
      map.current?.setLayoutProperty(
        id,
        "visibility",
        labels ? "visible" : "none"
      );
  }, [labels, ready]);

  useEffect(() => {
    for (const marker of markers.current) {
      const element = marker.getElement();
      element.hidden = !showPlaces || editingPlacement;
      element.setAttribute(
        "aria-pressed",
        String(element.dataset.place === selected?.id)
      );
    }
  }, [showPlaces, selected, ready, editingPlacement]);

  useEffect(() => {
    if (!rotating || !ready) return;
    let frame = 0;
    let previous = 0;
    const animate = (time: number) => {
      if (previous && map.current)
        map.current.setBearing(
          map.current.getBearing() + Math.min(time - previous, 50) * 0.004
        );
      previous = time;
      frame = requestAnimationFrame(animate);
    };
    const stop = () => {
      if (document.hidden) setRotating(false);
    };
    document.addEventListener("visibilitychange", stop);
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [rotating, ready]);

  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  function reset() {
    setSelected(GENT_PLACES[0]);
    setRotating(false);
    map.current?.flyTo({
      ...GENT_CAMERA,
      zoom: overviewZoom(),
      pitch: is3d ? GENT_CAMERA.pitch : 0,
      duration: duration()
    });
  }

  function focusProject(forPlacement = false) {
    setRotating(false);
    setShowProject(true);
    const camera = {
      center: placement.coordinates,
      zoom: 19,
      pitch: forPlacement ? 40 : 60,
      bearing: forPlacement ? 0 : 180 - placement.facadeBearing
    };
    // Recenter before switching from 2D: the pitch effect can interrupt flyTo.
    if (!is3d) map.current?.jumpTo(camera);
    setIs3d(true);
    setSelected(null);
    map.current?.flyTo({ ...camera, duration: duration() });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shell.current?.requestFullscreen)
        await shell.current.requestFullscreen();
      else setFullscreen((value) => !value);
    } catch {
      setFullscreen((value) => !value);
    }
  }

  return (
    <main
      className={`gent-page${fullscreen ? " gent-page--fullscreen" : ""}${editingPlacement ? " gent-page--placing" : ""}`}
      ref={shell}
    >
      <header className="gent-header">
        <div className="gent-heading">
          <span className="gent-eyebrow">Omgevingskaart</span>
          <h1>Alice Buyssehof</h1>
        </div>
        <div className="gent-header-location">
          <MapPin size={15} aria-hidden />
          <span>Nevele, Deinze</span>
        </div>
        <div className="gent-view-mode" role="group" aria-label="Kaartweergave">
          <button
            type="button"
            aria-pressed={!is3d}
            disabled={!ready || editingPlacement}
            onClick={() => setIs3d(false)}
          >
            2D
          </button>
          <button
            type="button"
            aria-pressed={is3d}
            disabled={!ready}
            onClick={() => setIs3d(true)}
          >
            <Box size={15} aria-hidden />
            3D
          </button>
        </div>
      </header>
      <div className="gent-workspace">
        <aside className="gent-sidebar" aria-label="Plekken en kaartlagen">
          <ModelLibrary
            active={activeModel}
            ready={ready}
            disabled={!ready || editingPlacement || projectStatus === "loading"}
            onSelect={selectModel}
          />
          <div className="gent-places-heading">
            <h2>In de buurt</h2>
            <span>{GENT_PLACES.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="gent-search">
            <Search size={17} aria-hidden />
            <input
              aria-label="Zoek een herkenningspunt"
              placeholder="Zoek een plek"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                title="Zoekopdracht wissen"
                aria-label="Zoekopdracht wissen"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className="gent-places" aria-label="Herkenningspunten">
            {visiblePlaces.map((place) => (
              <button
                className="gent-place"
                key={place.id}
                type="button"
                disabled={!ready}
                aria-pressed={selected?.id === place.id}
                onClick={() => selectPlace.current(place)}
              >
                <span className="gent-place-number">
                  {GENT_PLACE_NUMERALS[GENT_PLACES.indexOf(place)]}
                </span>
                <span className="gent-place-text">
                  <strong>{place.name}</strong>
                  <span>{place.category}</span>
                </span>
                <ChevronRight size={15} aria-hidden />
              </button>
            ))}
            {!visiblePlaces.length && (
              <p className="gent-no-results" role="status">
                Geen plekken gevonden.
              </p>
            )}
          </div>
          <fieldset className="gent-layers" disabled={!ready}>
            <legend>
              <Layers size={15} aria-hidden />
              Kaartlagen
            </legend>
            <label>
              <Box size={16} aria-hidden />
              Projectmodel
              <input
                type="checkbox"
                checked={showProject}
                disabled={editingPlacement}
                onChange={(event) => setShowProject(event.target.checked)}
              />
              <span className="gent-check"><Check size={12} /></span>
            </label>
            <div className="gent-project-status" role="status">
              {projectStatus === "loading" ? "3D-project wordt geladen…" :
                projectStatus === "error" ? (
                  <>Het 3D-project kon niet laden. <button type="button" onClick={() => void project.current?.load()}>Opnieuw proberen</button></>
                ) : "3D-project geladen · vrij te plaatsen op de kaart."}
            </div>
            <button
              className="gent-project-focus"
              type="button"
              disabled={projectStatus !== "ready"}
              onClick={() => focusProject(editingPlacement)}
            >
              <Focus size={15} aria-hidden /> Bekijk het project
            </button>
            <ProjectPlacementControls
              key={activeModel.id}
              model={activeModel}
              map={ready ? map.current : null}
              placement={placement}
              editing={editingPlacement}
              disabled={!ready || projectStatus !== "ready"}
              onChange={setPlacement}
              onEditingChange={setEditingPlacement}
              onStart={() => focusProject(true)}
            />
            <label>
              <Building2 size={16} aria-hidden />
              3D-gebouwen
              <input
                type="checkbox"
                checked={is3d}
                disabled={editingPlacement}
                onChange={(event) => setIs3d(event.target.checked)}
              />
              <span className="gent-check">
                <Check size={12} />
              </span>
            </label>
            <label>
              <MapPin size={16} aria-hidden />
              Herkenningspunten
              <input
                type="checkbox"
                checked={showPlaces}
                onChange={(event) => setShowPlaces(event.target.checked)}
              />
              <span className="gent-check">
                <Check size={12} />
              </span>
            </label>
            <label>
              <span className="gent-label-icon" aria-hidden>
                Aa
              </span>
              Straatnamen
              <input
                type="checkbox"
                checked={labels}
                onChange={(event) => setLabels(event.target.checked)}
              />
              <span className="gent-check">
                <Check size={12} />
              </span>
            </label>
          </fieldset>
          <div className="gent-sidebar-footer">
            <span className="gent-status-dot" />
            <span>51.0319 N &nbsp; 3.5488 E</span>
            <ArrowUpRight size={14} aria-hidden />
          </div>
        </aside>
        <section
          className="gent-map-area"
          aria-label="Kaart van Alice Buyssehof"
        >
          <div className="gent-map-canvas" ref={container} />
          {ready && (
            <>
              <div className="gent-map-caption">
                <MapPin size={16} aria-hidden />
                Nevele <span>/</span> {selected?.name ?? "Alice Buyssehof"}
              </div>
              <div className="gent-map-tools">
                <div className="gent-tool-group">
                  <MapButton
                    label="Inzoomen"
                    icon={Plus}
                    disabled={zoom >= 19}
                    onClick={() => {
                      setRotating(false);
                      map.current?.zoomIn();
                    }}
                  />
                  <MapButton
                    label="Uitzoomen"
                    icon={Minus}
                    disabled={zoom <= 14}
                    onClick={() => {
                      setRotating(false);
                      map.current?.zoomOut();
                    }}
                  />
                </div>
                <div className="gent-tool-group">
                  <MapButton
                    label="Links draaien"
                    icon={RotateCcw}
                    onClick={() => {
                      setRotating(false);
                      map.current?.rotateTo(bearing - 30, {
                        duration: duration() / 3
                      });
                    }}
                  />
                  <MapButton
                    label="Rechts draaien"
                    icon={RotateCw}
                    onClick={() => {
                      setRotating(false);
                      map.current?.rotateTo(bearing + 30, {
                        duration: duration() / 3
                      });
                    }}
                  />
                  <MapButton
                    label={
                      rotating ? "Rondvlucht stoppen" : "Rondvlucht starten"
                    }
                    icon={Orbit}
                    disabled={editingPlacement}
                    pressed={rotating}
                    onClick={() => setRotating((value) => !value)}
                  />
                </div>
                <div className="gent-tool-group">
                  <MapButton
                    label="Terug naar Alice Buyssehof"
                    icon={Focus}
                    onClick={reset}
                  />
                  <MapButton
                    label={
                      fullscreen ? "Volledig scherm sluiten" : "Volledig scherm"
                    }
                    icon={fullscreen ? Minimize : Maximize}
                    onClick={() => void toggleFullscreen()}
                  />
                </div>
              </div>
              <button
                className="gent-compass"
                type="button"
                title="Noorden boven"
                aria-label="Noorden boven"
                onClick={() => {
                  setRotating(false);
                  map.current?.rotateTo(0, { duration: duration() / 2 });
                }}
              >
                <span>N</span>
                <Navigation2
                  size={24}
                  style={{ transform: `rotate(${-bearing}deg)` }}
                  aria-hidden
                />
              </button>
              {is3d && (
                <div className="gent-pitch">
                  <Compass size={16} aria-hidden />
                  <label htmlFor="gent-pitch">Kanteling</label>
                  <input
                    id="gent-pitch"
                    type="range"
                    min={0}
                    max={70}
                    step={1}
                    value={Math.round(pitch)}
                    onChange={(event) => {
                      setRotating(false);
                      map.current?.setPitch(Number(event.target.value));
                    }}
                  />
                  <output htmlFor="gent-pitch">{Math.round(pitch)}&deg;</output>
                </div>
              )}
              {selected && !editingPlacement && (
                <div className="gent-selection" aria-live="polite">
                  <MapPin size={20} aria-hidden />
                  <div>
                    <span>{selected.category}</span>
                    <h2>{selected.name}</h2>
                  </div>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${selected.coordinates[1]}&mlon=${selected.coordinates[0]}#map=18/${selected.coordinates[1]}/${selected.coordinates[0]}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${selected.name} op OpenStreetMap`}
                    title="OpenStreetMap"
                  >
                    <ExternalLink size={17} />
                  </a>
                  <button
                    type="button"
                    title="Selectie sluiten"
                    aria-label="Selectie sluiten"
                    onClick={() => setSelected(null)}
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
            </>
          )}
          {status !== "ready" && (
            <div
              className="gent-map-message"
              role={status === "error" ? "alert" : "status"}
            >
              {status === "loading" ? (
                <>
                  <LoaderCircle
                    className="gent-spinner"
                    size={25}
                    aria-hidden
                  />
                  <span>Alice Buyssehof wordt geladen...</span>
                </>
              ) : (
                <>
                  <MapPin size={26} aria-hidden />
                  <h2>Kaart niet beschikbaar</h2>
                  <p>{error}</p>
                  <button
                    type="button"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    <RotateCw size={16} aria-hidden />
                    Opnieuw laden
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Move, RotateCcw } from "lucide-react";
import type { Map as LibreMap, MapMouseEvent, Marker } from "maplibre-gl";
import {
  ALICE_PROJECT,
  PROJECT_BOUNDS,
  PROJECT_PLACEMENT_KEY,
  readProjectPlacement,
  type ProjectPlacement
} from "./project-model.js";

export function ProjectPlacementControls({
  map, placement, editing, disabled, onChange, onEditingChange, onStart
}: {
  map: LibreMap | null;
  placement: ProjectPlacement;
  editing: boolean;
  disabled: boolean;
  onChange: (placement: ProjectPlacement) => void;
  onEditingChange: (editing: boolean) => void;
  onStart: () => void;
}) {
  const current = useRef(placement);
  current.current = placement;
  const original = useRef(placement);
  const marker = useRef<Marker | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROJECT_PLACEMENT_KEY);
      const stored = readProjectPlacement(raw);
      if (stored) {
        onChange(stored);
        setSaved(true);
      } else if (raw) {
        setError("De opgeslagen positie is ongeldig. Plaats het project opnieuw.");
      }
    } catch {
      setError("Je browser blokkeert het bewaren van de positie. Je kunt het project wel verplaatsen.");
    }
  }, [onChange]);

  useEffect(() => {
    if (!map || !editing) return;
    let cancelled = false;
    let handle: Marker | undefined;
    const canvas = map.getCanvas();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    const place = (lng: number, lat: number) => {
      const coordinates: [number, number] = [
        Math.max(PROJECT_BOUNDS.west, Math.min(PROJECT_BOUNDS.east, lng)),
        Math.max(PROJECT_BOUNDS.south, Math.min(PROJECT_BOUNDS.north, lat))
      ];
      const next = { ...current.current, coordinates };
      current.current = next;
      handle?.setLngLat(coordinates);
      onChange(next);
    };
    const click = (event: MapMouseEvent) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".maplibregl-marker")) return;
      place(event.lngLat.lng, event.lngLat.lat);
    };
    map.on("click", click);
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return;
      // Default draggable markers also support arrow keys and touch dragging.
      handle = new Marker({ color: "#80644b", draggable: true })
        .setLngLat(current.current.coordinates)
        .setOpacity(1, 1)
        .addTo(map);
      marker.current = handle;
      const element = handle.getElement();
      element.classList.add("gent-project-handle");
      element.setAttribute("aria-label", "Verplaats het project met de pijltjestoetsen");
      element.setAttribute("aria-describedby", "gent-placement-help");
      element.setAttribute("title", "Sleep om het project te verplaatsen");
      handle.on("drag", () => {
        const position = handle!.getLngLat();
        place(position.lng, position.lat);
      });
      element.focus({ preventScroll: true });
    }).catch(() => {
      if (!cancelled) setError("De sleeppin kon niet laden. Klik op de kaart om het project te verplaatsen.");
    });
    return () => {
      cancelled = true;
      map.off("click", click);
      handle?.remove();
      marker.current = null;
      canvas.style.cursor = previousCursor;
    };
  }, [map, editing, onChange]);

  useEffect(() => {
    marker.current?.setLngLat(placement.coordinates);
  }, [placement]);

  function finishEditing() {
    onEditingChange(false);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }

  function save() {
    try {
      window.localStorage.setItem(PROJECT_PLACEMENT_KEY, JSON.stringify({
        coordinates: placement.coordinates,
        facadeBearing: placement.facadeBearing
      }));
      setSaved(true);
      setError("");
      finishEditing();
    } catch {
      setError("Opslaan is niet gelukt. Sta browseropslag toe en probeer opnieuw. Je aanpassing blijft zichtbaar.");
    }
  }

  return (
    <div className="gent-placement">
      {!editing ? (
        <>
          <button
            ref={editButton}
            className="gent-project-focus"
            type="button"
            disabled={disabled}
            onClick={() => {
              original.current = placement;
              setError("");
              onStart();
              onEditingChange(true);
            }}
          >
            <Move size={15} aria-hidden /> Verplaats het project
          </button>
          {saved && <p role="status">Eigen plaatsing opgeslagen in deze browser.</p>}
        </>
      ) : (
        <fieldset className="gent-placement-editor" disabled={disabled}>
          <legend>Project plaatsen</legend>
          <p id="gent-placement-help">Sleep de pin of klik op de kaart. De pin staat in het midden van de voorgevel. Met de pijltjestoetsen verplaats je de geselecteerde pin nauwkeurig.</p>
          <div className="gent-placement-bearing">
            <label htmlFor="gent-project-bearing">Richting voorgevel</label>
            <output htmlFor="gent-project-bearing">{placement.facadeBearing}°</output>
          </div>
          <input
            id="gent-project-bearing"
            aria-describedby="gent-bearing-help"
            type="range"
            min={0}
            max={359}
            step={1}
            value={placement.facadeBearing}
            onChange={(event) => onChange({ ...placement, facadeBearing: Number(event.target.value) })}
          />
          <p id="gent-bearing-help">0° noord · 90° oost · 180° zuid · 270° west</p>
          <p className="gent-placement-coordinates" aria-label="Projectcoördinaten">
            {placement.coordinates[1].toFixed(6)} N · {placement.coordinates[0].toFixed(6)} E
          </p>
          <div className="gent-placement-actions">
            <button type="button" className="gent-placement-save" onClick={save}>
              <Check size={14} aria-hidden /> Positie opslaan
            </button>
            <button type="button" onClick={() => {
              onChange(original.current);
              setError("");
              finishEditing();
            }}>Annuleren</button>
          </div>
          <button type="button" className="gent-placement-reset" onClick={() => onChange({
            coordinates: [...ALICE_PROJECT.coordinates], facadeBearing: ALICE_PROJECT.facadeBearing
          })}>
            <RotateCcw size={13} aria-hidden /> Terug naar beginpositie
          </button>
          <p>Je bewaart de positie alleen in deze browser.</p>
        </fieldset>
      )}
      {error && <p className="gent-placement-error" role="alert">{error}</p>}
    </div>
  );
}

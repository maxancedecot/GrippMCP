import { GENT_CENTER } from "./map-style.js";

export type ProjectPlacement = {
  coordinates: [number, number];
  facadeBearing: number;
};

export const PROJECT_PLACEMENT_KEY = "alice-buyssehof:placement:v1";

export type ProjectModelSource = {
  id: string;
  name: string;
  file?: Blob;
};

export type ProjectModelInstance = {
  source: ProjectModelSource;
  placement: ProjectPlacement;
  visible: boolean;
};

export type ModelSelectionOptions = {
  select?: boolean;
  visible?: boolean;
  frame?: boolean;
  persist?: boolean;
};

export const DEFAULT_PROJECT_MODEL: ProjectModelSource = {
  id: "alice-buyssehof",
  name: "Alice Buyssehof"
};

export function projectPlacementKey(model: ProjectModelSource) {
  return model.id === DEFAULT_PROJECT_MODEL.id
    ? PROJECT_PLACEMENT_KEY
    : `${PROJECT_PLACEMENT_KEY}:${model.id}`;
}

// Keep saved placements within the area navigable on this map.
export const PROJECT_BOUNDS = { west: 3.5, east: 3.59, south: 51.005, north: 51.065 };

export function readProjectPlacement(raw: string | null): ProjectPlacement | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { coordinates, facadeBearing } = value as Partial<ProjectPlacement>;
    if (!Array.isArray(coordinates) || coordinates.length !== 2 ||
      !coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) ||
      coordinates[0] < PROJECT_BOUNDS.west || coordinates[0] > PROJECT_BOUNDS.east ||
      coordinates[1] < PROJECT_BOUNDS.south || coordinates[1] > PROJECT_BOUNDS.north ||
      typeof facadeBearing !== "number" || !Number.isFinite(facadeBearing) ||
      facadeBearing < 0 || facadeBearing >= 360) return null;
    return { coordinates: [coordinates[0], coordinates[1]], facadeBearing };
  } catch {
    return null;
  }
}

// Preview anchor only: the supplied Blender scene has no survey coordinates or
// north direction. Replace this anchor/bearing from a confirmed site plan.
export const ALICE_PROJECT = {
  url: "/models/alice-buyssehof.glb",
  coordinates: GENT_CENTER,
  facadeBearing: 180,
  altitude: 0.08,
  scale: 1,
  placementConfirmed: false
};

export type ProjectModelStatus = "loading" | "ready" | "error";

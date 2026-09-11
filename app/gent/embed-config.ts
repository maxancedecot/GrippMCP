import { ALICE_PROJECT, BUILT_IN_PROJECT_MODELS, readProjectPlacement, type ProjectModelInstance, type ProjectPlacement } from "./project-model.js";
import { GENT_CAMERA } from "./map-style.js";

export type EmbedScene = {
  version: 1;
  models: (ProjectPlacement & { id: string })[];
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  is3d: boolean;
  showProject: boolean;
  labels: boolean;
  places: boolean;
};

export const DEFAULT_EMBED_SCENE: EmbedScene = {
  version: 1,
  models: [{ id: "alice-buyssehof-compleet", coordinates: ALICE_PROJECT.coordinates, facadeBearing: ALICE_PROJECT.facadeBearing }],
  camera: { center: ALICE_PROJECT.coordinates, zoom: 18, pitch: GENT_CAMERA.pitch, bearing: 0 },
  is3d: true, showProject: true, labels: true, places: true
};

const finiteBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// Only deployed project IDs and bounded numeric settings are shareable. Never
// accept a model URL, a local upload ID or arbitrary scene content from a link.
export function parseEmbedScene(raw: string): EmbedScene | null {
  if (raw.length > 6000) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Array.isArray(value.models) ||
      !value.models.length || value.models.length > BUILT_IN_PROJECT_MODELS.length) return null;
    const models: EmbedScene["models"] = [];
    const ids = new Set<string>();
    for (const model of value.models) {
      if (!model || !BUILT_IN_PROJECT_MODELS.some((source) => source.id === model.id) || ids.has(model.id)) return null;
      const placement = readProjectPlacement(JSON.stringify(model));
      if (!placement) return null;
      ids.add(model.id);
      models.push({ id: model.id, ...placement });
    }
    const camera = value.camera;
    if (!camera || !readProjectPlacement(JSON.stringify({ coordinates: camera.center, facadeBearing: 0 })) ||
      !finiteBetween(camera.zoom, 14, 19) || !finiteBetween(camera.pitch, 0, 70) || !finiteBetween(camera.bearing, -360, 360) ||
      ![value.is3d, value.showProject, value.labels, value.places].every((setting) => typeof setting === "boolean")) return null;
    return {
      version: 1, models,
      camera: { center: [camera.center[0], camera.center[1]], zoom: camera.zoom, pitch: value.is3d ? camera.pitch : 0, bearing: camera.bearing },
      is3d: value.is3d, showProject: value.showProject, labels: value.labels, places: value.places
    };
  } catch { return null; }
}

export function embedModelInstances(scene: EmbedScene): ProjectModelInstance[] {
  return scene.models.map(({ id, ...placement }) => ({
    source: BUILT_IN_PROJECT_MODELS.find((model) => model.id === id)!, placement, visible: true
  }));
}

export function buildEmbedCode(origin: string, scene: EmbedScene) {
  const url = new URL("/alice-buyssehof/embed", origin);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Gebruik het webadres van de kaart.");
  const valid = parseEmbedScene(JSON.stringify(scene));
  if (!valid) throw new Error("Vink minstens één beschikbaar projectmodel aan om het in te sluiten.");
  url.searchParams.set("scene", JSON.stringify(valid));
  const src = url.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return {
    url: url.href,
    code: `<iframe\n  src="${src}"\n  title="Alice Buyssehof 3D-kaart"\n  width="100%"\n  height="600"\n  style="border:0;display:block;"\n  loading="lazy"\n  allow="fullscreen"\n  allowfullscreen\n></iframe>`
  };
}

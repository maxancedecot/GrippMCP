import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap
} from "maplibre-gl";
import {
  Camera,
  Box3,
  DirectionalLight,
  HemisphereLight,
  LoadingManager,
  Matrix4,
  Mesh,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Texture
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ALICE_PROJECT, DEFAULT_PROJECT_MODEL, PROJECT_BOUNDS, type ProjectModelInstance, type ProjectModelSource, type ProjectModelStatus, type ProjectPlacement } from "./project-model.js";
import { validateModelBuffer } from "./model-upload.js";

function disposeModel(model: Object3D) {
  const textures = new Set<Texture>();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && "isTexture" in value)
          textures.add(value as Texture);
      }
      material.dispose();
    }
  });
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}

type RenderedProject = ProjectModelInstance & {
  model: Object3D;
  scene: Scene;
  transform: Matrix4;
};

export class AliceProjectLayer implements CustomLayerInterface {
  readonly id = "alice-project-model";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private camera = new Camera();
  private models = new Map<string, RenderedProject>();
  private placements = new Map<string, ProjectPlacement>();
  private visibility = new Map<string, boolean>();
  private request?: AbortController;
  private queue: Promise<unknown> = Promise.resolve();
  private enabled = true;
  private activeId = DEFAULT_PROJECT_MODEL.id;
  private removedSnapshot: ProjectModelInstance[] | null = null;

  constructor(
    private onStatus: (status: ProjectModelStatus) => void,
    private initialModels: ProjectModelInstance[] = [{ source: DEFAULT_PROJECT_MODEL, placement: ALICE_PROJECT, visible: true }]
  ) {}

  private transformFor(placement: ProjectPlacement) {
    const origin = MercatorCoordinate.fromLngLat(placement.coordinates, ALICE_PROJECT.altitude);
    const scale = origin.meterInMercatorCoordinateUnits() * ALICE_PROJECT.scale;
    return new Matrix4()
      .makeTranslation(origin.x, origin.y, origin.z)
      .scale(new Vector3(scale, -scale, scale))
      .multiply(new Matrix4().makeRotationZ((180 - placement.facadeBearing) * Math.PI / 180))
      .multiply(new Matrix4().makeRotationX(Math.PI / 2));
  }

  setPlacement(id: string, placement: ProjectPlacement) {
    this.placements.set(id, placement);
    const entry = this.models.get(id);
    if (entry) {
      entry.placement = placement;
      entry.transform = this.transformFor(placement);
    }
    this.updateMap();
  }

  setModelVisible(id: string, visible: boolean) {
    this.visibility.set(id, visible);
    const entry = this.models.get(id);
    if (entry) entry.visible = visible;
    this.updateMap();
  }

  setActiveModel(id: string) {
    this.activeId = id;
    this.updateMap();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.updateMap();
  }

  snapshot(): ProjectModelInstance[] {
    return this.removedSnapshot ?? [...this.models.values()].map(({ source, placement, visible }) => ({ source, placement, visible }));
  }

  private updateMap() {
    if (!this.map) return;
    const data = this.map.getCanvas().dataset;
    const visible = [...this.models.values()].filter((entry) => this.enabled && entry.visible);
    data.projectVisible = String(this.enabled);
    data.projectModel = this.activeId;
    data.projectModels = JSON.stringify(visible.map((entry) => entry.source.id));
    data.projectModelCount = String(this.models.size);
    data.projectPlacements = JSON.stringify(Object.fromEntries([...this.models].map(([id, entry]) => [id, entry.placement])));
    this.map.triggerRepaint();
  }

  private boundsFor(entry: RenderedProject) {
    return new Box3().setFromObject(entry.model).applyMatrix4(entry.transform);
  }

  getVisibleBounds(): [[number, number], [number, number]] | null {
    const bounds = new Box3();
    for (const entry of this.models.values()) if (entry.visible) bounds.union(this.boundsFor(entry));
    if (bounds.isEmpty()) return null;
    const northWest = new MercatorCoordinate(bounds.min.x, bounds.min.y).toLngLat();
    const southEast = new MercatorCoordinate(bounds.max.x, bounds.max.y).toLngLat();
    return [[northWest.lng, southEast.lat], [southEast.lng, northWest.lat]];
  }

  // Place a fresh upload beside the geometry already on the map. This is only
  // a preview layout; previously saved coordinates always take precedence.
  private suggestPlacement(model: Object3D): ProjectPlacement {
    if (!this.models.size) return ALICE_PROJECT;
    const origin = MercatorCoordinate.fromLngLat(ALICE_PROJECT.coordinates);
    const metre = origin.meterInMercatorCoordinateUnits();
    const modelBounds = new Box3().setFromObject(model).applyMatrix4(this.transformFor(ALICE_PROJECT));
    const occupied = new Box3();
    for (const entry of this.models.values()) occupied.union(this.boundsFor(entry));
    const east = origin.x + occupied.max.x + 8 * metre - modelBounds.min.x;
    const west = origin.x + occupied.min.x - 8 * metre - modelBounds.max.x;
    let position = new MercatorCoordinate(east, origin.y).toLngLat();
    if (position.lng > PROJECT_BOUNDS.east) position = new MercatorCoordinate(west, origin.y).toLngLat();
    return {
      coordinates: [Math.max(PROJECT_BOUNDS.west, Math.min(PROJECT_BOUNDS.east, position.lng)), position.lat],
      facadeBearing: ALICE_PROJECT.facadeBearing
    };
  }

  onAdd(map: LibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.removedSnapshot = null;
    this.renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
    this.renderer.autoClear = false;
    for (const entry of this.initialModels) {
      this.setModelVisible(entry.source.id, entry.visible);
      void this.load(entry.source, entry.placement);
    }
  }

  // One decode at a time limits memory pressure. Selecting a loaded model
  // reuses its scene and never disposes another model.
  load(source: ProjectModelSource = DEFAULT_PROJECT_MODEL, placement: ProjectPlacement | null = null): Promise<ProjectPlacement | null> {
    const operation = this.queue.then(() => this.loadModel(source, placement));
    this.queue = operation.catch(() => null);
    return operation;
  }

  private async loadModel(source: ProjectModelSource, requested: ProjectPlacement | null): Promise<ProjectPlacement | null> {
    if (!this.map) return null;
    const existing = this.models.get(source.id);
    if (existing) return existing.placement;
    const request = new AbortController();
    this.request = request;
    this.onStatus("loading");
    this.map.getCanvas().dataset.projectStatus = "loading";
    const draco = new DRACOLoader().setDecoderPath("/gent-map/draco/").setWorkerLimit(2);
    const timeout = setTimeout(() => request.abort(), 45000);
    let pending: Object3D | undefined;
    try {
      let buffer: ArrayBuffer;
      if (source.file) {
        buffer = await source.file.arrayBuffer();
        validateModelBuffer(buffer);
      } else {
        const response = await fetch(ALICE_PROJECT.url, { signal: request.signal });
        if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
        buffer = await response.arrayBuffer();
      }
      if (!this.map) return null;
      if (request.signal.aborted) throw new Error("Model load timed out");
      const manager = new LoadingManager();
      if (source.file) manager.setURLModifier((url) => {
        if (/^(blob:|data:)/.test(url)) return url;
        throw new Error("Uploaded models must embed their resources.");
      });
      const gltf = await new GLTFLoader(manager).setDRACOLoader(draco).parseAsync(buffer, "");
      pending = gltf.scene;
      if (!this.map) return null;
      if (request.signal.aborted) throw new Error("Model load timed out");
      if (source.file) {
        const bounds = new Box3().setFromObject(gltf.scene);
        if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
          throw new Error("The model contains no visible geometry.");
        }
        const center = bounds.getCenter(new Vector3());
        gltf.scene.position.add(new Vector3(-center.x, -bounds.min.y, -center.z));
      }
      const placement = this.placements.get(source.id) ?? requested ?? (source.file ? this.suggestPlacement(gltf.scene) : ALICE_PROJECT);
      gltf.scene.traverse((object) => { if (object instanceof Mesh) object.frustumCulled = false; });
      const scene = new Scene();
      scene.add(new HemisphereLight("#fff7e8", "#9b947f", 2.2));
      const sun = new DirectionalLight("#fff1da", 2.8);
      sun.position.set(-30, 60, 40);
      scene.add(sun, gltf.scene);
      this.models.set(source.id, {
        source, placement, visible: this.visibility.get(source.id) ?? true,
        model: gltf.scene, scene, transform: this.transformFor(placement)
      });
      pending = undefined;
      this.map.getCanvas().dataset.projectStatus = "ready";
      this.onStatus("ready");
      this.updateMap();
      return placement;
    } catch (error) {
      if (!this.map) return null;
      console.warn("Project model:", error);
      const status = this.models.size ? "ready" : "error";
      this.map.getCanvas().dataset.projectStatus = status;
      this.onStatus(status);
      return null;
    } finally {
      if (pending) disposeModel(pending);
      clearTimeout(timeout);
      draco.dispose();
    }
  }

  removeModel(id: string) {
    const entry = this.models.get(id);
    if (!entry) return;
    disposeModel(entry.model);
    entry.scene.clear();
    this.models.delete(id);
    this.placements.delete(id);
    this.visibility.delete(id);
    this.updateMap();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.renderer || !this.enabled) return;
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    for (const entry of this.models.values()) {
      if (!entry.visible) continue;
      this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(entry.transform);
      this.renderer.render(entry.scene, this.camera);
    }
    this.renderer.resetState();
  }

  onRemove() {
    // MapLibre removes custom layers before announcing a lost WebGL context.
    // Retain source data so the page can recover after GPU resources are gone.
    this.removedSnapshot = this.snapshot();
    this.map = undefined;
    this.request?.abort();
    for (const entry of this.models.values()) { disposeModel(entry.model); entry.scene.clear(); }
    this.models.clear();
    this.placements.clear();
    this.visibility.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
  }
}

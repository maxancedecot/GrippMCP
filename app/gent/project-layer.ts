import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap
} from "maplibre-gl";
import {
  Camera,
  DirectionalLight,
  HemisphereLight,
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
import { ALICE_PROJECT, type ProjectModelStatus, type ProjectPlacement } from "./project-model.js";

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
  for (const texture of textures) texture.dispose();
}

export class AliceProjectLayer implements CustomLayerInterface {
  readonly id = "alice-project-model";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private camera = new Camera();
  private scene = new Scene();
  private model?: Object3D;
  private request?: AbortController;
  private enabled = true;
  private transform = new Matrix4();

  constructor(private onStatus: (status: ProjectModelStatus) => void) {
    this.setPlacement(ALICE_PROJECT);
  }

  setPlacement(placement: ProjectPlacement) {
    const origin = MercatorCoordinate.fromLngLat(placement.coordinates, ALICE_PROJECT.altitude);
    const scale = origin.meterInMercatorCoordinateUnits() * ALICE_PROJECT.scale;
    this.transform
      .makeTranslation(origin.x, origin.y, origin.z)
      .scale(new Vector3(scale, -scale, scale))
      // Blender's front faces -Y (south); bearing is clockwise from north.
      .multiply(new Matrix4().makeRotationZ((180 - placement.facadeBearing) * Math.PI / 180))
      // glTF Y-up to the map's Z-up coordinate system.
      .multiply(new Matrix4().makeRotationX(Math.PI / 2));
    this.map?.triggerRepaint();
  }

  onAdd(map: LibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true
    });
    this.renderer.autoClear = false;
    // Lights are in glTF coordinates, where +Y is up.
    this.scene.add(new HemisphereLight("#fff7e8", "#9b947f", 2.2));
    const sun = new DirectionalLight("#fff1da", 2.8);
    sun.position.set(-30, 60, 40);
    this.scene.add(sun);
    void this.load();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.map) this.map.getCanvas().dataset.projectVisible = String(enabled);
    this.map?.triggerRepaint();
  }

  async load() {
    if (!this.map) return;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.onStatus("loading");
    this.map.getCanvas().dataset.projectStatus = "loading";
    const draco = new DRACOLoader()
      .setDecoderPath("/gent-map/draco/")
      .setWorkerLimit(2);
    const timeout = setTimeout(() => request.abort(), 45000);
    try {
      const response = await fetch(ALICE_PROJECT.url, { signal: request.signal });
      if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
      const buffer = await response.arrayBuffer();
      const gltf = await new GLTFLoader().setDRACOLoader(draco).parseAsync(buffer, "");
      if (!this.map || request.signal.aborted || request !== this.request) {
        disposeModel(gltf.scene);
        // An active request that timed out should surface the retry action.
        if (this.map && request === this.request) throw new Error("Model load timed out");
        return;
      }
      if (this.model) {
        this.scene.remove(this.model);
        disposeModel(this.model);
      }
      this.model = gltf.scene;
      this.model.traverse((object) => {
        if (object instanceof Mesh) object.frustumCulled = false;
      });
      this.scene.add(this.model);
      this.map.getCanvas().dataset.projectStatus = "ready";
      this.onStatus("ready");
      this.map.triggerRepaint();
    } catch (error) {
      if (!this.map || request !== this.request) return;
      console.warn("Alice Buyssehof model:", error);
      this.map.getCanvas().dataset.projectStatus = "error";
      this.onStatus("error");
    } finally {
      clearTimeout(timeout);
      draco.dispose();
    }
  }

  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput
  ) {
    if (!this.renderer || !this.enabled || !this.model) return;
    this.camera.projectionMatrix
      .fromArray(args.defaultProjectionData.mainMatrix)
      .multiply(this.transform);
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  onRemove() {
    this.map = undefined;
    this.request?.abort();
    if (this.model) disposeModel(this.model);
    this.model = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.scene.clear();
  }
}

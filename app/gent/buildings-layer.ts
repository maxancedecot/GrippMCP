import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap
} from "maplibre-gl";
import {
  AmbientLight,
  BufferGeometry,
  Camera,
  DirectionalLight,
  ExtrudeGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Path,
  Scene,
  Shape,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GENT_CENTER } from "./map-style.js";

export class GentBuildingsLayer implements CustomLayerInterface {
  readonly id = "gent-3d-buildings";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private camera = new Camera();
  private scene = new Scene();
  private material = new MeshLambertMaterial({ color: "#d8dedb" });
  private mesh?: Mesh;
  private origin = MercatorCoordinate.fromLngLat(GENT_CENTER);
  private scale = this.origin.meterInMercatorCoordinateUnits();
  private transform = new Matrix4()
    .makeTranslation(this.origin.x, this.origin.y, 0)
    .scale(new Vector3(this.scale, -this.scale, this.scale));
  private signature = "";
  private enabled = true;
  private dirty = true;
  private lastUpdate = 0;
  private updateTimer?: ReturnType<typeof setTimeout>;

  onAdd(map: LibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true
    });
    this.renderer.autoClear = false;
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(-150, -100, 300);
    this.scene.add(sun);
    map.on("idle", this.updateBuildings);
    map.on("moveend", this.markDirty);
    map.on("sourcedata", this.markDirty);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.scene.visible = enabled;
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  private markDirty = () => {
    this.dirty = true;
  };

  private localPoint = (point: number[]) => {
    const coordinate = MercatorCoordinate.fromLngLat([point[0], point[1]]);
    return new Vector2(
      (coordinate.x - this.origin.x) / this.scale,
      (this.origin.y - coordinate.y) / this.scale
    );
  };

  private updateBuildings = () => {
    if (!this.map || !this.dirty || !this.enabled) return;
    // Bound mesh rebuilding during the continuous orbit; camera rendering stays smooth.
    const elapsed = performance.now() - this.lastUpdate;
    if (elapsed < 500) {
      if (!this.updateTimer)
        this.updateTimer = setTimeout(() => {
          this.updateTimer = undefined;
          this.updateBuildings();
        }, 500 - elapsed);
      return;
    }
    this.lastUpdate = performance.now();
    this.dirty = false;
    // Reuse visible map features, including clipped tile pieces, without extra requests.
    const features = this.map.queryRenderedFeatures({ layers: ["buildings"] });
    const parts = new Map<
      string,
      { rings: number[][][]; height: number; base: number }
    >();
    for (const feature of features) {
      if (
        feature.properties.hide_3d === true ||
        feature.properties.hide_3d === "true"
      )
        continue;
      const geometry = feature.geometry;
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      const height = Math.max(3, Number(feature.properties.render_height) || 9);
      const base = Math.max(
        0,
        Number(feature.properties.render_min_height) || 0
      );
      if (height <= base) continue;
      for (const rings of polygons) {
        if (rings[0]?.length < 4) continue;
        const key = JSON.stringify([height, base, rings]);
        parts.set(key, { rings, height, base });
      }
    }
    const signature = [...parts.keys()].sort().join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    const geometries: BufferGeometry[] = [];
    for (const { rings, height, base } of parts.values()) {
      const shape = new Shape(rings[0].map(this.localPoint));
      for (const ring of rings.slice(1))
        shape.holes.push(new Path(ring.map(this.localPoint)));
      const geometry = new ExtrudeGeometry(shape, {
        depth: height - base,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1
      });
      geometry.translate(0, 0, base);
      geometries.push(geometry);
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = undefined;
    }
    if (geometries.length) {
      const merged = mergeGeometries(geometries);
      if (merged) {
        this.mesh = new Mesh(merged, this.material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
      }
    }
    for (const geometry of geometries) geometry.dispose();
    this.map.getCanvas().dataset.buildingCount = String(parts.size);
    this.map.triggerRepaint();
  };

  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: CustomRenderMethodInput
  ) {
    if (!this.renderer || !this.enabled) return;
    this.camera.projectionMatrix
      .fromArray(args.defaultProjectionData.mainMatrix)
      .multiply(this.transform);
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  onRemove() {
    clearTimeout(this.updateTimer);
    this.map?.off("idle", this.updateBuildings);
    this.map?.off("moveend", this.markDirty);
    this.map?.off("sourcedata", this.markDirty);
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.renderer?.dispose();
    this.scene.clear();
    this.map = undefined;
  }
}

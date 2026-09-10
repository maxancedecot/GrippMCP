import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap
} from "maplibre-gl";
import {
  BufferGeometry,
  Camera,
  Color,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Path,
  Scene,
  Shape,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GENT_CENTER } from "./map-style.js";

const STONE_COLORS = ["#e5dac9", "#e8dece", "#e2d7c7", "#e9dfcf"].map(
  (value) => new Color(value)
);
const ROOF_COLORS = ["#f2e8d7", "#f0e5d4", "#eee3d2", "#f3e9d9"].map(
  (value) => new Color(value)
);

function buildingTint(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++)
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
  return Math.abs(hash) % STONE_COLORS.length;
}

function paintBuilding(geometry: BufferGeometry, cap: Color, side: Color) {
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (const group of geometry.groups) {
    const color = group.materialIndex === 0 ? cap : side;
    for (let vertex = group.start; vertex < group.start + group.count; vertex++)
      color.toArray(colors, vertex * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
}

function createGabledRoof(points: Vector2[], height: number) {
  let longest = 0;
  let area = 0;
  const axis = new Vector2();
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    area += a.x * b.y - b.x * a.y;
    const length = a.distanceToSquared(b);
    if (length > longest) {
      longest = length;
      axis.subVectors(b, a).normalize();
    }
  }
  const across = new Vector2(-axis.y, axis.x);
  const alongValues = points.map((point) => point.dot(axis));
  const acrossValues = points.map((point) => point.dot(across));
  const minAlong = Math.min(...alongValues);
  const minAcross = Math.min(...acrossValues);
  const length = Math.max(...alongValues) - minAlong;
  const width = Math.max(...acrossValues) - minAcross;
  // Restrict decorative roofs to compact, nearly rectangular footprints without courtyards.
  if (
    width < 3 ||
    width > 18 ||
    length < 4 ||
    length > 40 ||
    Math.abs(area) / (2 * width * length) < 0.94
  )
    return null;
  const rise = Math.min(width * 0.55, 6);
  const triangle = new Shape([
    new Vector2(0, 0),
    new Vector2(width, 0),
    new Vector2(width / 2, rise)
  ]);
  const roof = new ExtrudeGeometry(triangle, {
    depth: length,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1
  });
  const orientation = new Matrix4().makeBasis(
    new Vector3(across.x, across.y, 0),
    new Vector3(0, 0, 1),
    new Vector3(axis.x, axis.y, 0)
  );
  orientation.setPosition(
    axis.x * minAlong + across.x * minAcross,
    axis.y * minAlong + across.y * minAcross,
    height
  );
  roof.applyMatrix4(orientation);
  return roof;
}

export class GentBuildingsLayer implements CustomLayerInterface {
  readonly id = "gent-3d-buildings";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map?: LibreMap;
  private renderer?: WebGLRenderer;
  private camera = new Camera();
  private scene = new Scene();
  private material = new MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  private lineMaterial = new LineBasicMaterial({
    color: "#756555",
    transparent: true,
    opacity: 0.72,
    depthWrite: false
  });
  private outlines?: LineSegments;
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
      { rings: number[][][]; height: number; base: number; tint: number }
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
        const tint = buildingTint(String(feature.id ?? JSON.stringify(rings)));
        const key = JSON.stringify([height, base, rings, tint]);
        parts.set(key, { rings, height, base, tint });
      }
    }
    const signature = [...parts.keys()].sort().join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    const geometries: BufferGeometry[] = [];
    const edgeGeometries: BufferGeometry[] = [];
    let roofCount = 0;
    for (const { rings, height, base, tint } of parts.values()) {
      const points = rings[0].map(this.localPoint);
      const shape = new Shape(points);
      for (const ring of rings.slice(1))
        shape.holes.push(new Path(ring.map(this.localPoint)));
      const geometry = new ExtrudeGeometry(shape, {
        depth: height - base,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1
      });
      geometry.translate(0, 0, base);
      const stone = STONE_COLORS[tint];
      const roofColor = ROOF_COLORS[tint];
      const roof =
        base === 0 && height <= 22 && rings.length === 1
          ? createGabledRoof(points, height)
          : null;
      paintBuilding(geometry, roof ? stone : roofColor, stone);
      geometries.push(geometry);
      edgeGeometries.push(new EdgesGeometry(geometry, 25));
      if (roof) {
        paintBuilding(roof, stone, roofColor);
        geometries.push(roof);
        edgeGeometries.push(new EdgesGeometry(roof, 25));
        roofCount++;
      }
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = undefined;
    }
    if (this.outlines) {
      this.scene.remove(this.outlines);
      this.outlines.geometry.dispose();
      this.outlines = undefined;
    }
    if (geometries.length) {
      const merged = mergeGeometries(geometries);
      if (merged) {
        this.mesh = new Mesh(merged, this.material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
      }
    }
    if (edgeGeometries.length) {
      const mergedEdges = mergeGeometries(edgeGeometries);
      if (mergedEdges) {
        this.outlines = new LineSegments(mergedEdges, this.lineMaterial);
        this.outlines.frustumCulled = false;
        this.outlines.renderOrder = 1;
        this.scene.add(this.outlines);
      }
    }
    for (const geometry of geometries) geometry.dispose();
    for (const geometry of edgeGeometries) geometry.dispose();
    this.map.getCanvas().dataset.buildingCount = String(parts.size);
    this.map.getCanvas().dataset.roofCount = String(roofCount);
    this.map.getCanvas().dataset.outlineCount = String(parts.size);
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
    this.renderer.setViewport(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight
    );
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  onRemove() {
    clearTimeout(this.updateTimer);
    this.map?.off("idle", this.updateBuildings);
    this.map?.off("moveend", this.markDirty);
    this.map?.off("sourcedata", this.markDirty);
    this.mesh?.geometry.dispose();
    this.outlines?.geometry.dispose();
    this.lineMaterial.dispose();
    this.material.dispose();
    this.renderer?.dispose();
    this.scene.clear();
    this.map = undefined;
  }
}

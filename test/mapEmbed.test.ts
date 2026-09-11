import assert from "node:assert/strict";
import test from "node:test";
import { buildEmbedCode, DEFAULT_EMBED_SCENE, embedModelInstances, parseEmbedScene, type EmbedScene } from "../app/gent/embed-config.js";

const scene: EmbedScene = {
  ...DEFAULT_EMBED_SCENE,
  models: [
    { id: "alice-buyssehof", coordinates: [3.5488, 51.0319], facadeBearing: 45 },
    { id: "alice-buyssehof-compleet", coordinates: [3.5498, 51.0325], facadeBearing: 215 }
  ],
  camera: { center: [3.549, 51.032], zoom: 18.4, pitch: 55, bearing: -35 },
  places: false
};

test("iframe code carries both published model placements and view settings independently of browser storage", () => {
  const result = buildEmbedCode("https://maps.example.com", scene);
  const url = new URL(result.url);
  assert.equal(url.pathname, "/alice-buyssehof/embed");
  assert.deepEqual(parseEmbedScene(url.searchParams.get("scene")!), scene);
  assert.match(result.code, /title="Alice Buyssehof 3D-kaart"/);
  assert.match(result.code, /width="100%"/);
  assert.match(result.code, /allow="fullscreen"/);
  const instances = embedModelInstances(scene);
  assert.equal(instances[1].source.url, "/models/alice-buyssehof-compleet.glb");
  assert.deepEqual(instances.map((entry) => entry.placement.coordinates), scene.models.map((model) => model.coordinates));
});

test("embed links reject local uploads, unknown IDs, duplicate models and invalid coordinates", () => {
  for (const models of [
    [],
    [{ ...scene.models[0], id: "upload-private" }],
    [{ ...scene.models[0], id: "https://example.com/model.glb" }],
    [scene.models[0], scene.models[0]],
    [{ ...scene.models[0], coordinates: [0, 0] }],
    [{ ...scene.models[0], facadeBearing: 360 }],
    [null]
  ]) assert.equal(parseEmbedScene(JSON.stringify({ ...scene, models })), null);
});

test("embed links validate bounded camera and display settings and do not accept source URLs", () => {
  for (const camera of [
    null, { ...scene.camera, center: [180, 90] }, { ...scene.camera, zoom: 100 },
    { ...scene.camera, pitch: -1 }, { ...scene.camera, bearing: "45" }
  ]) assert.equal(parseEmbedScene(JSON.stringify({ ...scene, camera })), null);
  assert.equal(parseEmbedScene(JSON.stringify({ ...scene, labels: "false" })), null);
  assert.equal(parseEmbedScene("{"), null);
  assert.equal(parseEmbedScene(" ".repeat(6001)), null);
  assert.equal(parseEmbedScene(JSON.stringify({ ...scene, version: 2 })), null);
  const supplied = { ...scene, models: [{ ...scene.models[1], url: "https://example.com/private.glb" }] };
  assert.deepEqual(parseEmbedScene(JSON.stringify(supplied))?.models, [scene.models[1]]);
  assert.throws(() => buildEmbedCode("javascript:alert(1)", scene));
});

test("default iframe loads the complete project and 2D links have a flat camera", () => {
  assert.deepEqual(parseEmbedScene(JSON.stringify(DEFAULT_EMBED_SCENE)), DEFAULT_EMBED_SCENE);
  assert.equal(embedModelInstances(DEFAULT_EMBED_SCENE).length, 1);
  assert.equal(parseEmbedScene(JSON.stringify({ ...scene, is3d: false }))?.camera.pitch, 0);
});

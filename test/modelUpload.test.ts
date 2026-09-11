import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_MODEL_BYTES, validateModelBuffer, validateModelFile } from "../app/gent/model-upload.js";

function glb(manifest: object) {
  const json = Buffer.from(JSON.stringify(manifest));
  const padded = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + padded);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(32);
  new Uint8Array(buffer, 20, json.length).set(json);
  return buffer;
}
const manifest = { asset: { version: "2.0" }, meshes: [{ primitives: [] }] };

test("accepts both Blender-exported, Draco-compressed Alice models", async () => {
  for (const name of ["alice-buyssehof.glb", "alice-buyssehof-compleet.glb"]) {
    const data = await readFile(`public/models/${name}`);
    const buffer = new Uint8Array(data).buffer;
    assert.doesNotThrow(() => validateModelFile({ name: name.toUpperCase(), size: buffer.byteLength }));
    assert.doesNotThrow(() => validateModelBuffer(buffer));
  }
});

test("explains Blender export requirements and enforces the upload limit", () => {
  assert.throws(() => validateModelFile({ name: "Building.blend", size: 5000 }), /File → Export/);
  assert.throws(() => validateModelFile({ name: "Building.gltf", size: 5000 }), /\.glb/);
  assert.throws(() => validateModelFile({ name: "Building.glb", size: MAX_MODEL_BYTES + 1 }), /50 MB/);
  assert.throws(() => validateModelFile({ name: "Building.glb", size: 0 }), /geen geldig/);
});

test("rejects remote and relative resources before a model can request them", () => {
  for (const uri of ["https://example.com/texture.png", "//example.com/mesh.bin", "../texture.png", "file:///tmp/model.bin", "blob:unknown"]) {
    for (const collection of ["images", "buffers"]) {
      assert.throws(() => validateModelBuffer(glb({ ...manifest, [collection]: [{ uri }] })), /losse bestanden/);
    }
  }
  assert.doesNotThrow(() => validateModelBuffer(glb({ ...manifest, images: [{ uri: "data:image/png;base64,AA==" }] })));
});

test("rejects truncated, oversized-chunk, malformed-JSON and non-glTF containers", () => {
  const valid = glb(manifest);
  for (const length of [0, 12, 19, valid.byteLength - 1]) {
    assert.throws(() => validateModelBuffer(valid.slice(0, length)), /ongeldig/);
  }
  for (const [offset, value] of [[0, 0], [4, 1], [8, 20], [12, 0xffffffff], [16, 0]]) {
    const damaged = valid.slice(0);
    new DataView(damaged).setUint32(offset, value, true);
    assert.throws(() => validateModelBuffer(damaged), /ongeldig/);
  }
  const brokenJson = valid.slice(0);
  new Uint8Array(brokenJson)[20] = 0;
  assert.throws(() => validateModelBuffer(brokenJson), /ongeldig/);
  assert.throws(() => validateModelBuffer(glb({ asset: { version: "2.0" } })), /ongeldig/);
});

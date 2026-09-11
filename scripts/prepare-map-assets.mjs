import { copyFile, mkdir } from "node:fs/promises";

// Keep the browser worker and its shared module on the same installed version.
const source = new URL(import.meta.resolve("maplibre-gl"));
const destination = new URL("../public/gent-map/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(filename, source), new URL(filename, destination));
}

// Serve the decoder locally with the installed Three.js version.
const dracoSource = new URL(
  "../examples/jsm/libs/draco/gltf/",
  import.meta.resolve("three")
);
const dracoDestination = new URL("draco/", destination);
await mkdir(dracoDestination, { recursive: true });
for (const filename of ["draco_wasm_wrapper.js", "draco_decoder.wasm", "draco_decoder.js"]) {
  await copyFile(new URL(filename, dracoSource), new URL(filename, dracoDestination));
}

import { copyFile, mkdir } from "node:fs/promises";

// Keep the browser worker and its shared module on the same installed version.
const source = new URL(import.meta.resolve("maplibre-gl"));
const destination = new URL("../public/gent-map/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(new URL(filename, source), new URL(filename, destination));
}

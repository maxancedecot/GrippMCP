export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export function validateModelFile(file: { name: string; size: number }) {
  if (file.name.toLowerCase().endsWith(".blend")) {
    throw new Error("Exporteer dit bestand eerst in Blender via File → Export → glTF 2.0 en kies GLB. Upload daarna het .glb-bestand.");
  }
  if (!file.name.toLowerCase().endsWith(".glb")) {
    throw new Error("Kies een .glb-bestand, geëxporteerd vanuit Blender.");
  }
  if (file.size > MAX_MODEL_BYTES) throw new Error("Het model is te groot. Exporteer een GLB van maximaal 50 MB.");
  if (file.size < 20) throw new Error("Dit bestand bevat geen geldig 3D-model.");
}

// A single-file upload must contain its own geometry and textures. Inspect the
// container before GLTFLoader can follow any referenced resource URLs.
export function validateModelBuffer(buffer: ArrayBuffer) {
  const invalid = () => new Error("Dit GLB-bestand is beschadigd of ongeldig. Exporteer het opnieuw vanuit Blender.");
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) throw invalid();
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength) throw invalid();
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4 || 20 + jsonLength > buffer.byteLength) throw invalid();
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  } catch { throw invalid(); }
  if (!manifest || typeof manifest !== "object") throw invalid();
  const document = manifest as Record<string, unknown>;
  const asset = document.asset as { version?: unknown } | undefined;
  if (!asset || asset.version !== "2.0" || !Array.isArray(document.meshes) || !document.meshes.length) throw invalid();
  for (const collection of [document.buffers, document.images]) {
    if (collection === undefined) continue;
    if (!Array.isArray(collection)) throw invalid();
    for (const entry of collection) {
      if (!entry || typeof entry !== "object") throw invalid();
      if ("uri" in entry && (typeof entry.uri !== "string" || !entry.uri.startsWith("data:"))) {
        throw new Error("Dit model verwijst naar losse bestanden. Exporteer als GLB met de materialen en texturen in hetzelfde bestand.");
      }
    }
  }
  let offset = 20 + jsonLength;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) throw invalid();
    const length = view.getUint32(offset, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw invalid();
    offset += 8 + length;
  }
}

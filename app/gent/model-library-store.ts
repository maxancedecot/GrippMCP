import { DEFAULT_PROJECT_MODEL, type ProjectModelSource } from "./project-model.js";
import { MAX_MODEL_BYTES } from "./model-upload.js";

const DATABASE = "alice-buyssehof-models";

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("models", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Modelopslag is geblokkeerd door een ander tabblad."));
    };
  });
}

function validModel(value: unknown): value is ProjectModelSource & { file: Blob } {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<ProjectModelSource>;
  return typeof model.id === "string" && /^upload-[\w-]+$/.test(model.id) &&
    typeof model.name === "string" && model.name.length > 0 && model.name.length <= 200 &&
    model.file instanceof Blob && model.file.size >= 20 && model.file.size <= MAX_MODEL_BYTES;
}

export async function readModelLibrary(): Promise<{ models: ProjectModelSource[]; activeId: string; visibility: Record<string, boolean> }> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["models", "settings"], "readonly");
    const models = tx.objectStore("models").getAll();
    const active = tx.objectStore("settings").get("active");
    const visibility = tx.objectStore("settings").get("visibility");
    tx.oncomplete = () => {
      db.close();
      resolve({
        models: (models.result as unknown[]).filter(validModel),
        activeId: typeof active.result === "string" ? active.result : DEFAULT_PROJECT_MODEL.id,
        visibility: visibility.result && typeof visibility.result === "object"
          ? Object.fromEntries(Object.entries(visibility.result).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
          : {}
      });
    };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { /* Transaction abort handles the failure. */ };
  });
}

// Store a newly uploaded model and its selection atomically. A quota failure
// leaves the previous library and selection intact.
export async function rememberModel(model: ProjectModelSource, add = false) {
  const db = await openLibrary();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["models", "settings"], "readwrite");
    if (add && model.file) tx.objectStore("models").put(model);
    tx.objectStore("settings").put(model.id, "active");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { /* Transaction abort handles the failure. */ };
  });
}

export async function rememberModelVisibility(id: string, visible: boolean) {
  const db = await openLibrary();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const request = store.get("visibility");
    request.onsuccess = () => store.put({ ...request.result, [id]: visible }, "visibility");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function forgetModel(id: string, activeId = DEFAULT_PROJECT_MODEL.id) {
  const db = await openLibrary();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["models", "settings"], "readwrite");
    tx.objectStore("models").delete(id);
    tx.objectStore("settings").put(activeId, "active");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { /* Transaction abort handles the failure. */ };
  });
}

"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { DEFAULT_PROJECT_MODEL, type ProjectModelSource } from "./project-model.js";
import { forgetModel, readModelLibrary, rememberModel } from "./model-library-store.js";
import { validateModelBuffer, validateModelFile } from "./model-upload.js";

export function ModelLibrary({ active, ready, disabled, onSelect }: {
  active: ProjectModelSource;
  ready: boolean;
  disabled: boolean;
  onSelect: (model: ProjectModelSource) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const restored = useRef(false);
  const mounted = useRef(true);
  const [models, setModels] = useState<ProjectModelSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = disabled || busy;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready || restored.current) return;
    let cancelled = false;
    setBusy(true);
    void readModelLibrary().then(async (library) => {
      if (cancelled) return;
      setModels(library.models);
      const selected = library.models.find((model) => model.id === library.activeId);
      if (selected && !await onSelect(selected) && !cancelled) {
        setError("Het bewaarde model kon niet laden. Kies een model of upload het opnieuw.");
      }
    }).catch(() => {
      if (!cancelled) setMessage("Browseropslag is niet beschikbaar. Uploads blijven alleen tijdens deze sessie beschikbaar.");
    }).finally(() => {
      if (!cancelled) {
        restored.current = true;
        setBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [ready, onSelect]);

  async function select(model: ProjectModelSource, add = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!await onSelect(model)) throw new Error("Het model kon niet worden geopend. Het vorige model blijft behouden. Exporteer opnieuw als GLB en probeer nogmaals.");
      if (!mounted.current) return;
      if (add) setModels((previous) => [...previous, model]);
      try {
        await rememberModel(model, Boolean(model.file));
        if (mounted.current) setMessage("Model bewaard.");
      } catch {
        if (mounted.current) setMessage("Model geopend voor deze sessie. Bewaren is niet gelukt; controleer de vrije browseropslag.");
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Het model kon niet worden geopend.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function upload(file: File) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      validateModelFile(file);
      validateModelBuffer(await file.arrayBuffer());
      if (!mounted.current) return;
      await select({ id: `upload-${crypto.randomUUID()}`, name: file.name.slice(0, 200), file }, true);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Dit bestand kon niet worden gelezen.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!await onSelect(DEFAULT_PROJECT_MODEL)) throw new Error("Alice Buyssehof kon niet laden. Je upload blijft bewaard.");
      await forgetModel(active.id);
      if (mounted.current) {
        setModels((previous) => previous.filter((model) => model.id !== active.id));
        setMessage("Het geüploade model is uit deze browser verwijderd.");
      }
    } catch {
      if (mounted.current) setError("Verwijderen is niet gelukt. Het model blijft in de keuzelijst staan.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="gent-model-library" aria-busy={busy}>
      <label htmlFor="gent-project-model">3D-model</label>
      <select id="gent-project-model" value={active.id} disabled={locked}
        onChange={(event) => {
          const model = [DEFAULT_PROJECT_MODEL, ...models].find((item) => item.id === event.target.value);
          if (model) void select(model);
        }}>
        <option value={DEFAULT_PROJECT_MODEL.id}>{DEFAULT_PROJECT_MODEL.name}</option>
        {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <input ref={input} type="file" accept=".glb,model/gltf-binary" hidden
        aria-label="Upload een Blender-model als GLB" disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }} />
      <button type="button" className="gent-project-focus" disabled={locked} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle size={15} className="gent-spinner" aria-hidden /> : <Upload size={15} aria-hidden />}
        {busy ? "Model openen…" : "Model uploaden"}
      </button>
      {active.file && <button type="button" className="gent-model-remove" disabled={locked} onClick={() => void remove()}>
        <Trash2 size={13} aria-hidden /> Verwijder dit model
      </button>}
      <details>
        <summary>Exporteren vanuit Blender</summary>
        <p>File → Export → glTF 2.0. Kies glTF Binary (.glb) en exporteer je gebouw met materialen en texturen. Maximaal 50 MB.</p>
        <p>Een .blend-bestand moet eerst als GLB worden geëxporteerd.</p>
      </details>
      <p>Je uploads blijven in deze browser. Je toont één model tegelijk.</p>
      {message && <p role="status">{message}</p>}
      {error && <p className="gent-model-error" role="alert">{error}</p>}
    </div>
  );
}

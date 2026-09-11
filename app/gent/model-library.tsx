"use client";

import { useEffect, useRef, useState } from "react";
import { Focus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { DEFAULT_PROJECT_MODEL, type ModelSelectionOptions, type ProjectModelSource } from "./project-model.js";
import { forgetModel, readModelLibrary, rememberModel } from "./model-library-store.js";
import { validateModelBuffer, validateModelFile } from "./model-upload.js";

export function ModelLibrary({ active, visibility, ready, disabled, onSelect, onVisibility, onRemove, onShowAll }: {
  active: ProjectModelSource;
  visibility: Record<string, boolean>;
  ready: boolean;
  disabled: boolean;
  onSelect: (model: ProjectModelSource, options?: ModelSelectionOptions) => Promise<boolean>;
  onVisibility: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
  onShowAll: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const restored = useRef(false);
  const mounted = useRef(true);
  const [models, setModels] = useState<ProjectModelSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = disabled || busy;
  const allModels = [DEFAULT_PROJECT_MODEL, ...models];

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
      const loaded: ProjectModelSource[] = [];
      const failed: string[] = [];
      for (const model of [DEFAULT_PROJECT_MODEL, ...library.models]) {
        if (cancelled) return;
        const success = await onSelect(model, {
          select: false, visible: library.visibility[model.id] !== false, frame: false, persist: false
        });
        if (success) loaded.push(model);
        else failed.push(model.name);
      }
      if (cancelled) return;
      const selected = loaded.find((model) => model.id === library.activeId) ?? loaded[0];
      if (selected) await onSelect(selected, {
        visible: library.visibility[selected.id] !== false, frame: false, persist: false
      });
      if (cancelled) return;
      if (failed.length) setError(`Deze modellen konden niet laden: ${failed.join(", ")}. De andere modellen blijven zichtbaar.`);
      if (library.models.length) onShowAll();
    }).catch(() => {
      if (!cancelled) setMessage("Browseropslag is niet beschikbaar. Uploads blijven alleen tijdens deze sessie beschikbaar.");
    }).finally(() => {
      if (!cancelled) { restored.current = true; setBusy(false); }
    });
    return () => { cancelled = true; };
  }, [ready, onSelect, onShowAll]);

  async function open(model: ProjectModelSource, add = false) {
    if (!await onSelect(model)) throw new Error("Het model kon niet worden geopend. De andere modellen blijven behouden.");
    if (!mounted.current) return false;
    if (add) setModels((previous) => [...previous, model]);
    try {
      await rememberModel(model, Boolean(model.file));
      return true;
    } catch { return false; }
  }

  async function select(model: ProjectModelSource) {
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await open(model);
      if (mounted.current && !saved) setMessage("Je modelkeuze kon niet worden bewaard in deze browser.");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Het model kon niet worden geopend.");
    } finally { if (mounted.current) setBusy(false); }
  }

  async function upload(files: File[]) {
    setBusy(true); setError(""); setMessage("");
    const failed: string[] = [];
    let added = 0;
    let savedAll = true;
    for (const file of files) {
      if (!mounted.current) return;
      try {
        validateModelFile(file);
        validateModelBuffer(await file.arrayBuffer());
        if (!mounted.current) return;
        const saved = await open({ id: `upload-${crypto.randomUUID()}`, name: file.name.slice(0, 200), file }, true);
        savedAll = savedAll && saved;
        added++;
      } catch (cause) {
        failed.push(`${file.name}: ${cause instanceof Error ? cause.message : "Het bestand kon niet worden gelezen."}`);
      }
    }
    if (!mounted.current) return;
    if (added) {
      setMessage(savedAll
        ? `${added} ${added === 1 ? "model toegevoegd" : "modellen toegevoegd"}. Alle aangevinkte modellen blijven samen zichtbaar.`
        : "Modellen toegevoegd voor deze sessie. Bewaren is niet gelukt; controleer de vrije browseropslag.");
      onShowAll();
    }
    setError(failed.join(" "));
    setBusy(false);
  }

  async function remove(model: ProjectModelSource) {
    setBusy(true); setError(""); setMessage("");
    try {
      let next = active;
      if (model.id === active.id) {
        next = allModels.find((entry) => entry.id !== model.id && visibility[entry.id] !== false) ?? DEFAULT_PROJECT_MODEL;
        if (!await onSelect(next, { visible: visibility[next.id] !== false, frame: false })) throw new Error("Geen ander model beschikbaar.");
      }
      await forgetModel(model.id, next.id);
      if (!mounted.current) return;
      onRemove(model.id);
      setModels((previous) => previous.filter((entry) => entry.id !== model.id));
      setMessage(`${model.name} is verwijderd. De andere modellen blijven op de kaart.`);
      onShowAll();
    } catch {
      if (mounted.current) setError("Verwijderen is niet gelukt. Het model blijft in de lijst staan.");
    } finally { if (mounted.current) setBusy(false); }
  }

  return (
    <div className="gent-model-library" aria-busy={busy}>
      <label htmlFor="gent-project-model">Model bewerken</label>
      <select id="gent-project-model" value={active.id} disabled={locked}
        onChange={(event) => {
          const model = allModels.find((entry) => entry.id === event.target.value);
          if (model) void select(model);
        }}>
        {allModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <div className="gent-model-list" role="group" aria-label="Zichtbare modellen">
        {allModels.map((model) => (
          <div className="gent-model-row" key={model.id} data-selected={model.id === active.id}>
            <label>
              <input type="checkbox" checked={visibility[model.id] !== false} disabled={locked}
                aria-label={`Toon ${model.name}`} onChange={(event) => onVisibility(model.id, event.target.checked)} />
              <span title={model.name}>{model.name}</span>
            </label>
            {model.file && <button type="button" className="gent-model-remove" disabled={locked}
              aria-label={`Verwijder ${model.name}`} title={`Verwijder ${model.name}`} onClick={() => void remove(model)}>
              <Trash2 size={14} aria-hidden />
            </button>}
          </div>
        ))}
      </div>
      <input ref={input} type="file" accept=".glb,model/gltf-binary" hidden multiple
        aria-label="Upload Blender-modellen als GLB" disabled={locked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void upload(files);
        }} />
      <button type="button" className="gent-project-focus" disabled={locked} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle size={15} className="gent-spinner" aria-hidden /> : <Upload size={15} aria-hidden />}
        {busy ? "Modellen openen…" : "Modellen uploaden"}
      </button>
      <button type="button" className="gent-project-focus" disabled={locked} onClick={onShowAll}>
        <Focus size={15} aria-hidden /> Alles in beeld
      </button>
      <details>
        <summary>Exporteren vanuit Blender</summary>
        <p>File → Export → glTF 2.0. Kies glTF Binary (.glb) en exporteer je gebouw met materialen en texturen. Maximaal 50 MB per bestand.</p>
        <p>Een .blend-bestand moet eerst als GLB worden geëxporteerd.</p>
      </details>
      <p>Alle aangevinkte modellen zijn tegelijk zichtbaar. Kies hierboven welk model je wilt verplaatsen of draaien. Je uploads blijven in deze browser.</p>
      {message && <p role="status">{message}</p>}
      {error && <p className="gent-model-error" role="alert">{error}</p>}
    </div>
  );
}

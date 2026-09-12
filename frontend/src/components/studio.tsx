"use client";

import { useMemo, useRef, useState } from "react";
import { useBoardLayout, referenceName } from "./studio/board/board-store";
import ParticleScene from "./particle-scene";
import StudioHeader from "./studio/studio-header";
import ReferencesPanel from "./studio/references-panel";
import ChatPanel from "./studio/chat-panel";
import type { ChatPanelHandle } from "./studio/chat-panel";
import PlaybackPanel from "./studio/playback-panel";
import PanelToggle from "./studio/panel-toggle";
import { usePlayback } from "./studio/use-playback";
import { useReferences } from "./studio/use-references";
import type {
  Project,
  Reference,
  Generation,
  EffectVersion,
} from "@/lib/project-types";
import EmitterTimeline from "./vfx-studio/emitter-timeline";
import {
  cloneSample,
  createEmitter,
  normalizeVfxDocument,
  PARAMETER_NAMES,
  type VfxLayer,
  type VfxSampleId,
  type VfxUiDocument,
} from "./vfx-studio/ui-model";
import "./vfx-studio/studio-ui.css";

type StudioProps = {
  project: Project;
  userId: string;
  email: string;
  initialReferences: Reference[];
  initialGenerations: Generation[];
  versions: EffectVersion[];
};

function downloadDocument(document: VfxUiDocument) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.name.toLowerCase().replaceAll(" ", "-")}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Studio({
  project,
  userId,
  email,
  initialReferences,
  initialGenerations,
  versions,
}: StudioProps) {
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vfxDocument, setVfxDocument] = useState(() => cloneSample("amber"));
  const [selectedLayerId, setSelectedLayerId] = useState(
    () => cloneSample("amber").layers[1].id,
  );
  const [soloLayerId, setSoloLayerId] = useState<string>();
  const [vfxNotice, setVfxNotice] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const playback = usePlayback(vfxDocument.duration);
  const references = useReferences(project.id, userId, initialReferences);

  const { layout } = useBoardLayout(project.id);
  const chat = useRef<ChatPanelHandle>(null);
  const displayReferences = useMemo(() => references.references.map(ref => ({ ...ref, name: layout[ref.id]?.name || referenceName(ref.name) })), [references.references, layout]);
  const boardState = { ...references, references: displayReferences };
  const mention = (reference: Reference) => { setRight(true); chat.current?.mention(reference); };
  const selectedLayer =
    vfxDocument.layers.find(layer => layer.id === selectedLayerId) ||
    vfxDocument.layers[0];
  const updateLayer = (id: string, update: (layer: VfxLayer) => VfxLayer) => {
    setVfxDocument(document => ({
      ...document,
      layers: document.layers.map(layer => layer.id === id ? update(layer) : layer),
    }));
  };
  const selectSample = (id: VfxSampleId) => {
    const next = cloneSample(id);
    setVfxDocument(next);
    setSelectedLayerId(next.layers[1]?.id || next.layers[0].id);
    setSoloLayerId(undefined);
    setVfxNotice(`${next.name} sample loaded.`);
    playback.setTime(0);
  };
  const addEmitter = () => {
    const emitter = createEmitter(vfxDocument.layers.length + 1, vfxDocument.duration);
    setVfxDocument(document => ({
      ...document,
      layers: [...document.layers, emitter],
    }));
    setSelectedLayerId(emitter.id);
    setSoloLayerId(undefined);
  };
  const effectControls = (
    <div className="lab-controls lab-emitter-controls">
      <h3 className="lab-section-label lab-wide">
        {selectedLayer.name} · {selectedLayer.kind} · {selectedLayer.start.toFixed(2)}–{selectedLayer.end.toFixed(2)} s
      </h3>
      <button
        type="button"
        className="lab-action lab-wide"
        onClick={() => {
          setRight(true);
          chat.current?.editLayer(selectedLayer.id);
        }}
      >
        Edit this emitter in chat ↗
      </button>
      <label className="lab-field">
        Color
        <input
          type="color"
          aria-label="Emitter color"
          value={selectedLayer.color}
          onChange={event => updateLayer(selectedLayer.id, layer => ({ ...layer, color: event.target.value }))}
        />
      </label>
      <label className="lab-field">
        Secondary color
        <input
          type="color"
          aria-label="Emitter secondary color"
          value={selectedLayer.secondaryColor}
          onChange={event => updateLayer(selectedLayer.id, layer => ({ ...layer, secondaryColor: event.target.value }))}
        />
      </label>
      <label className="lab-field">
        Blend
        <select
          aria-label="Emitter blend"
          value={selectedLayer.blend}
          onChange={event => updateLayer(selectedLayer.id, layer => ({
            ...layer,
            blend: event.target.value as VfxLayer["blend"],
          }))}
        >
          <option value="additive">Additive</option>
          <option value="normal">Normal</option>
        </select>
      </label>
      {PARAMETER_NAMES.map(name => (
        <label className="lab-field" key={name}>
          <span>{name}<output>{(selectedLayer.parameters[name] / 100).toFixed(2)}</output></span>
          <input
            aria-label={`Emitter ${name.toLowerCase()}`}
            type="range"
            min="0"
            max="100"
            value={selectedLayer.parameters[name]}
            onChange={event => updateLayer(selectedLayer.id, layer => ({
              ...layer,
              parameters: {
                ...layer.parameters,
                [name]: Number(event.target.value),
              },
            }))}
          />
        </label>
      ))}
    </div>
  );
  const environmentControls = (
    <div className="lab-shelf">
      <label className="lab-field">
        Bloom
        <input
          type="range"
          aria-label="Bloom"
          min="0"
          max="100"
          value={vfxDocument.environment.bloom}
          onChange={event => setVfxDocument(document => ({
            ...document,
            environment: { ...document.environment, bloom: Number(event.target.value) },
          }))}
        />
      </label>
      <label className="lab-field">
        Exposure
        <input
          type="range"
          aria-label="Exposure"
          min="0"
          max="100"
          value={vfxDocument.environment.exposure}
          onChange={event => setVfxDocument(document => ({
            ...document,
            environment: { ...document.environment, exposure: Number(event.target.value) },
          }))}
        />
      </label>
      <button type="button" className="lab-action" onClick={() => setVfxDocument(document => ({
        ...document,
        environment: { bloom: 64, exposure: 48 },
      }))}>
        Reset environment
      </button>
    </div>
  );

  return (
    <main
      className={`studio lab ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <div className="lab-preview-stage">
        <ParticleScene time={playback.time} />
        <div className="lab-preview-caption">
          <span>LIVE PREVIEW</span>
          <strong>{vfxDocument.name}</strong>
          <small>{soloLayerId ? `${selectedLayer.name} · SOLO` : `${vfxDocument.layers.filter(layer => layer.enabled).length} EMITTERS VISIBLE`}</small>
        </div>
      </div>
      <StudioHeader
        project={project}
        email={email}
        actions={
          <>
            <select
              aria-label="Load VFX sample"
              className="lab-mode"
              defaultValue=""
              onChange={event => {
                selectSample(event.target.value as VfxSampleId);
                event.target.value = "";
              }}
            >
              <option value="" disabled>Samples</option>
              <option value="amber">Amber rupture</option>
              <option value="plasma">Plasma bloom</option>
              <option value="ember">Ember trail</option>
            </select>
            <button type="button" className="lab-action" onClick={() => importInput.current?.click()}>
              Import JSON
            </button>
            <button type="button" className="lab-action" onClick={() => downloadDocument(vfxDocument)}>
              JSON ↓
            </button>
          </>
        }
      />
      <input
        ref={importInput}
        hidden
        type="file"
        accept=".json,application/json"
        aria-label="Import effect JSON"
        onChange={async event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > 1_000_000) throw new Error("Effect JSON must be under 1 MB.");
            const next = normalizeVfxDocument(JSON.parse(await file.text()));
            setVfxDocument(next);
            setSelectedLayerId(next.layers[0].id);
            setSoloLayerId(undefined);
            setVfxNotice(`${file.name} imported.`);
            playback.setTime(0);
          } catch (error) {
            setVfxNotice(error instanceof Error ? error.message : "Could not import this JSON file.");
          }
        }}
      />
      {!left && (
        <PanelToggle
          side="left"
          label="References"
          onOpen={() => setLeft(true)}
        />
      )}
      {!right && (
        <PanelToggle side="right" label="Chat" onOpen={() => setRight(true)} />
      )}
      <div hidden={!left}>
        <ReferencesPanel projectId={project.id} state={boardState} onMention={mention} locked={saving} onCollapse={() => setLeft(false)} />
      </div>
      <div hidden={!right}>
        <ChatPanel
          key={`${project.id}-${vfxDocument.name}-${vfxDocument.duration}`}
          projectId={project.id}
          initialGenerations={initialGenerations}
          versions={versions}
          ref={chat}
          references={displayReferences}
          uploadFile={references.uploadFile}
          busy={references.busy}
          saving={saving}
          setSaving={setSaving}
          onCollapse={() => setRight(false)}
          vfx={{
            document: vfxDocument,
            selectedId: selectedLayer.id,
            onSelect: setSelectedLayerId,
            onScopedEdit: (layerId, edit) => updateLayer(layerId, layer => ({
              ...layer,
              edits: [...layer.edits, edit],
            })),
          }}
        />
      </div>
      <PlaybackPanel
        playback={playback}
        duration={vfxDocument.duration}
        name={vfxDocument.name}
        tracks={
          <EmitterTimeline
            layers={vfxDocument.layers}
            duration={vfxDocument.duration}
            time={playback.time}
            selected={selectedLayer.id}
            solo={soloLayerId}
            onSelect={setSelectedLayerId}
            onSolo={id => {
              setSelectedLayerId(id);
              setSoloLayerId(soloLayerId === id ? undefined : id);
            }}
            onToggle={id => updateLayer(id, layer => ({ ...layer, enabled: !layer.enabled }))}
            onAdd={addEmitter}
          />
        }
        effectControls={effectControls}
        environmentLabel="Environment"
      >
        {environmentControls}
      </PlaybackPanel>
      <footer className="viewport-footer">
        <span><i /> {vfxDocument.layers.length} emitters · UI controls only</span>
        <span>{vfxNotice || "VFX generation logic is not included"}</span>
      </footer>
    </main>
  );
}

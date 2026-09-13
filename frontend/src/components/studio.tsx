"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardLayout, referenceName } from "./studio/board/board-store";
import ParticleScene from "./particle-scene";
import StudioHeader from "./studio/studio-header";
import ReferencesPanel from "./studio/references-panel";
import ChatPanel from "./studio/chat-panel";
import type { ChatPanelHandle } from "./studio/chat-panel";
import PlaybackPanel from "./studio/playback-panel";
import PanelToggle from "./studio/panel-toggle";
import Icon from "./studio/icon";
import IconButton from "./studio/icon-button";
import { usePlayback } from "./studio/use-playback";
import { useReferences } from "./studio/use-references";
import type {
  Project,
  Reference,
  Generation,
  EffectVersion,
} from "@/lib/project-types";
import EmitterTimeline from "./vfx-studio/emitter-timeline";
import EmitterControls from "./vfx-studio/emitter-controls";
import {
  cloneSample,
  createEmitter,
  normalizeVfxDocument,
  type VfxLayer,
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
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const environmentPanel = useRef<HTMLElement>(null);
  const environmentTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!environmentOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!environmentPanel.current?.contains(event.target as Node)) setEnvironmentOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEnvironmentOpen(false);
        environmentTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [environmentOpen]);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vfxDocument, setVfxDocument] = useState(() => cloneSample("amber"));
  const [selectedLayerId, setSelectedLayerId] = useState(
    () => cloneSample("amber").layers[1].id,
  );
  const [soloLayerId, setSoloLayerId] = useState<string>();
  const [importError, setImportError] = useState("");
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
  const addEmitter = () => {
    const emitter = createEmitter(vfxDocument.layers.length + 1, vfxDocument.duration);
    setVfxDocument(document => ({
      ...document,
      layers: [...document.layers, emitter],
    }));
    setSelectedLayerId(emitter.id);
    setSoloLayerId(undefined);
  };
  const effectControls = <EmitterControls layer={selectedLayer} onChange={patch => updateLayer(selectedLayer.id, layer => ({ ...layer, ...patch }))} />;
  const environmentControls = (
    <section ref={environmentPanel} className="glass lab-environment-strip" aria-label="Scene controls"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEnvironmentOpen(false);
      }}
    >
      <button
        ref={environmentTrigger}
        type="button"
        className="lab-environment-trigger"
        aria-expanded={environmentOpen}
        aria-controls="environment-settings"
        onClick={() => setEnvironmentOpen(open => !open)}
      >
        <Icon name="sliders" size={14} />
        Environment
        <span className={environmentOpen ? "rotated" : ""}><Icon name="chevron" size={14} /></span>
      </button>
      <div id="environment-settings" className="lab-environment-panel" hidden={!environmentOpen}>
        <label className="lab-environment-field">
          Bloom
          <input
            type="range"
            aria-label="Bloom"
            min="0"
            max="100"
            id="environment-bloom"
            value={vfxDocument.environment.bloom}
            onChange={event => setVfxDocument(document => ({
              ...document,
              environment: { ...document.environment, bloom: Number(event.target.value) },
            }))}
          />
          <output htmlFor="environment-bloom">{vfxDocument.environment.bloom}</output>
        </label>
        <label className="lab-environment-field">
          Exposure
          <input
            type="range"
            aria-label="Exposure"
            min="0"
            max="100"
            id="environment-exposure"
            value={vfxDocument.environment.exposure}
            onChange={event => setVfxDocument(document => ({
              ...document,
              environment: { ...document.environment, exposure: Number(event.target.value) },
            }))}
          />
          <output htmlFor="environment-exposure">{vfxDocument.environment.exposure}</output>
        </label>
        <IconButton
          name="reset"
          label="Reset environment"
          onClick={() => setVfxDocument(document => ({
            ...document,
            environment: { bloom: 64, exposure: 48 },
          }))}
        />
      </div>
      <div className="lab-scene-export">
        <IconButton
          name="upload"
          label="Import effect JSON"
          onClick={() => {
            setEnvironmentOpen(false);
            importInput.current?.click();
          }}
        />
        <IconButton
          name="download"
          label="Export effect JSON"
          onClick={() => {
            setEnvironmentOpen(false);
            downloadDocument(vfxDocument);
          }}
        />
      </div>
    </section>
  );

  return (
    <main
      className={`studio lab ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <div className="lab-preview-stage">
        <ParticleScene time={playback.time} />
      </div>
      <StudioHeader
        project={project}
        email={email}

      />
      {environmentControls}
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
          setImportError("");
          try {
            if (file.size > 1_000_000) throw new Error("Effect JSON must be under 1 MB.");
            const next = normalizeVfxDocument(JSON.parse(await file.text()));
            setVfxDocument(next);
            setSelectedLayerId(next.layers[0].id);
            setSoloLayerId(undefined);
            playback.setTime(0);
          } catch (error) {
            setImportError(error instanceof Error ? error.message : "Could not import this JSON file.");
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
          key={`${project.id}-${vfxDocument.name}`}
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
          }}
        />
      </div>
      <PlaybackPanel
        playback={playback}
        duration={vfxDocument.duration}
        minDuration={Math.max(0.01, ...vfxDocument.layers.flatMap(layer => [layer.end, ...layer.edits.map(edit => edit.end)]))}
        onDurationChange={duration => {
          playback.setPlaying(false);
          playback.setTime(Math.min(playback.time, duration));
          setVfxDocument(document => ({ ...document, duration }));
        }}
        tracks={
          <EmitterTimeline
            layers={vfxDocument.layers}
            duration={vfxDocument.duration}
            time={playback.time}
            onSeek={time => {
              playback.setPlaying(false);
              playback.setTime(time);
            }}
            selected={selectedLayer.id}
            solo={soloLayerId}
            onSelect={setSelectedLayerId}
            onSolo={id => {
              setSelectedLayerId(id);
              setSoloLayerId(soloLayerId === id ? undefined : id);
            }}
            onToggle={id => updateLayer(id, layer => ({ ...layer, enabled: !layer.enabled }))}
            editorControls={effectControls}
            onTag={id => {
              const layer = vfxDocument.layers.find(item => item.id === id);
              if (!layer) return;
              setRight(true);
              chat.current?.mentionEmitter(layer);
            }}
            onAdd={addEmitter}
            onTimingChange={(id, edge, value) => {
              playback.setPlaying(false);
              updateLayer(id, layer => ({ ...layer, [edge]: value }));
            }}
          />
        }
      />
      {importError && <div className="lab-import-error" role="alert">
        <span>{importError}</span>
        <IconButton name="close" label="Dismiss import error" onClick={() => setImportError("")} />
      </div>}
    </main>
  );
}

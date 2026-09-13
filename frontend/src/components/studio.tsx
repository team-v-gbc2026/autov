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
import V2Scene from "./studio/v2-scene";
import {
  createEmitter,
  normalizeVfxDocument,
  type VfxLayer,
  type VfxUiDocument,
} from "./vfx-studio/ui-model";
import {
  addLayer,
  applyDuration,
  applyEnvironment,
  applyLayerPatch,
  createDocument,
  projectToUi,
} from "@/lib/vfx-lab/ui-bridge";
import {
  isV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";
import { upgradeDocument } from "@/lib/vfx-lab/migrate";
import "./vfx-studio/studio-ui.css";

type StudioProps = {
  project: Project;
  userId: string;
  email: string;
  initialReferences: Reference[];
  initialGenerations: Generation[];
  versions: EffectVersion[];
  /** A v2 document to open the timeline on. Absent in the product workspace. */
  initialDocument?: VfxDocumentV2;
  /** Dev pages: no Supabase project behind the chat, generate locally only. */
  standalone?: boolean;
};

/**
 * Export the autov.lab/2 document when one exists — that is the real, lossless
 * effect — and the UI-dialect document only when the timeline is UI-only.
 */
function downloadDocument(document: VfxUiDocument | VfxDocumentV2) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  // Generated v2 names are free text, so keep the filename to safe characters.
  anchor.download = `${document.name.toLowerCase().replaceAll(" ", "-").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "effect"}.json`;
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
  initialDocument,
  standalone = false,
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
  // The autov.lab/2 document is the source of truth; the timeline, the emitter
  // rows and the controls all read a pure projection of it.
  const [doc, setDoc] = useState<VfxDocumentV2 | null>(initialDocument ?? null);
  // A JSON import in the UI dialect has no v2 document behind it, so it stays a
  // UI-only document (with the placeholder preview) until a generation or a
  // v1/v2 import replaces it.
  const [uiImport, setUiImport] = useState<VfxUiDocument | null>(null);
  const vfxDocument = useMemo(
    () => uiImport ?? projectToUi(doc),
    [uiImport, doc],
  );
  const [selectedLayerId, setSelectedLayerId] = useState(
    () => initialDocument?.layers[0]?.id ?? "",
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
  /** Every UI mutation is a patch; the bridge writes it into the v2 document. */
  const patchLayer = (id: string, patch: Partial<VfxLayer>) => {
    if (uiImport) {
      setUiImport(document => document && ({
        ...document,
        layers: document.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer),
      }));
      return;
    }
    setDoc(current => current && applyLayerPatch(current, id, patch));
  };
  const addEmitter = () => {
    if (uiImport) {
      const emitter = createEmitter(uiImport.layers.length + 1, uiImport.duration);
      setUiImport(document => document && ({ ...document, layers: [...document.layers, emitter] }));
      setSelectedLayerId(emitter.id);
      setSoloLayerId(undefined);
      return;
    }
    // An empty timeline has no v2 document yet: the first emitter creates one.
    // The bridge throws rather than hand back a document with no new layer.
    try {
      const next = doc
        ? addLayer(doc, doc.layers.length)
        : createDocument(project.name);
      setDoc(next);
      setSelectedLayerId(next.layers[next.layers.length - 1].id);
      setSoloLayerId(undefined);
      setImportError("");
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Could not add an emitter.",
      );
    }
  };
  /** A generated or imported v2 document becomes the new source of truth. */
  const openDocument = (next: VfxDocumentV2) => {
    setUiImport(null);
    setDoc(next);
    setSelectedLayerId(next.layers[0]?.id ?? "");
    setSoloLayerId(undefined);
    playback.setPlaying(false);
    playback.setTime(0);
  };
  const changeEnvironment = (patch: { bloom?: number; exposure?: number }) => {
    if (uiImport) {
      setUiImport(document => document && ({
        ...document,
        environment: { ...document.environment, ...patch },
      }));
      return;
    }
    setDoc(current => current && applyEnvironment(current, patch));
  };
  const effectControls = selectedLayer ? <EmitterControls layer={selectedLayer} onChange={patch => patchLayer(selectedLayer.id, patch)} /> : null;
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
            onChange={event => changeEnvironment({ bloom: Number(event.target.value) })}
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
            onChange={event => changeEnvironment({ exposure: Number(event.target.value) })}
          />
          <output htmlFor="environment-exposure">{vfxDocument.environment.exposure}</output>
        </label>
        <IconButton
          name="reset"
          label="Reset environment"
          onClick={() => changeEnvironment({ bloom: 64, exposure: 48 })}
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
            downloadDocument(doc ?? vfxDocument);
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
        {doc ? (
          <V2Scene doc={doc} time={playback.time} solo={soloLayerId} />
        ) : (
          <ParticleScene time={playback.time} />
        )}
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
            if (file.size > 4_000_000) throw new Error("Effect JSON must be under 4 MB.");
            const parsed = JSON.parse(await file.text());
            // autov.lab/2 and autov.lab/1 documents open in the renderer; the
            // older UI-only dialect still opens in the timeline alone.
            if (isV2(parsed) || parsed?.schemaVersion === "autov.lab/1") {
              openDocument(validateDocumentV2(upgradeDocument(parsed)));
            } else {
              const next = normalizeVfxDocument(parsed);
              setDoc(null);
              setUiImport(next);
              setSelectedLayerId(next.layers[0].id);
              setSoloLayerId(undefined);
              playback.setTime(0);
            }
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
          key={project.id}
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
            onDocument: openDocument,
            standalone,
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
          if (uiImport) setUiImport(document => document && ({ ...document, duration }));
          else setDoc(current => current && applyDuration(current, duration));
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
            selected={selectedLayer?.id ?? ""}
            solo={soloLayerId}
            onSelect={setSelectedLayerId}
            onSolo={id => {
              setSelectedLayerId(id);
              setSoloLayerId(soloLayerId === id ? undefined : id);
            }}
            onToggle={id => patchLayer(id, { enabled: !vfxDocument.layers.find(layer => layer.id === id)?.enabled })}
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
              patchLayer(id, { [edge]: value });
            }}
          />
        }
      />
      {importError && <div className="lab-import-error" role="alert">
        <span>{importError}</span>
        <IconButton name="close" label="Dismiss error" onClick={() => setImportError("")} />
      </div>}
    </main>
  );
}

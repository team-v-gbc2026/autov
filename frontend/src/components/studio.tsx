"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardLayout, referenceName } from "./studio/board/board-store";
import StudioHeader from "./studio/studio-header";
import ReferencesPanel from "./studio/references-panel";
import ChatPanel from "./studio/chat-panel";
import type { ChatPanelHandle } from "./studio/chat-panel";
import PlaybackPanel from "./studio/playback-panel";
import PanelToggle from "./studio/panel-toggle";
import Icon from "./studio/icon";
import IconButton from "./studio/icon-button";
import { PlaybackFrames, usePlaybackClock } from "./studio/playback-clock";
import { useReferences } from "./studio/use-references";
import { useLocalReferences } from "./vfx-lab/use-local-references";
import type {
  Project,
  Reference,
  Generation,
  EffectVersion,
} from "@/lib/project-types";
import EmitterTimeline from "./vfx-studio/emitter-timeline";
import EmitterControls from "./vfx-studio/emitter-controls";
import WorkspaceScene from "./studio/workspace-scene";
import StudioBackdrop from "./studio/studio-backdrop";
import { DEFAULT_BACKDROP_SETTINGS, type BackdropController, type BackdropSnapshot } from "@/lib/vfx-lab/backdrop-controller";
import type { PlacementController, PlacementSnapshot } from "@/lib/vfx-lab/placement-controller";
import { IDENTITY_PLACEMENT } from "@/lib/vfx-lab/placement";
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
  createWorkspaceDocument,
  projectToUi,
} from "@/lib/vfx-lab/ui-bridge";
import {
  isV2,
  validateWorkspaceDocumentV2,
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
  headerActions?: React.ReactNode;
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
  headerActions,
}: StudioProps) {
  const [backdropOpen, setBackdropOpen] = useState(false);
  const [backdropController, setBackdropController] = useState<BackdropController | null>(null);
  const [backdropSnapshot, setBackdropSnapshot] = useState<BackdropSnapshot>({ state: "empty", settings: DEFAULT_BACKDROP_SETTINGS, error: null, numSplats: null });
  const [placementController, setPlacementController] = useState<PlacementController | null>(null);
  const [placementSnapshot, setPlacementSnapshot] = useState<PlacementSnapshot>({
    placement: IDENTITY_PLACEMENT,
    mode: "translate",
    space: "world",
    visible: false,
    dragging: false,
    canUndo: false,
    editingOrigin: false,
  });
  const workspaceStorageKey = `autov.workspace.${encodeURIComponent(userId)}.${encodeURIComponent(project.id)}`;
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
  const [focusRequest, setFocusRequest] = useState(0);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [saving, setSaving] = useState(false);
  // The autov.lab/2 document is the source of truth; the timeline, the emitter
  // rows and the controls all read a pure projection of it.
  const [doc, setDoc] = useState<VfxDocumentV2>(() => initialDocument ? validateWorkspaceDocumentV2(initialDocument) : createWorkspaceDocument(project.name));
  // A JSON import in the UI dialect has no v2 document behind it, so it stays a
  // UI-only document (with the workspace environment visible) until a generation or a
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
  const clock = usePlaybackClock(vfxDocument.duration);
  const playback = clock.getSnapshot();
  const projectReferences = useReferences(project.id, userId, initialReferences);
  const localReferences = useLocalReferences(standalone);
  const references = standalone ? localReferences : projectReferences;

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
    setDoc(current => applyLayerPatch(current, id, patch));
  };
  const addEmitter = () => {
    if (uiImport) {
      const emitter = createEmitter(uiImport.layers.length + 1, uiImport.duration);
      setUiImport(document => document && ({ ...document, layers: [...document.layers, emitter] }));
      setSelectedLayerId(emitter.id);
      setSoloLayerId(undefined);
      return;
    }
    // Emitters are added to the existing workspace document and environment.
    try {
      const next = addLayer(doc, doc.layers.length);
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
    placementController?.cancelOriginEdit();
    setUiImport(null);
    setDoc(validateWorkspaceDocumentV2(next));
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
    setDoc(current => applyEnvironment(current, patch));
  };
  const effectControls = selectedLayer ? <EmitterControls layer={selectedLayer} onChange={patch => patchLayer(selectedLayer.id, patch)} /> : null;
  const environmentControls = (
    <section ref={environmentPanel} className="glass lab-environment-strip" aria-label="Scene controls"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEnvironmentOpen(false);
      }}
    >
      <IconButton name="focus" label="Focus" onClick={() => setFocusRequest(value => value + 1)} />
      <button
        ref={environmentTrigger}
        type="button"
        className="icon-button"
        aria-label="Environment settings"
        title="Environment settings"
        aria-expanded={environmentOpen}
        aria-controls="environment-settings"
        onClick={() => setEnvironmentOpen(open => !open)}
      >
        <Icon name="environment" />
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
      <button type="button" className="icon-button" aria-haspopup="dialog" aria-controls="studio-backdrop" aria-expanded={backdropOpen} onClick={() => { setEnvironmentOpen(false); setBackdropOpen(true); }}>Backdrop</button>
      {/* Placement moves the whole effect in the workspace. It is viewer state:
          dragging never edits or regenerates the effect document. */}
      <div className="lab-placement-controls" role="group" aria-label="Effect placement">
        <button type="button" className="icon-button"
          disabled={!placementController || placementSnapshot.dragging}
          aria-pressed={placementSnapshot.editingOrigin}
          onClick={() => placementSnapshot.editingOrigin ? placementController?.cancelOriginEdit() : placementController?.beginOriginEdit()}>
          {placementSnapshot.editingOrigin ? "Cancel origin edit" : "Set effect origin"}
        </button>
        {placementSnapshot.editingOrigin && <>
          <span className="lab-origin-hint" role="status">Move the marker to the source; point its arrow forward. Apply aligns it to placement.</span>
          <button type="button" className="icon-button" disabled={placementSnapshot.dragging}
            onClick={() => {
              const authoringFrame = placementController?.finishOriginEdit();
              if (authoringFrame) setDoc(current => validateWorkspaceDocumentV2({ ...current, authoringFrame }));
            }}>Apply origin</button>
        </>}

        <button
          type="button"
          className="icon-button"
          aria-pressed={placementSnapshot.visible}
          disabled={!placementController || placementSnapshot.editingOrigin}
          onClick={() => placementController?.setVisible(!placementSnapshot.visible)}
        >
          Place
        </button>
        {/* Always rendered, disabled until the handle is shown: hiding the mode
            buttons until then leaves no way to discover that rotation exists. */}
        <button
          type="button"
          className="icon-button"
          aria-pressed={placementSnapshot.mode === "translate"}
          disabled={!placementController || !placementSnapshot.visible}
          onClick={() => placementController?.setMode("translate")}
        >
          Move
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={placementSnapshot.mode === "rotate"}
          disabled={!placementController || !placementSnapshot.visible}
          onClick={() => placementController?.setMode("rotate")}
        >
          Rotate
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={placementSnapshot.space === "local"}
          disabled={!placementController || !placementSnapshot.visible}
          title={placementSnapshot.space === "local" ? "Rotating around the effect's own axes" : "Rotating around workspace axes"}
          onClick={() =>
            placementController?.setSpace(placementSnapshot.space === "local" ? "world" : "local")
          }
        >
          {placementSnapshot.space === "local" ? "Local" : "World"}
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!placementController || !placementSnapshot.canUndo}
          onClick={() => placementController?.undo()}
        >
          Undo
        </button>
        <IconButton
          name="reset"
          label="Reset placement"
          onClick={() => placementController?.reset()}
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
            downloadDocument(uiImport ?? doc);
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
        <WorkspaceScene focusRequest={focusRequest} doc={doc} clock={clock} solo={soloLayerId}
          backdropStorageKey={`${workspaceStorageKey}.backdrop.v1`} onBackdropReady={setBackdropController} onBackdropChange={setBackdropSnapshot}
          placementStorageKey={`${workspaceStorageKey}.placement.v1`} onPlacementReady={setPlacementController} onPlacementChange={setPlacementSnapshot} />
      </div>
      <StudioHeader
        project={project}
        email={email}
        actions={headerActions}
      />
      {environmentControls}
      <StudioBackdrop key={workspaceStorageKey} open={backdropOpen} onClose={() => setBackdropOpen(false)} controller={backdropController} snapshot={backdropSnapshot} cleanImageStorageKey={`${workspaceStorageKey}.clean-image.v1`} />
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
              openDocument(isV2(parsed) ? parsed : upgradeDocument(parsed));
            } else {
              const next = normalizeVfxDocument(parsed);
              setDoc(current => ({ ...current, layers: [] }));
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
            selectedEmitterId: selectedLayerId,
            onDocument: openDocument,
            standalone,
          }}
        />
      </div>
      <PlaybackFrames clock={clock}>{playback => <PlaybackPanel
        playback={playback}
        effectName={vfxDocument.name}
        onEffectNameChange={name => {
          if (uiImport) setUiImport(document => document && ({ ...document, name }));
          else setDoc(document => ({ ...document, name }));
        }}
        duration={vfxDocument.duration}
        minDuration={Math.max(0.01, ...vfxDocument.layers.flatMap(layer => [layer.end, ...layer.edits.map(edit => edit.end)]))}
        onDurationChange={duration => {
          playback.setPlaying(false);
          playback.setTime(Math.min(playback.time, duration));
          if (uiImport) setUiImport(document => document && ({ ...document, duration }));
          else setDoc(current => applyDuration(current, duration));
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
            onDelete={id => {
              if (uiImport) {
                setUiImport(current => current && ({ ...current, layers: current.layers.filter(layer => layer.id !== id) }));
              } else {
                setDoc(current => {
                  const layers = current.layers.filter(layer => layer.id !== id);
                  return { ...current, layers };
                });
              }
              setSelectedLayerId(current => current === id ? vfxDocument.layers.find(layer => layer.id !== id)?.id ?? "" : current);
              setSoloLayerId(current => current === id ? undefined : current);
            }}
            onAdd={addEmitter}
            onTimingChange={(id, edge, value) => {
              playback.setPlaying(false);
              patchLayer(id, { [edge]: value });
            }}
          />
        }
      />}</PlaybackFrames>
      {importError && <div className="lab-import-error" role="alert">
        <span>{importError}</span>
        <IconButton name="close" label="Dismiss error" onClick={() => setImportError("")} />
      </div>}
    </main>
  );
}

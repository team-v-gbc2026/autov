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
import {
  useStudioDocument,
  type BrowserOperation,
} from "./studio/use-studio-document";
import { useReferences } from "./studio/use-references";
import type {
  Project,
  Reference,
  Generation,
  EffectVersion,
} from "@/lib/project-types";
import EmitterTimeline from "./vfx-studio/emitter-timeline";
import EmitterControls from "./vfx-studio/emitter-controls";
import AuthoringPanel from "./vfx-studio/authoring-panel";
import WorkspaceScene from "./studio/workspace-scene";
import WebGpuGate from "./studio/webgpu-gate";
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
  validateWorkspaceDocumentV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";
import { saveProjectThumbnail } from "@/lib/project-thumbnail";
import { parseMentions } from "@/lib/studio-tools/mentions";
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
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const environmentPanel = useRef<HTMLElement>(null);
  const environmentTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!environmentOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!environmentPanel.current?.contains(event.target as Node))
        setEnvironmentOpen(false);
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
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  // The autov.lab/2 document is the source of truth; the timeline, the emitter
  // rows and the controls all read a pure projection of it.
  const [selectedLayerId, setSelectedLayerId] = useState(
    () => initialDocument?.layers[0]?.id ?? "",
  );
  const [soloLayerId, setSoloLayerId] = useState<string>();
  const references = useReferences(project.id, userId, initialReferences);
  const [referenceFocus, setReferenceFocus] = useState<{
    id: string;
    sequence: number;
  }>();
  const [emitterFocus, setEmitterFocus] = useState<{
    id: string;
    sequence: number;
  }>();
  const focusReference = (id: string) => {
    setLeft(true);
    setReferenceFocus({ id, sequence: Date.now() });
  };
  const focusEmitter = (id: string) => {
    setSelectedLayerId(id);
    setEmitterFocus({ id, sequence: Date.now() });
  };
  const browserHandler = useRef<
    (
      operation: BrowserOperation,
      currentDocument: VfxDocumentV2,
    ) => Promise<Record<string, unknown>>
  >(async () => {
    throw new Error("Studio is starting.");
  });
  const synced = useStudioDocument(
    project.id,
    () =>
      initialDocument
        ? validateWorkspaceDocumentV2(initialDocument)
        : createWorkspaceDocument(project.name),
    standalone,
    (operation, currentDocument) =>
      browserHandler.current(operation, currentDocument),
    references.reconcileAssets,
  );
  const { document: doc, setDoc } = synced;
  // A JSON import in the UI dialect has no v2 document behind it, so it stays a
  // UI-only document (with the workspace environment visible) until a generation or a
  // V2 import replaces it.
  const [uiImport, setUiImport] = useState<VfxUiDocument | null>(null);
  const vfxDocument = useMemo(
    () => uiImport ?? projectToUi(doc),
    [uiImport, doc],
  );
  // References mentioned while building this effect: saved generation prompts
  // and per-layer scoped edits are the only record of which board images a
  // prompt drew on, since the document itself doesn't persist that link.
  const usedReferences = useMemo(() => {
    const prompts = [
      ...initialGenerations.map((generation) => generation.prompt),
      ...vfxDocument.layers.flatMap((layer) =>
        layer.edits.map((edit) => edit.prompt),
      ),
    ];
    const ids = new Set(
      prompts.flatMap((prompt) =>
        parseMentions(prompt).flatMap((token) =>
          token.type === "reference" ? [token.id] : [],
        ),
      ),
    );
    return references.references.filter((reference) => ids.has(reference.id));
  }, [initialGenerations, vfxDocument, references.references]);
  const [importError, setImportError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const clock = usePlaybackClock(vfxDocument.duration);
  const playback = clock.getSnapshot();
  useEffect(() => {
    browserHandler.current = async (operation, currentDocument) => {
      if (operation.kind === "reference_view")
        focusReference(String(operation.input.referenceId));
      if (operation.kind === "view") {
        const input = operation.input;
        if (typeof input.layerId === "string") focusEmitter(input.layerId);
        if (typeof input.solo === "boolean")
          setSoloLayerId(
            input.solo ? String(input.layerId || selectedLayerId) : undefined,
          );
        if (typeof input.playing === "boolean")
          playback.setPlaying(input.playing);
        if (typeof input.time === "number") playback.setTime(input.time);
      }
      if (["preview", "capture_candidate"].includes(operation.kind)) {
        const { captureV2 } = await import("@/lib/vfx-lab/capture-v2");
        const captureDoc =
          operation.kind === "capture_candidate"
            ? validateWorkspaceDocumentV2(operation.input.document)
            : currentDocument;
        const evidence = await captureV2(captureDoc, {
          motionEvidence: false,
          solo:
            typeof operation.input.layerId === "string"
              ? operation.input.layerId
              : undefined,
          times: operation.input.times as number[] | undefined,
        });
        if (operation.kind === "capture_candidate" && !standalone)
          await saveProjectThumbnail(project.id, evidence.sheet).catch(
            () => undefined,
          );
        return {
          sheet: evidence.sheet,
          times: evidence.times,
          renderedPixels: evidence.renderedPixels || 0,
        };
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {};
    };
  });

  const { layout } = useBoardLayout(project.id);
  const chat = useRef<ChatPanelHandle>(null);
  const displayReferences = useMemo(
    () =>
      references.references.map((ref) => ({
        ...ref,
        name: layout[ref.id]?.name || referenceName(ref.name),
      })),
    [references.references, layout],
  );
  const boardState = { ...references, references: displayReferences };
  const mention = (reference: Reference) => {
    setRight(true);
    chat.current?.mention(reference);
  };
  const selectedLayer =
    vfxDocument.layers.find((layer) => layer.id === selectedLayerId) ||
    vfxDocument.layers[0];
  /** Every UI mutation is a patch; the bridge writes it into the v2 document. */
  const patchLayer = (id: string, patch: Partial<VfxLayer>) => {
    if (uiImport) {
      setUiImport(
        (document) =>
          document && {
            ...document,
            layers: document.layers.map((layer) =>
              layer.id === id ? { ...layer, ...patch } : layer,
            ),
          },
      );
      return;
    }
    setDoc((current) => applyLayerPatch(current, id, patch));
  };
  const addEmitter = () => {
    if (uiImport) {
      const emitter = createEmitter(
        uiImport.layers.length + 1,
        uiImport.duration,
      );
      setUiImport(
        (document) =>
          document && { ...document, layers: [...document.layers, emitter] },
      );
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
    setUiImport(null);
    setDoc(validateWorkspaceDocumentV2(next));
    setSelectedLayerId(next.layers[0]?.id ?? "");
    setSoloLayerId(undefined);
    playback.setPlaying(false);
    playback.setTime(0);
  };
  const changeEnvironment = (patch: { bloom?: number; exposure?: number }) => {
    if (uiImport) {
      setUiImport(
        (document) =>
          document && {
            ...document,
            environment: { ...document.environment, ...patch },
          },
      );
      return;
    }
    setDoc((current) => applyEnvironment(current, patch));
  };
  const selectedRuntimeLayer = uiImport
    ? undefined
    : (doc.layers.find((layer) => layer.id === selectedLayerId) ??
      doc.layers[0]);
  const effectControls = selectedLayer ? (
    uiImport || !selectedRuntimeLayer ? (
      <EmitterControls
        layer={selectedLayer}
        onChange={(patch) => patchLayer(selectedLayer.id, patch)}
      />
    ) : (
      <AuthoringPanel
        document={doc}
        layer={selectedRuntimeLayer}
        onChange={(next) =>
          setDoc((current) => ({
            ...current,
            layers: current.layers.map((layer) =>
              layer.id === next.id ? next : layer,
            ),
          }))
        }
      />
    )
  ) : null;
  const environmentControls = (
    <section
      ref={environmentPanel}
      className="glass lab-environment-strip"
      aria-label="Scene controls"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setEnvironmentOpen(false);
      }}
    >
      <IconButton
        name="focus"
        label="Focus"
        onClick={() => setFocusRequest((value) => value + 1)}
      />
      <button
        ref={environmentTrigger}
        type="button"
        className="icon-button"
        aria-label="Environment settings"
        title="Environment settings"
        aria-expanded={environmentOpen}
        aria-controls="environment-settings"
        onClick={() => setEnvironmentOpen((open) => !open)}
      >
        <Icon name="environment" />
      </button>
      <div
        id="environment-settings"
        className="lab-environment-panel"
        hidden={!environmentOpen}
      >
        <label className="lab-environment-field">
          Bloom
          <input
            type="range"
            aria-label="Bloom"
            min="0"
            max="100"
            id="environment-bloom"
            value={vfxDocument.environment.bloom}
            onChange={(event) =>
              changeEnvironment({ bloom: Number(event.target.value) })
            }
          />
          <output htmlFor="environment-bloom">
            {vfxDocument.environment.bloom}
          </output>
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
            onChange={(event) =>
              changeEnvironment({ exposure: Number(event.target.value) })
            }
          />
          <output htmlFor="environment-exposure">
            {vfxDocument.environment.exposure}
          </output>
        </label>
        <IconButton
          name="reset"
          label="Reset environment"
          onClick={() => changeEnvironment({ bloom: 64, exposure: 48 })}
        />
      </div>
      <div className="lab-scene-export">
        <IconButton
          name="reset"
          label="Reset effect"
          disabled={saving || !synced.ready}
          onClick={() => {
            setEnvironmentOpen(false);
            openDocument(createWorkspaceDocument(project.name));
            setEmitterFocus(undefined);
            setImportError("");
          }}
        />
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
          label="Export for another AI agent (JSON + reference stills + clip)"
          disabled={handoffBusy}
          onClick={async () => {
            setEnvironmentOpen(false);
            setHandoffError("");
            setHandoffBusy(true);
            try {
              const { buildAgentHandoffBundle, zipFiles } = await import(
                "@/lib/vfx-lab/agent-handoff"
              );
              const bundle = await buildAgentHandoffBundle(doc, {
                references: usedReferences,
              });
              const zip = await zipFiles(bundle.files);
              const url = URL.createObjectURL(zip);
              const anchor = window.document.createElement("a");
              anchor.href = url;
              anchor.download = `${
                doc.name
                  .toLowerCase()
                  .replaceAll(" ", "-")
                  .replace(/[^a-z0-9-]+/g, "-")
                  .replace(/^-+|-+$/g, "") || "effect"
              }-agent-handoff.zip`;
              anchor.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (error) {
              setHandoffError(
                error instanceof Error ? error.message : "Handoff export failed.",
              );
            } finally {
              setHandoffBusy(false);
            }
          }}
        />
      </div>
      {handoffError && <p className="lab-scene-export-error">{handoffError}</p>}
    </section>
  );

  return (
    <WebGpuGate>
    <main
      className={`studio lab ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <div className="lab-preview-stage">
        <WorkspaceScene
          focusRequest={focusRequest}
          doc={doc}
          clock={clock}
          solo={soloLayerId}
          loaded={synced.ready}
        />
      </div>
      <StudioHeader project={project} email={email} actions={headerActions} />
      {environmentControls}
      <input
        ref={importInput}
        hidden
        type="file"
        accept=".json,application/json"
        aria-label="Import effect JSON"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setImportError("");
          try {
            if (file.size > 4_000_000)
              throw new Error("Effect JSON must be under 4 MB.");
            const parsed = JSON.parse(await file.text());
            // autov.lab/2 documents open in the renderer; the older UI-only
            // dialect still opens in the timeline alone.
            if (parsed?.schemaVersion === "autov.lab/2") {
              openDocument(validateWorkspaceDocumentV2(parsed));
            } else {
              const next = normalizeVfxDocument(parsed);
              setDoc((current) => ({ ...current, layers: [] }));
              setUiImport(next);
              setSelectedLayerId(next.layers[0].id);
              setSoloLayerId(undefined);
              playback.setTime(0);
            }
          } catch (error) {
            setImportError(
              error instanceof Error
                ? error.message
                : "Could not import this JSON file.",
            );
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
        <ReferencesPanel
          focusRequest={referenceFocus}
          projectId={project.id}
          state={boardState}
          onMention={mention}
          locked={saving}
          onCollapse={() => setLeft(false)}
        />
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
          busy={references.busy || !synced.ready}
          saving={saving}
          setSaving={setSaving}
          onCollapse={() => setRight(false)}
          vfx={{
            document: vfxDocument,
            selectedEmitterId: selectedLayerId,
            onDocument: (generated) =>
              openDocument(generated),
            standalone,
            beforeSend: async () => {
              if (uiImport)
                throw new Error(
                  "Import a v2 effect before using studio tools.",
                );
              await synced.flush();
            },
            onReference: focusReference,
            onEmitter: focusEmitter,
          }}
        />
      </div>
      <PlaybackFrames clock={clock}>
        {(playback) => (
          <PlaybackPanel
            playback={playback}
            effectName={vfxDocument.name}
            onEffectNameChange={(name) => {
              if (uiImport)
                setUiImport((document) => document && { ...document, name });
              else setDoc((document) => ({ ...document, name }));
            }}
            duration={vfxDocument.duration}
            minDuration={Math.max(
              0.01,
              ...vfxDocument.layers.flatMap((layer) => [
                layer.end,
                ...layer.edits.map((edit) => edit.end),
              ]),
            )}
            onDurationChange={(duration) => {
              playback.setPlaying(false);
              playback.setTime(Math.min(playback.time, duration));
              if (uiImport)
                setUiImport(
                  (document) => document && { ...document, duration },
                );
              else setDoc((current) => applyDuration(current, duration));
            }}
            tracks={
              <EmitterTimeline
                focusRequest={emitterFocus}
                layers={vfxDocument.layers}
                duration={vfxDocument.duration}
                time={playback.time}
                onSeek={(time) => {
                  playback.setPlaying(false);
                  playback.setTime(time);
                }}
                selected={selectedLayer?.id ?? ""}
                solo={soloLayerId}
                onSelect={setSelectedLayerId}
                onSolo={(id) => {
                  setSelectedLayerId(id);
                  setSoloLayerId(soloLayerId === id ? undefined : id);
                }}
                onToggle={(id) =>
                  patchLayer(id, {
                    enabled: !vfxDocument.layers.find(
                      (layer) => layer.id === id,
                    )?.enabled,
                  })
                }
                editorControls={effectControls}
                onTag={(id) => {
                  const layer = vfxDocument.layers.find(
                    (item) => item.id === id,
                  );
                  if (!layer) return;
                  setRight(true);
                  chat.current?.mentionEmitter(layer);
                }}
                onDelete={(id) => {
                  if (uiImport) {
                    setUiImport(
                      (current) =>
                        current && {
                          ...current,
                          layers: current.layers.filter(
                            (layer) => layer.id !== id,
                          ),
                        },
                    );
                  } else {
                    setDoc((current) => {
                      const layers = current.layers.filter(
                        (layer) => layer.id !== id,
                      );
                      return { ...current, layers };
                    });
                  }
                  setSelectedLayerId((current) =>
                    current === id
                      ? (vfxDocument.layers.find((layer) => layer.id !== id)
                          ?.id ?? "")
                      : current,
                  );
                  setSoloLayerId((current) =>
                    current === id ? undefined : current,
                  );
                }}
                onAdd={addEmitter}
                onTimingChange={(id, edge, value) => {
                  playback.setPlaying(false);
                  patchLayer(id, { [edge]: value });
                }}
              />
            }
          />
        )}
      </PlaybackFrames>
      {synced.error && (
        <div className="lab-import-error" role="alert">
          <span>
            {synced.error} Your local edits are preserved; export them before
            reloading if there is a conflict.
          </span>
        </div>
      )}
      {importError && (
        <div className="lab-import-error" role="alert">
          <span>{importError}</span>
          <IconButton
            name="close"
            label="Dismiss error"
            onClick={() => setImportError("")}
          />
        </div>
      )}
    </main>
    </WebGpuGate>
  );
}

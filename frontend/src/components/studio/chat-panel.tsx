"use client";
import { useRef, useState, useImperativeHandle, type Ref } from "react";
import ChatEmptyState from "./chat-empty-state";
import { savePrompt } from "@/app/workspace/actions";
import type { Generation, EffectVersion } from "@/lib/project-types";
import ReferenceComposer, { type ComposerHandle } from "./composer/reference-composer";
import { displayPrompt } from "./composer/prompt-format";
import type { Reference } from "@/lib/project-types";
import { iconButton as button } from "./icon-button";
import type {
  ScopedEdit,
  VfxLayer,
  VfxUiDocument,
} from "@/components/vfx-studio/ui-model";

export type ChatPanelHandle = ComposerHandle & {
  editLayer: (id: string) => void;
};

type VfxEditing = {
  document: VfxUiDocument;
  selectedId: string;
  onSelect: (id: string) => void;
  onScopedEdit: (layerId: string, edit: ScopedEdit) => void;
};

export default function ChatPanel({
  projectId,
  initialGenerations,
  versions,
  references,
  uploadFile,
  ref,
  busy,
  onCollapse,
  saving,
  setSaving,
  vfx,
}: {
  projectId: string;
  initialGenerations: Generation[];
  versions: EffectVersion[];
  references: Reference[];
  uploadFile: (file: File) => Promise<Reference>;
  ref: Ref<ChatPanelHandle>;
  busy: boolean;
  onCollapse: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
  vfx?: VfxEditing;
}) {
  const composer = useRef<ComposerHandle>(null);
  const [editMode, setEditMode] = useState(false);
  const [quality, setQuality] = useState<"quality" | "fast">("quality");
  const firstLayer = vfx?.document.layers[0];
  const selectedLayer =
    vfx?.document.layers.find((layer) => layer.id === vfx.selectedId) ||
    firstLayer;
  const [editStart, setEditStart] = useState(selectedLayer?.start || 0);
  const [editEnd, setEditEnd] = useState(selectedLayer?.end || 1);
  const chooseEditLayer = (layer: VfxLayer) => {
    vfx?.onSelect(layer.id);
    setEditStart(Number(layer.start.toFixed(3)));
    setEditEnd(Number(layer.end.toFixed(3)));
  };
  useImperativeHandle(ref, () => ({
    mention: reference => composer.current?.mention(reference),
    setText: text => composer.current?.setText(text),
    editLayer: id => {
      const layer = vfx?.document.layers.find(item => item.id === id);
      if (!layer) return;
      chooseEditLayer(layer);
      setEditMode(true);
    },
  }));
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState(initialGenerations);
  const [loaded, setLoaded] = useState(initialGenerations);
  if (loaded !== initialGenerations) {
    setLoaded(initialGenerations);
    setMessages(initialGenerations);
  }
  const scopedEdits = vfx?.document.layers.flatMap(layer =>
    layer.edits.map(edit => ({ layer, edit })),
  ) || [];
  const hasHistory = messages.length > 0 || versions.length > 0 || scopedEdits.length > 0;
  return (
    <aside className="glass chat-panel">
      <div className="panel-heading">
        <div>
          <h2>Chat</h2>
        </div>
        <div>{button("panel", "Collapse creative assistant", onCollapse)}</div>
      </div>
      <div className={`chat-content ${hasHistory ? "" : "chat-content-empty"}`}>
        {!hasHistory && <ChatEmptyState disabled={saving} onSelect={value => { composer.current?.setText(value); }} />}
        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id}>
              <p className="user-message">{displayPrompt(message.prompt)}</p>
              <p className="assistant-message">
                {message.status === "draft"
                  ? "Prompt saved."
                  : message.status === "failed"
                    ? "Generation failed."
                    : `Generation ${message.status}.`}
              </p>
            </div>
          ))}
          {versions.map((version) => (
            <a
              className="effect-download"
              key={version.id}
              href={`/api/effects/${version.id}`}
            >
              Download effect JSON · {version.schema_version} ↓
            </a>
          ))}
          {scopedEdits.map(({ layer, edit }) => (
            <div key={edit.id} className="scoped-edit-message">
              <p className="user-message">{edit.prompt}</p>
              <p className="assistant-message">
                Scoped edit added to {layer.name} · {edit.start.toFixed(2)}–{edit.end.toFixed(2)} s.
              </p>
            </div>
          ))}
          {notice && (
            <p className="account-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      {vfx && selectedLayer && (
        <div className="lab-chat-options">
          <div className="lab-control-row">
            <select
              className="lab-mode"
              aria-label="Chat action"
              value={editMode ? "edit" : "generate"}
              disabled={saving}
              onChange={event => {
                const editing = event.target.value === "edit";
                if (editing) chooseEditLayer(selectedLayer);
                setEditMode(editing);
              }}
            >
              <option value="generate">Generate effect</option>
              <option value="edit">Edit selected emitter</option>
            </select>
            {!editMode && (
              <select
                className="lab-mode"
                aria-label="Generation quality"
                value={quality}
                disabled={saving}
                onChange={event => setQuality(event.target.value as typeof quality)}
              >
                <option value="quality">Quality · 3 directions</option>
                <option value="fast">Quick · 1 direction</option>
              </select>
            )}
          </div>
          {editMode && (
            <div className="lab-edit-scope">
              <label className="lab-field lab-edit-layer">
                Emitter
                <select
                  aria-label="Edit emitter"
                  value={selectedLayer.id}
                  disabled={saving}
                  onChange={event => {
                    const layer = vfx.document.layers.find(item => item.id === event.target.value);
                    if (layer) chooseEditLayer(layer);
                  }}
                >
                  {vfx.document.layers.map(layer => (
                    <option key={layer.id} value={layer.id}>{layer.name}</option>
                  ))}
                </select>
              </label>
              <div className="lab-control-row">
                <label className="lab-field">
                  From (s)
                  <input
                    aria-label="Edit start"
                    type="number"
                    min="0"
                    max={vfx.document.duration}
                    step="0.01"
                    value={editStart}
                    disabled={saving}
                    onChange={event => setEditStart(Number(event.target.value))}
                  />
                </label>
                <label className="lab-field">
                  To (s)
                  <input
                    aria-label="Edit end"
                    type="number"
                    min="0"
                    max={vfx.document.duration}
                    step="0.01"
                    value={editEnd}
                    disabled={saving}
                    onChange={event => setEditEnd(Number(event.target.value))}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
      <ReferenceComposer ref={composer} references={references} uploadFile={uploadFile} busy={busy} saving={saving} sendLabel={editMode ? "Add scoped emitter edit" : "Save prompt"} onSend={async (prompt, referenceIds) => {
        if (editMode && vfx && selectedLayer) {
          if (
            !Number.isFinite(editStart) ||
            !Number.isFinite(editEnd) ||
            editStart < 0 ||
            editStart >= editEnd ||
            editEnd > vfx.document.duration
          ) {
            setNotice(`Choose a start before the end, within 0.00–${vfx.document.duration.toFixed(2)} seconds.`);
            return false;
          }
          vfx.onScopedEdit(selectedLayer.id, {
            id: crypto.randomUUID(),
            prompt,
            start: editStart,
            end: editEnd,
          });
          setNotice("");
          return true;
        }
        if (saving || busy) return false;
        setSaving(true); setNotice("");
        try {
          const result = await savePrompt(projectId, prompt, referenceIds);
          if (result.error) { setNotice(result.error); return false; }
          if (result.generation) { setMessages(items => [...items, result.generation]); return true; }
          return false;
        } catch { setNotice("Could not save your prompt. Please try again."); return false; }
        finally { setSaving(false); }
      }} />
      <div className="chat-footnote">
        {editMode
          ? "Emitter and time range are attached to this edit request."
          : "Generation not connected. Prompts are saved for later."}
      </div>
    </aside>
  );
}

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useStudioDocument } from "../../src/components/studio/use-studio-document";
import ChatMessage, { ChatTargets } from "../../src/components/studio/chat-message";
import EmitterTimeline from "../../src/components/vfx-studio/emitter-timeline";
import EmitterControls from "../../src/components/vfx-studio/emitter-controls";
import MoodBoard from "../../src/components/studio/board/mood-board";
import { createWorkspaceDocument, projectToUi } from "../../src/lib/vfx-lab/ui-bridge";
import type { Reference } from "../../src/lib/project-types";
import type { VfxDocumentV2 } from "../../src/lib/vfx-lab/schema-v2";
import type { BrowserOperation } from "../../src/components/studio/use-studio-document";
import "../../src/components/vfx-studio/studio-ui.css";
const projectId = "10000000-0000-4000-8000-000000000001";
function Harness() {
  const [references, setReferences] = useState<Reference[]>([]);
  const [selected, select] = useState("");
  const [focus, setFocus] = useState<{ id: string; sequence: number }>();
  const [referenceFocus, setReferenceFocus] = useState<{ id: string; sequence: number }>();
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const focusEmitter = (id: string) => { select(id); setFocus({ id, sequence: Date.now() }); };
  const handle = async (operation: BrowserOperation) => {
    if (operation.kind === "view") focusEmitter(String(operation.input.layerId));
    if (operation.kind === "reference_view") setReferenceFocus({ id: String(operation.input.referenceId), sequence: Date.now() });
    if (operation.kind === "preview" || operation.kind === "capture_candidate") return { sheet: references[0]?.url, times: [0.2], renderedPixels: 400 };
    return {};
  };
  const synced = useStudioDocument(projectId, () => createWorkspaceDocument("Empty"), false, handle, async assets => {
    if (assets.length) setReferences(assets.map(asset => ({ id: asset.id, name: asset.name, url: asset.storage_path, type: asset.mime_type })));
  });
  const ui = projectToUi(synced.document);
  const layer = ui.layers.find(item => item.id === selected) || ui.layers[0];
  const command = async (action: string) => {
    await synced.flush();
    const response = await fetch(`/test/${action}`, { method: "POST" });
    const result = await response.json();
    if (result.message) setMessage(result.message);
    setStatus(action);
  };
  return <main>
    <output data-testid="document">{JSON.stringify(synced.document)}</output>
    <output data-testid="ready">{String(synced.ready)}</output>
    <output data-testid="status">{status}</output>
    <output role="alert">{synced.error}</output>
    <input type="file" aria-label="Upload reference" onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const url = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      const ref = { id: "20000000-0000-4000-8000-000000000001", name: "Smoke reference", url, type: file.type };
      setReferences([ref]); await fetch("/test/reference", { method: "POST", body: JSON.stringify(ref) });
    }} />
    <button onClick={() => void command("generate")}>Generate from reference</button>
    <button onClick={() => void command("edit")}>Edit smoke</button>
    <button onClick={() => void command("preview")}>Preview effect</button>
    <button onClick={() => void command("undo")}>Undo agent edit</button>
    <button onClick={() => synced.setDoc(current => ({ ...current, name: "Manual edit" }))}>Manual edit</button>
    <button onClick={() => void command("conflict")}>Delayed generation</button>
    <button onClick={() => void synced.flush().catch(() => {})}>Save edits</button>
    <ChatTargets.Provider value={{ references, emitters: ui.layers, onReference: id => setReferenceFocus({ id, sequence: Date.now() }), onEmitter: focusEmitter }}><ChatMessage role="assistant" text={message} /></ChatTargets.Provider>
    <div style={{ position: "relative", height: 400, width: 500 }}>
      <MoodBoard projectId={projectId} focusRequest={referenceFocus} state={{ references, busy: false, error: "", setError: () => {}, addFiles: async () => {}, uploadFile: async () => { throw new Error("Use test uploader"); }, removeReference: async () => {}, refresh: () => {} }} onMention={() => {}} locked={false} onCollapse={() => {}} />
    </div>
    <output data-testid="reference-focus">{referenceFocus?.id}</output>
    <EmitterTimeline layers={ui.layers} duration={ui.duration} time={0} selected={selected} focusRequest={focus} onSelect={select} onSolo={() => {}} onToggle={() => {}} onAdd={() => {}} onDelete={() => {}} onTag={() => {}} onTimingChange={() => {}} onSeek={() => {}} editorControls={layer ? <EmitterControls layer={layer} onChange={() => {}} /> : null} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
export type { VfxDocumentV2 };

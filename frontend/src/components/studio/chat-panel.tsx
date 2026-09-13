"use client";
import { useRef, useState, useImperativeHandle, type Ref } from "react";
import ChatEmptyState from "./chat-empty-state";
import { savePrompt } from "@/app/workspace/actions";
import type { Generation, EffectVersion } from "@/lib/project-types";
import ReferenceComposer, { type ComposerHandle } from "./composer/reference-composer";
import { displayPrompt } from "./composer/prompt-format";
import type { Reference } from "@/lib/project-types";
import { iconButton as button } from "./icon-button";
import Icon from "./icon";
import type { VfxUiDocument } from "@/components/vfx-studio/ui-model";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import { useLocalGeneration } from "./use-local-generation";
import {
  MAX_PROMPT_REFERENCES,
  MAX_REFERENCE_CHARACTERS,
  referenceInput,
} from "@/lib/vfx-lab/reference-input";
import { prepareReference } from "@/components/vfx-lab/use-local-references";

export type ChatPanelHandle = ComposerHandle;
type VfxEditing = {
  document: VfxUiDocument;
  /** Receives the autov.lab/2 document a local generation produced. */
  onDocument?: (doc: VfxDocumentV2) => void;
  /** Dev pages have no Supabase project: skip the prompt save and only run local generation. */
  standalone?: boolean;
};

/** `crypto.randomUUID` needs a secure context; local ids only need to be unique. */
const localId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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
  useImperativeHandle(ref, () => ({
    mention: reference => composer.current?.mention(reference),
    mentionEmitter: emitter => composer.current?.mentionEmitter(emitter),
    setText: text => composer.current?.setText(text),
  }));
  const [notice, setNotice] = useState("");
  // Local generation progress, kept next to the saved prompts without touching
  // the Supabase-backed `Generation` type.
  const [progress, setProgress] = useState<{ id: string; text: string }[]>([]);
  const say = (text: string) =>
    setProgress(items =>
      [...items, { id: localId(), text }].slice(-40),
    );
  const generation = useLocalGeneration({
    onDocument: document => vfx?.onDocument?.(document),
    onProgress: say,
  });
  const [messages, setMessages] = useState(initialGenerations);
  const [loaded, setLoaded] = useState(initialGenerations);
  if (loaded !== initialGenerations) {
    setLoaded(initialGenerations);
    setMessages(initialGenerations);
  }
  /**
   * Run the v2 pipeline for a prompt that was just saved. The `#[name](emitter:id)`
   * tags stay in the prompt text verbatim: scoped, per-emitter v2 edits are a
   * follow-up, so for now the model simply reads the emitter names.
   */
  const runGeneration = async (prompt: string, referenceIds: string[]) => {
    let images: string[];
    try {
      const input = referenceInput(
        prompt,
        referenceIds.slice(0, MAX_PROMPT_REFERENCES),
        references,
      );
      images = await Promise.all(
        input.selected.map(reference => prepareReference(reference.url)),
      );
      const oversized = images.find(
        image => image.length > MAX_REFERENCE_CHARACTERS,
      );
      if (oversized)
        throw new Error(
          "A reference image is too large for local generation. Use a smaller image.",
        );
    } catch (error) {
      say(
        error instanceof Error
          ? error.message
          : "Reference images are unavailable.",
      );
      return;
    }
    await generation.run(prompt, images, "fast");
  };
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
              <p className="user-message">{displayPrompt(edit.prompt)}</p>
              <p className="assistant-message">
                Scoped edit added to {layer.name} · {edit.start.toFixed(2)}–{edit.end.toFixed(2)} s.
              </p>
            </div>
          ))}
          {progress.map(item => (
            <p key={item.id} className="assistant-message">
              {item.text}
            </p>
          ))}
          {notice && (
            <p className="account-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <ReferenceComposer ref={composer} references={references} emitters={vfx?.document.layers} uploadFile={uploadFile} busy={busy || generation.busy} saving={saving} onSend={async (prompt, referenceIds) => {
        if (saving || busy || generation.busy) return false;
        // `saving` covers the Supabase write only. The pipeline that follows it
        // reports through `generation.busy`, which disables the composer the
        // same way and can be stopped from the footer.
        setNotice("");
        if (vfx?.standalone) {
          if (!generation.available) { setNotice("Local generation is not configured. Add OPENAI_API_KEY to frontend/.env.local."); return false; }
          setMessages(items => [...items, { id: localId(), prompt, status: "requested", created_at: new Date().toISOString(), error: null }]);
          void runGeneration(prompt, referenceIds);
          return true;
        }
        setSaving(true);
        let stored = false;
        try {
          const result = await savePrompt(projectId, prompt, referenceIds);
          if (result.error) { setNotice(result.error); return false; }
          if (!result.generation) return false;
          const generationRow = result.generation;
          setMessages(items => [...items, generationRow]);
          stored = true;
        } catch { setNotice("Could not save your prompt. Please try again."); return false; }
        finally { setSaving(false); }
        if (stored && generation.available) void runGeneration(prompt, referenceIds);
        return stored;
      }} />
      <div className="chat-footnote">
        {generation.busy ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            Generating…
            <button type="button" className="icon-button" onClick={generation.abort} aria-label="Stop generation" title="Stop generation">
              <Icon name="close" size={13} />
            </button>
          </span>
        ) : generation.available && generation.budget ? (
          `Local generation ready · $${generation.budget.used.toFixed(2)} of $${generation.budget.limit.toFixed(2)} used`
        ) : (
          "Generation not connected. Prompts are saved for later."
        )}
      </div>
    </aside>
  );
}

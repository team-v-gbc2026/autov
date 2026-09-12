"use client";
import { useRef, useState, useImperativeHandle, type Ref } from "react";
import ChatEmptyState from "./chat-empty-state";
import { savePrompt } from "@/app/workspace/actions";
import type { Generation, EffectVersion } from "@/lib/project-types";
import ReferenceComposer, { type ComposerHandle } from "./composer/reference-composer";
import { displayPrompt } from "./composer/prompt-format";
import type { Reference } from "@/lib/project-types";
import { iconButton as button } from "./icon-button";

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
}: {
  projectId: string;
  initialGenerations: Generation[];
  versions: EffectVersion[];
  references: Reference[];
  uploadFile: (file: File) => Promise<Reference>;
  ref: Ref<ComposerHandle>;
  busy: boolean;
  onCollapse: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
}) {
  const composer = useRef<ComposerHandle>(null);
  useImperativeHandle(ref, () => ({ mention: reference => composer.current?.mention(reference), setText: text => composer.current?.setText(text) }));
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState(initialGenerations);
  const [loaded, setLoaded] = useState(initialGenerations);
  if (loaded !== initialGenerations) {
    setLoaded(initialGenerations);
    setMessages(initialGenerations);
  }
  return (
    <aside className="glass chat-panel">
      <div className="panel-heading">
        <div>
          <h2>Chat</h2>
        </div>
        <div>{button("panel", "Collapse creative assistant", onCollapse)}</div>
      </div>
      <div className={`chat-content ${messages.length === 0 && versions.length === 0 ? "chat-content-empty" : ""}`}>
        {messages.length === 0 && versions.length === 0 && <ChatEmptyState disabled={saving} onSelect={value => { composer.current?.setText(value); }} />}
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
          {notice && (
            <p className="account-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <ReferenceComposer ref={composer} references={references} uploadFile={uploadFile} busy={busy} saving={saving} onSend={async (prompt, referenceIds) => {
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
        Generation not connected. Sample effect shown.
      </div>
    </aside>
  );
}

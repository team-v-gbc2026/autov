"use client";
import { useRef, useState } from "react";
import ChatEmptyState from "./chat-empty-state";
import { savePrompt } from "@/app/workspace/actions";
import type { Generation, EffectVersion } from "@/lib/project-types";
import Icon from "./icon";
import { iconButton as button } from "./icon-button";

export default function ChatPanel({
  projectId,
  initialGenerations,
  versions,
  referenceIds,
  busy,
  onCollapse,
  saving,
  setSaving,
}: {
  projectId: string;
  initialGenerations: Generation[];
  versions: EffectVersion[];
  referenceIds: string[];
  busy: boolean;
  onCollapse: () => void;
  saving: boolean;
  setSaving: (value: boolean) => void;
}) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
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
        {messages.length === 0 && versions.length === 0 && <ChatEmptyState disabled={saving} onSelect={value => { setPrompt(value); composer.current?.focus(); }} />}
        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id}>
              <p className="user-message">{message.prompt}</p>
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
      <form
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!prompt.trim() || saving || busy) return;
          setSaving(true);
          setNotice("");
          try {
            const result = await savePrompt(projectId, prompt, referenceIds);
            if (result.error) setNotice(result.error);
            else if (result.generation) {
              setMessages((items) => [...items, result.generation]);
              setPrompt("");
            }
          } catch {
            setNotice("Could not save your prompt. Please try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <textarea ref={composer}
          aria-label="Describe your effect"
          placeholder="Describe your effect..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={10000}
          disabled={saving}
        />
        <div className="composer-toolbar">
          <span>{saving ? "Saving..." : ""}</span>
          <button
            type="submit"
            className="send-button"
            disabled={!prompt.trim() || saving || busy}
            aria-label={saving ? "Saving prompt" : "Save prompt"}
          >
            <Icon name="arrow" />
          </button>
        </div>
      </form>
      <div className="chat-footnote">
        Generation not connected. Sample effect shown.
      </div>
    </aside>
  );
}

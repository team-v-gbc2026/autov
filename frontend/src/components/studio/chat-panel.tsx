"use client";
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import ChatEmptyState from "./chat-empty-state";
import { useEveAgent } from "eve/react";
import { agentHeaders, loadConversation } from "@/lib/agent/client";
import type { Generation, EffectVersion } from "@/lib/project-types";
import ReferenceComposer, { type ComposerHandle } from "./composer/reference-composer";
import { displayPrompt } from "./composer/prompt-format";
import type { Reference } from "@/lib/project-types";
import { iconButton as button } from "./icon-button";
import type { VfxUiDocument } from "@/components/vfx-studio/ui-model";

export type ChatPanelHandle = ComposerHandle;
type VfxEditing = { document: VfxUiDocument; selectedEmitterId?: string };
type AgentHandle = { send: (prompt: string, referenceIds: string[]) => Promise<boolean> };

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
  const messages = initialGenerations;
  const [agentHasHistory, setAgentHasHistory] = useState(false);
  const agent = useRef<AgentHandle>(null);
  const [connection, setConnection] = useState<{ sessionId: string | null }>();
  const [attempt, setAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadConversation(projectId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setConnection(result); setConnectionError(""); }
    }).catch(error => {
      if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "Could not connect.");
    });
    return () => controller.abort();
  }, [projectId, attempt]);
  function reconnect() { setConnection(undefined); setConnectionError(""); setAttempt(value => value + 1); }
  const scopedEdits = vfx?.document.layers.flatMap(layer =>
    layer.edits.map(edit => ({ layer, edit })),
  ) || [];
  const hasHistory = messages.length > 0 || versions.length > 0 || scopedEdits.length > 0 || !!connection?.sessionId || agentHasHistory;
  return (
    <aside className="glass chat-panel">
      <div className="panel-heading">
        <div>
          <h2>Chat</h2>
        </div>
        <div>{button("panel", "Collapse creative assistant", onCollapse)}</div>
      </div>
      <div className={`chat-content ${hasHistory ? "" : "chat-content-empty"}`}>
        {!hasHistory && <ChatEmptyState disabled={saving || !connection} onSelect={value => { composer.current?.setText(value); }} />}
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
          {connection ? <AgentConversation key={`${projectId}-${attempt}`} ref={agent} projectId={projectId} sessionId={connection.sessionId} vfx={vfx} setSaving={setSaving} onHistory={setAgentHasHistory} reconnect={reconnect} /> : (
            <p className="account-notice" role="status">{connectionError || "Connecting assistant…"}
              {connectionError && <button type="button" onClick={reconnect}>Retry connection</button>}
            </p>
          )}
          {notice && (
            <p className="account-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <ReferenceComposer ref={composer} references={references} emitters={vfx?.document.layers} uploadFile={uploadFile} busy={busy || !connection} saving={saving} sendLabel="Send message" onSend={async (prompt, referenceIds) => {
        if (saving || busy || !agent.current) return false;
        setNotice("");
        return agent.current.send(prompt, referenceIds);
      }} />
      <div className="chat-footnote">
        Discuss effects and reference images. Studio editing is coming next.
      </div>
    </aside>
  );
}


function AgentConversation({ ref, projectId, sessionId, vfx, setSaving, onHistory, reconnect }: {
  ref: Ref<AgentHandle>;
  projectId: string;
  sessionId: string | null;
  vfx?: VfxEditing;
  setSaving: (saving: boolean) => void;
  reconnect: () => void;
  onHistory: (hasHistory: boolean) => void;
}) {
  const accepted = useRef(false);
  const sending = useRef(false);
  const [sendError, setSendError] = useState("");
  const agent = useEveAgent({
    headers: () => agentHeaders(projectId),
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: !!sessionId,
    optimistic: false,
    onEvent: event => { if (event.type === "message.received") accepted.current = true; },
  });
  useEffect(() => { onHistory(agent.data.messages.length > 0); }, [agent.data.messages.length, onHistory]);
  const active = agent.status === "submitted" || agent.status === "streaming";
  const resuming = agent.status === "resuming";
  useEffect(() => {
    setSaving(active || resuming);
    return () => setSaving(false);
  }, [active, resuming, setSaving]);
  useImperativeHandle(ref, () => ({
    async send(prompt, referenceIds) {
      if (sending.current || active || resuming || agent.status === "error") return false;
      sending.current = true;
      accepted.current = false;
      setSendError("");
      try {
        await agent.send(prompt, { clientContext: { referenceIds, document: vfx?.document ?? null, selectedEmitterId: vfx?.selectedEmitterId ?? null } });
        return true;
      } catch {
        // A failed model response does not undo an accepted user message.
        setSendError(accepted.current ? "Your message was received, but the reply was interrupted. Reconnect to check its status." : "Your message could not be confirmed. Your text is still here; reconnect before retrying.");
        return accepted.current;
      } finally { sending.current = false; }
    },
  }));
  return <>
    {agent.data.messages.map(message => <div key={message.id}>
      {message.parts.map((part, index) => part.type === "text" ? (
        <p key={index} className={message.role === "user" ? "user-message" : "assistant-message"} style={{ whiteSpace: "pre-wrap" }}>{displayPrompt(part.text)}</p>
      ) : part.type === "file" ? (
        <p key={index} className="assistant-message">Reference: {part.filename || "Image"}</p>
      ) : null)}
    </div>)}
    {resuming && <p className="account-notice" role="status">Reconnecting to your conversation…</p>}
    {active && <div className="account-notice" role="status">{agent.status === "submitted" ? "Sending…" : "Assistant is responding…"}
      <button type="button" onClick={() => { void agent.cancel().catch(() => setSendError("Could not stop the response. Reconnect and try again.")); }}>Stop</button>
    </div>}
    {(sendError || agent.error) && <p className="account-notice" role="alert">{sendError || "The assistant is unavailable. Reconnect to check the conversation before retrying."}
      <button type="button" onClick={reconnect}>Reconnect</button>
    </p>}
  </>;
}

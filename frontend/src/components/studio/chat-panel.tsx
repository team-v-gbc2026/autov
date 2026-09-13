"use client";
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import ChatMessage from "./chat-message";
import styles from "./chat.module.css";
import ChatEmptyState from "./chat-empty-state";
import { useEveAgent } from "eve/react";
import { agentHeaders, loadConversation } from "@/lib/agent/client";
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
type AgentHandle = { stop: () => Promise<void>; send: (prompt: string, referenceIds: string[]) => Promise<boolean> };
type VfxEditing = {
  document: VfxUiDocument;
  selectedEmitterId?: string;
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
  const [responding, setResponding] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const container = scroll.current;
    const content = container?.querySelector(".messages");
    if (!container || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const [notice, setNotice] = useState("");
  const [agentHasHistory, setAgentHasHistory] = useState(false);
  const agent = useRef<AgentHandle>(null);
  const [connection, setConnection] = useState<{ sessionId: string | null }>();
  const [attempt, setAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    if (vfx?.standalone) return;
    const controller = new AbortController();
    loadConversation(projectId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setConnection(result); setConnectionError(""); }
    }).catch(error => {
      if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "Could not connect.");
    });
    return () => controller.abort();
  }, [projectId, attempt, vfx?.standalone]);
  function reconnect() { setConnection(undefined); setConnectionError(""); setAttempt(value => value + 1); }
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
  const hasHistory = messages.length > 0 || versions.length > 0 || scopedEdits.length > 0 || !!connection?.sessionId || agentHasHistory;
  return (
    <aside className={`glass chat-panel ${styles.panel}`}>
      <div className="panel-heading">
        <div>
          <h2>Assistant</h2><span className={styles.subtitle}>Your VFX creative partner</span>
        </div>
        <div>{button("panel", "Collapse creative assistant", onCollapse)}</div>
      </div>
      <div ref={scroll} onScroll={event => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className={`chat-content ${hasHistory ? "" : "chat-content-empty"}`}>
        {!hasHistory && <ChatEmptyState disabled={saving || (!vfx?.standalone && !connection)} onSelect={value => { composer.current?.setText(value); }} />}
        <div className="messages" aria-live="polite">
          {messages.map(message => <ChatMessage key={message.id} role="user" text={displayPrompt(message.prompt)} caption={message.status === "draft" ? "Saved prompt · history" : `Generation ${message.status}`} />)}
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
          {!vfx?.standalone && (connection ? <AgentConversation key={`${projectId}-${attempt}`} ref={agent} projectId={projectId} sessionId={connection.sessionId} vfx={vfx} setSaving={setSaving} onActivity={setResponding} onHistory={setAgentHasHistory} reconnect={reconnect} /> : (
            <p className={styles.notice} role="status">{connectionError || "Connecting assistant…"}
              {connectionError && <button type="button" onClick={reconnect}>Retry connection</button>}
            </p>
          ))}
          {progress.map(item => (
            <p key={item.id} className="assistant-message">
              {item.text}
            </p>
          ))}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <ReferenceComposer ref={composer} references={references} emitters={vfx?.document.layers} uploadFile={uploadFile} busy={busy || (vfx?.standalone ? generation.busy : !connection)} saving={saving} responding={responding} onStop={async () => { if (!agent.current) throw new Error("Assistant disconnected"); await agent.current.stop(); }} sendLabel="Send message" onSend={async (prompt, referenceIds) => {
        if (saving || busy) return false;
        if (vfx?.standalone) {
          if (generation.busy) return false;
          if (!generation.available) { setNotice("Local generation is not configured. Add OPENAI_API_KEY to frontend/.env.local."); return false; }
          setNotice("");
          stickToBottom.current = true;
          setMessages(items => [...items, { id: localId(), prompt, status: "requested", created_at: new Date().toISOString(), error: null }]);
          void runGeneration(prompt, referenceIds);
          return true;
        }
        if (!agent.current) return false;
        setNotice("");
        stickToBottom.current = true;
        return agent.current.send(prompt, referenceIds);
      }} />
      <div className="chat-footnote">
        {!vfx?.standalone ? "Discuss effects and reference images. Studio editing is coming next." : generation.busy ? (
          <span>Generating… <button type="button" className="icon-button" onClick={generation.abort} aria-label="Stop generation"><Icon name="close" size={13} /></button></span>
        ) : generation.available && generation.budget ? (
          `Local generation ready · $${generation.budget.used.toFixed(2)} of $${generation.budget.limit.toFixed(2)} used`
        ) : "Local generation is not configured."}
      </div>
    </aside>
  );
}


function AgentConversation({ ref, projectId, sessionId, vfx, setSaving, onHistory, onActivity, reconnect }: {
  ref: Ref<AgentHandle>;
  projectId: string;
  sessionId: string | null;
  vfx?: VfxEditing;
  setSaving: (saving: boolean) => void;
  reconnect: () => void;
  onHistory: (hasHistory: boolean) => void;
  onActivity: (active: boolean) => void;
}) {
  const accepted = useRef(false);
  const sending = useRef(false);
  const [sendError, setSendError] = useState("");
  const agent = useEveAgent({
    headers: () => agentHeaders(projectId),
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: !!sessionId,
    optimistic: true,
    onEvent: event => { if (event.type === "message.received") accepted.current = true; },
  });
  useEffect(() => { onHistory(agent.data.messages.length > 0); }, [agent.data.messages.length, onHistory]);
  const active = agent.status === "submitted" || agent.status === "streaming";
  const resuming = agent.status === "resuming";
  useEffect(() => {
    setSaving(active || resuming);
    onActivity(active);
    return () => { setSaving(false); onActivity(false); };
  }, [active, resuming, setSaving, onActivity]);
  useImperativeHandle(ref, () => ({
    async stop() { await agent.cancel(); },
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
    {agent.data.messages.map(message => <ChatMessage key={message.id} role={message.role}
      text={displayPrompt(message.parts.filter(part => part.type === "text").map(part => part.text).join("\n\n"))}
      files={message.parts.filter(part => part.type === "file").map(part => part.filename || "Reference image")}
      streaming={message.metadata?.status === "streaming"}
      caption={message.role === "user" ? message.metadata?.status === "failed" ? "Not confirmed · draft restored" : message.metadata?.optimistic ? "Sending…" : undefined : undefined}
    />)}
    {resuming && <div className={styles.reconnecting} role="status"><svg className={styles.spinner} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity=".2" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>Reconnecting</span></div>}
    {active && <div className={styles.notice} role="status"><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>{agent.status === "submitted" ? "Sending your message" : "Responding"}</div>}
    {(sendError || agent.error) && <p className={`${styles.notice} ${styles.error}`} role="alert">{sendError || "The assistant is unavailable. Reconnect to check the conversation before retrying."}
      <button type="button" onClick={reconnect}>Reconnect</button>
    </p>}
  </>;
}

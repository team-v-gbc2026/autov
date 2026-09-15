"use client";
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from "react";
import CapturePreview from "./capture-preview";
import ChatMessage, { ChatTargets } from "./chat-message";
import styles from "./chat.module.css";
import ChatEmptyState from "./chat-empty-state";
import { useEveAgent } from "eve/react";
import { agentHeaders, loadConversation } from "@/lib/agent/client";
import ReferenceComposer, { type ComposerHandle } from "./composer/reference-composer";
import { displayPrompt } from "./composer/prompt-format";
import type { Reference } from "@/lib/project-types";
import IconButton, { iconButton as button } from "./icon-button";
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
  beforeSend?: () => Promise<void>;
  onReference?: (id: string) => void;
  onEmitter?: (id: string) => void;
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
  const [previewId, setPreviewId] = useState<string>();
  const [clearing, setClearing] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [responding, setResponding] = useState(false);
  const [queued, setQueued] = useState<{ id: string; prompt: string; referenceIds: string[] }[]>([]);
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
  // Drain the next queued message once the assistant frees up, one at a time.
  useEffect(() => {
    if (saving || queued.length === 0 || !agent.current) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void (async () => {
      try { await vfx?.beforeSend?.(); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Could not save studio changes."); return; }
      await agent.current?.send(next.prompt, next.referenceIds);
    })();
  }, [saving, queued, vfx]);
  // Standalone/local generation only: prompts sent through the dev-page local
  // pipeline, kept separate from the real (Eve-resumed) conversation history.
  const [messages, setMessages] = useState<{ id: string; prompt: string; status: string; created_at: string; error: string | null }[]>([]);
  const [progress, setProgress] = useState<{ id: string; text: string }[]>([]);
  const say = (text: string) =>
    setProgress(items =>
      [...items, { id: localId(), text }].slice(-40),
    );
  const generation = useLocalGeneration({
    projectId: vfx?.standalone ? undefined : projectId,
    onDocument: document => vfx?.onDocument?.(document),
    onProgress: say,
  });
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
  async function clearChat() {
    if (clearing || saving || responding || generation.busy) return;
    setClearing(true);
    try {
      if (!vfx?.standalone) {
        const current = await loadConversation(projectId, new AbortController().signal);
        if (current.sessionId) {
          const response = await fetch(`/eve/v1/session/${encodeURIComponent(current.sessionId)}/reset`, {
            method: "POST", headers: { ...await agentHeaders(projectId), "Content-Type": "application/json" }, body: "{}",
          });
          if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Could not clear chat."); }
        }
        reconnect();
      }
      setMessages([]); setProgress([]); setNotice(""); setAgentHasHistory(false); setHistoryCleared(true); setQueued([]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not clear chat."); }
    finally { setClearing(false); }
  }
  const hasHistory = messages.length > 0 || (!historyCleared && scopedEdits.length > 0) || !!connection?.sessionId || agentHasHistory;
  return (
    <ChatTargets.Provider value={{ references, emitters: vfx?.document.layers || [], onReference: vfx?.onReference, onPreview: vfx?.standalone ? undefined : setPreviewId, onEmitter: vfx?.onEmitter }}><aside className={`glass chat-panel ${styles.panel}`}>
      <div className="panel-heading">
        <div>
          <h2>Assistant</h2><span className={styles.subtitle}>Your VFX creative partner</span>
        </div>
        <div><IconButton name="trash" label={clearing ? "Clearing chat" : "Clear chat"} disabled={clearing || saving || responding || generation.busy || (!vfx?.standalone && !connection)} onClick={() => void clearChat()} />{button("panel", "Collapse creative assistant", onCollapse)}</div>
      </div>
      <div ref={scroll} onScroll={event => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className={`chat-content ${hasHistory ? "" : "chat-content-empty"}`}>
        {!hasHistory && <ChatEmptyState disabled={saving || (!vfx?.standalone && !connection)} onSelect={value => { composer.current?.setText(value); }} />}
        <div className="messages" aria-live="polite">
          {messages.map(message => <ChatMessage key={message.id} role="user" text={message.prompt} caption={message.status === "draft" ? "Saved prompt · history" : `Generation ${message.status}`} />)}
          {!historyCleared && scopedEdits.map(({ layer, edit }) => (
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
          {queued.map(item => (
            <div key={item.id} className={styles.queuedMessage}>
              <ChatMessage role="user" text={item.prompt} caption="Queued · will send when the assistant is free" />
              <button type="button" className={styles.queuedCancel} aria-label="Remove queued message" onClick={() => setQueued(items => items.filter(queuedItem => queuedItem.id !== item.id))}>
                <Icon name="close" size={13} />
              </button>
            </div>
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
      <ReferenceComposer ref={composer} references={references} emitters={vfx?.document.layers} uploadFile={uploadFile} busy={busy || (vfx?.standalone ? generation.busy : !connection)} saving={vfx?.standalone ? saving : false} responding={responding} onStop={async () => { if (!agent.current) throw new Error("Assistant disconnected"); await agent.current.stop(); }} sendLabel="Send message" onSend={async (prompt, referenceIds) => {
        if (busy || clearing) return false;
        if (vfx?.standalone) {
          if (saving || generation.busy) return false;
          if (!generation.available) { setNotice("Local generation is not configured. Add OPENAI_API_KEY to frontend/.env.local."); return false; }
          setNotice("");
          stickToBottom.current = true;
          setMessages(items => [...items, { id: localId(), prompt, status: "requested", created_at: new Date().toISOString(), error: null }]);
          void runGeneration(prompt, referenceIds);
          return true;
        }
        if (!connection) return false;
        setNotice("");
        stickToBottom.current = true;
        if (saving) {
          setQueued(items => [...items, { id: localId(), prompt, referenceIds }]);
          return true;
        }
        if (!agent.current) return false;
        try { await vfx?.beforeSend?.(); }
        catch (error) { setNotice(error instanceof Error ? error.message : "Could not save studio changes."); return false; }
        return agent.current.send(prompt, referenceIds);
      }} />
      <div className="chat-footnote">
        {!vfx?.standalone ? "Edit effects and explore references with the assistant." : generation.busy ? (
          <span>Generating… <button type="button" className="icon-button" onClick={generation.abort} aria-label="Stop generation"><Icon name="close" size={13} /></button></span>
        ) : generation.available && generation.budget ? (
          `Local generation ready · $${generation.budget.used.toFixed(2)} of $${generation.budget.limit.toFixed(2)} used`
        ) : "Local generation is not configured."}
      </div>
    </aside>{previewId && <CapturePreview key={previewId} projectId={projectId} referenceId={previewId} onClose={() => setPreviewId(undefined)} />}</ChatTargets.Provider>
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
  const [toolActivity, setToolActivity] = useState<Record<string, string>>({});
  const [toolFailure, setToolFailure] = useState("");
  const agent = useEveAgent({
    headers: () => agentHeaders(projectId),
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: !!sessionId,
    optimistic: true,
    onEvent: event => {
      if (event.type === "message.received") { accepted.current = true; setToolFailure(""); setToolActivity({}); }
      if (event.type === "actions.requested") setToolActivity(current => ({ ...current, ...Object.fromEntries(event.data.actions.map(action => [action.callId, "toolName" in action ? action.toolName : "working"])) }));
      if (event.type === "action.result") { setToolActivity(current => { const next = { ...current }; delete next[event.data.result.callId]; return next; }); if (event.data.status !== "completed") setToolFailure(event.data.error?.message || "The studio tool could not complete this request."); }
    },
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
    {toolFailure && <p className={`${styles.notice} ${styles.error}`} role="alert">{toolFailure}</p>}
    {agent.data.messages.filter(message => message.role !== "assistant" || message.parts.some(part => part.type === "text" && part.text.trim() || part.type === "file")).map(message => <ChatMessage key={message.id} role={message.role}
      text={message.parts.filter(part => part.type === "text").map(part => part.text).join("\n\n")}
      files={message.parts.filter(part => part.type === "file").map(part => part.filename || "Reference image")}
      streaming={message.metadata?.status === "streaming"}
      caption={message.role === "user" ? message.metadata?.status === "failed" ? "Not confirmed · draft restored" : message.metadata?.optimistic ? "Sending…" : undefined : undefined}
    />)}
    {resuming && <div className={styles.reconnecting} role="status"><svg className={styles.spinner} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity=".2" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><span>Reconnecting</span></div>}
    {active && <div className={styles.activityRow}><span className={styles.activityBrand}><span className={styles.mark} aria-hidden="true">✦</span> AutoV</span><ToolHint key={Object.values(toolActivity).join(",")} projectId={projectId} generationCallId={Object.entries(toolActivity).find(([, name]) => (name === "generate_vfx" || name === "refine_vfx"))?.[0]} tools={Object.values(toolActivity)} submitting={agent.status === "submitted"} /></div>}
    {(sendError || agent.error) && <p className={`${styles.notice} ${styles.error}`} role="alert">{sendError || "The assistant is unavailable. Reconnect to check the conversation before retrying."}
      <button type="button" onClick={reconnect}>Reconnect</button>
    </p>}
  </>;
}

const generationHints = ["Building your VFX…", "Making your idea real…", "Warming up the particles…", "Giving your effect some spark…"];
const editingHints = ["Shaping your effect…", "Fine-tuning the particles…", "Working on the details…"];
const referenceHints = ["Looking at your references…", "Exploring the details…", "Taking a closer look…"];
const previewHints = ["Preparing your preview…", "Framing your effect…", "Capturing the moment…"];
const inspectHints = ["Inspecting the pixels…", "Checking how it looks…", "Comparing against the request…", "Studying the details…"];
const refineHints = ["Reviewing your effect…", "Iterating on the details…", "Comparing against your request…"];
const readingHints = ["Reading the current effect…", "Getting up to speed…", "Checking the latest revision…"];
const textureHints = ["Generating a texture…", "Crafting the mask…", "Shaping the material…"];
const commitHints = ["Locking in your changes…", "Saving the result…"];
const undoHints = ["Undoing that change…", "Reverting to the last version…"];
function ToolHint({ tools, submitting, projectId, generationCallId }: { tools: string[]; submitting: boolean; projectId: string; generationCallId?: string }) {
  const hints = tools.includes("generate_reference_image") ? ["Creating your image…", "Bringing your reference to life…", "Working on the details…"]
    : tools.includes("refine_vfx") ? refineHints
    : tools.includes("generate_vfx") ? generationHints
    : tools.some(tool => tool.startsWith("inspect_")) ? inspectHints
    : tools.includes("preview_vfx") ? previewHints
    : tools.includes("generate_effect_texture") ? textureHints
    : tools.some(tool => tool.includes("reference")) ? referenceHints
    : tools.includes("commit_vfx_candidate") ? commitHints
    : tools.includes("undo_vfx_edit") ? undoHints
    : tools.some(tool => tool === "edit_vfx" || tool === "edit_vfx_candidate") ? editingHints
    : tools.some(tool => tool === "read_vfx" || tool === "set_vfx_view" || tool === "recover_vfx_candidate") ? readingHints
    : tools.length ? ["Exploring your effect…", "Looking at the details…"]
    : [submitting ? "Sending your idea…" : "Thinking it through…"];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (hints.length < 2) return;
    const timer = setInterval(() => setIndex(value => value + 1), 3500);
    return () => clearInterval(timer);
  }, [hints.length]);
  const hint = hints[index % hints.length];
  if (generationCallId) return <GenerationProgress projectId={projectId} callId={generationCallId} hint={hint} />;
  return <div className={styles.toolHint} role="status" aria-live="polite">
    <svg className={`${styles.stageRing} ${styles.pendingRing}`} width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity=".18" />
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="12 38" />
    </svg>
    <span>{hint}</span>
  </div>;
}

function GenerationProgress({ projectId, callId, hint }: { projectId: string; callId: string; hint: string }) {
  const [progress, setProgress] = useState<{ stage: number; startedAt: string; status: string; error?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/studio/progress?callId=${encodeURIComponent(callId)}`, { headers: await agentHeaders(projectId), signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Progress unavailable");
        const next = await response.json();
        if (!controller.signal.aborted) { setProgress(next); setUnavailable(false); }
      } catch { if (!controller.signal.aborted) setUnavailable(true); }
      finally { pending = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [projectId, callId]);
  useEffect(() => {
    if (!progress) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(progress.startedAt)) / 1000)));
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [progress]);
  const failed = progress && ["failed", "cancelled", "expired"].includes(progress.status);
  return <div className={styles.generationProgress}>
    <svg className={styles.stageRing} width="18" height="18" viewBox="0 0 20 20" role="progressbar" aria-label="Generation stages completed" aria-valuemin={0} aria-valuemax={5} aria-valuenow={progress?.stage ?? 0}>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity=".18" />
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (progress?.stage ?? 0) * 20} transform="rotate(-90 10 10)" />
    </svg>
    <div className={styles.generationLabel} role="status"><span className={styles.generationHintText}>{unavailable ? "Progress temporarily unavailable" : failed ? progress.error || "Generation stopped" : hint}</span><span className={styles.generationElapsed}>{elapsed}s</span></div>

  </div>;
}

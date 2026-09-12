"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/studio/icon";
import ChatEmptyState from "@/components/studio/chat-empty-state";
import PanelToggle from "@/components/studio/panel-toggle";
import PlaybackPanel from "@/components/studio/playback-panel";
import { usePlayback } from "@/components/studio/use-playback";
import { iconButton as button } from "@/components/studio/icon-button";
import Viewport from "./viewport";
import { createPreset, RECIPES, type RecipeId } from "@/lib/vfx-lab/recipes";
import {
  validateDocument,
  type VfxDocument,
  type Override,
  type NumericTarget,
  RANGES,
} from "@/lib/vfx-lab/schema";
import { applyScopedEdit } from "@/lib/vfx-lab/evaluate";
import {
  generatePipeline,
  type Candidate,
  type PipelineResult,
} from "@/lib/vfx-lab/pipeline";
import { score, type Plan } from "@/lib/vfx-lab/protocol";
import type { VfxRuntime } from "@/lib/vfx-lab/runtime";
import "./studio.css";

type Status = {
  configured: boolean;
  model: string;
  budget: {
    limit: number;
    used: number;
    remaining: number;
    calls: number;
    pending: number;
  };
};
type LocalReference = { id: string; name: string; url: string };
const STORAGE = "autov.local.document.v1";
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function resizeImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Use a PNG, JPEG or WebP image up to 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image preparation failed.");
    ctx.fillStyle = "#101112";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.87);
  } finally {
    bitmap.close();
  }
}
export default function VfxStudio() {
  const [doc, setDoc] = useState(() => createPreset("slash")),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState<Status | null>(null);
  const [left, setLeft] = useState(true),
    [right, setRight] = useState(true),
    [leftTab, setLeftTab] = useState<"references" | "layers">("references");
  const [references, setReferences] = useState<LocalReference[]>([]),
    [uploading, setUploading] = useState(false);
  const [prompt, setPrompt] = useState(""),
    [mode, setMode] = useState<"fast" | "quality">("quality"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [selectedCandidate, setSelectedCandidate] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null);
  const [lastPrompt, setLastPrompt] = useState(""),
    [selected, setSelected] = useState("arc-0"),
    [solo, setSolo] = useState<string | undefined>();
  const [undo, setUndo] = useState<VfxDocument[]>([]),
    [redo, setRedo] = useState<VfxDocument[]>([]);
  const [editMode, setEditMode] = useState(false),
    [start, setStart] = useState(0.55),
    [end, setEnd] = useState(1.3),
    [proposal, setProposal] = useState<{
      layerId: string;
      override: Override;
      explanation: string;
    } | null>(null);
  const runtime = useRef<VfxRuntime | null>(null),
    abort = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<PipelineResult | null>(null);
  const playback = usePlayback(doc.duration),
    layer = doc.layers.find((l) => l.id === selected) || doc.layers[0];
  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/local-vfx");
      const s = await r.json();
      if (r.ok) setStatus(s);
      else setError(s.error);
    } catch {
      setError("Local API unavailable.");
    }
  }, []);
  // Browser storage is external persisted state; hydrate after the server render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) setDoc(validateDocument(JSON.parse(raw)));
    } catch {
      setError("Saved document could not be loaded. A valid preset is shown.");
    }
    setReady(true);
    void refreshStatus();
    if (window.matchMedia("(max-width:800px)").matches) setLeft(false);
    return () => abort.current?.abort();
  }, [refreshStatus]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(STORAGE, JSON.stringify(doc));
      } catch {
        setError("Browser storage is full. Export JSON to save this effect.");
      }
  }, [doc, ready]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const commit = (next: VfxDocument) => {
    validateDocument(next);
    setUndo((items) => [...items.slice(-29), doc]);
    setRedo([]);
    setDoc(next);
    setProposal(null);
    setSelectedCandidate("");
  };
  const choosePreset = (id: RecipeId) => {
    const next = createPreset(id);
    commit(next);
    setSelected(next.layers.find((l) => l.role === "primary")!.id);
    setSolo(undefined);
    setPrompt(RECIPES[id].prompt);
    playback.setTime(next.impact + 0.2);
    setCandidates([]);
    setPlan(null);
    setNotice(
      "Hand-authored preset loaded. Generate to create a new effect with OpenAI.",
    );
  };
  const request = async (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) => {
    const response = await fetch("/api/local-vfx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (data.budget) setStatus((s) => (s ? { ...s, budget: data.budget } : s));
    if (!response.ok) throw new Error(data.error || "Generation failed.");
    return data;
  };
  const submit = async () => {
    if (!prompt.trim() || busy || !runtime.current) return;
    setError("");
    setBusy(true);
    setProposal(null);
    setSolo(undefined);
    const controller = new AbortController();
    abort.current = controller;
    playback.setPlaying(false);
    try {
      if (editMode) {
        if (start < 0 || end > doc.duration || start >= end)
          throw new Error("Choose a valid time range within the effect.");
        setNotice(
          `Preparing an edit for ${layer.name}, ${start.toFixed(2)}–${end.toFixed(2)} s…`,
        );
        const result = await request(
          { action: "edit", prompt, document: doc, layerId: layer.id },
          controller.signal,
        );
        const override: Override = {
          target: result.value.target,
          value: result.value.value,
          start,
          end,
          fade: Math.min(0.1, (end - start) / 4),
        };
        applyScopedEdit(doc, layer.id, override);
        setProposal({
          layerId: layer.id,
          override,
          explanation: result.value.explanation,
        });
        setNotice("Review the selected layer and time range, then apply.");
      } else {
        setCandidates([]);
        setReport(null);
        setLastPrompt(prompt);
        setPlan(null);
        const result = await generatePipeline({
          prompt,
          references: references.map((r) => r.url),
          mode,
          signal: controller.signal,
          request,
          capture: (document, solo, diagnostic) => {
            if (!runtime.current) throw new Error("Renderer unavailable.");
            return runtime.current.capture(document, { solo, diagnostic });
          },
          progress: setNotice,
          candidate: (candidate) => {
            setCandidates((items) => {
              const index = items.findIndex((c) => c.id === candidate.id);
              return index < 0
                ? [...items, candidate]
                : items.map((c) => (c.id === candidate.id ? candidate : c));
            });
          },
        });
        setReport(result);
        setPlan(result.plan);
        commit(result.selected.document);
        setSelectedCandidate(result.selected.id);
        setSelected(
          result.selected.document.layers.find((l) => l.role === "primary")
            ?.id || result.selected.document.layers[0].id,
        );
        playback.setTime(result.selected.document.impact + 0.15);
        playback.setPlaying(true);
      }
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "Stopped. Your current effect is preserved; completed candidates remain available."
          : e instanceof Error
            ? e.message
            : "Generation failed. Previous effect preserved.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
      void refreshStatus();
    }
  };
  const addFiles = async (files: FileList | null) => {
    if (!files || uploading) return;
    setUploading(true);
    try {
      if (references.length + files.length > 3)
        throw new Error("Use up to three references per generation.");
      const prepared = await Promise.all(
        Array.from(files).map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          url: await resizeImage(file),
        })),
      );
      setReferences((items) => [...items, ...prepared]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image import failed.");
    } finally {
      setUploading(false);
    }
  };
  const parameter = (target: NumericTarget, value: number) => {
    const next = structuredClone(doc),
      item = next.layers.find((l) => l.id === layer.id)!;
    item.params[target] = value;
    item.tracks = item.tracks.filter((t) => t.target !== target);
    try {
      commit(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid parameter.");
    }
  };
  const onRuntimeReady = useCallback((value: VfxRuntime | null) => {
    runtime.current = value;
  }, []);
  const exportPlayer = async () => {
    try {
      const { exportHtml } = await import("@/lib/vfx-lab/export");
      download(`${doc.name}.html`, await exportHtml(doc), "text/html");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  };
  return (
    <main
      className={`studio lab ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <Viewport
        doc={doc}
        time={playback.time}
        solo={solo}
        onReady={onRuntimeReady}
      />
      <header className="studio-header">
        <div className="project-heading">
          <Link href="/" className="studio-back-brand" aria-label="Autov home">
            <span className="wordmark">
              <span className="brand-symbol">a</span>autov
              <span className="wordmark-dot">.</span>
            </span>
          </Link>
          <span className="header-divider" />
          <span className="lab-header-name">{doc.name}</span>
          <span className="lab-badge">LOCAL · SAVED ON THIS DEVICE</span>
        </div>
        <div className="header-actions">
          <button
            className="lab-action"
            onClick={() => importInput.current?.click()}
            disabled={busy}
          >
            Import
          </button>
          <button
            className="lab-action"
            onClick={() =>
              download(`${doc.name}.json`, JSON.stringify(doc, null, 2))
            }
          >
            JSON ↓
          </button>
          <button className="lab-action" onClick={() => void exportPlayer()}>
            Three.js ↓
          </button>
        </div>
      </header>
      <input
        ref={importInput}
        aria-label="Import effect JSON"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            if (file.size > 1_000_000)
              throw new Error("Effect JSON must be under 1 MB.");
            const next = validateDocument(JSON.parse(await file.text()));
            commit(next);
            setSolo(undefined);
            setSelected(next.layers[0].id);
            playback.setTime(next.impact);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid JSON.");
          }
        }}
      />
      {!left && (
        <PanelToggle
          side="left"
          label="References & layers"
          onOpen={() => setLeft(true)}
        />
      )}
      {!right && (
        <PanelToggle side="right" label="Chat" onOpen={() => setRight(true)} />
      )}
      {left && (
        <aside className="glass reference-panel">
          <div className="panel-heading">
            <div>
              <Icon name="image" />
              <h2>{leftTab === "references" ? "References" : "Layers"}</h2>
              <span className="count">
                {(leftTab === "references"
                  ? references.length
                  : doc.layers.length
                )
                  .toString()
                  .padStart(2, "0")}
              </span>
            </div>
            {button("panel", "Collapse references", () => setLeft(false))}
          </div>
          <div
            className="lab-tabs"
            role="tablist"
            aria-label="Reference and layer panels"
          >
            <button
              role="tab"
              aria-selected={leftTab === "references"}
              onClick={() => setLeftTab("references")}
            >
              References
            </button>
            <button
              role="tab"
              aria-selected={leftTab === "layers"}
              onClick={() => setLeftTab("layers")}
            >
              Layers
            </button>
          </div>
          <div className="panel-body lab-scroll">
            {leftTab === "references" ? (
              <>
                <button
                  className="drop-zone"
                  disabled={busy || uploading}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!busy) void addFiles(e.dataTransfer.files);
                  }}
                >
                  <span className="upload-icon">
                    <Icon name="plus" size={22} />
                  </span>
                  <strong>Add references</strong>
                  <span>Drop images or browse</span>
                  <small>
                    {uploading ? "PREPARING…" : "IMAGES · UP TO 20 MB · MAX 3"}
                  </small>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  aria-label="Add reference images"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="reference-list">
                  {references.map((ref) => (
                    <div className="reference-item" key={ref.id}>
                      <Image
                        unoptimized
                        width={240}
                        height={160}
                        src={ref.url}
                        alt={ref.name}
                      />
                      <div>
                        <span>{ref.name}</span>
                        {button("close", `Remove ${ref.name}`, () =>
                          setReferences((items) =>
                            items.filter((r) => r.id !== ref.id),
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="lab-hint">
                  References guide color, shape and atmosphere. Motion comes
                  from your prompt. Uploaded references are sent to OpenAI when
                  you generate.
                </p>
                <h3 className="lab-section-label">Start with an effect</h3>
                <div className="lab-presets">
                  {(Object.keys(RECIPES) as RecipeId[]).map((id) => (
                    <button
                      className="lab-preset"
                      key={id}
                      disabled={busy}
                      onClick={() => choosePreset(id)}
                    >
                      <strong>
                        {RECIPES[id].name} <span>↗</span>
                      </strong>
                      <small>{RECIPES[id].subtitle}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {doc.layers.map((l) => (
                  <div
                    key={l.id}
                    className={`lab-layer ${l.id === layer.id ? "selected" : ""}`}
                  >
                    <button
                      disabled={busy}
                      aria-label={`${l.enabled ? "Hide" : "Show"} ${l.name}`}
                      onClick={() => {
                        const next = structuredClone(doc);
                        next.layers.find((x) => x.id === l.id)!.enabled =
                          !l.enabled;
                        try {
                          commit(next);
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Invalid layer selection.",
                          );
                        }
                      }}
                    >
                      <span
                        className="lab-layer-dot"
                        style={{
                          background: l.enabled ? l.params.color : "#45494b",
                        }}
                      />
                    </button>
                    <button onClick={() => setSelected(l.id)}>
                      {l.name}
                      <small>
                        {l.kind} · {l.start.toFixed(2)}–{l.end.toFixed(2)} s
                      </small>
                    </button>
                    <button
                      className="lab-tiny"
                      aria-label={`Solo ${l.name}`}
                      aria-pressed={solo === l.id}
                      onClick={() => setSolo(solo === l.id ? undefined : l.id)}
                    >
                      {solo === l.id ? "●" : "S"}
                    </button>
                  </div>
                ))}
                <div className="lab-controls">
                  <h3 className="lab-section-label">{layer.name}</h3>
                  <label className="lab-field">
                    Color
                    <input
                      type="color"
                      aria-label="Layer color"
                      value={layer.params.color}
                      disabled={busy}
                      onChange={(e) => {
                        const next = structuredClone(doc);
                        next.layers.find(
                          (l) => l.id === layer.id,
                        )!.params.color = e.target.value;
                        commit(next);
                      }}
                    />
                  </label>
                  {(
                    [
                      "intensity",
                      "radius",
                      "width",
                      "opacity",
                    ] as NumericTarget[]
                  ).map((target) => (
                    <label className="lab-field" key={target}>
                      <span>
                        {target}
                        <output>{layer.params[target].toFixed(2)}</output>
                      </span>
                      <input
                        aria-label={`Layer ${target}`}
                        type="range"
                        min={RANGES[target][0]}
                        max={
                          target === "radius"
                            ? 4
                            : target === "width"
                              ? 0.5
                              : RANGES[target][1]
                        }
                        step="0.01"
                        value={layer.params[target]}
                        disabled={busy}
                        onChange={(e) =>
                          parameter(target, Number(e.target.value))
                        }
                      />
                    </label>
                  ))}
                  <p className="lab-hint">
                    Manual sliders replace this parameter’s animation. Use a
                    scoped chat edit to preserve it outside a time window.
                  </p>
                  <button
                    className="lab-action"
                    onClick={() => {
                      setEditMode(true);
                      setRight(true);
                    }}
                  >
                    Edit this layer in chat ↗
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}
      {right && (
        <aside className="glass chat-panel">
          <div className="panel-heading">
            <div>
              <h2>Chat</h2>
            </div>
            {button("panel", "Collapse creative assistant", () =>
              setRight(false),
            )}
          </div>
          <div className="chat-content">
            <div className="messages" aria-live="polite">
              {!lastPrompt && !notice && (
                <ChatEmptyState disabled={busy} onSelect={setPrompt} />
              )}
              {lastPrompt && <p className="user-message">{lastPrompt}</p>}
              {notice && (
                <div className="lab-progress" role="status">
                  <span>
                    {busy && (
                      <span
                        className="scene-loader"
                        style={{ display: "inline-block", marginRight: 8 }}
                      />
                    )}
                    {notice}
                  </span>
                  <small>
                    {mode === "quality"
                      ? "Plan → 3 candidates → render → review → bounded refinement"
                      : "Plan → candidate → render"}
                  </small>
                </div>
              )}
              {plan && (
                <details>
                  <summary className="lab-hint">
                    Creative direction · {plan.name}
                  </summary>
                  <p className="lab-hint">{plan.intent}</p>
                  <p className="lab-hint">{plan.motion.timing}</p>
                  <ul className="lab-criteria">
                    {plan.criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="lab-candidates">
                {candidates.map((c, i) => (
                  <div
                    key={c.id}
                    className={`lab-candidate ${selectedCandidate === c.id ? "active" : ""}`}
                  >
                    <Image
                      unoptimized
                      width={1280}
                      height={606}
                      src={c.evidence.sheet}
                      alt={`Candidate ${i + 1}, timestamped render contact sheet`}
                    />
                    <button
                      disabled={busy}
                      onClick={() => {
                        commit(c.document);
                        setSelectedCandidate(c.id);
                        setSolo(undefined);
                        playback.setTime(c.document.impact + 0.15);
                      }}
                    >
                      <span>
                        {c.origin === "refined"
                          ? "Refinement"
                          : `Direction ${i + 1}`}{" "}
                        · {c.document.name}
                      </span>
                      <span>
                        {score(c.review) < 0
                          ? "Rendered"
                          : `${score(c.review).toFixed(1)} / 5`}
                      </span>
                    </button>
                    {c.review && <p>{c.review.verdict}</p>}
                    {c.error && <p>{c.error}</p>}
                  </div>
                ))}
              </div>
              {proposal && (
                <div className="lab-editor">
                  <strong>
                    {doc.layers.find((l) => l.id === proposal.layerId)?.name} ·{" "}
                    {proposal.override.start.toFixed(2)}–
                    {proposal.override.end.toFixed(2)} s
                  </strong>
                  <p>{proposal.explanation}</p>
                  <p>
                    {proposal.override.target} →{" "}
                    {String(proposal.override.value)}
                  </p>
                  <div className="lab-control-row">
                    <button
                      className="lab-primary"
                      onClick={() => {
                        try {
                          commit(
                            applyScopedEdit(
                              doc,
                              proposal.layerId,
                              proposal.override,
                            ),
                          );
                          setNotice(
                            "Edit applied. Other layers and times outside this window are unchanged.",
                          );
                          setPrompt("");
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Edit rejected.",
                          );
                        }
                      }}
                    >
                      Apply edit
                    </button>
                    <button
                      className="lab-action"
                      onClick={() => setProposal(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              {!status?.configured && (
                <p className="lab-hint">
                  <Link href="/local/settings">Connect your OpenAI key ↗</Link>
                </p>
              )}
              {report && (
                <button
                  className="effect-download"
                  onClick={() =>
                    download(
                      "autov-evidence.json",
                      JSON.stringify(report, null, 2),
                    )
                  }
                >
                  Download generation evidence ↓
                </button>
              )}
            </div>
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="lab-control-row" style={{ marginBottom: 9 }}>
              <select
                className="lab-mode"
                aria-label="Chat action"
                value={editMode ? "edit" : "generate"}
                disabled={busy}
                onChange={(e) => setEditMode(e.target.value === "edit")}
              >
                <option value="generate">Generate effect</option>
                <option value="edit">Edit selected layer</option>
              </select>
              {!editMode && (
                <select
                  className="lab-mode"
                  aria-label="Generation quality"
                  value={mode}
                  disabled={busy}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="quality">Quality · 3 directions</option>
                  <option value="fast">Quick · 1 direction</option>
                </select>
              )}
            </div>
            {editMode && (
              <>
                <label className="lab-field">
                  Layer
                  <select
                    aria-label="Edit layer"
                    value={layer.id}
                    disabled={busy}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {doc.layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="lab-control-row" style={{ margin: "8px 0" }}>
                  <label className="lab-field">
                    From (s)
                    <input
                      aria-label="Edit start"
                      type="number"
                      min="0"
                      max={doc.duration}
                      step="0.05"
                      value={start}
                      disabled={busy}
                      onChange={(e) => setStart(Number(e.target.value))}
                    />
                  </label>
                  <label className="lab-field">
                    To (s)
                    <input
                      aria-label="Edit end"
                      type="number"
                      min="0"
                      max={doc.duration}
                      step="0.05"
                      value={end}
                      disabled={busy}
                      onChange={(e) => setEnd(Number(e.target.value))}
                    />
                  </label>
                </div>
              </>
            )}
            <textarea
              aria-label="Describe your effect"
              placeholder={
                editMode
                  ? "Make only this layer warmer and brighter…"
                  : "Describe your effect…"
              }
              rows={3}
              value={prompt}
              maxLength={5000}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="composer-toolbar">
              <span className="lab-tiny">
                {busy ? (
                  <button type="button" onClick={() => abort.current?.abort()}>
                    Stop generation
                  </button>
                ) : status?.configured ? (
                  "OpenAI · gpt-6-astra"
                ) : (
                  "OpenAI not connected"
                )}
              </span>
              <button
                type="submit"
                className="send-button"
                aria-label={
                  editMode ? "Prepare scoped edit" : "Generate effect"
                }
                disabled={
                  busy || uploading || !prompt.trim() || !status?.configured
                }
              >
                <Icon name="arrow" />
              </button>
            </div>
          </form>
          <div className="chat-footnote">
            {status ? (
              <span className="lab-budget">
                ${status.budget.used.toFixed(2)} / $30 local limit ·{" "}
                {status.budget.pending
                  ? "includes reserved calls"
                  : "conservative usage"}
              </span>
            ) : (
              "Connecting…"
            )}
          </div>
        </aside>
      )}
      <PlaybackPanel
        playback={playback}
        duration={doc.duration}
        name={doc.name}
      >
        <div className="lab-shelf">
          <div>
            <label className="lab-field">
              Bloom
              <input
                type="range"
                aria-label="Bloom"
                min="0"
                max="2"
                step="0.05"
                value={doc.post.bloom}
                disabled={busy}
                onChange={(e) =>
                  commit({
                    ...doc,
                    post: { ...doc.post, bloom: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>
          <div>
            <label className="lab-field">
              Exposure
              <input
                type="range"
                aria-label="Exposure"
                min="0.3"
                max="2"
                step="0.05"
                value={doc.post.exposure}
                disabled={busy}
                onChange={(e) =>
                  commit({
                    ...doc,
                    post: { ...doc.post, exposure: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>
          <button
            className="lab-action"
            onClick={() => runtime.current?.resetCamera()}
          >
            Reset camera
          </button>
        </div>
        <div className="lab-control-row" style={{ marginTop: 12 }}>
          <button
            className="lab-action"
            disabled={!undo.length || busy}
            onClick={() => {
              const previous = undo[undo.length - 1];
              setRedo((items) => [...items, doc]);
              setUndo((items) => items.slice(0, -1));
              setDoc(previous);
              setProposal(null);
              setSelectedCandidate("");
            }}
          >
            Undo
          </button>
          <button
            className="lab-action"
            disabled={!redo.length || busy}
            onClick={() => {
              const next = redo[redo.length - 1];
              setUndo((items) => [...items, doc]);
              setRedo((items) => items.slice(0, -1));
              setDoc(next);
              setProposal(null);
              setSelectedCandidate("");
            }}
          >
            Redo
          </button>
          <button
            className="lab-action"
            onClick={() => {
              if (runtime.current)
                download(
                  "autov-contact-sheet.json",
                  JSON.stringify(
                    { document: doc, evidence: runtime.current.capture(doc) },
                    null,
                    2,
                  ),
                );
            }}
          >
            Capture evidence
          </button>
        </div>
      </PlaybackPanel>
      <footer className="viewport-footer">
        <span className="lab-status">
          <i />
          Three.js · {doc.layers.length} layers ·{" "}
          {doc.layers
            .filter((l) => l.kind === "particles")
            .reduce((n, l) => n + l.params.count, 0)
            .toLocaleString()}{" "}
          particles
        </span>
        <span className="lab-status">
          {solo
            ? "Solo layer preview"
            : "Deterministic playback · local workspace"}
        </span>
      </footer>
    </main>
  );
}

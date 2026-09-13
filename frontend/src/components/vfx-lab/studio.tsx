"use client";
// @refresh reset
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ReferencesPanel from "@/components/studio/references-panel";
import ReferenceComposer, {
  type ComposerHandle,
} from "@/components/studio/composer/reference-composer";
import { displayPrompt } from "@/components/studio/composer/prompt-format";
import {
  useBoardLayout,
  referenceName,
} from "@/components/studio/board/board-store";
import { useLocalReferences, prepareReference } from "./use-local-references";
import EmitterTimeline from "./emitter-timeline";
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
  GEOMETRIES,
  SURFACES,
} from "@/lib/vfx-lab/schema";
import { referenceInput } from "@/lib/vfx-lab/reference-input";
import { applyScopedEdit } from "@/lib/vfx-lab/evaluate";
import {
  generatePipeline,
  type Candidate,
  type PipelineResult,
} from "@/lib/vfx-lab/pipeline";
import { score, type Plan } from "@/lib/vfx-lab/protocol";
import type { VfxRuntime } from "@/lib/vfx-lab/runtime";
import "./studio.css";
import "../vfx-studio/studio-ui.css";

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
const STORAGE = "autov.local.document.v1";
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function VfxStudio() {
  const [doc, setDoc] = useState(() => createPreset("slash")),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState<Status | null>(null);
  const [left, setLeft] = useState(true),
    [right, setRight] = useState(true);
  const referenceState = useLocalReferences();
  const { layout } = useBoardLayout("local");
  const references = referenceState.references.map((r) => ({
    ...r,
    name: layout[r.id]?.name || referenceName(r.name),
  }));
  const composer = useRef<ComposerHandle>(null);
  const [history, setHistory] = useState<
    { id: string; text: string; kind: string }[]
  >([]);
  const record = (kind: string, text: string) =>
    setHistory((items) =>
      [...items, { id: crypto.randomUUID(), kind, text }].slice(-100),
    );
  const [mode, setMode] = useState<"fast" | "quality">("quality"),
    [textures, setTextures] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [sharedTrials, setSharedTrials] = useState<
    Array<{
      id: string;
      name: string;
      caseId: string;
      latest: boolean;
      origin: string;
    }>
  >([]);
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
    importInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<PipelineResult | null>(null);
  const playback = usePlayback(doc.duration),
    layer = doc.layers.find((l) => l.id === selected) || doc.layers[0];
  const selectLayer = (id: string) => {
    const item = doc.layers.find((l) => l.id === id);
    if (!item) return;
    setSelected(id);
    setStart(Number(item.start.toFixed(3)));
    setEnd(Number(item.end.toFixed(3)));
  };
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
    try {
      const raw = localStorage.getItem("autov.local.chat.v1");
      if (raw) {
        const items: unknown = JSON.parse(raw);
        if (Array.isArray(items))
          setHistory(
            items
              .filter(
                (e) =>
                  e &&
                  typeof e.id === "string" &&
                  typeof e.text === "string" &&
                  typeof e.kind === "string",
              )
              .slice(-100),
          );
      }
    } catch {
      /* History is optional. */
    }
    void fetch("/trial-presets/manifest.json")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (
          data.schemaVersion === "autov.shared-trials/1" &&
          Array.isArray(data.trials)
        )
          setSharedTrials(
            data.trials.filter(
              (t: { id?: string; name?: string; caseId?: string }) =>
                typeof t.id === "string" &&
                /^[-a-zA-Z0-9]{1,100}$/.test(t.id) &&
                typeof t.name === "string" &&
                typeof t.caseId === "string",
            ),
          );
      })
      .catch(() => {});
    const query = new URLSearchParams(window.location.search);
    const trialId = query.get("trial");
    const sharedTrial = query.get("sharedTrial");
    if (trialId || (sharedTrial && /^[-a-zA-Z0-9]{1,100}$/.test(sharedTrial)))
      void fetch(
        sharedTrial && /^[-a-zA-Z0-9]{1,100}$/.test(sharedTrial)
          ? `/trial-presets/effects/${encodeURIComponent(sharedTrial)}/document.json`
          : `/api/local-trials?id=${encodeURIComponent(trialId!)}&file=document`,
      )
        .then(async (r) => {
          if (!r.ok) throw new Error("Saved trial unavailable.");
          const imported = validateDocument(await r.json());
          setDoc(imported);
          setSelected(imported.layers[0].id);
          setNotice(
            "Saved trial opened. Changes do not overwrite the original trial.",
          );
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Trial unavailable."),
        );
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
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("autov.local.chat.v1", JSON.stringify(history));
      } catch {
        setError("Chat history could not be saved. Browser storage is full.");
      }
  }, [history, ready]);
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
    composer.current?.setText(RECIPES[id].prompt);
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
  const submit = async (prompt: string, ids: string[]) => {
    if (!prompt.trim() || busy || !runtime.current || !status?.configured)
      return false;
    let input: ReturnType<typeof referenceInput>;
    try {
      input = referenceInput(prompt, ids, references);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid references.");
      return false;
    }
    setError("");
    setBusy(true);
    setProposal(null);
    setSolo(undefined);
    const controller = new AbortController();
    abort.current = controller;
    playback.setPlaying(false);
    record(
      editMode
        ? `Edit ${layer.name} · ${start.toFixed(2)}–${end.toFixed(2)} s`
        : "Generate effect",
      displayPrompt(prompt),
    );
    try {
      const images = await Promise.all(
        input.selected.map((r) => prepareReference(r.url)),
      );
      if (editMode) {
        if (start < 0 || end > doc.duration || start >= end)
          throw new Error("Choose a valid time range within the effect.");
        setNotice(
          `Preparing an edit for ${layer.name}, ${start.toFixed(2)}–${end.toFixed(2)} s…`,
        );
        const result = await request(
          {
            action: "edit",
            prompt,
            references: images,
            document: doc,
            layerId: layer.id,
          },
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
        let allTrialsSaved = true;
        const saveCandidate = async (item: Candidate, selected = false) => {
          try {
            const saved = await fetch("/api/local-trials", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: item.id,
                prompt,
                references: images,
                source: "openai-live",
                origin: item.origin,
                selected,
                document: item.document,
                sheet: item.evidence.sheet,
                review: item.review,
              }),
            });
            if (!saved.ok) throw Error("Trial save failed");
          } catch {
            allTrialsSaved = false;
            setError(
              "A trial could not be saved. Download generation evidence before closing this page.",
            );
          }
        };
        const result = await generatePipeline({
          prompt,
          references: images,
          mode,
          textures,
          signal: controller.signal,
          request,
          capture: (document, solo, diagnostic) => {
            if (!runtime.current) throw new Error("Renderer unavailable.");
            return runtime.current.capture(document, { solo, diagnostic });
          },
          progress: setNotice,
          candidate: async (candidate) => {
            setCandidates((items) => {
              const index = items.findIndex((c) => c.id === candidate.id);
              return index < 0
                ? [...items, candidate]
                : items.map((c) => (c.id === candidate.id ? candidate : c));
            });
            await saveCandidate(candidate);
          },
        });
        setNotice("Saving every generated direction to the trial gallery…");
        for (const item of result.candidates)
          await saveCandidate(item, item.id === result.selected.id);
        setNotice(
          allTrialsSaved
            ? "Saved to the trial gallery. Compare the directions or keep editing."
            : "Generated effects are available here; some could not be saved to the gallery.",
        );
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
        record("Generated effect", result.selected.document.name);
      }
      return true;
    } catch (e) {
      record(
        "Request failed",
        controller.signal.aborted
          ? "Stopped"
          : e instanceof Error
            ? e.message
            : "Generation failed",
      );
      setError(
        controller.signal.aborted
          ? "Stopped. Your current effect is preserved; completed candidates remain available."
          : e instanceof Error
            ? e.message
            : "Generation failed. Previous effect preserved.",
      );
      return false;
    } finally {
      setBusy(false);
      abort.current = null;
      void refreshStatus();
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
      style={{ background: doc.post.background }}
    >
      <div className="viewport-grid" />
      <div className="lab-preview-stage">
        <Viewport
          doc={doc}
          time={playback.time}
          solo={solo}
          onReady={onRuntimeReady}
        />
      </div>
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
          <a className="lab-action" href="/trial-presets/index.html">
            Shared trials ↗
          </a>
          <Link className="lab-action" href="/local/trials">
            Trials ↗
          </Link>
          <select
            aria-label="Load preset"
            className="lab-mode"
            disabled={busy}
            value=""
            onChange={async (e) => {
              const sharedId = e.target.value.startsWith("shared:")
                ? e.target.value.slice(7)
                : null;
              const example =
                e.target.value === "texture-demo"
                  ? "generated-sigil.json"
                  : e.target.value === "smoke-trial"
                    ? "generated-smoke-trial.json"
                    : null;
              if (!example && !sharedId) {
                choosePreset(e.target.value as RecipeId);
                return;
              }
              try {
                const response = await fetch(
                  sharedId
                    ? `/trial-presets/effects/${encodeURIComponent(sharedId)}/document.json`
                    : `/examples/${example}`,
                );
                if (!response.ok) throw new Error("Example unavailable.");
                const next = validateDocument(await response.json());
                commit(next);
                setSelected(next.layers[0].id);
                setSolo(undefined);
                composer.current?.setText(next.description);
                playback.setTime(Math.min(next.duration, next.impact + 0.2));
                setCandidates([]);
                setPlan(null);
                setNotice(
                  sharedId
                    ? "DRAFT · Actual generated trial. Replay or edit it locally; no API call is needed."
                    : example === "generated-smoke-trial.json"
                      ? "Saved API-generated smoke example. Replay it or edit its layers."
                      : "Authored demonstration using a Codex-generated texture. This is not a live generation result.",
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Demo failed.");
              }
            }}
          >
            <option value="" disabled>
              Presets
            </option>
            <option value="texture-demo">Generated texture demo</option>
            <option value="smoke-trial">Generated smoke example</option>
            {[...new Set(sharedTrials.map((t) => t.caseId))]
              .sort()
              .map((caseId) => (
                <optgroup key={caseId} label={`DRAFT · ${caseId}`}>
                  {sharedTrials
                    .filter((t) => t.caseId === caseId)
                    .map((t, i) => (
                      <option key={t.id} value={`shared:${t.id}`}>
                        {t.latest ? "★ 最新 · " : ""}
                        {t.name} · {t.origin} · {i + 1}
                      </option>
                    ))}
                </optgroup>
              ))}
            {Object.entries(RECIPES).map(([id, recipe]) => (
              <option key={id} value={id}>
                {recipe.name}
              </option>
            ))}
          </select>
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
            if (file.size > 16_000_000)
              throw new Error("Effect JSON must be under 16 MB.");
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
        <PanelToggle side="left" label="Board" onOpen={() => setLeft(true)} />
      )}
      {!right && (
        <PanelToggle side="right" label="Chat" onOpen={() => setRight(true)} />
      )}
      <div hidden={!left}>
        <ReferencesPanel
          projectId="local"
          state={{ ...referenceState, references }}
          locked={busy}
          onCollapse={() => setLeft(false)}
          onMention={(ref) => {
            setRight(true);
            composer.current?.mention(ref);
          }}
        />
      </div>
      <div hidden={!right}>
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
              {!history.length && !lastPrompt && !notice && (
                <ChatEmptyState
                  disabled={busy}
                  onSelect={(text) => composer.current?.setText(text)}
                />
              )}
              {history.map((entry) => (
                <div key={entry.id} className="lab-history-entry">
                  <small>{entry.kind}</small>
                  <p className="user-message">{entry.text}</p>
                </div>
              ))}
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
                    {editMode
                      ? "Selected emitter → scoped edit → review → apply"
                      : mode === "quality"
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
                      height={Math.ceil(c.evidence.times.length / 4) * 202}
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
                          record(
                            "Edit applied",
                            `${doc.layers.find((l) => l.id === proposal.layerId)?.name} · ${proposal.override.start.toFixed(2)}–${proposal.override.end.toFixed(2)} s · ${proposal.override.target} → ${proposal.override.value}`,
                          );
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
          <div className="lab-chat-options">
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
            {!editMode && (
              <label className="lab-texture-option">
                <input
                  type="checkbox"
                  checked={textures}
                  disabled={busy}
                  onChange={(e) => setTextures(e.target.checked)}
                />{" "}
                Use generated textures when useful
              </label>
            )}
            {editMode && (
              <>
                <label className="lab-field">
                  Layer
                  <select
                    aria-label="Edit layer"
                    value={layer.id}
                    disabled={busy}
                    onChange={(e) => selectLayer(e.target.value)}
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
                      step="0.001"
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
                      step="0.001"
                      value={end}
                      disabled={busy}
                      onChange={(e) => setEnd(Number(e.target.value))}
                    />
                  </label>
                </div>
              </>
            )}
          </div>
          <ReferenceComposer
            ref={composer}
            references={references}
            busy={referenceState.busy || !status?.configured}
            saving={busy}
            uploadFile={referenceState.uploadFile}
            onSend={submit}
            sendLabel={editMode ? "Prepare scoped edit" : "Generate effect"}
          />
          {busy && (
            <button
              className="lab-action"
              onClick={() => abort.current?.abort()}
            >
              Stop generation
            </button>
          )}
          <div className="chat-footnote">
            {status ? (
              <span className="lab-budget">
                ${status.budget.used.toFixed(2)} / $
                {status.budget.limit.toFixed(0)} local limit ·{" "}
                {status.budget.pending
                  ? "includes reserved calls"
                  : "conservative usage"}
              </span>
            ) : (
              "Connecting…"
            )}
          </div>
        </aside>
      </div>
      <PlaybackPanel
        playback={playback}
        duration={doc.duration}
        name={doc.name}
        tracks={
          <EmitterTimeline
            layers={doc.layers}
            duration={doc.duration}
            time={playback.time}
            selected={layer.id}
            solo={solo}
            busy={busy}
            onAdd={() => {
              if (doc.layers.length >= 18) return;
              const next = structuredClone(doc);
              const emitter = structuredClone(
                createPreset("shockwave").layers.find(
                  (l) => l.kind === "particles",
                )!,
              );
              emitter.id = `emitter-${crypto.randomUUID()}`;
              emitter.name = `Emitter ${doc.layers.length + 1}`;
              emitter.start = 0;
              emitter.end = doc.duration;
              emitter.tracks = [];
              emitter.overrides = [];
              emitter.params.emission = Math.min(0.3, doc.duration / 4);
              emitter.params.life = Math.min(1, doc.duration / 2);
              emitter.params.count = 240;
              next.layers.push(emitter);
              try {
                commit(next);
                setSelected(emitter.id);
                setSolo(undefined);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Emitter limit reached.",
                );
              }
            }}
            onSelect={selectLayer}
            onSolo={(id) => setSolo(solo === id ? undefined : id)}
            onToggle={(id) => {
              const next = structuredClone(doc);
              const item = next.layers.find((l) => l.id === id)!;
              item.enabled = !item.enabled;
              try {
                commit(next);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Invalid selection");
              }
            }}
          />
        }
        effectControls={
          <div className="lab-controls lab-emitter-controls">
            <h3 className="lab-section-label lab-wide">
              {layer.name} · {layer.kind} · {layer.start.toFixed(2)}–
              {layer.end.toFixed(2)} s
            </h3>
            <button
              className="lab-action lab-wide"
              onClick={() => {
                setEditMode(true);
                setStart(Number(layer.start.toFixed(3)));
                setEnd(Number(layer.end.toFixed(3)));
                setRight(true);
              }}
            >
              Edit this layer in chat ↗
            </button>
            {layer.kind !== "particles" && (
              <>
                <label className="lab-field">
                  Mesh
                  <select
                    aria-label="Layer mesh"
                    value={layer.geometry || "auto"}
                    disabled={busy}
                    onChange={(e) => {
                      const next = structuredClone(doc);
                      const target = next.layers.find(
                        (l) => l.id === layer.id,
                      )!;
                      target.geometry = e.target.value as typeof layer.geometry;
                      if (target.geometry === "crystal-cluster")
                        target.params.count = Math.min(32, target.params.count);
                      commit(next);
                    }}
                  >
                    {GEOMETRIES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                {layer.geometry === "crystal-cluster" && (
                  <label className="lab-field">
                    Crystals
                    <input
                      aria-label="Crystal count"
                      type="number"
                      min={1}
                      max={32}
                      step={1}
                      value={layer.params.count}
                      disabled={busy}
                      onChange={(e) => {
                        const count = Number(e.target.value);
                        if (!Number.isInteger(count) || count < 1 || count > 32)
                          return;
                        const next = structuredClone(doc);
                        next.layers.find(
                          (l) => l.id === layer.id,
                        )!.params.count = count;
                        commit(next);
                      }}
                    />
                  </label>
                )}
                <label className="lab-field">
                  Surface
                  <select
                    aria-label="Layer surface"
                    value={layer.surface || "default"}
                    disabled={busy}
                    onChange={(e) => {
                      const next = structuredClone(doc);
                      next.layers.find((l) => l.id === layer.id)!.surface = e
                        .target.value as typeof layer.surface;
                      commit(next);
                    }}
                  >
                    {SURFACES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lab-field">
                  Texture
                  <select
                    aria-label="Layer texture"
                    value={layer.textureId || ""}
                    disabled={busy}
                    onChange={(e) => {
                      const next = structuredClone(doc);
                      next.layers.find((l) => l.id === layer.id)!.textureId =
                        e.target.value || null;
                      commit(next);
                    }}
                  >
                    <option value="">Procedural</option>
                    {(doc.textures || []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="lab-field">
              Color
              <input
                type="color"
                aria-label="Layer color"
                value={layer.params.color}
                disabled={busy}
                onChange={(e) => {
                  const next = structuredClone(doc);
                  next.layers.find((l) => l.id === layer.id)!.params.color =
                    e.target.value;
                  commit(next);
                }}
              />
            </label>
            <label className="lab-field">
              Secondary color
              <input
                type="color"
                aria-label="Layer secondary color"
                value={layer.params.secondaryColor}
                disabled={busy}
                onChange={(e) => {
                  const next = structuredClone(doc);
                  next.layers.find(
                    (l) => l.id === layer.id,
                  )!.params.secondaryColor = e.target.value;
                  commit(next);
                }}
              />
            </label>
            <label className="lab-field">
              Blend
              <select
                aria-label="Layer blend"
                value={layer.params.blend}
                disabled={busy}
                onChange={(e) => {
                  const next = structuredClone(doc);
                  next.layers.find((l) => l.id === layer.id)!.params.blend = e
                    .target.value as "additive" | "normal";
                  commit(next);
                }}
              >
                <option value="additive">Additive</option>
                <option value="normal">Normal</option>
              </select>
            </label>
            {(
              [
                "intensity",
                "radius",
                "width",
                "opacity",
                "length",
                "speed",
                "turbulence",
                "erosion",
                "spin",
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
                  max={RANGES[target][1]}
                  step="0.001"
                  value={layer.params[target]}
                  disabled={busy}
                  onChange={(e) => parameter(target, Number(e.target.value))}
                />
              </label>
            ))}
            <p className="lab-hint lab-wide">
              Manual sliders replace this parameter’s animation. Use a scoped
              chat edit to preserve it outside a time window.
            </p>
          </div>
        }
        environmentLabel="Environment settings"
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
              record("Undo", previous.name);
              setNotice("Undid the last document change.");
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
              record("Redo", next.name);
              setNotice("Restored the undone document change.");
              setProposal(null);
              setSelectedCandidate("");
            }}
          >
            Redo
          </button>
          <button
            className="lab-action"
            onClick={async () => {
              if (runtime.current)
                download(
                  "autov-contact-sheet.json",
                  JSON.stringify(
                    {
                      document: doc,
                      evidence: await runtime.current.capture(doc),
                    },
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

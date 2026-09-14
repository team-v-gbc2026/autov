"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIXTURE_IDS } from "@/lib/vfx-lab/asset-urls";
import { FAMILY_REFERENCES, spikeHref } from "./families";

// Review page: play every v2 exemplar family in a live viewport next to its
// benchmark reference video/image, and jump to the hand-built spike page for
// the same family.
//
// Reuses the same VfxRuntimeV2 / validateDocumentV2 contract as the
// /dev/vfx-v2 toolbox gallery (src/app/dev/vfx-v2/page.dev.tsx): both are
// loaded via a trivial-template dynamic import so this page still compiles
// and renders a "not built yet" state if either file is ever removed, and
// fixtures are fetched from the same /dev/vfx-v2/fixtures route rather than
// duplicating fixture-loading logic.

type VfxDocumentV2 = unknown;

interface VfxRuntimeV2Instance {
  setDocument(doc: unknown): void;
  render(time: number): void;
  resize(): void;
  resetCamera(): void;
  dispose(): void;
  setFeatureFlags(flags: Record<string, boolean>): void;
}

type VfxRuntimeV2Ctor = new (host: HTMLElement) => VfxRuntimeV2Instance;

type ModuleState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing" };

async function loadRuntimeV2(): Promise<VfxRuntimeV2Ctor | null> {
  try {
    const mod = (await import(`@/lib/vfx-lab/runtime-v2${""}`)) as {
      VfxRuntimeV2?: VfxRuntimeV2Ctor;
    };
    return typeof mod.VfxRuntimeV2 === "function" ? mod.VfxRuntimeV2 : null;
  } catch {
    return null;
  }
}

async function loadSchemaV2(): Promise<((input: unknown) => unknown) | null> {
  try {
    const mod = (await import(`@/lib/vfx-lab/schema-v2${""}`)) as {
      validateDocumentV2?: (input: unknown) => unknown;
    };
    return typeof mod.validateDocumentV2 === "function" ? mod.validateDocumentV2 : null;
  } catch {
    return null;
  }
}

type FixtureEntry = {
  id: string;
  name: string;
  document: VfxDocumentV2;
  v1Document: unknown | null;
  group?: "exemplar" | "generated";
};

const panelStyle: React.CSSProperties = {
  background: "#181a1d",
  border: "1px solid #2a2d31",
  borderRadius: 8,
  padding: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#9aa0a6",
  marginBottom: 6,
  display: "block",
};

const buttonStyle: React.CSSProperties = {
  background: "#26292e",
  border: "1px solid #3a3d42",
  borderRadius: 6,
  color: "#e6e6e6",
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
};

function noteStyle(kind: "info" | "warn" = "info"): React.CSSProperties {
  return {
    color: kind === "warn" ? "#e0a83a" : "#7d848c",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: 8,
  };
}

function docStats(doc: unknown): { layerCount: number; kinds: string[] } {
  if (typeof doc !== "object" || doc === null || !("layers" in doc)) {
    return { layerCount: 0, kinds: [] };
  }
  const layers = (doc as { layers?: unknown }).layers;
  if (!Array.isArray(layers)) return { layerCount: 0, kinds: [] };
  const kinds = new Set<string>();
  for (const layer of layers) {
    if (layer && typeof layer === "object" && "kind" in layer) {
      const kind = (layer as { kind?: unknown }).kind;
      if (typeof kind === "string") kinds.add(kind);
    }
  }
  return { layerCount: layers.length, kinds: [...kinds].sort() };
}

export default function VfxReviewPage() {
  const families = useMemo(() => [...FIXTURE_IDS].sort(), []);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(
    families[0] ?? null,
  );

  const [fixtures, setFixtures] = useState<Record<string, FixtureEntry>>({});
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [runtimeMod, setRuntimeMod] = useState<ModuleState<VfxRuntimeV2Ctor>>({
    status: "loading",
  });
  const [schemaMod, setSchemaMod] = useState<
    ModuleState<(input: unknown) => unknown>
  >({ status: "loading" });

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [docError, setDocError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<VfxRuntimeV2Instance | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  // Load the module-level runtime + schema once.
  useEffect(() => {
    let cancelled = false;
    loadRuntimeV2().then((ctor) => {
      if (!cancelled) setRuntimeMod(ctor ? { status: "ready", value: ctor } : { status: "missing" });
    });
    loadSchemaV2().then((fn) => {
      if (!cancelled) setSchemaMod(fn ? { status: "ready", value: fn } : { status: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the fixture document for the selected family (fetched on demand and
  // cached per family; "Reload document" bumps reloadNonce to force a
  // re-fetch while the other agent is still editing fixtures/**).
  useEffect(() => {
    if (!selectedFamily) return;
    let cancelled = false;
    fetch("/dev/vfx-v2/fixtures", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`fixtures route returned ${res.status}`);
        return res.json();
      })
      .then((body: { fixtures: FixtureEntry[] }) => {
        if (cancelled) return;
        const byId: Record<string, FixtureEntry> = {};
        for (const f of body.fixtures ?? []) byId[f.id] = f;
        setFixtures(byId);
        setFixtureError(null);
      })
      .catch((err) => {
        if (!cancelled) setFixtureError(String(err));
      })
      .finally(() => {
        if (!cancelled) setFixturesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFamily, reloadNonce]);

  const selectedFixture = selectedFamily ? fixtures[selectedFamily] ?? null : null;

  // Runtime construction and document loading are external-system
  // synchronization (WebGL context + three.js scene), not derived render
  // state — see src/app/dev/vfx-v2/page.dev.tsx for the same pattern.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (runtimeMod.status !== "ready" || !hostRef.current) return;
    const host = hostRef.current;
    let runtime: VfxRuntimeV2Instance | null = null;
    try {
      runtime = new runtimeMod.value(host);
      runtimeRef.current = runtime;
      setDocError(null);
    } catch (err) {
      setDocError(`VfxRuntimeV2 failed to construct: ${String(err)}`);
    }
    return () => {
      runtime?.dispose();
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeMod]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !selectedFixture) return;
    try {
      const validate = schemaMod.status === "ready" ? schemaMod.value : (d: unknown) => d;
      const doc = validate(selectedFixture.document);
      runtime.setDocument(doc);
      runtime.resetCamera();
      const maybeDuration = (doc as { duration?: number })?.duration;
      setDuration(typeof maybeDuration === "number" ? maybeDuration : 4);
      setTime(0);
      setDocError(null);
    } catch (err) {
      setDocError(`Document rejected: ${String(err)}`);
    }

  }, [selectedFixture, runtimeMod, schemaMod]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Drive the viewport off the shared clock.
  useEffect(() => {
    runtimeRef.current?.render(time);
  }, [time]);

  // Play/pause loop.
  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      return;
    }
    const tick = (now: number) => {
      if (lastFrameRef.current == null) lastFrameRef.current = now;
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      setTime((t) => {
        const next = t + dt * speed;
        if (next <= duration) return next;
        if (loop) return duration > 0 ? next % duration : 0;
        setPlaying(false);
        return duration;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, duration, loop]);

  // Keyboard: space = play/pause, arrows = +/- 0.1s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setTime((t) => Math.min(duration, t + 0.1));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setTime((t) => Math.max(0, t - 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);

  const syncVideoToViewport = useCallback(() => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, [time]);

  const syncViewportToVideo = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(false);
    setTime(Math.min(duration, v.currentTime));
  }, [duration]);

  const reference = selectedFamily ? FAMILY_REFERENCES[selectedFamily] : undefined;
  const stats = selectedFixture ? docStats(selectedFixture.document) : null;
  const spike = selectedFamily ? spikeHref(selectedFamily) : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0e0f11",
        color: "#e6e6e6",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        padding: 16,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>VFX review</h1>
        <span style={{ fontSize: 12, color: "#7d848c" }}>
          excluded from production builds
        </span>
        <Link href="/dev/vfx-v2" style={{ fontSize: 12, color: "#6ea8fe", marginLeft: "auto" }}>
          Toolbox gallery →
        </Link>
      </header>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 1000 }}>
        {/* Left: family list */}
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={panelStyle}>
            <span style={labelStyle}>Families ({families.length})</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {families.map((familyId) => {
                const ref = FAMILY_REFERENCES[familyId];
                return (
                  <button
                    key={familyId}
                    onClick={() => setSelectedFamily(familyId)}
                    style={{
                      ...buttonStyle,
                      textAlign: "left",
                      background: familyId === selectedFamily ? "#33507a" : buttonStyle.background,
                      borderColor:
                        familyId === selectedFamily ? "#5b7fb5" : (buttonStyle.borderColor as string),
                    }}
                  >
                    {familyId}
                    <div style={{ fontSize: 10, color: "#9aa0a6" }}>
                      {ref ? `${ref.caseId} · ${ref.kind}` : "no reference"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center: viewport + controls */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
          <div style={panelStyle}>
            <span style={labelStyle}>Viewport {selectedFamily ? `— ${selectedFamily}` : ""}</span>
            <div
              ref={hostRef}
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                background: "#000",
                borderRadius: 4,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {runtimeMod.status === "missing" && (
                <div style={noteStyle("warn")}>
                  VfxRuntimeV2 not built yet — waiting for
                  <br />
                  src/lib/vfx-lab/runtime-v2.ts (export {"{"} VfxRuntimeV2 {"}"})
                </div>
              )}
              {runtimeMod.status === "ready" && !selectedFixture && !fixturesLoading && (
                <div style={noteStyle()}>
                  {fixtureError ? fixtureError : "No document for this family yet."}
                </div>
              )}
              {docError && <div style={noteStyle("warn")}>{docError}</div>}
            </div>
            {schemaMod.status === "missing" && (
              <p style={{ fontSize: 11, color: "#7d848c", marginTop: 6 }}>
                schema-v2.ts not built yet — rendering fixtures unvalidated.
              </p>
            )}
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Playback</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <button style={buttonStyle} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : "Play"}
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                style={{ ...buttonStyle, cursor: "pointer" }}
              >
                {[0.25, 0.5, 1, 2, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <button
                style={buttonStyle}
                onClick={() => runtimeRef.current?.resetCamera()}
                disabled={runtimeMod.status !== "ready" || !selectedFixture}
              >
                Reset camera
              </button>
              <span style={{ fontSize: 12, color: "#9aa0a6", marginLeft: "auto" }}>
                {time.toFixed(2)}s / {duration.toFixed(2)}s
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={Math.min(time, duration)}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
              style={{ width: "100%" }}
            />
            <p style={{ fontSize: 11, color: "#7d848c", marginTop: 6 }}>
              space: play/pause · ←/→: ±0.1s · drag viewport: orbit
            </p>
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Sync &amp; actions</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={buttonStyle} onClick={syncVideoToViewport} disabled={!reference || reference.kind !== "video"}>
                Sync video → viewport time
              </button>
              <button style={buttonStyle} onClick={syncViewportToVideo} disabled={!reference || reference.kind !== "video"}>
                Sync viewport → video time
              </button>
              <button
                style={buttonStyle}
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                Reload document
              </button>
              {spike && (
                <Link href={spike} style={{ ...buttonStyle, textDecoration: "none" }} target="_blank">
                  Open spike →
                </Link>
              )}
            </div>
          </div>

          {stats && (
            <div style={panelStyle}>
              <span style={labelStyle}>Document stats</span>
              <pre
                style={{
                  fontSize: 11,
                  color: "#c6cad0",
                  margin: 0,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(stats, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Right: reference video/image */}
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <span style={labelStyle}>Reference{reference ? ` (${reference.caseId})` : ""}</span>
            {!reference && <div style={noteStyle()}>No benchmark reference for this family.</div>}
            {reference?.kind === "video" && (
              <video
                ref={videoRef}
                controls
                loop
                muted
                playsInline
                style={{ width: "100%", borderRadius: 4, background: "#000" }}
                src={`/dev/vfx-review/reference/${selectedFamily}`}
              />
            )}
            {reference?.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/dev/vfx-review/reference/${selectedFamily}`}
                alt={`${reference.caseId} reference`}
                style={{ width: "100%", borderRadius: 4, display: "block" }}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

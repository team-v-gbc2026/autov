"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VfxRuntime } from "@/lib/vfx-lab/runtime";
import { validateDocument } from "@/lib/vfx-lab/schema";

// --- Contract this page codes against -------------------------------------
//
// frontend/src/lib/vfx-lab/runtime-v2.ts is expected to export:
//   class VfxRuntimeV2 {
//     constructor(host: HTMLElement)
//     setDocument(doc: VfxDocumentV2): void
//     render(time: number): void
//     resize(): void
//     resetCamera(): void
//     dispose(): void
//     setFeatureFlags(flags: Partial<FeatureFlags>): void
//   }
//
// frontend/src/lib/vfx-lab/schema-v2.ts is expected to export:
//   function validateDocumentV2(input: unknown): VfxDocumentV2
//
// frontend/fixtures/v2/<id>/document.json is a v2 fixture; an optional
// sibling frontend/fixtures/v2/<id>/v1.json is the same effect authored
// against the v1 (autov.lab/1) schema, used for the side-by-side v1
// viewport below.
//
// None of runtime-v2.ts, schema-v2.ts, or fixtures/v2/ need to exist for
// this page to compile or render today: every optional piece is behind a
// dynamic import or a fetch, and this page shows a plain "not built yet"
// state instead of crashing until they land.
// ---------------------------------------------------------------------------

type FeatureFlags = Partial<{
  aa: boolean;
  textures: boolean;
  erosion: boolean;
  curl: boolean;
  light: boolean;
  post: boolean;
  ground: boolean;
  softParticles: boolean;
}>;

const FLAG_KEYS: (keyof FeatureFlags)[] = [
  "aa",
  "textures",
  "erosion",
  "curl",
  "light",
  "post",
  "ground",
  "softParticles",
];

const DEFAULT_FLAGS: FeatureFlags = Object.fromEntries(
  FLAG_KEYS.map((key) => [key, true]),
) as FeatureFlags;

interface VfxRuntimeV2Instance {
  setDocument(doc: unknown): void;
  render(time: number): void;
  resize(): void;
  resetCamera(): void;
  dispose(): void;
  setFeatureFlags(flags: FeatureFlags): void;
}

type VfxRuntimeV2Ctor = new (host: HTMLElement) => VfxRuntimeV2Instance;

type FixtureEntry = {
  id: string;
  name: string;
  document: unknown;
  v1Document: unknown | null;
};

type ModuleState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing" };

// Dynamic imports below use a template literal with a trivial ("") trailing
// interpolation on purpose: it keeps the specifier out of TypeScript's and
// the bundler's static module resolution (both would otherwise hard-fail
// the whole page at compile time while these files don't exist yet), while
// still resolving the real module once it's added — no rebuild-from-scratch
// needed, just re-open this page.
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

async function loadSchemaV2(): Promise<
  ((input: unknown) => unknown) | null
> {
  try {
    const mod = (await import(`@/lib/vfx-lab/schema-v2${""}`)) as {
      validateDocumentV2?: (input: unknown) => unknown;
    };
    return typeof mod.validateDocumentV2 === "function"
      ? mod.validateDocumentV2
      : null;
  } catch {
    return null;
  }
}

const TILE_W = 640;
const TILE_H = 360;
const TILE_COLS = 4;
const TILE_ROWS = 2;
const TILE_COUNT = TILE_COLS * TILE_ROWS;

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

export default function VfxV2DevGalleryPage() {
  const [fixtures, setFixtures] = useState<FixtureEntry[] | null>(null);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [runtimeV2Mod, setRuntimeV2Mod] = useState<
    ModuleState<VfxRuntimeV2Ctor>
  >({ status: "loading" });
  const [schemaV2Mod, setSchemaV2Mod] = useState<
    ModuleState<(input: unknown) => unknown>
  >({ status: "loading" });

  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  const [v2Error, setV2Error] = useState<string | null>(null);
  const [v1Error, setV1Error] = useState<string | null>(null);
  const [captureImg, setCaptureImg] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const v2HostRef = useRef<HTMLDivElement | null>(null);
  const v1HostRef = useRef<HTMLDivElement | null>(null);
  const v2RuntimeRef = useRef<VfxRuntimeV2Instance | null>(null);
  const v1RuntimeRef = useRef<VfxRuntime | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  // Load the fixture list.
  useEffect(() => {
    let cancelled = false;
    fetch("/dev/vfx-v2/fixtures")
      .then((res) => {
        if (!res.ok) throw new Error(`fixtures route returned ${res.status}`);
        return res.json();
      })
      .then((body: { fixtures: FixtureEntry[] }) => {
        if (cancelled) return;
        setFixtures(body.fixtures ?? []);
        if (body.fixtures?.length) setSelectedId(body.fixtures[0].id);
      })
      .catch((err) => {
        if (cancelled) return;
        setFixturesError(String(err));
        setFixtures([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the v2 runtime + schema modules once, tolerating either being absent.
  useEffect(() => {
    let cancelled = false;
    loadRuntimeV2().then((ctor) => {
      if (cancelled) return;
      setRuntimeV2Mod(ctor ? { status: "ready", value: ctor } : { status: "missing" });
    });
    loadSchemaV2().then((fn) => {
      if (cancelled) return;
      setSchemaV2Mod(fn ? { status: "ready", value: fn } : { status: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFixture = useMemo(
    () => fixtures?.find((f) => f.id === selectedId) ?? null,
    [fixtures, selectedId],
  );

  // Runtime construction and document loading are external-system
  // synchronization (WebGL context + three.js scene), not derived render
  // state, so the error/duration state they report is set from inside the
  // effect body itself. See src/components/vfx-lab/studio.tsx for the same
  // pattern already used elsewhere in this codebase.
  /* eslint-disable react-hooks/set-state-in-effect */

  // Create the v2 runtime once its host div and constructor are available.
  // Only (re)created when the constructor itself changes; flags/document are
  // pushed via setFeatureFlags/setDocument in the effects below.
  useEffect(() => {
    if (runtimeV2Mod.status !== "ready" || !v2HostRef.current) return;
    const host = v2HostRef.current;
    let runtime: VfxRuntimeV2Instance | null = null;
    try {
      runtime = new runtimeV2Mod.value(host);
      v2RuntimeRef.current = runtime;
      runtime.setFeatureFlags(flags);
      setV2Error(null);
    } catch (err) {
      setV2Error(`VfxRuntimeV2 failed to construct: ${String(err)}`);
    }
    return () => {
      runtime?.dispose();
      v2RuntimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeV2Mod]);

  // Push the selected document into the v2 runtime.
  useEffect(() => {
    const runtime = v2RuntimeRef.current;
    if (!runtime || !selectedFixture) return;
    try {
      const validate =
        schemaV2Mod.status === "ready" ? schemaV2Mod.value : (d: unknown) => d;
      const doc = validate(selectedFixture.document);
      runtime.setDocument(doc);
      runtime.resetCamera();
      const maybeDuration = (doc as { duration?: number })?.duration;
      setDuration(typeof maybeDuration === "number" ? maybeDuration : 4);
      setTime(0);
      setV2Error(null);
    } catch (err) {
      setV2Error(`Document rejected: ${String(err)}`);
    }
     
  }, [selectedFixture, runtimeV2Mod, schemaV2Mod]);

  // Set up the v1 comparison runtime whenever the fixture has a v1 sibling.
  useEffect(() => {
    if (!selectedFixture?.v1Document || !v1HostRef.current) {
      v1RuntimeRef.current?.dispose();
      v1RuntimeRef.current = null;
      return;
    }
    const host = v1HostRef.current;
    let runtime: VfxRuntime | null = null;
    try {
      runtime = new VfxRuntime(host);
      const doc = validateDocument(selectedFixture.v1Document);
      runtime.setDocument(doc);
      runtime.resetCamera();
      v1RuntimeRef.current = runtime;
      setV1Error(null);
    } catch (err) {
      setV1Error(`v1 sibling document rejected: ${String(err)}`);
    }
    return () => {
      runtime?.dispose();
      v1RuntimeRef.current = null;
    };
     
  }, [selectedFixture]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Feature flags -> v2 runtime.
  useEffect(() => {
    v2RuntimeRef.current?.setFeatureFlags(flags);
  }, [flags]);

  // Drive both viewports off one shared clock.
  useEffect(() => {
    v2RuntimeRef.current?.render(time);
    v1RuntimeRef.current?.render(time);
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
        return duration > 0 ? next % duration : 0;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, duration]);

  const toggleFlag = useCallback((key: keyof FeatureFlags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const capture = useCallback(async () => {
    const runtime = v2RuntimeRef.current;
    const host = v2HostRef.current;
    if (!runtime || !host) return;
    const canvas = host.querySelector("canvas");
    if (!canvas) return;
    setCapturing(true);
    setPlaying(false);
    try {
      const sheet = document.createElement("canvas");
      sheet.width = TILE_W * TILE_COLS;
      sheet.height = TILE_H * TILE_ROWS;
      const ctx = sheet.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0b0c0d";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      for (let i = 0; i < TILE_COUNT; i++) {
        const t = TILE_COUNT > 1 ? (i / (TILE_COUNT - 1)) * duration : 0;
        runtime.render(t);
        // Let the browser present the frame before we read the canvas back.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const col = i % TILE_COLS;
        const row = Math.floor(i / TILE_COLS);
        ctx.drawImage(canvas, col * TILE_W, row * TILE_H, TILE_W, TILE_H);
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.strokeRect(col * TILE_W + 0.5, row * TILE_H + 0.5, TILE_W - 1, TILE_H - 1);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "16px ui-monospace, monospace";
        ctx.fillText(`t=${t.toFixed(2)}s`, col * TILE_W + 8, row * TILE_H + 20);
      }
      setCaptureImg(sheet.toDataURL("image/png"));
      runtime.render(time);
    } finally {
      setCapturing(false);
    }
     
  }, [duration, time]);

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
        <h1 style={{ fontSize: 16, margin: 0 }}>Toolbox v2 dev gallery</h1>
        <span style={{ fontSize: 12, color: "#7d848c" }}>
          excluded from production builds
        </span>
        <Link href="/dev/vfx-v2/spike" style={{ fontSize: 12, color: "#6ea8fe", marginLeft: "auto" }}>
          Spike →
        </Link>
      </header>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 1000 }}>
        {/* Left: controls */}
        <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <span style={labelStyle}>Fixture</span>
            {fixtures === null && <div style={noteStyle()}>loading…</div>}
            {fixturesError && <div style={noteStyle("warn")}>{fixturesError}</div>}
            {fixtures?.length === 0 && (
              <div style={noteStyle()}>
                No fixtures yet — waiting for
                <br />
                fixtures/v2/&lt;id&gt;/document.json
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {fixtures?.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedId(f.id)}
                  style={{
                    ...buttonStyle,
                    textAlign: "left",
                    background: f.id === selectedId ? "#33507a" : buttonStyle.background,
                    borderColor: f.id === selectedId ? "#5b7fb5" : (buttonStyle.borderColor as string),
                  }}
                >
                  {f.name}
                  {f.v1Document ? " · v1 ✓" : ""}
                </button>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Playback</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <button style={buttonStyle} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : "Play"}
              </button>
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
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Feature flags (v2)</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {FLAG_KEYS.map((key) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!!flags[key]}
                    onChange={() => toggleFlag(key)}
                  />
                  {key}
                </label>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Camera</span>
            <button
              style={{ ...buttonStyle, width: "100%" }}
              onClick={() => v2RuntimeRef.current?.resetCamera()}
              disabled={runtimeV2Mod.status !== "ready" || !selectedFixture}
            >
              Reset camera
            </button>
            <p style={{ fontSize: 11, color: "#7d848c", marginTop: 6 }}>
              drag: orbit · right-drag/shift: pan · wheel: zoom
            </p>
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>Capture</span>
            <button
              style={{ ...buttonStyle, width: "100%", opacity: capturing ? 0.6 : 1 }}
              onClick={capture}
              disabled={capturing || runtimeV2Mod.status !== "ready" || !selectedFixture}
            >
              {capturing ? "Capturing…" : `Contact sheet (${TILE_COUNT} frames)`}
            </button>
            <p style={{ fontSize: 11, color: "#7d848c", marginTop: 6 }}>
              8 evenly-spaced frames across the document&apos;s duration, 2×4 tiles
              at {TILE_W}×{TILE_H} — paste this into PRs.
            </p>
          </div>
        </div>

        {/* Center: viewports + capture output */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, maxWidth: 960 }}>
          <div style={panelStyle}>
            <span style={labelStyle}>v2 renderer</span>
            <div
              ref={v2HostRef}
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                background: "#000",
                borderRadius: 4,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {runtimeV2Mod.status === "missing" && (
                <div style={noteStyle("warn")}>
                  VfxRuntimeV2 not built yet — waiting for
                  <br />
                  src/lib/vfx-lab/runtime-v2.ts (export {"{"} VfxRuntimeV2 {"}"})
                </div>
              )}
              {runtimeV2Mod.status === "ready" && !selectedFixture && (
                <div style={noteStyle()}>Select a fixture.</div>
              )}
              {v2Error && <div style={noteStyle("warn")}>{v2Error}</div>}
            </div>
            {schemaV2Mod.status === "missing" && (
              <p style={{ fontSize: 11, color: "#7d848c", marginTop: 6 }}>
                schema-v2.ts not built yet — rendering fixtures unvalidated.
              </p>
            )}
          </div>

          <div style={panelStyle}>
            <span style={labelStyle}>v1 renderer</span>
            <div
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                background: "#000",
                borderRadius: 4,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {!selectedFixture?.v1Document && (
                <div style={noteStyle()}>no v1 counterpart</div>
              )}
              {!!selectedFixture?.v1Document && (
                <div ref={v1HostRef} style={{ width: "100%", height: "100%" }} />
              )}
              {v1Error && <div style={noteStyle("warn")}>{v1Error}</div>}
            </div>
          </div>

          {captureImg && (
            <div style={panelStyle}>
              <span style={labelStyle}>Contact sheet</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={captureImg} alt="v2 contact sheet" style={{ width: "100%", borderRadius: 4 }} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

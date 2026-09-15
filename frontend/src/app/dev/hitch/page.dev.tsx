"use client";

import { useEffect, useRef, useState } from "react";
import type { RecipeV2Id } from "@/lib/vfx-lab/recipes-v2";
import type { VfxRuntimeV2 } from "@/lib/vfx-lab/runtime-v2";

/** Local-only manual review; page.dev.tsx is excluded from production builds. */
export default function HitchReview() {
  const host = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<RecipeV2Id>("ice-blast");
  const [attempt, setAttempt] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [status, setStatus] = useState("Preparing…");
  useEffect(() => {
    let runtime: VfxRuntimeV2 | undefined;
    let stopped = false;
    let frame = 0;
    void Promise.all([
      import("@/lib/vfx-lab/runtime-v2"),
      import("@/lib/vfx-lab/recipes-v2"),
    ])
      .then(async ([{ VfxRuntimeV2 }, { createPresetV2 }]) => {
        if (stopped || !host.current) return;
        setStatus("Preparing…");
        const doc = createPresetV2(preset);
        runtime = new VfxRuntimeV2(host.current, { preview: true });
        const instance = runtime;
        instance.setInteractive(false);
        const start = performance.now();
        instance.setDocument(doc);
        instance.resize(960, 540);
        await instance.whenReady();
        if (stopped) return;
        setStatus(
          `Ready in ${(performance.now() - start).toFixed(0)} ms · 960 × 540 · authored particle count and quality`,
        );
        const playbackStart = performance.now();
        const draw = (now: number) => {
          if (stopped) return;
          try {
            instance.renderPreview(
              ((now - playbackStart) / 1000) % doc.duration,
            );
            frame = requestAnimationFrame(draw);
          } catch (error) {
            setStatus(String(error));
          }
        };
        frame = requestAnimationFrame(draw);
      })
      .catch((error) => {
        if (!stopped) setStatus(String(error));
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      void runtime?.dispose();
    };
  }, [preset, attempt]);
  return (
    <main
      style={{
        padding: 24,
        background: "#111315",
        color: "#eee",
        minHeight: "100vh",
      }}
    >
      <h1>VFX preparation · Issue #41</h1>
      <p>
        Switch effects during preparation to check cancellation. Click the
        counter while loading to check main-thread responsiveness.
      </p>
      <div style={{ display: "flex", gap: 16, marginBlock: 16 }}>
        <select
          aria-label="Effect"
          value={preset}
          onChange={(event) => setPreset(event.target.value as RecipeV2Id)}
        >
          {[
            "ice-blast",
            "smoke-burst",
            "fire-projectile",
            "water-projectile",
            "glitch-projectile",
          ].map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
        <button onClick={() => setAttempt((value) => value + 1)}>
          Cold reload
        </button>
        <button onClick={() => setClicks((value) => value + 1)}>
          Input response: {clicks}
        </button>
      </div>
      <p role="status">{status}</p>
      <div
        ref={host}
        style={{
          position: "relative",
          width: 960,
          height: 540,
          maxWidth: "100%",
        }}
      />
      <p>
        Automated before/after timings and pixel comparisons:{" "}
        <code>node scripts/webgpu/verify-hitch.mjs</code>.
      </p>
    </main>
  );
}

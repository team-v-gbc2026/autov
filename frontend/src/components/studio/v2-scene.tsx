"use client";

import { useEffect, useRef, useState } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import type { VfxRuntimeV2 } from "@/lib/vfx-lab/runtime-v2";

/** Slider drags fire many times a frame; coalesce document installs. */
const INSTALL_DEBOUNCE_MS = 50;

/**
 * The product preview: the real autov.lab/2 renderer, mounted into the same
 * host element and CSS classes `ParticleScene` uses so `.lab-preview-stage`
 * lays it out identically. Orbit controls come from the runtime itself.
 */
export default function V2Scene({
  doc,
  time,
  solo,
}: {
  doc: VfxDocumentV2;
  time: number;
  solo?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<VfxRuntimeV2 | null>(null);
  // The rAF loop and the async mount read the latest props through refs, so a
  // new time, solo or document never tears the renderer down.
  const latest = useRef({ time, solo });
  const pending = useRef(doc);
  const installed = useRef<VfxDocumentV2 | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = { time, solo };
    pending.current = doc;
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let instance: VfxRuntimeV2 | undefined;
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      setStatus("error");
    };
    import("@/lib/vfx-lab/runtime-v2")
      .then(async ({ VfxRuntimeV2 }) => {
        if (cancelled) return;
        instance = new VfxRuntimeV2(element);
        runtime.current = instance;
        instance.setDocument(pending.current);
        installed.current = pending.current;
        await instance.whenReady();
        if (cancelled) return;
        instance.resize();
        observer = new ResizeObserver(() => {
          if (!cancelled) instance?.resize();
        });
        observer.observe(element);
        setStatus("ready");
        const draw = () => {
          if (cancelled) return;
          try {
            instance!.render(latest.current.time, latest.current.solo);
          } catch (problem) {
            fail(
              problem instanceof Error ? problem.message : "Preview failed.",
            );
            return;
          }
          frame = requestAnimationFrame(draw);
        };
        draw();
      })
      .catch((problem) =>
        fail(
          problem instanceof Error
            ? problem.message
            : "WebGL2 is unavailable. Enable browser hardware acceleration.",
        ),
      );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      instance?.dispose();
      runtime.current = null;
      installed.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const instance = runtime.current;
      // The mount installs whatever is pending; only later changes come here.
      if (!instance || installed.current === doc) return;
      try {
        // setDocument reframes and resets the camera; an edit should not throw
        // away the orbit the author set up, so restore it afterwards.
        const eye = instance.camera.position.clone();
        const target = instance.controls.target.clone();
        instance.setDocument(doc);
        installed.current = doc;
        instance.camera.position.copy(eye);
        instance.controls.target.copy(target);
        instance.camera.lookAt(target);
        instance.camera.updateProjectionMatrix();
        instance.controls.update();
        void instance.whenReady();
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "Invalid effect.");
        setStatus("error");
      }
    }, INSTALL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc]);

  return (
    <div className="scene-container scene-interactive">
      <div ref={host} className="scene-host" />
      <div className="scene-navigation-hint">
        DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM
      </div>
      {status === "loading" && (
        <div className="scene-status" role="status">
          <span className="scene-loader" /> Preparing the scene
        </div>
      )}
      {status === "error" && (
        <div className="scene-status scene-error" role="alert">
          <strong>Scene unavailable</strong>
          <p>{error}</p>
          <button
            onClick={() => {
              setStatus("loading");
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Reload scene
          </button>
        </div>
      )}
    </div>
  );
}

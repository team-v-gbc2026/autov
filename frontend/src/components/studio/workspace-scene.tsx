"use client";

import { useEffect, useRef, useState } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import type { PlaybackClock } from "./playback-clock";
import { needsWorkspaceFraming, workspaceVisibleArea } from "./workspace-presentation";
import type { VfxRuntimeV2 } from "@/lib/vfx-lab/runtime-v2";

/** Slider drags fire many times a frame; coalesce document installs. */
const INSTALL_DEBOUNCE_MS = 50;

/**
 * Persistent workspace canvas. Document edits update the existing scene;
 * orbit controls and rendering are owned by the runtime.
 */
export default function WorkspaceScene({
  doc: effect,
  clock,
  solo,
  focusRequest = 0,
  loaded = true,
}: {
  doc: VfxDocumentV2;
  clock: PlaybackClock;
  solo?: string;
  focusRequest?: number;
  /**
   * Whether `doc` is the project's own document rather than the empty
   * placeholder the studio renders until the server answers. The first loaded
   * document is framed; ordinary edits keep the camera the user set.
   */
  loaded?: boolean;
}) {
  // Render the same authored environment as the candidate capture.
  const doc = effect;
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<VfxRuntimeV2 | null>(null);
  // The rAF loop and the async mount read the latest props through refs, so a
  // new clock, solo or document never tears the renderer down.
  const latest = useRef({ clock, solo, loaded });
  const pending = useRef(doc);
  const installed = useRef<VfxDocumentV2 | null>(null);
  // Empty scenes do not consume the first-effect framing. Explicit authored
  // camera changes reframe; ordinary parameter edits preserve the user's orbit.
  const framed = useRef(false);
  // Between setDocument and whenReady the device builds this document's
  // pipelines. Drawing the new scene at full size during that only adds to the
  // stall, so the last prepared frame stays on screen instead.
  const preparing = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = { clock, solo, loaded };
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
        instance = new VfxRuntimeV2(element, { preview: true });
        runtime.current = instance;
        // The timeline waits for the device: a held clock keeps playback at the
        // frame the preparation started on instead of stalling mid-play.
        const release = latest.current.clock.hold();
        try {
          instance.setDocument(pending.current);
          installed.current = pending.current;
          if (latest.current.loaded && pending.current.layers.some(layer => layer.enabled)) framed.current = true;
          await instance.whenReady();
        } finally {
          release();
        }
        if (cancelled) return;
        const resize = () => {
          if (cancelled || !instance) return;
          instance.resize();
          const area = workspaceVisibleArea(element);
          if (area) instance.focus(area, latest.current.solo, pending.current.camera.framing);
        };
        resize();
        observer = new ResizeObserver(resize);
        observer.observe(element);
        setStatus("ready");
        const draw = () => {
          if (cancelled) return;
          try {
            if (!preparing.current)
              instance!.renderPreview(latest.current.clock.getSnapshot().time, latest.current.solo);
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
            : "WebGPU is unavailable. Use a supported browser with hardware acceleration.",
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
      // First effects and authored camera changes use the same safe area as
      // Focus; ordinary edits keep the camera where the user left it.
      const first = needsWorkspaceFraming(installed.current, doc, framed.current);
      const release = clock.hold();
      preparing.current = true;
      const settle = () => {
        preparing.current = false;
        release();
      };
      try {
        instance.setDocument(doc, { preserveCamera: !first });
        installed.current = doc;
        if (loaded && doc.layers.some(layer => layer.enabled)) framed.current = true;
        if (first) setStatus("loading");
        void instance.whenReady().then(
          () => {
            settle();
            if (runtime.current === instance && installed.current === doc && first) {
              const area = host.current && workspaceVisibleArea(host.current);
              if (area) instance.focus(area, solo, doc.camera.framing);
              setStatus("ready");
            }
          },
          problem => {
            settle();
            if (runtime.current !== instance || installed.current !== doc) return;
            setError(problem instanceof Error ? problem.message : "Could not prepare the scene.");
            setStatus("error");
          },
        );
      } catch (problem) {
        settle();
        setError(problem instanceof Error ? problem.message : "Invalid effect.");
        setStatus("error");
      }
    }, INSTALL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, clock, loaded, solo]);

  useEffect(() => {
    if (!focusRequest || !runtime.current || !host.current) return;
    const area = workspaceVisibleArea(host.current);
    if (area) runtime.current.focus(area, solo);
  }, [focusRequest, solo]);

  return (
    <div className="scene-container scene-interactive">
      <div ref={host} className="scene-host" />
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

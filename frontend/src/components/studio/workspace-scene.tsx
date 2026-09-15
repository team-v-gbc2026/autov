"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import type { PlaybackClock } from "./playback-clock";
import { createWorkspaceDocument } from "@/lib/vfx-lab/ui-bridge";
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
   * document is framed; everything after it keeps the camera the user set.
   */
  loaded?: boolean;
}) {
  // The studio stage stays visible even when an effect authors a black backdrop.
  const doc = useMemo(() => ({ ...effect, environment: createWorkspaceDocument().environment }), [effect]);
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<VfxRuntimeV2 | null>(null);
  // The rAF loop and the async mount read the latest props through refs, so a
  // new clock, solo or document never tears the renderer down.
  const latest = useRef({ clock, solo, loaded });
  const pending = useRef(doc);
  const installed = useRef<VfxDocumentV2 | null>(null);
  // The camera is framed once, for the first document that is actually the
  // project's. Without this a project opened from a preset keeps the pose that
  // framed the empty placeholder, which sits inside the effect.
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
          if (latest.current.loaded) framed.current = true;
          await instance.whenReady();
        } finally {
          release();
        }
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
      preparing.current = false;
      framed.current = false;
    };
  }, [attempt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const instance = runtime.current;
      // The mount installs whatever is pending; only later changes come here.
      if (!instance || installed.current === doc) return;
      // The project's first real document is framed the way the exemplars and
      // the Focus button frame it; user edits keep the camera where it is.
      const first = !framed.current;
      const release = clock.hold();
      preparing.current = true;
      const settle = () => {
        if (runtime.current === instance && installed.current === doc)
          preparing.current = false;
        release();
      };
      try {
        instance.setDocument(doc, { preserveCamera: !first });
        installed.current = doc;
        if (loaded) framed.current = true;
        if (first) setStatus("loading");
        void instance.whenReady().then(
          () => {
            settle();
            if (runtime.current === instance && installed.current === doc) setStatus("ready");
          },
          problem => {
            settle();
            if (runtime.current !== instance || installed.current !== doc) return;
            setError(problem instanceof Error ? problem.message : "Could not prepare the scene.");
            setStatus("error");
          },
        );
      } catch (problem) {
        if (runtime.current === instance) preparing.current = false;
        settle();
        setError(problem instanceof Error ? problem.message : "Invalid effect.");
        setStatus("error");
      }
    }, INSTALL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, clock, loaded]);

  useEffect(() => {
    if (!focusRequest || !runtime.current || !host.current) return;
    const canvas = host.current.getBoundingClientRect();
    const studio = host.current.closest(".studio");
    if (!studio) return;
    let left = 0, right = canvas.width, top = 0, bottom = canvas.height;
    let occupied = false;
    for (const panel of studio.querySelectorAll<HTMLElement>("aside, #playback-timeline")) {
      if (!panel.getClientRects().length) continue;
      const rect = panel.getBoundingClientRect();
      occupied = true;
      if (panel.id === "playback-timeline") bottom = Math.min(bottom, rect.top - canvas.top - 16);
      else if (panel.classList.contains("chat-panel")) right = Math.min(right, rect.left - canvas.left - 16);
      else left = Math.max(left, rect.right - canvas.left + 16);
    }
    if (occupied) {
      const strip = studio.querySelector(".lab-environment-strip")?.getBoundingClientRect();
      top = strip ? strip.bottom - canvas.top + 16 : 0;
    }
    if (right - left < 32 || bottom - top < 32) return;
    runtime.current.focus({ left, top, width: right - left, height: bottom - top }, solo);
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

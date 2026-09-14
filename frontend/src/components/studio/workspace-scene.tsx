"use client";

import { viewerGpuPreference } from "@/lib/vfx-lab/viewer-gpu-preference";

import { useEffect, useRef, useState } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import type { BackdropController, BackdropSnapshot } from "@/lib/vfx-lab/backdrop-controller";
import { loadBackdropSettings, saveBackdropSettings } from "@/lib/vfx-lab/backdrop-settings";
import type { PlacementController, PlacementSnapshot } from "@/lib/vfx-lab/placement-controller";
import { loadPlacement, savePlacement } from "@/lib/vfx-lab/placement-settings";
import type { PlaybackClock } from "./playback-clock";
import type { VfxRuntimeV2 } from "@/lib/vfx-lab/runtime-v2";

/** Slider drags fire many times a frame; coalesce document installs. */
const INSTALL_DEBOUNCE_MS = 50;

/**
 * Persistent workspace canvas. Document edits update the existing scene;
 * orbit controls and rendering are owned by the runtime.
 */
export default function WorkspaceScene({
  doc,
  clock,
  solo,
  focusRequest = 0,
  backdropStorageKey,
  onBackdropReady,
  onBackdropChange,
  placementStorageKey,
  onPlacementReady,
  onPlacementChange,
}: {
  doc: VfxDocumentV2;
  clock: PlaybackClock;
  solo?: string;
  focusRequest?: number;
  backdropStorageKey: string;
  onBackdropReady?: (controller: BackdropController | null) => void;
  onBackdropChange?: (snapshot: BackdropSnapshot) => void;
  placementStorageKey: string;
  onPlacementReady?: (controller: PlacementController | null) => void;
  onPlacementChange?: (snapshot: PlacementSnapshot) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<VfxRuntimeV2 | null>(null);
  // The rAF loop and the async mount read the latest props through refs, so a
  // new clock, solo or document never tears the renderer down.
  const latest = useRef({ clock, solo, onBackdropReady, onBackdropChange, onPlacementReady, onPlacementChange });
  const pending = useRef(doc);
  const installed = useRef<VfxDocumentV2 | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = { clock, solo, onBackdropReady, onBackdropChange, onPlacementReady, onPlacementChange };
    pending.current = doc;
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let instance: VfxRuntimeV2 | undefined;
    let backdrop: BackdropController | undefined;
    let placement: PlacementController | undefined;
    const fail = (message: string) => {
      if (cancelled) return;
      setError(message);
      setStatus("error");
    };
    import("@/lib/vfx-lab/runtime-v2")
      .then(async ({ VfxRuntimeV2 }) => {
        if (cancelled) return;
        instance = new VfxRuntimeV2(element, { preview: true, powerPreference: viewerGpuPreference() });
        runtime.current = instance;
        instance.setDocument(pending.current);
        installed.current = pending.current;
        await instance.whenReady();
        if (cancelled) return;
        const { BackdropController } = await import("@/lib/vfx-lab/backdrop-controller");
        if (cancelled) return;
        let restoring = true;
        backdrop = new BackdropController({
          scene: instance.scene,
          renderer: instance.renderer,
          requestRender: () => {
            if (cancelled || !instance) return;
            try {
              // Preview skips unchanged clock snapshots; backdrop edits also
              // need a fresh frame while playback is paused.
              instance.render(latest.current.clock.getSnapshot().time, latest.current.solo);
            } catch (problem) {
              fail(problem instanceof Error ? problem.message : "Could not render the backdrop.");
            }
          },
          onChange: snapshot => {
            if (cancelled) return;
            latest.current.onBackdropChange?.(snapshot);
            if (!restoring) saveBackdropSettings(snapshot.settings, backdropStorageKey);
          },
        });
        latest.current.onBackdropReady?.(backdrop);
        latest.current.onBackdropChange?.(backdrop.snapshot);
        // Transform and visibility only: the asset itself loads on demand from
        // the Backdrop panel, never at startup.
        backdrop.restoreSettings(loadBackdropSettings(backdropStorageKey));
        restoring = false;
        const { PlacementController } = await import("@/lib/vfx-lab/placement-controller");
        if (cancelled) return;
        let restoringPlacement = true;
        placement = new PlacementController({
          scene: instance.scene,
          camera: instance.camera,
          domElement: instance.renderer.domElement,
          orbit: instance.controls,
          effectRoot: instance.effectRoot,
          applyPlacement: next => instance?.setPlacement(next),
          requestRender: () => {
            if (cancelled || !instance) return;
            try {
              // Paused playback still has to show the drag.
              instance.render(latest.current.clock.getSnapshot().time, latest.current.solo);
            } catch (problem) {
              fail(problem instanceof Error ? problem.message : "Could not render the placement.");
            }
          },
          onChange: snapshot => {
            if (cancelled) return;
            latest.current.onPlacementChange?.(snapshot);
            if (!restoringPlacement) savePlacement(snapshot.placement, placementStorageKey);
          },
        });
        // Restore without an undo entry: reopening a workspace is not an edit.
        placement.setPlacement(loadPlacement(placementStorageKey), { history: false });
        restoringPlacement = false;
        latest.current.onPlacementReady?.(placement);
        latest.current.onPlacementChange?.(placement.snapshot);
        instance.resize();
        observer = new ResizeObserver(() => {
          if (!cancelled) instance?.resize();
        });
        observer.observe(element);
        setStatus("ready");
        const draw = () => {
          if (cancelled) return;
          try {
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
      latest.current.onBackdropReady?.(null);
      latest.current.onPlacementReady?.(null);
      placement?.dispose();
      backdrop?.dispose();
      instance?.dispose();
      runtime.current = null;
      installed.current = null;
    };
  }, [attempt, backdropStorageKey, placementStorageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const instance = runtime.current;
      // The mount installs whatever is pending; only later changes come here.
      if (!instance || installed.current === doc) return;
      try {
        instance.setDocument(doc, { preserveCamera: true });
        installed.current = doc;
        void instance.whenReady().catch(problem => {
          if (runtime.current !== instance || installed.current !== doc) return;
          setError(problem instanceof Error ? problem.message : "Could not prepare the scene.");
          setStatus("error");
        });
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "Invalid effect.");
        setStatus("error");
      }
    }, INSTALL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc]);

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

import * as THREE from "three";
import { clamp } from "./evaluate";
import { evaluateLayerV2 } from "./evaluate-v2";
import { RUNTIME_VERSION_V2, VfxRuntimeV2 } from "./runtime-v2";
import { type VfxDocumentV2, validateDocumentV2 } from "./schema-v2";
import type { Evidence } from "./runtime";
import {
  measureFrameActivity,
  summarizeActivity,
  type TemporalDiagnostics,
} from "./temporal";

// ---------------------------------------------------------------------------
// Headless evidence capture for autov.lab/2 documents.
//
// Same contract as VfxRuntime.capture in v1 — an Evidence record with a
// timestamped contact sheet, rendered-pixel count and 30 Hz activity
// diagnostics — so the pipeline, the reviewer and the benchmark archive do not
// need to know which schema produced a candidate.
//
// One deliberate difference: v1 hides its debug grid before capturing, because
// that grid is renderer furniture. In v2 the ground belongs to the document
// (environment.ground), so it stays visible: it is part of what the reviewer is
// asked to judge.
// ---------------------------------------------------------------------------

const SHEET_WIDTH = 1280;
const TILE_WIDTH = 320;
const TILE_HEIGHT = 180;
const ROW_HEIGHT = 202;
const MAX_TIMES = 16;

/** Event-timed capture moments; mirrors v1's spacing rules on v2 layers. */
export function captureTimesV2(doc: VfxDocumentV2) {
  const impacts = doc.layers
    .filter((l) => l.enabled && l.role === "impact")
    .map((l) => l.start);
  const impact = impacts.length ? Math.min(...impacts) : doc.impact;
  const normalize = (t: number) =>
    Math.round(clamp(t, 0, doc.duration - 0.001) * 1000) / 1000;
  const selected = new Set<number>([
    0,
    normalize(doc.duration * 0.1),
    normalize(doc.duration * 0.2),
    normalize(doc.duration * 0.35),
    normalize(doc.duration * 0.55),
    normalize(doc.duration * 0.8),
    normalize(doc.duration - 0.001),
  ]);
  if (
    doc.layers.some(
      (l) => l.enabled && l.role === "primary" && l.end - l.start > 0.6,
    )
  ) {
    selected.add(normalize(doc.duration * 0.9));
    selected.add(normalize(doc.duration * 0.96));
  }
  const priority = [
    Math.max(0, impact - 0.02),
    impact + 0.02,
    ...doc.layers
      .filter(
        (l) =>
          l.enabled &&
          (l.role === "primary" || l.role === "impact") &&
          l.end - l.start <= 0.5,
      )
      .map((l) => l.start + Math.min(0.08, (l.end - l.start) / 2)),
    impact + 0.08,
    impact * 0.5,
    impact + 0.18,
    impact + 0.35,
    impact + 0.65,
    doc.duration * 0.35,
    doc.duration * 0.65,
    doc.duration * 0.82,
  ];
  for (const time of priority) {
    if (selected.size >= MAX_TIMES) break;
    selected.add(normalize(time));
  }
  for (let i = 1; selected.size < MAX_TIMES && i < 24; i++)
    selected.add(normalize((doc.duration * i) / 24));
  return [...selected].sort((a, b) => a - b);
}

function rendererDescription(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return String(
    gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  );
}

/**
 * Render `doc` with the v2 runtime into an off-screen host and return Evidence.
 * The runtime instance is created and disposed inside this call, so nothing
 * about the caller's live preview is disturbed.
 */
export async function captureV2(
  input: VfxDocumentV2,
  options: { solo?: string; diagnostic?: boolean } = {},
): Promise<Evidence> {
  const doc = validateDocumentV2(input);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
  document.body.appendChild(host);
  const runtime = new VfxRuntimeV2(host);
  try {
    runtime.setDocument(doc);
    runtime.resize(TILE_WIDTH, TILE_HEIGHT);
    await runtime.whenReady();
    // One warm-up frame so every shader is compiled before the first tile.
    runtime.render(0, options.solo, options.diagnostic);

    const times = captureTimesV2(doc);
    const sheet = document.createElement("canvas");
    sheet.width = SHEET_WIDTH;
    sheet.height = Math.ceil(times.length / 4) * ROW_HEIGHT;
    const ctx = sheet.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Capture unavailable.");
    ctx.fillStyle = "#101112";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    let renderedPixels = 0;
    times.forEach((time, index) => {
      runtime.render(time, options.solo, options.diagnostic);
      const x = (index % 4) * TILE_WIDTH;
      const y = Math.floor(index / 4) * ROW_HEIGHT;
      ctx.drawImage(runtime.renderer.domElement, x, y, TILE_WIDTH, TILE_HEIGHT);
      const pixels = ctx.getImageData(x, y, TILE_WIDTH, TILE_HEIGHT).data;
      // Compare against the actual corner background, before the timestamp text.
      const background = [pixels[0], pixels[1], pixels[2]];
      for (let p = 0; p < pixels.length; p += 4)
        if (
          Math.max(...background.map((v, c) => Math.abs(pixels[p + c] - v))) >
          12
        )
          renderedPixels++;
      ctx.fillStyle = "#bdc5cc";
      ctx.font = "11px monospace";
      ctx.fillText(`${time.toFixed(3)} s`, x + 12, y + 195);
    });

    let temporal: TemporalDiagnostics | undefined;
    if (!options.diagnostic) {
      const activity = document.createElement("canvas");
      activity.width = 160;
      activity.height = 90;
      const context = activity.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Activity capture unavailable.");
      runtime.render(doc.duration, options.solo);
      context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
      const baseline = context.getImageData(0, 0, 160, 90).data;
      const energies: number[] = [];
      const steps = Math.ceil(doc.duration * 30);
      for (let i = 0; i <= steps; i++) {
        runtime.render(Math.min(doc.duration, i / 30), options.solo);
        context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
        energies.push(
          measureFrameActivity(
            context.getImageData(0, 0, 160, 90).data,
            baseline,
          ),
        );
      }
      temporal = summarizeActivity(energies, 30, doc.duration);
    }

    const forward = runtime.camera.getWorldDirection(new THREE.Vector3());
    return {
      renderedPixels,
      temporal,
      sheet: sheet.toDataURL("image/jpeg", 0.88),
      times,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      runtime: RUNTIME_VERSION_V2,
      renderer: rendererDescription(runtime.renderer),
      camera: [
        ...runtime.camera.position.toArray(),
        ...runtime.camera.position.clone().add(forward).toArray(),
      ],
      layers: options.solo ? [options.solo] : doc.layers.map((l) => l.id),
      observations: times.map((time) => ({
        time,
        visible: doc.layers
          .filter((l) => evaluateLayerV2(l, time).visible)
          .map((l) => l.id),
      })),
    };
  } finally {
    runtime.dispose();
    host.remove();
  }
}

// Re-exported so the browser bundle (public/vfx-runtime-v2.js) exposes the whole
// v2 capture surface under one global.
export { VfxRuntimeV2, RUNTIME_VERSION_V2 } from "./runtime-v2";
export { isV2, validateDocumentV2 } from "./schema-v2";

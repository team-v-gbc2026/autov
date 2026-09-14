import * as THREE from "three/webgpu";
import { clamp } from "./evaluate";
import { evaluateLayerV2 } from "./evaluate-v2";
import { RUNTIME_VERSION_V2, VfxRuntimeV2 } from "./runtime-v2";
import { type VfxDocumentV2, validateDocumentV2 } from "./schema-v2";
import type { Evidence } from "./runtime";
import {
  jitterScore,
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

// Sheet: 8 tiles at 640x360, four per row. Half the tile count of v1 at four
// times the area — the defect checklist asks about particle variation, billboard
// edges and aliasing, and none of those survive a 320x180 thumbnail.
const SHEET_COLUMNS = 4;
const TILE_WIDTH = 640;
const TILE_HEIGHT = 360;
const LABEL_HEIGHT = 22;

// Strip: 12 consecutive frames at 320x180, 33 ms apart, four per row. Twelve
// adjacent frames are the only evidence in the record that shows whether motion
// is continuous or arrives in steps.
const STRIP_COLUMNS = 4;
const STRIP_TILE_WIDTH = 320;
const STRIP_TILE_HEIGHT = 180;
const STRIP_FRAMES = 12;
const STRIP_STEP = 0.033;
const STRIP_LEAD = 0.1;

const round3 = (t: number) => Math.round(t * 1000) / 1000;

/** Real event onset: prose and nominal `impact` metadata may disagree. */
export function impactTimeV2(doc: VfxDocumentV2) {
  const impacts = doc.layers
    .filter((l) => l.enabled && l.role === "impact")
    .map((l) => l.start);
  return impacts.length ? Math.min(...impacts) : doc.impact;
}

/** Round to milliseconds, keep inside the document, keep strictly ascending. */
function ascending(times: number[], duration: number) {
  const ceiling = round3(Math.max(0, duration - 0.001));
  const out: number[] = [];
  times.forEach((time, index) => {
    const headroom = round3(
      Math.max(0, ceiling - (times.length - 1 - index) * 0.001),
    );
    let value = round3(clamp(time, 0, headroom));
    const previous = out[out.length - 1];
    if (previous !== undefined && value <= previous)
      value = round3(Math.min(headroom, previous + 0.001));
    out.push(value);
  });
  return out;
}

/**
 * The eight moments the sheet shows: the anticipation beat, the frame before
 * impact, impact itself, three moments across the falloff, the middle of the
 * dissipation and the last renderable frame.
 */
export function captureTimesV2(doc: VfxDocumentV2) {
  const impact = impactTimeV2(doc);
  const end = doc.duration - 0.001;
  const dissipation = impact + 0.4;
  return ascending(
    [
      impact - 0.12,
      impact - 1 / 30,
      impact,
      impact + 0.05,
      impact + 0.15,
      dissipation,
      (dissipation + end) / 2,
      end,
    ],
    doc.duration,
  );
}

/** Twelve consecutive frames from 0.1 s before impact, 33 ms apart. */
export function stripTimesV2(doc: VfxDocumentV2) {
  const span = (STRIP_FRAMES - 1) * STRIP_STEP;
  const start = clamp(
    impactTimeV2(doc) - STRIP_LEAD,
    0,
    Math.max(0, doc.duration - 0.001 - span),
  );
  return ascending(
    Array.from({ length: STRIP_FRAMES }, (_, i) => start + i * STRIP_STEP),
    doc.duration,
  );
}

function rendererDescription(renderer: THREE.WebGPURenderer) {
  const backend = renderer.backend as unknown as {
    isWebGPUBackend?: boolean;
    device?: GPUDevice;
  };
  if (!backend.isWebGPUBackend) throw new Error("Evaluation requires WebGPU.");
  const info = backend.device?.adapterInfo;
  return `WebGPU ${info?.vendor || ""} ${info?.device || ""} ${info?.description || ""}`.trim();
}

/**
 * Render `doc` with the v2 runtime into an off-screen host and return Evidence.
 * The runtime instance is created and disposed inside this call, so nothing
 * about the caller's live preview is disturbed.
 */
export async function captureV2(
  input: VfxDocumentV2,
  options: { solo?: string; diagnostic?: boolean; times?: number[]; motionEvidence?: boolean } = {},
): Promise<Evidence> {
  const doc = validateDocumentV2(input);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
  document.body.appendChild(host);
  const runtime = new VfxRuntimeV2(host);
  // Capture dimensions are output pixels, independent of the display's DPR.
  runtime.renderer.setPixelRatio(1);
  const canvases: HTMLCanvasElement[] = [];
  const drain = async () => {
    const backend = runtime.renderer.backend as unknown as { device?: GPUDevice };
    await backend.device?.queue.onSubmittedWorkDone();
  };
  // Deterministic capture: never let orbit/pan/zoom controls perturb the
  // camera between frames.
  runtime.setInteractive(false);
  try {
    runtime.setDocument(doc);
    runtime.resize(TILE_WIDTH, TILE_HEIGHT);
    await runtime.whenReady();
    // One warm-up frame so every shader is compiled before the first tile.
    runtime.render(0, options.solo, options.diagnostic);
    await drain();

    // One grid draws both images: the only differences are the tile size, the
    // column count and the label font.
    const compose = async (
      moments: number[],
      columns: number,
      tileWidth: number,
      tileHeight: number,
      fontSize: number,
      count: (pixels: Uint8ClampedArray) => void = () => {},
    ) => {
      runtime.resize(tileWidth, tileHeight);
      const rowHeight = tileHeight + LABEL_HEIGHT;
      const canvas = document.createElement("canvas");
      canvases.push(canvas);
      canvas.width = columns * tileWidth;
      canvas.height = Math.ceil(moments.length / columns) * rowHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Capture unavailable.");
      context.fillStyle = "#101112";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const [index, time] of moments.entries()) {
        runtime.render(time, options.solo, options.diagnostic);
        // Keep only one capture frame in flight, including in diagnostic runs.
        await drain();
        const x = (index % columns) * tileWidth;
        const y = Math.floor(index / columns) * rowHeight;
        context.drawImage(
          runtime.renderer.domElement,
          x,
          y,
          tileWidth,
          tileHeight,
        );
        count(context.getImageData(x, y, tileWidth, tileHeight).data);
        context.fillStyle = "#bdc5cc";
        context.font = `${fontSize}px monospace`;
        context.fillText(
          `${time.toFixed(3)} s`,
          x + 12,
          y + tileHeight + LABEL_HEIGHT - 7,
        );
      }
      return canvas;
    };

    if (options.times && (!options.times.length || options.times.length > 8 || options.times.some(time => !Number.isFinite(time) || time < 0 || time > doc.duration))) throw new Error("Capture times must be within the effect duration.");
    const times = options.times ?? captureTimesV2(doc);
    let renderedPixels = 0;
    const sheet = await compose(
      times,
      SHEET_COLUMNS,
      TILE_WIDTH,
      TILE_HEIGHT,
      14,
      (pixels) => {
        // Compare against the actual corner background, before the label text.
        const background = [pixels[0], pixels[1], pixels[2]];
        for (let p = 0; p < pixels.length; p += 4)
          if (
            Math.max(Math.abs(pixels[p] - background[0]), Math.abs(pixels[p + 1] - background[1]), Math.abs(pixels[p + 2] - background[2])) >
            12
          )
            renderedPixels++;
      },
    );
    // The strip is motion evidence, not a second look at the effect: a solo
    // diagnostic render has nothing continuous to show.
    const motionEvidence = !options.diagnostic && options.motionEvidence !== false;
    const stripTimes = motionEvidence ? stripTimesV2(doc) : [];
    const strip = !motionEvidence
      ? undefined
      : (await compose(
          stripTimes,
          STRIP_COLUMNS,
          STRIP_TILE_WIDTH,
          STRIP_TILE_HEIGHT,
          11,
        )).toDataURL("image/jpeg", 0.88);

    let temporal: TemporalDiagnostics | undefined;
    let jitter: number | undefined;
    if (motionEvidence) {
      runtime.resize(STRIP_TILE_WIDTH, STRIP_TILE_HEIGHT);
      const activity = document.createElement("canvas");
      canvases.push(activity);
      activity.width = 160;
      activity.height = 90;
      const context = activity.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Activity capture unavailable.");
      runtime.render(doc.duration, options.solo);
      await drain();
      context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
      const baseline = context.getImageData(0, 0, 160, 90).data;
      const energies: number[] = [];
      const steps = Math.ceil(doc.duration * 30);
      for (let i = 0; i <= steps; i++) {
        runtime.render(Math.min(doc.duration, i / 30), options.solo);
        await drain();
        context.drawImage(runtime.renderer.domElement, 0, 0, 160, 90);
        energies.push(
          measureFrameActivity(
            context.getImageData(0, 0, 160, 90).data,
            baseline,
          ),
        );
      }
      temporal = summarizeActivity(energies, 30, doc.duration);
      const peak = Math.max(...energies);
      jitter = jitterScore(
        energies.map((v) => (peak ? v / peak : 0)),
        30,
        impactTimeV2(doc),
      );
    }

    const forward = runtime.camera.getWorldDirection(new THREE.Vector3());
    return {
      renderedPixels,
      temporal,
      jitterScore: jitter,
      sheet: sheet.toDataURL("image/jpeg", 0.88),
      strip,
      stripTimes,
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
    try { await runtime.dispose(); }
    finally {
      for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
      host.remove();
    }
  }
}

// Re-exported so the browser bundle (public/vfx-runtime-v2.js) exposes the whole
// v2 capture surface under one global.
export { VfxRuntimeV2, RUNTIME_VERSION_V2 } from "./runtime-v2";
export { isV2, validateDocumentV2 } from "./schema-v2";
// The measure stage is part of the same browser surface: it renders with the
// same runtime and never calls anything.
export { measureV2 } from "./measure-browser-v2";

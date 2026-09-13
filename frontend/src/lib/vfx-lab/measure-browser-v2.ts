// ---------------------------------------------------------------------------
// The measure stage, browser half.
//
// Runs inside the capture browser with no model call of any kind: it renders
// the chosen candidate, measures its own screen features and activity curve,
// measures the reference the same way, aligns the two by phase, and produces
// the three things the refiner is then asked to reason about — a phase-aligned
// comparison sheet, a delta table and an influence table.
//
// The session it returns keeps the runtime alive, so the numeric solve that
// follows the refiner's answer costs renders and nothing else.
// ---------------------------------------------------------------------------

import { VfxRuntimeV2 } from "./runtime-v2";
import {
  maskAgainstBackground,
  meanFeatures,
  renderedFrameFeatures,
  stillFeatures,
  type FrameFeatures,
  type RgbaFrame,
} from "./features-v2";
import {
  analyzeReferenceVideo,
  buildReferenceSheet,
  buildVideoReferenceSheet,
  documentPhaseTimes,
  documentWindowsFromCurve,
  envelopeFromAreaCurve,
  PHASE_NAMES,
  type Confidence,
  type DocumentWindows,
  type PhaseName,
  type ReferenceSheet,
  type TimedFrame,
  type VideoAnalysis,
} from "./reference-features";
import {
  applyKnobs,
  KNOB_NAMES,
  knobRecord,
  visibleLayerCount,
  type KnobName,
} from "./knobs-v2";
import {
  checkGuards,
  residualOf,
  type EvaluateResult,
  type GuardReport,
} from "./calibrate-v2";
import {
  deltaTable,
  envelopeDistance,
  influenceTable,
  solveKnobSubspace,
  COLLAPSE_FRACTION,
  type MeasurementV2,
  type ReferenceInputV2,
  type RefinePlanRequest,
  type SubspaceResult,
} from "./measure-v2";
import { validateDocumentV2, type VfxDocumentV2 } from "./schema-v2";

/** Phase features are measured here; edge density needs the resolution. */
const FEATURE_SIZE: [number, number] = [640, 360];
/** The activity curve and the influence pass are measured here. */
const CURVE_SIZE: [number, number] = [320, 180];
/** Reference frames are decoded to the feature resolution. */
const REFERENCE_SIZE: [number, number] = [640, 360];
const LABEL_HEIGHT = 22;
/** Renders spent on one document's area curve. */
const CURVE_FRAMES = 20;
const CURVE_RATE = 10;
const SAMPLES_PER_PHASE = 2;
/** Reference decode rate and cap, matching scripts/calibrate-v2.mjs. */
export const REFERENCE_FPS = 10;
export const REFERENCE_MAX_FRAMES = 150;

export type { ReferenceInputV2 };

export interface SolveOutcomeV2 {
  accepted: boolean;
  document: VfxDocumentV2;
  knobs: Record<KnobName, number>;
  baselineResidual: number;
  residual: number;
  improvement: number;
  guards: GuardReport;
  evaluations: number;
  notes: string[];
  /** The solved document, measured again — a fresh aligned sheet included. */
  measurement: MeasurementV2;
}

export interface MeasureSessionV2 {
  measurement: MeasurementV2;
  sheet: ReferenceSheet;
  solve(plan: RefinePlanRequest): Promise<SolveOutcomeV2>;
  dispose(): void;
}

export interface MeasureOptionsV2 {
  reference?: ReferenceInputV2;
  /** Benchmark prompt, used only by the stills fallback for its timing. */
  prompt?: string;
  /** Frames spent per area curve. */
  curveFrames?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Reference image failed to decode."));
    image.src = src;
  });
}

function context2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Measurement canvas unavailable.");
  return { canvas, context };
}

async function frameFromImage(src: string): Promise<RgbaFrame> {
  const image = await loadImage(src);
  const { context } = context2d(REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
  context.drawImage(image, 0, 0, REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
  const data = context.getImageData(0, 0, REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
  return { width: REFERENCE_SIZE[0], height: REFERENCE_SIZE[1], data: data.data };
}

/**
 * Decode a clip by seeking. Browsers without the clip's codec reject it here,
 * which is why a local run may hand the stage decoded frames instead.
 */
async function decodeVideoInBrowser(
  src: string,
  fps = REFERENCE_FPS,
  maxFrames = REFERENCE_MAX_FRAMES,
): Promise<{ frames: TimedFrame[]; images: string[] }> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    const fail = () =>
      reject(new Error("The reference clip could not be decoded in this browser."));
    video.onloadeddata = () => resolve();
    video.onerror = fail;
    window.setTimeout(fail, 30000);
    video.src = src;
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!(duration > 0)) throw new Error("The reference clip has no duration.");
  const count = Math.min(maxFrames, Math.max(4, Math.round(duration * fps)));
  const { canvas, context } = context2d(REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
  const frames: TimedFrame[] = [];
  const images: string[] = [];
  for (let i = 0; i < count; i++) {
    const time = Math.min(duration - 1e-3, i / fps);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Reference seek failed."));
      video.currentTime = time;
    });
    context.drawImage(video, 0, 0, REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
    const data = context.getImageData(0, 0, REFERENCE_SIZE[0], REFERENCE_SIZE[1]);
    frames.push({
      time,
      frame: {
        width: REFERENCE_SIZE[0],
        height: REFERENCE_SIZE[1],
        data: data.data,
      },
    });
    images.push(canvas.toDataURL("image/jpeg", 0.85));
  }
  return { frames, images };
}

/** The document's environment and camera with every effect layer switched off. */
function backgroundDocument(base: VfxDocumentV2): VfxDocumentV2 {
  const doc = structuredClone(base);
  return {
    ...doc,
    layers: [
      ...doc.layers.map((layer) => ({ ...layer, enabled: false })),
      {
        id: "measure-plate",
        name: "background plate",
        role: "residue",
        kind: "light",
        start: 0,
        end: base.duration,
        enabled: true,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        motion: null,
        light: {
          color: "#000000",
          intensity: { keys: [[0, 0], [1, 0]], ease: "linear" },
          radius: 0.5,
          decay: 2,
        },
        tracks: [],
        overrides: [],
      },
    ] as VfxDocumentV2["layers"],
  };
}

/**
 * Measure one v2 candidate against its reference and keep the runtime open for
 * the solve that follows.
 */
export async function measureV2(
  input: VfxDocumentV2,
  options: MeasureOptionsV2 = {},
): Promise<MeasureSessionV2> {
  const base = validateDocumentV2(input);
  const curveFrames = options.curveFrames ?? CURVE_FRAMES;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
  document.body.appendChild(host);
  const runtime = new VfxRuntimeV2(host);
  runtime.setInteractive(false);
  const { canvas: scratch, context } = context2d(
    FEATURE_SIZE[0],
    FEATURE_SIZE[1],
  );
  let pose: {
    fov: number;
    position: number[];
    target: number[];
  } | null = null;
  const plates = new Map<string, RgbaFrame>();
  const notes: string[] = [];

  const readFrame = (size: [number, number]): RgbaFrame => {
    scratch.width = size[0];
    scratch.height = size[1];
    context.clearRect(0, 0, size[0], size[1]);
    context.drawImage(runtime.renderer.domElement, 0, 0, size[0], size[1]);
    const image = context.getImageData(0, 0, size[0], size[1]);
    return { width: size[0], height: size[1], data: image.data };
  };
  const applyPose = () => {
    if (!pose) return;
    runtime.camera.fov = pose.fov;
    runtime.camera.position.fromArray(pose.position);
    runtime.controls.target.fromArray(pose.target);
    runtime.camera.lookAt(runtime.controls.target);
    runtime.camera.updateProjectionMatrix();
    runtime.camera.updateMatrixWorld();
  };
  const load = async (doc: VfxDocumentV2, size: [number, number]) => {
    runtime.setDocument(doc);
    runtime.resize(size[0], size[1]);
    await runtime.whenReady();
    // Warm-up frame: every shader compiled before the first measured frame.
    runtime.render(0);
    applyPose();
  };
  const curveTimesFor = (doc: VfxDocumentV2) => {
    const wanted = Math.max(2, Math.round(doc.duration * CURVE_RATE) + 1);
    const count = Math.min(curveFrames, wanted);
    return Array.from({ length: count }, (_, i) =>
      round3(clamp((doc.duration * i) / (count - 1), 0, doc.duration - 0.001)),
    );
  };

  try {
    // The pose auto-framing picks for the base document, frozen for the run:
    // knobs move the effect, never the shot.
    await load(base, FEATURE_SIZE);
    pose = {
      fov: runtime.camera.fov,
      position: runtime.camera.position.toArray(),
      target: runtime.controls.target.toArray(),
    };
    for (const size of [FEATURE_SIZE, CURVE_SIZE] as [number, number][]) {
      await load(backgroundDocument(base), size);
      runtime.render(0);
      plates.set(size.join("x"), readFrame(size));
    }

    const areaCurve = async (doc: VfxDocumentV2, times: number[]) => {
      await load(doc, CURVE_SIZE);
      const plate = plates.get(CURVE_SIZE.join("x"))!;
      return times.map((time) => {
        runtime.render(time);
        const frame = readFrame(CURVE_SIZE);
        return (
          maskAgainstBackground(frame, plate).count /
          (frame.width * frame.height)
        );
      });
    };
    const phaseFrames = (times: number[], size: [number, number]) => {
      runtime.resize(size[0], size[1]);
      applyPose();
      const plate = plates.get(size.join("x"))!;
      return times.map((time) => {
        runtime.render(time);
        return renderedFrameFeatures(readFrame(size), plate).features;
      });
    };

    // --- the reference ----------------------------------------------------

    const baseCurveTimes = curveTimesFor(base);
    const baseAreas = await areaCurve(base, baseCurveTimes);
    const baseMeasured = documentWindowsFromCurve(
      baseCurveTimes,
      baseAreas,
      base.duration,
    );

    let analysis: VideoAnalysis | null = null;
    let referenceFrames: TimedFrame[] = [];
    let referenceImages: string[] = [];
    let stills: string[] = [];
    let sheet: ReferenceSheet;
    let confidence: Confidence = "low";

    const reference = options.reference;
    if (reference?.kind === "video" || reference?.kind === "frames") {
      try {
        if (reference.kind === "video") {
          const decoded = await decodeVideoInBrowser(reference.video);
          referenceFrames = decoded.frames;
          referenceImages = decoded.images;
        } else {
          referenceImages = reference.frames;
          const fps = reference.fps || REFERENCE_FPS;
          for (let i = 0; i < reference.frames.length; i++)
            referenceFrames.push({
              time: i / fps,
              frame: await frameFromImage(reference.frames[i]),
            });
        }
        analysis = analyzeReferenceVideo(referenceFrames);
      } catch (error) {
        notes.push(
          `reference clip unusable (${error instanceof Error ? error.message : "unknown"});` +
            " falling back to stills",
        );
        analysis = null;
      }
    }

    if (analysis) {
      sheet = buildVideoReferenceSheet({
        case: base.name,
        doc: base,
        analysis,
        measured: baseMeasured,
        samplesPerPhase: SAMPLES_PER_PHASE,
        maxEnvelopeSamples: curveFrames,
      });
      confidence = analysis.confidence;
    } else {
      stills =
        reference?.kind === "stills"
          ? reference.stills.slice(0, PHASE_NAMES.length)
          : [];
      if (stills.length !== PHASE_NAMES.length)
        throw new Error(
          "The measure stage needs a reference clip or three reference stills.",
        );
      const features: FrameFeatures[] = [];
      for (const still of stills)
        features.push(stillFeatures(await frameFromImage(still)).features);
      sheet = buildReferenceSheet({
        case: base.name,
        doc: base,
        prompt:
          options.prompt ??
          (reference?.kind === "stills" ? reference.prompt : undefined) ??
          "",
        references: features,
        samplesPerPhase: SAMPLES_PER_PHASE,
      });
      confidence = "low";
      notes.push(
        "no reference clip: phase targets come from three stills and carry no" +
          " temporal envelope, so timing is not measured",
      );
    }

    // --- one evaluation ---------------------------------------------------

    const pivot = baseMeasured.peakTime;
    const evaluateDocument = async (
      doc: VfxDocumentV2,
      size: [number, number],
    ): Promise<
      EvaluateResult & { measured: DocumentWindows; areas: number[]; times: number[] }
    > => {
      const times = curveTimesFor(doc);
      const areas = await areaCurve(doc, times);
      const measured = documentWindowsFromCurve(times, areas, doc.duration);
      const windowTimes = documentPhaseTimes(
        measured,
        doc.duration,
        SAMPLES_PER_PHASE,
      );
      const flat = PHASE_NAMES.flatMap((name) => windowTimes[name]);
      const measuredFrames = phaseFrames(flat, size);
      let cursor = 0;
      const features = {} as Record<PhaseName, FrameFeatures>;
      const frames = {} as Record<PhaseName, FrameFeatures[]>;
      for (const name of PHASE_NAMES) {
        const slice = windowTimes[name].map(() => measuredFrames[cursor++]);
        frames[name] = slice;
        features[name] = meanFeatures(slice);
      }
      return {
        features,
        frames,
        windows: measured.windows,
        peakPosition: measured.peakPosition,
        envelope: sheet.envelope
          ? envelopeFromAreaCurve(sheet, times, areas)
          : undefined,
        visibleLayers: visibleLayerCount(doc),
        measured,
        areas,
        times,
      };
    };
    const evaluateKnobs = (size: [number, number]) => async (knobs: number[]) =>
      evaluateDocument(applyKnobs(base, knobs, { pivot }), size);

    const identity = KNOB_NAMES.map(() => 1);
    const baseEvaluation = await evaluateDocument(base, FEATURE_SIZE);
    const baseGuards = checkGuards(
      baseEvaluation.features,
      baseEvaluation.visibleLayers,
      { visibleLayers: baseEvaluation.visibleLayers },
    );
    const guardReference = {
      visibleLayers: baseEvaluation.visibleLayers,
      worst: baseGuards.worst,
      peakPosition: sheet.envelope
        ? clamp(
            (sheet.envelope.peakTime - sheet.envelope.span[0]) /
              Math.max(sheet.envelope.span[1] - sheet.envelope.span[0], 1e-6),
            0,
            1,
          )
        : undefined,
    };

    // --- the aligned sheet ------------------------------------------------

    const referenceTileTimes = analysis
      ? [
          (analysis.windows.anticipation.start +
            analysis.windows.anticipation.end) /
            2,
          analysis.peakTime,
          analysis.windows.peak.end,
          (analysis.windows.dissipation.start +
            analysis.windows.dissipation.end) /
            2,
        ]
      : null;
    const tileLabels = ["anticipation", "peak", "peak+", "dissipation"];
    const nearestReference = (time: number) => {
      if (!referenceFrames.length) return null;
      let best = 0;
      for (let i = 1; i < referenceFrames.length; i++)
        if (
          Math.abs(referenceFrames[i].time - time) <
          Math.abs(referenceFrames[best].time - time)
        )
          best = i;
      return { index: best, time: referenceFrames[best].time };
    };

    /**
     * Four rows: the render at its own measured phase beside the reference at
     * the phase that means the same thing. Aligned by phase, never by clock
     * time — the document and the clip do not share a timeline.
     */
    const alignedSheet = async (
      doc: VfxDocumentV2,
      measured: DocumentWindows,
    ) => {
      const times = documentPhaseTimes(measured, doc.duration, SAMPLES_PER_PHASE);
      const renderTimes = [
        times.anticipation[0],
        measured.peakTime,
        times.peak[times.peak.length - 1],
        times.dissipation[0],
      ];
      const { canvas, context: ctx } = context2d(
        FEATURE_SIZE[0] * 2,
        (FEATURE_SIZE[1] + LABEL_HEIGHT) * renderTimes.length,
      );
      ctx.fillStyle = "#101112";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await load(doc, FEATURE_SIZE);
      const rowHeight = FEATURE_SIZE[1] + LABEL_HEIGHT;
      const label = (text: string, x: number, row: number) => {
        ctx.fillStyle = "#bdc5cc";
        ctx.font = "14px monospace";
        ctx.fillText(text, x + 12, row * rowHeight + rowHeight - 7);
      };
      for (let row = 0; row < renderTimes.length; row++) {
        runtime.render(renderTimes[row]);
        ctx.drawImage(
          runtime.renderer.domElement,
          0,
          row * rowHeight,
          FEATURE_SIZE[0],
          FEATURE_SIZE[1],
        );
        label(
          `render  ${tileLabels[row]}  ${renderTimes[row].toFixed(3)} s`,
          0,
          row,
        );
      }
      for (let row = 0; row < renderTimes.length; row++) {
        let source: string | null = null;
        let caption = "reference";
        if (referenceTileTimes && referenceImages.length) {
          const near = nearestReference(referenceTileTimes[row]);
          if (near) {
            source = referenceImages[near.index];
            caption = `reference  ${tileLabels[row]}  ${near.time.toFixed(3)} s`;
          }
        } else if (stills.length) {
          // Three stills, four rows: the peak still carries both peak rows.
          const index = Math.min(stills.length - 1, row === 0 ? 0 : row === 3 ? 2 : 1);
          source = stills[index];
          caption = `reference still ${index + 1}  ${tileLabels[row]}`;
        }
        if (!source) continue;
        const image = await loadImage(source);
        ctx.drawImage(
          image,
          FEATURE_SIZE[0],
          row * rowHeight,
          FEATURE_SIZE[0],
          FEATURE_SIZE[1],
        );
        label(caption, FEATURE_SIZE[0], row);
      }
      return canvas.toDataURL("image/png");
    };

    // --- the influence pass ------------------------------------------------

    // One forward-difference Jacobian over all eleven knobs at 320x180:
    // 1 + 11 = 12 evaluations, which is what keeps this affordable inside a
    // generation run rather than an offline calibration.
    const cheapEvaluate = evaluateKnobs(CURVE_SIZE);
    const cheapBase = await cheapEvaluate(identity);
    const cheapResidual = residualOf(sheet, cheapBase.features, undefined, cheapBase.envelope);
    const columns: number[][] = [];
    const step = 0.25;
    for (let j = 0; j < KNOB_NAMES.length; j++) {
      const knobs = identity.map((v, i) => (i === j ? v * Math.exp(step) : v));
      const probe = await cheapEvaluate(knobs);
      const probeResidual = residualOf(sheet, probe.features, undefined, probe.envelope);
      columns.push(
        probeResidual.values.map(
          (v, row) => (v - cheapResidual.values[row]) / step,
        ),
      );
    }

    const buildMeasurement = async (
      doc: VfxDocumentV2,
      evaluation: Awaited<ReturnType<typeof evaluateDocument>>,
      knobs: number[],
    ): Promise<MeasurementV2> => {
      const residual = residualOf(
        sheet,
        evaluation.features,
        undefined,
        evaluation.envelope,
      );
      return {
        phases: sheet.phases,
        deltas: deltaTable(sheet, evaluation.features),
        envelope: {
          render: (evaluation.envelope ?? []).map((v) => Math.round(v * 1000) / 1000),
          reference: (sheet.envelope?.values ?? []).map(
            (v) => Math.round(v * 1000) / 1000,
          ),
          distance: envelopeDistance(
            evaluation.envelope ?? [],
            sheet.envelope?.values ?? [],
          ),
        },
        influences: influenceTable(cheapResidual.labels, columns),
        confidence,
        notes: [...notes, ...sheet.notes],
        sheet: await alignedSheet(doc, evaluation.measured),
        residualNorm: Math.round(residual.norm * 1000) / 1000,
        knobs: knobRecord(knobs),
      };
    };

    const measurement = await buildMeasurement(base, baseEvaluation, identity);

    const solve = async (plan: RefinePlanRequest): Promise<SolveOutcomeV2> => {
      const result: SubspaceResult = await solveKnobSubspace({
        sheet,
        evaluate: evaluateKnobs(FEATURE_SIZE),
        plan,
        baseResult: baseEvaluation,
        reference: guardReference,
        // A solved candidate may not quietly become an empty frame.
        minPeakArea: baseGuards.worst.area * COLLAPSE_FRACTION,
      });
      const knobs = KNOB_NAMES.map((name) => result.knobValues[name]);
      const document = validateDocumentV2(applyKnobs(base, knobs, { pivot }));
      const evaluation = result.accepted
        ? await evaluateDocument(document, FEATURE_SIZE)
        : baseEvaluation;
      return {
        accepted: result.accepted,
        document,
        knobs: result.knobValues,
        baselineResidual: result.baselineResidual,
        residual: result.residual,
        improvement: result.improvement,
        guards: result.guards,
        evaluations: result.evaluations,
        notes: result.notes,
        measurement: await buildMeasurement(
          result.accepted ? document : base,
          evaluation,
          result.accepted ? knobs : identity,
        ),
      };
    };

    return {
      measurement,
      sheet,
      solve,
      dispose: () => {
        runtime.dispose();
        host.remove();
      },
    };
  } catch (error) {
    runtime.dispose();
    host.remove();
    throw error;
  }
}

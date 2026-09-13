// ---------------------------------------------------------------------------
// Reference sheet: turn three reference stills plus the benchmark prompt into
// a per-phase feature target the optimizer can aim at.
//
// The benchmark's three stills are shot at anticipation / peak / dissipation.
// The prompt carries the intended timing explicitly ("Timing (3 seconds
// total): 0.0-0.3: ... 0.3-1.2: ..."), so when it parses we use it and only
// fall back to ratios of the document's own duration when it does not.
//
// Every target carries a confidence flag. Nothing here is trusted blindly:
// benchmark references are frames of finished game footage, with floors,
// characters and lit environments the still mask cannot separate from the
// effect, and the flags are how that leaks into the report instead of into a
// silent bad target.
// ---------------------------------------------------------------------------

import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_NAMES,
  featuresFromMask,
  maskAgainstBackground,
  meanFeatures,
  type FeatureOptions,
  type FrameFeatures,
  type RgbaFrame,
} from "./features-v2";
import type { VfxDocumentV2 } from "./schema-v2";

export const PHASE_NAMES = ["anticipation", "peak", "dissipation"] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export type Confidence = "high" | "medium" | "low";

export interface PromptPhase {
  start: number;
  end: number;
  text: string;
}

export interface PromptTiming {
  /** Declared total, in seconds, from "Timing (N seconds total)". */
  total: number;
  phases: PromptPhase[];
}

export interface SheetPhase {
  name: PhaseName;
  start: number;
  end: number;
  /** Document times the renderer is sampled at for this phase. */
  sampleTimes: number[];
  confidence: Confidence;
  source: "prompt" | "prompt-rescaled" | "ratio" | "video";
  /** Which reference still or phase window supplied this phase's target (1-based). */
  reference: number;
  notes: string[];
}

/** Number of bins the normalized activity curve is resampled to. */
export const ENVELOPE_BINS = 32;
/** Weight applied to every envelope residual term. */
export const ENVELOPE_WEIGHT = 0.5;
/** Frame rate the render's own area curve is sampled at. */
export const ENVELOPE_SAMPLE_RATE = 10;

export interface EnvelopeTarget {
  bins: number;
  weight: number;
  /** The reference's peak-normalized foreground-area curve, one value per bin. */
  values: number[];
  /** Reference time of the peak the document's impact is anchored to. */
  peakTime: number;
  /** Reference times the effect is active between. */
  span: [number, number];
  /**
   * Document times the render's own (peak-normalized) area curve must be read
   * at to line up with `values`, bin for bin.
   */
  documentTimes: number[];
  /** Document times to render the area curve at, before interpolation. */
  sampleTimes: number[];
}

export interface ReferenceSheet {
  version: 1;
  case: string;
  duration: number;
  impact: number;
  phases: SheetPhase[];
  targets: Record<PhaseName, FrameFeatures>;
  weights: Record<string, number>;
  /** Null when the reference is stills only; a curve when a video was analysed. */
  envelope: EnvelopeTarget | null;
  notes: string[];
}

const DASH = /[–—-]/;

/**
 * Parse the benchmark prompt's timing block. Returns null when the prompt has
 * no "Timing (N seconds total):" line or no readable "a-b:" segments.
 */
export function parsePromptTiming(prompt: string): PromptTiming | null {
  const header = prompt.match(/Timing\s*\(\s*([\d.]+)\s*seconds?\s*total\s*\)/i);
  if (!header) return null;
  const total = Number(header[1]);
  if (!Number.isFinite(total) || total <= 0) return null;
  const body = prompt.slice(header.index! + header[0].length);
  const phases: PromptPhase[] = [];
  const segment =
    /(\d+(?:\.\d+)?)\s*(?:s\b)?\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:s\b)?\s*:\s*([^]*?)(?=(?:\d+(?:\.\d+)?\s*(?:s\b)?\s*[–—-]\s*\d)|$)/g;
  for (const match of body.matchAll(segment)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    phases.push({ start, end, text: match[3].trim().replace(/\s+/g, " ") });
  }
  if (!phases.length || !DASH.test(prompt)) return null;
  return { total, phases };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Two or three evenly spaced document times inside `[start, end)`, never at the
 * very edge of the window — a phase boundary is exactly where a layer switches
 * on and the frame is least representative.
 */
export function phaseSampleTimes(
  start: number,
  end: number,
  duration: number,
  count = 2,
) {
  const ceiling = Math.max(0, duration - 0.001);
  const lo = clamp(start, 0, ceiling);
  const hi = clamp(end, lo, ceiling);
  const span = hi - lo;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 1) / (count + 1);
    times.push(round3(clamp(lo + span * u, 0, ceiling)));
  }
  // Degenerate windows (a phase shorter than a millisecond) collapse; keep the
  // list strictly ascending so repeated renders are not silently wasted.
  return times.filter((t, i) => i === 0 || t > times[i - 1]);
}

interface PhaseWindow {
  start: number;
  end: number;
  source: SheetPhase["source"];
  notes: string[];
}

/** Fallback windows when the prompt carries no usable timing. */
function ratioWindows(doc: VfxDocumentV2): Record<PhaseName, PhaseWindow> {
  const { duration } = doc;
  const impact = clamp(doc.impact, 0, duration);
  const note = ["prompt timing unavailable; ratios of the document duration"];
  return {
    anticipation: {
      start: Math.max(0, impact - 0.2 * duration),
      end: impact,
      source: "ratio",
      notes: note,
    },
    peak: {
      start: impact,
      end: Math.min(duration, impact + 0.15),
      source: "ratio",
      notes: note,
    },
    dissipation: {
      start: 0.6 * duration,
      end: 0.8 * duration,
      source: "ratio",
      notes: note,
    },
  };
}

/**
 * Map the prompt's phases onto document time. The live documents do not always
 * honour the prompt's declared total (fx01's prompt says four seconds, its
 * document is 1.5 s long), so the prompt's phases are rescaled onto the
 * document's own duration and the rescaling is recorded rather than hidden.
 */
function promptWindows(
  doc: VfxDocumentV2,
  timing: PromptTiming,
): Record<PhaseName, PhaseWindow> {
  const scale = doc.duration / timing.total;
  const rescaled = Math.abs(scale - 1) > 0.1;
  const source: SheetPhase["source"] = rescaled ? "prompt-rescaled" : "prompt";
  const notes = rescaled
    ? [
        `prompt declares ${timing.total}s but the document is ${doc.duration}s;` +
          ` phases scaled by ${round3(scale)}`,
      ]
    : [];
  const mapped = timing.phases.map((p) => ({
    start: clamp(p.start * scale, 0, doc.duration),
    end: clamp(p.end * scale, 0, doc.duration),
  }));
  const impact = clamp(doc.impact, 0, doc.duration);
  // The peak phase is the one the document's impact falls in; failing that,
  // the first phase that starts at or after impact.
  let peakIndex = mapped.findIndex((p) => impact >= p.start && impact < p.end);
  if (peakIndex < 0) peakIndex = mapped.findIndex((p) => p.start >= impact);
  if (peakIndex < 0) peakIndex = Math.min(1, mapped.length - 1);
  const last = mapped.length - 1;
  const wrap = (index: number, extra: string[] = []) => ({
    start: mapped[index].start,
    end: mapped[index].end,
    source,
    notes: [...notes, ...extra],
  });

  // Short prompts can leave the impact phase sitting at one end of the list, so
  // that "the phase before it" or "the phase after it" does not exist. Rather
  // than aim two phases at the same window — which measures the same frames
  // against two different references — the shared phase is split.
  const peak = mapped[peakIndex];
  const span = Math.max(peak.end - peak.start, 1e-4);
  const split = (from: number, to: number, why: string) => ({
    start: peak.start + span * from,
    end: peak.start + span * to,
    source,
    notes: [...notes, why],
  });

  return {
    anticipation:
      peakIndex > 0
        ? wrap(peakIndex - 1)
        : split(
            0,
            0.3,
            "the prompt's first phase is also the impact phase; the leading" +
              " 30% of it is used as anticipation",
          ),
    peak:
      last === peakIndex && peakIndex > 0
        ? split(
            0,
            0.4,
            "the prompt's last phase is also the impact phase; its leading 40%" +
              " is used as the peak",
          )
        : wrap(peakIndex),
    dissipation:
      last > peakIndex
        ? wrap(last)
        : split(
            0.6,
            1,
            "the prompt's last phase is also the impact phase; its trailing 40%" +
              " is used as dissipation",
          ),
  };
}

const CONFIDENCE: Record<SheetPhase["source"], Confidence> = {
  prompt: "high",
  "prompt-rescaled": "medium",
  ratio: "low",
  // A video sheet carries its own confidence, from how clean the clip's
  // activity peak is; this entry is only the floor.
  video: "high",
};

/**
 * A still whose mask covers most of the frame is measuring the environment, not
 * the effect; a still whose mask covers almost nothing is measuring noise.
 * Either way the target is weak and the phase says so.
 */
function targetNotes(features: FrameFeatures): string[] {
  const notes: string[] = [];
  if (features.area > 0.45)
    notes.push(
      `reference mask covers ${Math.round(features.area * 100)}% of the still:` +
        " background (floor, characters, lit set) is probably inside it",
    );
  if (features.area < 0.005)
    notes.push("reference mask is nearly empty: the still may be a dark frame");
  if (features.washout > 0.25)
    notes.push("reference is largely blown out: luminance targets are weak");
  return notes;
}

function degrade(confidence: Confidence, notes: string[]): Confidence {
  if (!notes.length) return confidence;
  return confidence === "high" ? "medium" : "low";
}

export interface BuildSheetInput {
  case: string;
  doc: VfxDocumentV2;
  /** Benchmark prompt text; timing is parsed from it when present. */
  prompt: string;
  /** Features of reference-01..03, in order (anticipation, peak, dissipation). */
  references: FrameFeatures[];
  samplesPerPhase?: number;
}

/** Build the per-phase target sheet the optimizer is calibrated against. */
export function buildReferenceSheet(input: BuildSheetInput): ReferenceSheet {
  const { doc, references } = input;
  if (references.length !== PHASE_NAMES.length)
    throw new Error(
      `Expected ${PHASE_NAMES.length} reference stills, got ${references.length}`,
    );
  const timing = parsePromptTiming(input.prompt);
  const windows = timing ? promptWindows(doc, timing) : ratioWindows(doc);
  const samples = input.samplesPerPhase ?? 2;

  const phases = PHASE_NAMES.map((name, index) => {
    const window = windows[name];
    const notes = [...window.notes, ...targetNotes(references[index])];
    return {
      name,
      start: round3(window.start),
      end: round3(window.end),
      sampleTimes: phaseSampleTimes(
        window.start,
        window.end,
        doc.duration,
        samples,
      ),
      confidence: degrade(CONFIDENCE[window.source], targetNotes(references[index])),
      source: window.source,
      reference: index + 1,
      notes,
    } satisfies SheetPhase;
  });

  const targets = Object.fromEntries(
    PHASE_NAMES.map((name, index) => [name, references[index]]),
  ) as Record<PhaseName, FrameFeatures>;

  const notes = [
    "no reference video is available for this case, so no temporal envelope" +
      " target was built; only the three phase feature targets are used",
  ];
  if (!timing) notes.push("prompt timing could not be parsed");

  return {
    version: 1,
    case: input.case,
    duration: doc.duration,
    impact: doc.impact,
    phases,
    targets,
    weights: Object.fromEntries(
      FEATURE_NAMES.map((name) => [name, DEFAULT_FEATURE_WEIGHTS[name]]),
    ),
    envelope: null,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Video references
//
// A clip is a much better target than three stills: the background can be
// estimated properly (the camera is static in these clips, so the per-pixel
// temporal median is the plate), the phases can be *measured* instead of read
// out of the prompt, and the shape of the activity over time becomes a target
// of its own rather than something the optimizer is blind to.
//
// Decoding is the caller's job — these functions take frames.
// ---------------------------------------------------------------------------

export interface TimedFrame {
  time: number;
  frame: RgbaFrame;
}

export interface VideoSample {
  time: number;
  features: FrameFeatures;
  /** Foreground area fraction, the quantity the phase detector works on. */
  area: number;
  /** Mean absolute luminance change against the previous sample. */
  diff: number;
}

export interface PhaseWindowSpec {
  start: number;
  end: number;
}

export interface VideoAnalysis {
  frames: number;
  fps: number;
  samples: VideoSample[];
  /** Reference time of the first dominant activity peak. */
  peakTime: number;
  peakArea: number;
  /**
   * The clip's resting foreground level, subtracted before phase detection.
   * Gameplay footage has a permanently visible set and characters that no
   * background plate can remove; without this every window would be measured
   * against that floor rather than against the effect.
   */
  floorArea: number;
  /** Candidate peaks found, used to judge whether the clip repeats. */
  peakCount: number;
  confidence: Confidence;
  windows: Record<PhaseName, PhaseWindowSpec>;
  targets: Record<PhaseName, FrameFeatures>;
  /** Reference times the effect is active between. */
  span: [number, number];
  /** Peak-normalized area curve resampled to ENVELOPE_BINS over `span`. */
  envelope: number[];
  notes: string[];
}

/**
 * Default temporal quantile for the background plate.
 *
 * Not the median: these clips are short and the effect covers the centre of the
 * frame for most of their length, so the per-pixel median of fx12 *is* the
 * plume, and every empty frame then reads as 20% foreground. The effects are
 * additive light on a dark set, so the background of a pixel is what that pixel
 * looks like at its darkest — a low quantile, kept above the minimum so codec
 * undershoot does not set the level.
 */
export const BACKGROUND_QUANTILE = 0.2;

/**
 * Difference threshold floor for compressed reference video. The plate matches
 * most pixels exactly, so the MAD is zero and the adaptive rule would fall all
 * the way to one 8-bit code — which catches every block artefact.
 */
export const VIDEO_NOISE_FLOOR = 0.05;

/**
 * Per-pixel temporal quantile of every frame — the static background plate.
 * Valid only for a locked-off camera, which is what these reference clips are;
 * a moving camera would smear the set into the plate.
 */
export function temporalBackground(
  frames: readonly RgbaFrame[],
  quantile = BACKGROUND_QUANTILE,
): RgbaFrame {
  if (!frames.length) throw new Error("temporalMedianBackground needs frames");
  const { width, height } = frames[0];
  for (const frame of frames)
    if (frame.width !== width || frame.height !== height)
      throw new Error("Reference frames differ in size");
  const out = new Uint8ClampedArray(width * height * 4);
  const scratch = new Float64Array(frames.length);
  const pick = Math.min(
    frames.length - 1,
    Math.max(0, Math.round(clamp(quantile, 0, 1) * (frames.length - 1))),
  );
  for (let i = 0; i < out.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      for (let f = 0; f < frames.length; f++)
        scratch[f] = frames[f].data[i + channel];
      scratch.sort();
      out[i + channel] = scratch[pick];
    }
    out[i + 3] = 255;
  }
  return { width, height, data: out };
}

/** The plain per-pixel temporal median, for clips the effect does not dominate. */
export const temporalMedianBackground = (frames: readonly RgbaFrame[]) =>
  temporalBackground(frames, 0.5);

/** Mean absolute luminance difference between two frames, in 0..1. */
function frameDifference(a: RgbaFrame, b: RgbaFrame) {
  let sum = 0;
  const pixels = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4)
    sum +=
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
  return sum / (pixels * 3 * 255);
}

/**
 * Local maxima of `values` that rise at least `prominence` (as a fraction of
 * the global maximum) above the lowest point between them and the maximum.
 * The first one is the peak used for anchoring: fx01's clip replays its strike
 * several times, and only the first is the effect the document renders once.
 */
export function findPeaks(
  values: readonly number[],
  prominence = 0.25,
  radius = 3,
) {
  const peak = Math.max(...values, 0);
  if (!(peak > 0)) return [];
  const found: number[] = [];
  const last = values.length - 1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0.6 * peak) continue;
    // The first and last samples are shoulders, not peaks — a clip that starts
    // or ends mid-effect would otherwise anchor on its own edge.
    if ((i === 0 || i === last) && values[i] < peak) continue;
    let best = true;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++)
      if (values[k] > values[i] || (values[k] === values[i] && k < i)) best = false;
    if (!best) continue;
    // Prominence against the deepest trough separating this peak from the last.
    const previous = found[found.length - 1];
    if (previous !== undefined) {
      let trough = Infinity;
      for (let k = previous; k <= i; k++) trough = Math.min(trough, values[k]);
      if (values[i] - trough < prominence * peak) continue;
    }
    found.push(i);
  }
  return found;
}

/** Linear interpolation of a sampled curve at an arbitrary time. */
export function sampleCurve(
  times: readonly number[],
  values: readonly number[],
  at: number,
) {
  if (!times.length) return 0;
  if (at <= times[0]) return values[0];
  if (at >= times[times.length - 1]) return values[values.length - 1];
  for (let i = 1; i < times.length; i++)
    if (at <= times[i]) {
      const span = times[i] - times[i - 1] || 1;
      const u = (at - times[i - 1]) / span;
      return values[i - 1] + (values[i] - values[i - 1]) * u;
    }
  return values[values.length - 1];
}

/** Centre of bin `k` of `bins` spanning `[start, end]`. */
export function binCentre(start: number, end: number, k: number, bins: number) {
  return start + ((end - start) * (k + 0.5)) / bins;
}

/**
 * Measure a reference clip: background plate, per-frame features, activity
 * curve, phase windows and the normalized activity envelope.
 */
export function analyzeReferenceVideo(
  frames: readonly TimedFrame[],
  options: FeatureOptions = {},
): VideoAnalysis {
  if (frames.length < 4)
    throw new Error(`A reference clip needs at least 4 frames, got ${frames.length}`);
  const settings: FeatureOptions = { floor: VIDEO_NOISE_FLOOR, ...options };
  const background = temporalBackground(frames.map((f) => f.frame));
  const samples: VideoSample[] = frames.map(({ time, frame }, index) => {
    const mask = maskAgainstBackground(frame, background, settings);
    return {
      time,
      features: featuresFromMask(frame, mask.mask, settings),
      area: mask.count / (frame.width * frame.height),
      diff: index ? frameDifference(frame, frames[index - 1].frame) : 0,
    };
  });

  const times = samples.map((s) => s.time);
  const raw = samples.map((s) => s.area);
  const sortedAreas = [...raw].sort((a, b) => a - b);
  const floorArea =
    sortedAreas[Math.floor(0.1 * (sortedAreas.length - 1))] ?? 0;
  const areas = raw.map((v) => Math.max(0, v - floorArea));
  const span = times[times.length - 1] - times[0];
  const fps = span > 0 ? (times.length - 1) / span : 0;
  const peaks = findPeaks(areas);
  const peakIndex = peaks.length ? peaks[0] : areas.indexOf(Math.max(...areas));
  const peakArea = areas[peakIndex];
  const peakTime = times[peakIndex];

  const notes: string[] = [];
  if (floorArea > 0.02)
    notes.push(
      `the clip never falls below ${(floorArea * 100).toFixed(0)}% foreground` +
        " (a lit set and moving characters the plate cannot remove); that" +
        " resting level is subtracted before phase detection, but it is still" +
        " inside the per-phase feature targets",
    );
  if (peaks.length > 1)
    notes.push(
      `the clip has ${peaks.length} activity peaks (it repeats); the first at` +
        ` ${peakTime.toFixed(2)}s is used and the rest are ignored`,
    );
  if (!(peakArea > 0.002))
    notes.push("the clip's foreground never exceeds 0.2% of the frame");

  // Rising edge: back from the peak to where activity all but disappears,
  // then forward to where it has reached 40% of the peak.
  let riseStart = 0;
  for (let i = peakIndex; i >= 0; i--) {
    riseStart = i;
    if (areas[i] <= 0.05 * peakArea) break;
  }
  let riseEnd = peakIndex;
  for (let i = riseStart; i <= peakIndex; i++)
    if (areas[i] >= 0.4 * peakArea) {
      riseEnd = i;
      break;
    }
  // Falling edge: forward from the peak through 50% down to 10%.
  let fallStart = peakIndex;
  for (let i = peakIndex; i < areas.length; i++)
    if (areas[i] <= 0.5 * peakArea) {
      fallStart = i;
      break;
    }
  let fallEnd = areas.length - 1;
  for (let i = fallStart; i < areas.length; i++) {
    fallEnd = i;
    if (areas[i] <= 0.1 * peakArea) break;
  }
  // A later repeat must never be swept into the dissipation window.
  const nextPeak = peaks.find((p) => p > peakIndex);
  if (nextPeak !== undefined) fallEnd = Math.min(fallEnd, nextPeak - 1);
  fallStart = Math.min(fallStart, fallEnd);

  const half = 0.075;
  const windows: Record<PhaseName, PhaseWindowSpec> = {
    anticipation: { start: times[riseStart], end: times[riseEnd] },
    peak: { start: peakTime - half, end: peakTime + half },
    dissipation: { start: times[fallStart], end: times[fallEnd] },
  };

  const inWindow = (w: PhaseWindowSpec) => {
    const chosen = samples.filter((s) => s.time >= w.start && s.time <= w.end);
    // Never return an empty window: fall back to the nearest single frame.
    if (chosen.length) return chosen;
    const middle = (w.start + w.end) / 2;
    let best = samples[0];
    for (const s of samples)
      if (Math.abs(s.time - middle) < Math.abs(best.time - middle)) best = s;
    return [best];
  };
  const targets = Object.fromEntries(
    PHASE_NAMES.map((name) => [
      name,
      meanFeatures(inWindow(windows[name]).map((s) => s.features)),
    ]),
  ) as Record<PhaseName, FrameFeatures>;

  const activeSpan: [number, number] = [
    windows.anticipation.start,
    Math.max(windows.dissipation.end, windows.peak.end),
  ];
  const envelope = Array.from({ length: ENVELOPE_BINS }, (_, k) =>
    Math.min(
      1,
      sampleCurve(
        times,
        areas,
        binCentre(activeSpan[0], activeSpan[1], k, ENVELOPE_BINS),
      ) / (peakArea || 1),
    ),
  );

  const confidence: Confidence =
    peaks.length <= 1 ? "high" : peaks.length <= 3 ? "medium" : "low";

  return {
    frames: samples.length,
    fps,
    samples,
    peakTime,
    peakArea,
    floorArea,
    peakCount: peaks.length,
    confidence,
    windows,
    targets,
    span: activeSpan,
    envelope,
    notes,
  };
}

/**
 * Document-side phase windows, anchored on the document's own impact rather
 * than on a proportional share of its duration. Round one showed proportional
 * mapping landing the "peak" window before the effect existed whenever a live
 * document did not honour the prompt's declared total.
 */
export function impactWindows(doc: VfxDocumentV2): Record<PhaseName, PhaseWindowSpec> {
  const { duration } = doc;
  const impact = clamp(doc.impact, 0, duration);
  const tail = Math.max(duration - impact, 1e-3);
  return {
    anticipation: { start: Math.max(0, impact - 0.2 * duration), end: impact },
    peak: { start: impact, end: Math.min(duration, impact + 0.15) },
    dissipation: {
      start: impact + 0.3 * tail,
      end: impact + 0.8 * tail,
    },
  };
}

/**
 * Map a reference time onto document time. The document's impact is pinned to
 * the reference's peak, and the lead-in and the tail are scaled independently
 * so both ends of the clip reach both ends of the document.
 */
export function referenceTimeToDocument(
  time: number,
  analysis: Pick<VideoAnalysis, "peakTime" | "span">,
  doc: VfxDocumentV2,
  /**
   * The document's own anchor. Round three measures it — the document's
   * rendered activity peak and active span — instead of assuming `impact` is
   * where the effect is largest, which the round-two pilot disproved on all
   * three cases. Falls back to impact / whole duration when unmeasured.
   */
  anchor?: { peakTime: number; span: [number, number] },
) {
  const [start, end] = analysis.span;
  const beforePeak = Math.max(analysis.peakTime - start, 1e-3);
  const afterPeak = Math.max(end - analysis.peakTime, 1e-3);
  const docPeak = anchor
    ? clamp(anchor.peakTime, 0, doc.duration)
    : clamp(doc.impact, 0, doc.duration);
  const docStart = anchor ? clamp(anchor.span[0], 0, docPeak) : 0;
  const docEnd = anchor
    ? clamp(anchor.span[1], docPeak, doc.duration)
    : doc.duration;
  const scaled =
    time <= analysis.peakTime
      ? docPeak - ((analysis.peakTime - time) * (docPeak - docStart)) / beforePeak
      : docPeak + ((time - analysis.peakTime) * (docEnd - docPeak)) / afterPeak;
  return clamp(scaled, 0, Math.max(0, doc.duration - 0.001));
}

export interface BuildVideoSheetInput {
  case: string;
  doc: VfxDocumentV2;
  analysis: VideoAnalysis;
  /**
   * The base document's own measured activity, from one rendered area curve.
   * When present the sheet's phases and the envelope's time mapping are
   * anchored on the document's measured peak instead of on `doc.impact`.
   */
  measured?: DocumentWindows;
  samplesPerPhase?: number;
  /** Cap on how many frames the render's area curve is sampled at. */
  maxEnvelopeSamples?: number;
}

/** Build the target sheet from a measured reference clip. */
export function buildVideoReferenceSheet(
  input: BuildVideoSheetInput,
): ReferenceSheet {
  const { doc, analysis, measured } = input;
  const windows = measured ? measured.windows : impactWindows(doc);
  const samples = input.samplesPerPhase ?? 2;
  const phases = PHASE_NAMES.map((name, index) => {
    const window = windows[name];
    const notes = [
      `reference window ${analysis.windows[name].start.toFixed(2)}` +
        `-${analysis.windows[name].end.toFixed(2)}s, measured from the clip`,
      ...targetNotes(analysis.targets[name]),
    ];
    return {
      name,
      start: round3(window.start),
      end: round3(window.end),
      sampleTimes: phaseSampleTimes(window.start, window.end, doc.duration, samples),
      confidence: degrade(analysis.confidence, targetNotes(analysis.targets[name])),
      source: "video" as const,
      reference: index + 1,
      notes,
    } satisfies SheetPhase;
  });

  // The render's area curve: 10 fps across the whole document, thinned if that
  // would cost more renders than the cap allows.
  const rate = ENVELOPE_SAMPLE_RATE;
  const cap = input.maxEnvelopeSamples ?? 24;
  const wanted = Math.max(2, Math.round(doc.duration * rate) + 1);
  const count = Math.min(cap, wanted);
  const sampleTimes = Array.from({ length: count }, (_, i) =>
    round3(clamp((doc.duration * i) / (count - 1), 0, doc.duration - 0.001)),
  );
  const anchor = measured
    ? { peakTime: measured.peakTime, span: measured.span }
    : undefined;
  const documentTimes = Array.from({ length: ENVELOPE_BINS }, (_, k) =>
    round3(
      referenceTimeToDocument(
        binCentre(analysis.span[0], analysis.span[1], k, ENVELOPE_BINS),
        analysis,
        doc,
        anchor,
      ),
    ),
  );

  return {
    version: 1,
    case: input.case,
    duration: doc.duration,
    impact: doc.impact,
    phases,
    targets: analysis.targets,
    weights: Object.fromEntries(
      FEATURE_NAMES.map((name) => [name, DEFAULT_FEATURE_WEIGHTS[name]]),
    ),
    envelope: {
      bins: ENVELOPE_BINS,
      weight: ENVELOPE_WEIGHT,
      values: analysis.envelope,
      peakTime: analysis.peakTime,
      span: analysis.span,
      documentTimes,
      sampleTimes,
    },
    notes: [
      `phases measured from a ${analysis.frames}-frame clip at` +
        ` ${analysis.fps.toFixed(1)} fps; document phases ` +
        (measured
          ? `anchored on the document's own measured peak at ${measured.peakTime.toFixed(2)}s`
          : "anchored on impact"),
      `envelope: ${ENVELOPE_BINS} bins over the reference's active span` +
        ` ${analysis.span[0].toFixed(2)}-${analysis.span[1].toFixed(2)}s,` +
        ` peak ${analysis.peakTime.toFixed(2)}s pinned to impact ${doc.impact}s`,
      ...analysis.notes,
    ],
  };
}

/**
 * Turn a render's sampled area curve into the sheet's envelope bins: normalize
 * by its own peak, then read it at the document times the sheet lines up with
 * the reference bins. Comparing shapes, not magnitudes — magnitude is already
 * covered by the per-phase `area` feature.
 */
export function envelopeFromAreaCurve(
  sheet: ReferenceSheet,
  sampleTimes: readonly number[],
  areas: readonly number[],
) {
  if (!sheet.envelope) return [];
  if (sampleTimes.length !== areas.length)
    throw new Error("Area curve sample count mismatch");
  const peak = Math.max(...areas, 0);
  const normalized = peak > 0 ? areas.map((v) => v / peak) : areas.map(() => 0);
  return sheet.envelope.documentTimes.map((t) =>
    sampleCurve(sampleTimes, normalized, t),
  );
}

// ---------------------------------------------------------------------------
// Document-side phase detection
//
// Round two anchored the document's phases on `doc.impact`, and the pilot
// showed why that is wrong: `impact` is when the effect *starts*, while the
// reference's measured peak is when it is *largest*. On all three live cases
// the two are a whole phase apart, and the peak tile came back showing an
// ignition ring beside a fully grown plume.
//
// So the document is measured the same way the clip is: render its own
// foreground-area curve, take the argmax, and read the windows off that.
// ---------------------------------------------------------------------------

export interface DocumentWindows {
  windows: Record<PhaseName, PhaseWindowSpec>;
  /** Document time of the rendered activity peak. */
  peakTime: number;
  peakArea: number;
  /** Document times the effect is active between. */
  span: [number, number];
  /** Where the peak sits inside that span, 0..1 — the timing guard's subject. */
  peakPosition: number;
}

/**
 * Phase windows read off a rendered area curve. Mirrors the rules the clip is
 * measured with, except that the anticipation window runs all the way to the
 * peak rather than stopping at 40% of it: the document is what has to be
 * sampled, and a two-frame window inside a fast rise is not representative.
 */
export function documentWindowsFromCurve(
  times: readonly number[],
  areas: readonly number[],
  duration: number,
): DocumentWindows {
  if (!times.length || times.length !== areas.length)
    throw new Error("Document area curve is empty or mismatched");
  let peakIndex = 0;
  for (let i = 1; i < areas.length; i++)
    if (areas[i] > areas[peakIndex]) peakIndex = i;
  const peakArea = areas[peakIndex];

  // Sub-sample peak, by fitting a parabola through the argmax and its
  // neighbours. This is not cosmetic: without it the measured peak snaps from
  // one sample to the next as a knob moves, the phase windows jump with it,
  // and the finite-difference Jacobian ends up measuring the jump instead of
  // the response. Round three's first pilot stalled on exactly that.
  let peakTime = times[peakIndex];
  if (peakIndex > 0 && peakIndex < areas.length - 1) {
    const a = areas[peakIndex - 1];
    const b = areas[peakIndex];
    const c = areas[peakIndex + 1];
    const denominator = a - 2 * b + c;
    if (Math.abs(denominator) > 1e-12) {
      const offset = clamp((0.5 * (a - c)) / denominator, -0.5, 0.5);
      const step =
        offset >= 0
          ? times[peakIndex + 1] - times[peakIndex]
          : times[peakIndex] - times[peakIndex - 1];
      peakTime = times[peakIndex] + offset * step;
    }
  }

  /**
   * Time at which the curve crosses `level`, interpolated between samples.
   * Walking outward from the peak in `direction`; returns the far end of the
   * curve when it never gets there.
   */
  const crossing = (level: number, direction: 1 | -1) => {
    for (
      let i = peakIndex;
      i + direction >= 0 && i + direction < areas.length;
      i += direction
    ) {
      const next = i + direction;
      if (areas[next] > level) continue;
      const span = areas[i] - areas[next];
      const u = span > 1e-12 ? clamp((areas[i] - level) / span, 0, 1) : 1;
      return times[i] + (times[next] - times[i]) * u;
    }
    return direction > 0 ? times[times.length - 1] : times[0];
  };

  const ceiling = Math.max(0, duration - 0.001);
  const half = 0.075;
  const riseStart = Math.min(crossing(0.05 * peakArea, -1), peakTime);
  const fallHalf = Math.max(crossing(0.5 * peakArea, 1), peakTime);
  const fallEnd = Math.max(crossing(0.1 * peakArea, 1), fallHalf);

  const windows: Record<PhaseName, PhaseWindowSpec> = {
    anticipation: {
      start: clamp(riseStart, 0, ceiling),
      end: clamp(peakTime, 0, ceiling),
    },
    peak: {
      start: clamp(peakTime - half, 0, ceiling),
      end: clamp(peakTime + half, 0, ceiling),
    },
    dissipation: {
      start: clamp(fallHalf, 0, ceiling),
      end: clamp(Math.max(fallEnd, fallHalf + 1e-3), 0, ceiling),
    },
  };
  const span: [number, number] = [
    clamp(riseStart, 0, ceiling),
    Math.max(clamp(fallEnd, 0, ceiling), windows.peak.end),
  ];
  const width = Math.max(span[1] - span[0], 1e-6);
  return {
    windows,
    peakTime: clamp(peakTime, 0, ceiling),
    peakArea,
    span,
    // A document whose foreground never appears at all has no meaningful
    // position; report the middle rather than a division by zero.
    peakPosition: peakArea > 0 ? clamp((peakTime - span[0]) / width, 0, 1) : 0.5,
  };
}

/** Two sample times inside each measured window, in document time. */
export function documentPhaseTimes(
  measured: DocumentWindows,
  duration: number,
  samplesPerPhase = 2,
) {
  return Object.fromEntries(
    PHASE_NAMES.map((name) => [
      name,
      phaseSampleTimes(
        measured.windows[name].start,
        measured.windows[name].end,
        duration,
        samplesPerPhase,
      ),
    ]),
  ) as Record<PhaseName, number[]>;
}

// ---------------------------------------------------------------------------
// Measure -> align -> explain -> act, for the v2 scalar refinement round.
//
// calibrate-v2.ts searches the whole eleven-knob box against a reference sheet.
// That is the right tool for an offline calibration and the wrong one inside a
// generation run: it costs forty renders and it answers "which knobs" with a
// number, not with a reason anybody can read.
//
// This module is the small version of the same idea. It holds the arithmetic
// the measure stage produces — the per-phase delta table, the envelope
// distance, the one-pass influence table — and the numeric solver that runs
// AFTER the model has named at most three knobs and the features it wants
// smaller. The model chooses the subspace; damped least squares finds the point
// inside it. Nothing here touches the DOM: the browser half lives in
// measure-browser-v2.ts and supplies `evaluate`.
// ---------------------------------------------------------------------------

import {
  checkGuards,
  dampedStep,
  residualOf,
  DEFAULT_GUARDS,
  type EvaluateResult,
  type Evaluator,
  type GuardLimits,
  type GuardReport,
} from "./calibrate-v2";
import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_NAMES,
  type FeatureName,
} from "./features-v2";
import {
  KNOB_NAMES,
  LOG_KNOB_BOUNDS,
  fromLogKnobs,
  knobRecord,
  type KnobName,
} from "./knobs-v2";
import {
  PHASE_NAMES,
  type Confidence,
  type PhaseName,
  type ReferenceSheet,
  type SheetPhase,
} from "./reference-features";

/** Rows of the delta table the refiner is shown: the worst offenders only. */
export const MEASUREMENT_DELTA_ROWS = 20;
/** Rows of the influence table the refiner is shown. */
export const MEASUREMENT_INFLUENCE_ROWS = 15;
/** Knobs the refiner may name. */
export const MAX_REFINE_KNOBS_V2 = 3;
/** Features the refiner may ask to reduce. */
export const MAX_REFINE_TARGETS_V2 = 6;
/** Fractional drop in the weighted residual a solve must reach to be adopted. */
export const MIN_SUBSPACE_IMPROVEMENT = 0.1;
/** Damped least-squares iterations the solver may spend. */
export const SUBSPACE_ITERATIONS = 2;
/** Central-difference step, in log-knob space. */
export const SUBSPACE_DELTA = 0.25;
/**
 * How far one scalar round may move a knob, as a multiplier either way.
 *
 * The measurement is made with the camera frozen on the base document's own
 * auto-framing — the only way the residual measures the effect rather than the
 * shot. A large silhouette change breaks that: it re-frames the evidence
 * capture, and on fx01 a mesh scaled past 2x auto-frames into an empty black
 * sheet while the frozen-camera measurement still reads a fine bolt. A scalar
 * round is a correction, not a redesign, so it stays inside the neighbourhood
 * where the two agree; anything bigger belongs to the structural round.
 */
export const SUBSPACE_KNOB_LIMIT = 1.5;

/**
 * Extra damped trials allowed when a guard refuses a step. They reuse the
 * Jacobian already measured at that point, so each costs one evaluation, and a
 * step that only just breaks a ceiling gets a shorter one rather than nothing.
 */
export const MAX_GUARD_RETRIES = 2;

/**
 * How the reference reaches the measure stage: a clip the browser decodes
 * itself, frames somebody already decoded (a local run hands these over,
 * because a headless Chromium has no proprietary video codecs), or the three
 * benchmark stills, which carry no timing and are flagged low confidence.
 */
export type ReferenceInputV2 =
  | { kind: "video"; video: string }
  | { kind: "frames"; fps: number; frames: string[] }
  | { kind: "stills"; stills: string[]; prompt?: string };

export interface MeasurementDelta {
  feature: FeatureName;
  phase: PhaseName;
  /** The render's value for this feature at this phase. */
  render: number;
  /** The reference sheet's target. */
  reference: number;
  /** (render - reference) / scale, the standardized residual component. */
  delta: number;
  /** This feature's residual weight. */
  weight: number;
}

export interface MeasurementInfluence {
  knob: KnobName;
  feature: FeatureName | "envelope";
  phase: PhaseName | "envelope";
  /** d(standardized residual row) / d(log knob). */
  slope: number;
}

export interface MeasurementEnvelope {
  /** The render's peak-normalized area curve at the sheet's bins. */
  render: number[];
  /** The reference's. */
  reference: number[];
  /** RMS distance between the two curves. */
  distance: number;
}

/**
 * What the measure stage knows about one candidate: where its phases are, how
 * far every screen feature sits from the reference at those phases, how the two
 * activity curves differ, and which knob moves which row.
 */
export interface MeasurementV2 {
  phases: SheetPhase[];
  deltas: MeasurementDelta[];
  envelope: MeasurementEnvelope;
  influences: MeasurementInfluence[];
  confidence: Confidence;
  notes: string[];
  /** Phase-aligned comparison sheet (render beside reference), as a data URL. */
  sheet?: string;
  /** Weighted residual norm over every row, for the trace. */
  residualNorm?: number;
  /** Knob multipliers this measurement describes; identity for a base document. */
  knobs?: Record<KnobName, number>;
}

const round = (v: number, places = 4) => {
  const factor = 10 ** places;
  return Number.isFinite(v) ? Math.round(v * factor) / factor : 0;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const clampLog = (v: readonly number[]) =>
  v.map((x, i) =>
    clamp(Number.isFinite(x) ? x : 0, LOG_KNOB_BOUNDS[i][0], LOG_KNOB_BOUNDS[i][1]),
  );

/** Split a residual label ("peak.area", "envelope.7") into its two parts. */
export function parseResidualLabel(label: string): {
  phase: PhaseName | "envelope";
  feature: FeatureName | "envelope";
} {
  const [head, tail] = [label.slice(0, label.indexOf(".")), label.slice(label.indexOf(".") + 1)];
  if (head === "envelope") return { phase: "envelope", feature: "envelope" };
  return {
    phase: head as PhaseName,
    feature: tail as FeatureName,
  };
}

/**
 * Every (phase, feature) difference between a render and the sheet, standardized
 * the same way the residual is, worst first. `limit` keeps the table small
 * enough to put in a prompt without turning it into a data dump.
 */
export function deltaTable(
  sheet: ReferenceSheet,
  features: Record<PhaseName, import("./features-v2").FrameFeatures>,
  weights: Record<FeatureName, number> = DEFAULT_FEATURE_WEIGHTS,
  limit = MEASUREMENT_DELTA_ROWS,
): MeasurementDelta[] {
  const residual = residualOf(sheet, features, weights);
  const rows: MeasurementDelta[] = [];
  for (let i = 0; i < residual.labels.length; i++) {
    const label = residual.labels[i];
    if (label.startsWith("envelope.")) continue;
    const { phase, feature } = parseResidualLabel(label);
    if (phase === "envelope" || feature === "envelope") continue;
    const weight = weights[feature];
    rows.push({
      feature,
      phase,
      render: round(features[phase][feature]),
      reference: round(sheet.targets[phase][feature]),
      // residual values already carry the weight; report the unweighted,
      // scale-standardized difference and the weight beside it.
      delta: round(weight ? residual.values[i] / weight : residual.values[i]),
      weight,
    });
  }
  return rows
    .sort((a, b) => Math.abs(b.delta * b.weight) - Math.abs(a.delta * a.weight))
    .slice(0, limit);
}

/** RMS distance between two peak-normalized activity curves. */
export function envelopeDistance(
  render: readonly number[],
  reference: readonly number[],
) {
  if (!reference.length) return 0;
  let sum = 0;
  for (let i = 0; i < reference.length; i++) {
    const d = (render[i] ?? 0) - reference[i];
    sum += d * d;
  }
  return round(Math.sqrt(sum / reference.length));
}

/**
 * The strongest (knob, row) pairs of one Jacobian pass. `columns[j]` is the
 * finite-difference column for knob j, in the row order of `labels`.
 */
export function influenceTable(
  labels: readonly string[],
  columns: readonly (readonly number[])[],
  limit = MEASUREMENT_INFLUENCE_ROWS,
): MeasurementInfluence[] {
  const rows: MeasurementInfluence[] = [];
  columns.forEach((column, j) => {
    const knob = KNOB_NAMES[j];
    column.forEach((slope, row) => {
      if (!Number.isFinite(slope) || slope === 0) return;
      const { phase, feature } = parseResidualLabel(labels[row]);
      rows.push({ knob, feature, phase, slope: round(slope) });
    });
  });
  return rows
    .sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))
    .slice(0, limit);
}

// --- the subspace solve ----------------------------------------------------

/** One knob the refiner named, with the direction it expects to help. */
export interface RefineKnobRequest {
  name: KnobName;
  direction: "up" | "down";
  reason?: string;
}

export interface RefinePlanRequest {
  knobs: RefineKnobRequest[];
  targets: FeatureName[];
}

export interface SubspaceTrial {
  logKnobs: number[];
  residualNorm: number;
  accepted: boolean;
  reason: string;
}

export interface SubspaceResult {
  /** Knob names the solve was allowed to move. */
  knobs: KnobName[];
  targets: FeatureName[];
  logKnobs: number[];
  knobValues: Record<KnobName, number>;
  baselineResidual: number;
  residual: number;
  improvement: number;
  accepted: boolean;
  guards: GuardReport;
  evaluations: number;
  trials: SubspaceTrial[];
  notes: string[];
  /** The accepted point's evaluation, so the caller can re-measure from it. */
  result: EvaluateResult;
}

export interface SubspaceOptions {
  sheet: ReferenceSheet;
  evaluate: Evaluator;
  plan: RefinePlanRequest;
  /** The point the solve starts from, in log-knob space. Identity by default. */
  base?: number[];
  /** The base point's evaluation, when the caller already has it. */
  baseResult?: EvaluateResult;
  /** Layer count and worst guard values the base document established. */
  reference: {
    visibleLayers: number;
    worst?: GuardReport["worst"];
    peakPosition?: number;
  };
  weights?: Record<FeatureName, number>;
  guards?: GuardLimits;
  delta?: number;
  lambda?: number;
  iterations?: number;
  /** Fractional residual drop required for acceptance. */
  minImprovement?: number;
  /**
   * Collapse floor: the smallest peak-phase foreground area a solved candidate
   * may have. An empty frame measures as zeros, and zeros beat a real render on
   * any residual row whose target is small — the dry run found exactly that,
   * with a mesh scaled until nothing was left to see. calibrate-v2's guards are
   * all ceilings, so this floor is the one thing added here.
   */
  minPeakArea?: number;
  /** Multiplier bound on every knob this round may move. */
  knobLimit?: number;
}

/** Share of the base document's own peak area a solve must keep. */
export const COLLAPSE_FRACTION = 0.25;

/**
 * The weighted residual restricted to the features the refiner asked to reduce.
 * Every phase of each named feature counts; the envelope rows never do, because
 * a scalar round that is told to fix `area` should not be scored on timing it
 * was not asked about.
 */
export function selectedResidual(
  sheet: ReferenceSheet,
  features: Record<PhaseName, import("./features-v2").FrameFeatures>,
  targets: readonly FeatureName[],
  weights: Record<FeatureName, number> = DEFAULT_FEATURE_WEIGHTS,
) {
  const wanted = new Set<string>(targets);
  const full = residualOf(sheet, features, weights);
  const labels: string[] = [];
  const values: number[] = [];
  full.labels.forEach((label, i) => {
    if (label.startsWith("envelope.")) return;
    const { feature } = parseResidualLabel(label);
    if (!wanted.has(feature)) return;
    labels.push(label);
    values.push(full.values[i]);
  });
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return { labels, values, norm: Number.isFinite(norm) ? norm : Infinity };
}

/**
 * Damped least squares inside the ≤3-knob subspace the refiner named.
 *
 * Cost is fixed and small: 2k + 1 evaluations per iteration (central
 * differences plus one trial), two iterations. The guards are calibrate-v2's,
 * including the peak-position guard — a knob that wins the residual by sliding
 * the whole effect somewhere else is not an improvement — and the layer-count
 * guard, which is what stops a solve from paying for features with a layer.
 */
export async function solveKnobSubspace(
  options: SubspaceOptions,
): Promise<SubspaceResult> {
  const {
    sheet,
    evaluate,
    plan,
    reference,
    weights = DEFAULT_FEATURE_WEIGHTS,
    guards = DEFAULT_GUARDS,
    delta = SUBSPACE_DELTA,
    iterations = SUBSPACE_ITERATIONS,
    minImprovement = MIN_SUBSPACE_IMPROVEMENT,
  } = options;
  let lambda = options.lambda ?? 1e-3;

  const names = plan.knobs.slice(0, MAX_REFINE_KNOBS_V2).map((k) => k.name);
  const indices = names.map((name) => KNOB_NAMES.indexOf(name));
  if (!indices.length || indices.some((i) => i < 0))
    throw new Error("Refinement plan named a knob outside the v2 knob set.");
  const targets = plan.targets
    .slice(0, MAX_REFINE_TARGETS_V2)
    .filter((name): name is FeatureName => FEATURE_NAMES.includes(name));
  if (!targets.length)
    throw new Error("Refinement plan named no measurable feature to reduce.");

  // The round's own box: the knob box, narrowed to a bounded neighbourhood of
  // the point it starts from.
  const limit = Math.abs(Math.log(options.knobLimit ?? SUBSPACE_KNOB_LIMIT));
  const start = clampLog(options.base ?? new Array(KNOB_NAMES.length).fill(0));
  const roundBounds = LOG_KNOB_BOUNDS.map(
    ([lo, hi], i) =>
      [Math.max(lo, start[i] - limit), Math.min(hi, start[i] + limit)] as const,
  );
  const clampRound = (v: readonly number[]) =>
    v.map((x, i) =>
      clamp(Number.isFinite(x) ? x : 0, roundBounds[i][0], roundBounds[i][1]),
    );

  const notes: string[] = [];
  const trials: SubspaceTrial[] = [];
  let evaluations = 0;
  const run = async (logKnobs: number[]) => {
    const result = await evaluate(fromLogKnobs(logKnobs));
    evaluations++;
    return result;
  };

  /** calibrate-v2's guards, plus the collapse floor. */
  const guardsFor = (result: EvaluateResult): GuardReport => {
    const report = checkGuards(
      result.features,
      result.visibleLayers,
      reference,
      guards,
      result.peakPosition,
    );
    if (
      options.minPeakArea !== undefined &&
      report.worst.area < options.minPeakArea
    )
      return {
        ...report,
        ok: false,
        violations: [
          ...report.violations,
          `effect collapsed: peak area ${report.worst.area.toFixed(4)} <` +
            ` ${options.minPeakArea.toFixed(4)}`,
        ],
      };
    return report;
  };

  let bestLog = start;
  let bestResult = options.baseResult ?? (await run(bestLog));
  let bestResidual = selectedResidual(sheet, bestResult.features, targets, weights);
  const baselineResidual = bestResidual.norm;
  let bestGuards = guardsFor(bestResult);

  // The Jacobian is re-measured only after a step is taken. A trial the guards
  // refused leaves the point unchanged, so the same columns still describe it
  // and the retry costs one evaluation instead of 2k + 1.
  let jacobian: number[][] | null = null;
  let steps = 0;
  let retries = 0;
  for (
    let iteration = 1;
    steps < iterations && retries <= MAX_GUARD_RETRIES;
    iteration++
  ) {
    if (!jacobian) {
      const columns: number[][] = [];
      for (const j of indices) {
        const [lo, hi] = roundBounds[j];
        const plus = [...bestLog];
        plus[j] = clamp(bestLog[j] + delta, lo, hi);
        const minus = [...bestLog];
        minus[j] = clamp(bestLog[j] - delta, lo, hi);
        const span = plus[j] - minus[j];
        const up = await run(plus);
        const down = await run(minus);
        const upResidual = selectedResidual(sheet, up.features, targets, weights);
        const downResidual = selectedResidual(
          sheet,
          down.features,
          targets,
          weights,
        );
        columns.push(
          upResidual.values.map(
            (v, row) => (v - downResidual.values[row]) / (span || 1),
          ),
        );
      }
      jacobian = bestResidual.values.map((_, row) =>
        columns.map((column) => column[row]),
      );
    }
    const step = dampedStep(jacobian, bestResidual.values, lambda);
    if (!step) {
      notes.push(`iteration ${iteration}: normal equations singular`);
      break;
    }
    const candidate = [...bestLog];
    indices.forEach((j, k) => {
      candidate[j] = bestLog[j] + step[k];
    });
    const clamped = clampRound(candidate);
    if (indices.every((j) => Math.abs(clamped[j] - bestLog[j]) < 1e-6)) {
      trials.push({
        logKnobs: clamped,
        residualNorm: bestResidual.norm,
        accepted: false,
        reason: "step collapsed to zero at the knob box bound",
      });
      break;
    }
    const trial = await run(clamped);
    const trialResidual = selectedResidual(sheet, trial.features, targets, weights);
    const trialGuards = guardsFor(trial);
    const better = trialResidual.norm < bestResidual.norm;
    const reason = better
      ? trialGuards.ok
        ? "accepted"
        : `guards: ${trialGuards.violations.join("; ")}`
      : "residual did not decrease";
    trials.push({
      logKnobs: clamped,
      residualNorm: trialResidual.norm,
      accepted: better && trialGuards.ok,
      reason,
    });
    if (!(better && trialGuards.ok)) {
      // Damp harder and try a shorter step from the same point; the columns
      // still hold, so the retry is one evaluation.
      lambda *= 8;
      retries++;
      notes.push(`iteration ${iteration} rejected: ${reason}`);
      continue;
    }
    steps++;
    bestLog = clamped;
    bestResult = trial;
    bestResidual = trialResidual;
    bestGuards = trialGuards;
    jacobian = null;
    lambda = Math.max(1e-6, lambda / 3);
  }

  const improvement = baselineResidual
    ? (baselineResidual - bestResidual.norm) / baselineResidual
    : 0;
  const accepted = improvement >= minImprovement && bestGuards.ok;
  if (!accepted && improvement > 0 && improvement < minImprovement)
    notes.push(
      `residual fell ${(improvement * 100).toFixed(1)}%, short of the` +
        ` ${(minImprovement * 100).toFixed(0)}% the round requires`,
    );
  // What the refiner predicted, against what the numbers did. Recorded, never
  // enforced: the solve follows the measurement, not the prose.
  for (const request of plan.knobs.slice(0, MAX_REFINE_KNOBS_V2)) {
    const j = KNOB_NAMES.indexOf(request.name);
    const moved = bestLog[j];
    const wanted = request.direction === "up" ? 1 : -1;
    if (Math.abs(moved) > 1e-6 && Math.sign(moved) !== wanted)
      notes.push(
        `${request.name} was asked to go ${request.direction};` +
          ` the solve moved it the other way`,
      );
  }

  return {
    knobs: names,
    targets,
    logKnobs: bestLog,
    knobValues: knobRecord(fromLogKnobs(bestLog)),
    baselineResidual: round(baselineResidual),
    residual: round(bestResidual.norm),
    improvement: round(improvement),
    accepted,
    guards: bestGuards,
    evaluations,
    trials,
    notes,
    result: bestResult,
  };
}

/** One line per phase, for the trace. */
export function describeMeasurementV2(measurement: MeasurementV2) {
  const worst = measurement.deltas[0];
  return (
    `Measured ${PHASE_NAMES.length} phases at ${measurement.confidence} confidence;` +
    ` envelope distance ${measurement.envelope.distance}` +
    (worst
      ? `, worst row ${worst.phase}.${worst.feature} ${worst.delta > 0 ? "+" : ""}${worst.delta}`
      : "")
  );
}

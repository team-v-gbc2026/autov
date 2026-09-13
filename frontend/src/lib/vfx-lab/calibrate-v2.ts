// ---------------------------------------------------------------------------
// Reference-conditioned renderer response calibration.
//
// With camera, exposure and seed fixed, the renderer is a black box
// F: knobs -> screen features at the reference sheet's phase times. This module
// measures its local response by finite differences in log-knob space
// (1 + 2 * 8 = 17 evaluations per iteration), and takes a damped least-squares
// step toward the reference's features inside the knob box.
//
// It knows nothing about WebGL: the caller supplies an `evaluate` function that
// renders a knob vector and returns per-phase features. The two baselines
// (random search, coordinate search) go through exactly the same evaluator and
// the same accounting, so "equal render budget" means equal to the frame.
//
// Everything is deterministic: the search order is fixed, the random baseline
// draws from a seeded generator, and no evaluation is discarded unlogged.
// ---------------------------------------------------------------------------

import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_NAMES,
  FEATURE_SCALE_FLOORS,
  isFiniteFeatures,
  type FeatureName,
  type FrameFeatures,
} from "./features-v2";
import {
  KNOB_NAMES,
  LOG_KNOB_BOUNDS,
  clampKnobs,
  fromLogKnobs,
  knobRecord,
} from "./knobs-v2";
import { PHASE_NAMES, type PhaseName, type ReferenceSheet } from "./reference-features";

export type PhaseFeatures = Record<PhaseName, FrameFeatures>;

export interface EvaluateResult {
  features: PhaseFeatures;
  /**
   * The render's own peak-normalized area curve, read at the sheet's envelope
   * bins. Required whenever the sheet carries an envelope target.
   */
  envelope?: number[];
  /** Layers the renderer drew; the structure guard compares it to the base. */
  visibleLayers: number;
  /**
   * Where this render's own activity peaks inside its own active span, 0..1.
   * Compared against the reference's position by the timing guard.
   */
  peakPosition?: number;
  /** The document phase windows this evaluation was measured at. */
  windows?: Record<PhaseName, { start: number; end: number }>;
  /** Optional per-frame features, carried into the report for inspection. */
  frames?: Record<PhaseName, FrameFeatures[]>;
}

export type Evaluator = (knobs: number[]) => Promise<EvaluateResult>;

export interface GuardLimits {
  p99: number;
  washout: number;
  area: number;
  /**
   * How far the render's own activity peak may sit from the reference's, as a
   * fraction of the active span. Without it the time knob can win envelope
   * rows by sliding the whole effect somewhere else.
   */
  peakPosition: number;
}

export const DEFAULT_GUARDS: GuardLimits = {
  p99: 0.98,
  washout: 0.02,
  area: 0.6,
  peakPosition: 0.25,
};

export interface GuardReport {
  ok: boolean;
  violations: string[];
  worst: { p99: number; washout: number; area: number };
  /** Where the render peaks inside its own active span, 0..1. */
  peakPosition?: number;
}

export interface EvaluationRecord {
  index: number;
  /** Which stage of the search produced it. */
  stage: string;
  knobs: Record<string, number>;
  logKnobs: number[];
  features: PhaseFeatures;
  /** The document phase windows this evaluation measured itself at. */
  windows?: Record<PhaseName, { start: number; end: number }>;
  /** The render's own envelope, when the sheet carries an envelope target. */
  envelope?: number[];
  /** Residual norm restricted to the envelope rows, for attribution. */
  envelopeNorm?: number;
  residualNorm: number;
  guards: GuardReport;
  accepted: boolean;
}

/** One knob's measured pull on the residual, and the rows it pulls hardest. */
export interface KnobInfluence {
  knob: string;
  norm: number;
  top: { row: string; slope: number }[];
}

export interface JacobianTable {
  /** "<phase>.<feature>" for every residual row. */
  rows: string[];
  columns: readonly string[];
  /** d(residual) / d(log knob). */
  values: number[][];
  /** Per knob: the residual rows it moved most, largest first. */
  influence: KnobInfluence[];
}

export interface CalibrationResult {
  method: CalibrationMethod;
  budget: number;
  used: number;
  seed: number;
  delta: number;
  baseline: { knobs: Record<string, number>; residualNorm: number; guards: GuardReport };
  best: {
    knobs: Record<string, number>;
    logKnobs: number[];
    residualNorm: number;
    guards: GuardReport;
  };
  improvement: number;
  evaluations: EvaluationRecord[];
  iterations: {
    iteration: number;
    lambda: number;
    trials: { logKnobs: number[]; residualNorm: number; accepted: boolean; reason: string }[];
  }[];
  jacobian: JacobianTable | null;
  /** Which finite-difference scheme each iteration could afford. */
  differences: ("central" | "forward")[];
  /** Where the reference peaks in its active span; the timing guard's datum. */
  referencePeakPosition?: number;
  notes: string[];
}

export type CalibrationMethod = "response" | "random" | "coordinate";

// --- residual --------------------------------------------------------------

export interface Residual {
  labels: string[];
  values: number[];
  norm: number;
}

/**
 * Weighted, scale-standardized difference between a candidate's per-phase
 * features and the sheet's targets. Each component is divided by the size of
 * the target it is chasing (floored, so a near-zero target cannot dominate),
 * which is what makes area, luminance and hue commensurable.
 */
export function residualOf(
  sheet: ReferenceSheet,
  features: PhaseFeatures,
  weights: Record<FeatureName, number> = DEFAULT_FEATURE_WEIGHTS,
  envelope?: readonly number[],
): Residual {
  const labels: string[] = [];
  const values: number[] = [];
  for (const phase of PHASE_NAMES) {
    const target = sheet.targets[phase];
    const actual = features[phase];
    for (const name of FEATURE_NAMES) {
      const scale = Math.max(Math.abs(target[name]), FEATURE_SCALE_FLOORS[name]);
      labels.push(`${phase}.${name}`);
      values.push((weights[name] * (actual[name] - target[name])) / scale);
    }
  }
  // Temporal envelope: when the reference is a clip, *when* the effect peaks
  // and how fast it decays are targets too, not just what three moments look
  // like. Both curves are peak-normalized, so this compares shape over time and
  // leaves magnitude to the per-phase `area` feature.
  const target = sheet.envelope;
  if (target) {
    const actual = envelope ?? [];
    for (let k = 0; k < target.values.length; k++) {
      const scale = Math.max(Math.abs(target.values[k]), ENVELOPE_SCALE_FLOOR);
      labels.push(`envelope.${k}`);
      values.push((target.weight * ((actual[k] ?? 0) - target.values[k])) / scale);
    }
  }
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return { labels, values, norm: Number.isFinite(norm) ? norm : Infinity };
}

/** Floor on the envelope residual's standardizing scale; the curve is 0..1. */
export const ENVELOPE_SCALE_FLOOR = 0.2;

/**
 * Guards against metric hacking. The optimizer can always make `area` and `p90`
 * bigger by blowing the frame out; these are the limits that make that a losing
 * move. A document that already violates a limit at identity knobs is held to
 * "no worse than where it started" instead of to the absolute limit, so a bad
 * starting point stays optimizable.
 */
export function checkGuards(
  features: PhaseFeatures,
  visibleLayers: number,
  reference: {
    visibleLayers: number;
    worst?: GuardReport["worst"];
    /** Where the reference peaks inside its active span, 0..1. */
    peakPosition?: number;
  },
  limits: GuardLimits = DEFAULT_GUARDS,
  peakPosition?: number,
): GuardReport {
  const violations: string[] = [];
  const worst = { p99: 0, washout: 0, area: 0 };
  let finite = true;
  for (const phase of PHASE_NAMES) {
    const f = features[phase];
    if (!isFiniteFeatures(f)) finite = false;
    worst.p99 = Math.max(worst.p99, f.p99);
    worst.washout = Math.max(worst.washout, f.washout);
    worst.area = Math.max(worst.area, f.area);
  }
  if (!finite) violations.push("non-finite feature");
  const ceiling = (key: keyof GuardReport["worst"]) =>
    Math.max(limits[key], reference.worst ? reference.worst[key] : 0);
  if (worst.p99 > ceiling("p99"))
    violations.push(`p99 ${worst.p99.toFixed(3)} > ${ceiling("p99").toFixed(3)}`);
  if (worst.washout > ceiling("washout"))
    violations.push(
      `washout ${worst.washout.toFixed(3)} > ${ceiling("washout").toFixed(3)}`,
    );
  if (worst.area > ceiling("area"))
    violations.push(`area ${worst.area.toFixed(3)} > ${ceiling("area").toFixed(3)}`);
  if (visibleLayers !== reference.visibleLayers)
    violations.push(
      `visible layers ${visibleLayers} != ${reference.visibleLayers}`,
    );
  if (
    reference.peakPosition !== undefined &&
    peakPosition !== undefined &&
    Number.isFinite(peakPosition)
  ) {
    const drift = Math.abs(peakPosition - reference.peakPosition);
    if (drift > limits.peakPosition)
      violations.push(
        `peak position ${peakPosition.toFixed(3)} drifted ${drift.toFixed(3)}` +
          ` from the reference's ${reference.peakPosition.toFixed(3)}` +
          ` (limit ${limits.peakPosition})`,
      );
  }
  return { ok: violations.length === 0, violations, worst, peakPosition };
}

// --- small dense linear algebra (n = 8) ------------------------------------

/** Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinearSystem(
  a: number[][],
  b: number[],
): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (!(Math.abs(m[pivot][col]) > 1e-12)) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      if (!factor) continue;
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  const out = m.map((row, i) => row[n] / m[i][i]);
  return out.every(Number.isFinite) ? out : null;
}

/** Levenberg-Marquardt step: (JᵀJ + λ diag(JᵀJ)) Δ = -Jᵀr. */
export function dampedStep(
  jacobian: number[][],
  residual: number[],
  lambda: number,
): number[] | null {
  const n = jacobian[0]?.length ?? 0;
  if (!n) return null;
  const jtj = Array.from({ length: n }, () => new Array(n).fill(0));
  const jtr = new Array(n).fill(0);
  for (let row = 0; row < jacobian.length; row++) {
    const r = residual[row];
    for (let i = 0; i < n; i++) {
      jtr[i] += jacobian[row][i] * r;
      for (let j = 0; j < n; j++) jtj[i][j] += jacobian[row][i] * jacobian[row][j];
    }
  }
  // Marquardt scaling, with a floor so a knob with no measured response is
  // damped rather than dividing by zero.
  for (let i = 0; i < n; i++)
    jtj[i][i] += lambda * Math.max(jtj[i][i], 1e-6);
  return solveLinearSystem(
    jtj,
    jtr.map((v) => -v),
  );
}

// --- deterministic RNG -----------------------------------------------------

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Every knob has its own box; time is narrower than the rest. */
const clampLog = (v: number[]) =>
  v.map((x, i) =>
    clamp(Number.isFinite(x) ? x : 0, LOG_KNOB_BOUNDS[i][0], LOG_KNOB_BOUNDS[i][1]),
  );

// --- the search ------------------------------------------------------------

export interface CalibrateOptions {
  sheet: ReferenceSheet;
  evaluate: Evaluator;
  method?: CalibrationMethod;
  /** Maximum number of renderer evaluations, identical across methods. */
  budget?: number;
  iterations?: number;
  /** Finite-difference / coordinate step, in log-knob space. */
  delta?: number;
  lambda?: number;
  seed?: number;
  guards?: GuardLimits;
  weights?: Record<FeatureName, number>;
}

export async function calibrate(
  options: CalibrateOptions,
): Promise<CalibrationResult> {
  const {
    sheet,
    evaluate,
    method = "response",
    budget = 40,
    iterations = 2,
    delta = 0.25,
    lambda: lambda0 = 1e-3,
    seed = 1,
    guards = DEFAULT_GUARDS,
    weights = DEFAULT_FEATURE_WEIGHTS,
  } = options;

  const n = KNOB_NAMES.length;
  const evaluations: EvaluationRecord[] = [];
  const notes: string[] = [];
  let used = 0;

  let baselineVisible = 0;
  // Both are filled in by the first (identity-knob) evaluation and then act as
  // the reference every later candidate's guards are measured against.
  let baselineWorst: GuardReport["worst"] | undefined = undefined;
  // Where the reference peaks inside its active span; the timing guard's datum.
  const referencePeakPosition = sheet.envelope
    ? clamp(
        (sheet.envelope.peakTime - sheet.envelope.span[0]) /
          Math.max(sheet.envelope.span[1] - sheet.envelope.span[0], 1e-6),
        0,
        1,
      )
    : undefined;

  const run = async (logKnobs: number[], stage: string) => {
    const knobs = fromLogKnobs(logKnobs);
    const result = await evaluate(knobs);
    used++;
    const residual = residualOf(sheet, result.features, weights, result.envelope);
    const guardReport = checkGuards(
      result.features,
      result.visibleLayers,
      {
        visibleLayers: baselineVisible,
        worst: baselineWorst,
        peakPosition: referencePeakPosition,
      },
      guards,
      result.peakPosition,
    );
    const envelopeRows = residual.values.filter((_, i) =>
      residual.labels[i].startsWith("envelope."),
    );
    const record: EvaluationRecord = {
      index: evaluations.length,
      stage,
      knobs: knobRecord(knobs),
      logKnobs: [...logKnobs],
      features: result.features,
      windows: result.windows,
      envelope: result.envelope,
      envelopeNorm: envelopeRows.length
        ? Math.sqrt(envelopeRows.reduce((sum, v) => sum + v * v, 0))
        : undefined,
      residualNorm: residual.norm,
      guards: guardReport,
      accepted: false,
    };
    evaluations.push(record);
    return { record, residual, result };
  };

  // Identity knobs: the document exactly as authored.
  const identity = new Array(n).fill(0);
  const first = await run(identity, "baseline");
  baselineVisible = first.result.visibleLayers;
  baselineWorst = first.record.guards.worst;
  // Re-score the baseline now that its own guard reference exists.
  first.record.guards = checkGuards(
    first.result.features,
    first.result.visibleLayers,
    {
      visibleLayers: baselineVisible,
      worst: baselineWorst,
      peakPosition: referencePeakPosition,
    },
    guards,
    first.result.peakPosition,
  );
  first.record.accepted = true;

  let bestLog = identity;
  let bestNorm = first.residual.norm;
  let bestGuards = first.record.guards;
  let bestResidual = first.residual;

  const iterationLog: CalibrationResult["iterations"] = [];
  const differenceScheme: ("central" | "forward")[] = [];
  let jacobianTable: JacobianTable | null = null;

  if (method === "response") {
    let lambda = lambda0;
    for (let iteration = 1; iteration <= iterations; iteration++) {
      if (used + n + 1 > budget) {
        notes.push(
          `stopped before iteration ${iteration}: budget ${budget} cannot fund` +
            ` another Jacobian (${n} probes + at least one trial)`,
        );
        break;
      }
      // Central differences cost 2n probes; forward differences cost n and
      // reuse the point we are already standing on. Central is the default and
      // is what the budget check above reserves for; forward is what keeps a
      // second iteration affordable when eleven knobs no longer fit twice.
      const central = used + 2 * n + 1 <= budget;
      const columns: number[][] = [];
      for (let j = 0; j < n; j++) {
        const bound = LOG_KNOB_BOUNDS[j];
        const plus = [...bestLog];
        plus[j] = clamp(bestLog[j] + delta, bound[0], bound[1]);
        const up = await run(plus, `jacobian-${iteration}:+${KNOB_NAMES[j]}`);
        if (central) {
          const minus = [...bestLog];
          minus[j] = clamp(bestLog[j] - delta, bound[0], bound[1]);
          const span = plus[j] - minus[j];
          const down = await run(minus, `jacobian-${iteration}:-${KNOB_NAMES[j]}`);
          columns.push(
            up.residual.values.map(
              (v, row) => (v - down.residual.values[row]) / (span || 1),
            ),
          );
        } else {
          const span = plus[j] - bestLog[j];
          columns.push(
            up.residual.values.map(
              (v, row) => (v - bestResidual.values[row]) / (span || 1),
            ),
          );
        }
      }
      differenceScheme.push(central ? "central" : "forward");
      const jacobian = bestResidual.values.map((_, row) =>
        columns.map((column) => column[row]),
      );
      jacobianTable = describeJacobian(bestResidual.labels, jacobian);

      const trials: CalibrationResult["iterations"][number]["trials"] = [];
      let accepted = false;
      while (used < budget) {
        const step = dampedStep(jacobian, bestResidual.values, lambda);
        if (!step) {
          trials.push({
            logKnobs: bestLog,
            residualNorm: bestNorm,
            accepted: false,
            reason: "normal equations singular",
          });
          break;
        }
        const candidate = clampLog(bestLog.map((v, i) => v + step[i]));
        if (candidate.every((v, i) => Math.abs(v - bestLog[i]) < 1e-6)) {
          trials.push({
            logKnobs: candidate,
            residualNorm: bestNorm,
            accepted: false,
            reason: "step collapsed to zero at the box bound",
          });
          break;
        }
        const trial = await run(candidate, `lm-${iteration}`);
        const better = trial.residual.norm < bestNorm;
        const ok = trial.record.guards.ok;
        const reason = better
          ? ok
            ? "accepted"
            : `guards: ${trial.record.guards.violations.join("; ")}`
          : "residual did not decrease";
        trials.push({
          logKnobs: candidate,
          residualNorm: trial.residual.norm,
          accepted: better && ok,
          reason,
        });
        if (better && ok) {
          trial.record.accepted = true;
          bestLog = candidate;
          bestNorm = trial.residual.norm;
          bestGuards = trial.record.guards;
          bestResidual = trial.residual;
          lambda = Math.max(1e-6, lambda / 3);
          accepted = true;
          break;
        }
        lambda *= 8;
        if (lambda > 1e6) break;
      }
      iterationLog.push({ iteration, lambda, trials });
      if (!accepted) {
        notes.push(`iteration ${iteration} produced no accepted step`);
        break;
      }
    }
  } else if (method === "random") {
    const random = mulberry32(seed);
    while (used < budget) {
      const candidate = Array.from({ length: n }, (_, i) => {
        const [lo, hi] = LOG_KNOB_BOUNDS[i];
        return lo + (hi - lo) * random();
      });
      const trial = await run(candidate, "random");
      if (trial.residual.norm < bestNorm && trial.record.guards.ok) {
        trial.record.accepted = true;
        bestLog = candidate;
        bestNorm = trial.residual.norm;
        bestGuards = trial.record.guards;
        bestResidual = trial.residual;
      }
    }
  } else {
    // Coordinate search: one knob at a time, +/- step, greedy. A sweep with no
    // improvement halves the step, which is what lets it refine rather than
    // rattle against the same two points.
    let step = delta;
    let sweep = 0;
    while (used < budget && step > 0.02) {
      let improved = false;
      sweep++;
      for (let j = 0; j < n && used < budget; j++) {
        for (const sign of [1, -1]) {
          if (used >= budget) break;
          const candidate = clampLog(
            bestLog.map((v, i) => (i === j ? v + sign * step : v)),
          );
          if (Math.abs(candidate[j] - bestLog[j]) < 1e-9) continue;
          const trial = await run(
            candidate,
            `coordinate-${sweep}:${sign > 0 ? "+" : "-"}${KNOB_NAMES[j]}`,
          );
          if (trial.residual.norm < bestNorm && trial.record.guards.ok) {
            trial.record.accepted = true;
            bestLog = candidate;
            bestNorm = trial.residual.norm;
            bestGuards = trial.record.guards;
            bestResidual = trial.residual;
            improved = true;
            break;
          }
        }
      }
      if (!improved) step /= 2;
    }
  }

  return {
    method,
    budget,
    used,
    seed,
    delta,
    baseline: {
      knobs: knobRecord(clampKnobs(fromLogKnobs(identity))),
      residualNorm: first.residual.norm,
      guards: first.record.guards,
    },
    best: {
      knobs: knobRecord(fromLogKnobs(bestLog)),
      logKnobs: bestLog,
      residualNorm: bestNorm,
      guards: bestGuards,
    },
    improvement: first.residual.norm
      ? (first.residual.norm - bestNorm) / first.residual.norm
      : 0,
    evaluations,
    iterations: iterationLog,
    jacobian: jacobianTable,
    differences: differenceScheme,
    referencePeakPosition,
    notes,
  };
}

/** Compact "which knob moved which feature" table for the report. */
export function describeJacobian(
  rows: string[],
  values: number[][],
): JacobianTable {
  const columns = KNOB_NAMES;
  const influence = columns.map((knob, j) => {
    const column = values.map((row, i) => ({ row: rows[i], slope: row[j] }));
    const norm = Math.sqrt(column.reduce((s, c) => s + c.slope * c.slope, 0));
    const top = [...column]
      .sort((a, b) => Math.abs(b.slope) - Math.abs(a.slope))
      .slice(0, 3)
      .map((c) => ({ row: c.row, slope: Number(c.slope.toFixed(4)) }));
    return { knob, norm: Number(norm.toFixed(4)), top };
  });
  return {
    rows,
    columns,
    values: values.map((row) => row.map((v) => Number(v.toFixed(5)))),
    influence: influence.sort((a, b) => b.norm - a.norm),
  };
}

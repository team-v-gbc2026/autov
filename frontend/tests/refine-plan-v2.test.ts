import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_NAMES,
  type FrameFeatures,
} from "../src/lib/vfx-lab/features-v2";
import { KNOB_NAMES } from "../src/lib/vfx-lab/knobs-v2";
import {
  PHASE_NAMES,
  type PhaseName,
  type ReferenceSheet,
} from "../src/lib/vfx-lab/reference-features";
import type { EvaluateResult } from "../src/lib/vfx-lab/calibrate-v2";
import {
  deltaTable,
  envelopeDistance,
  influenceTable,
  selectedResidual,
  solveKnobSubspace,
  SUBSPACE_KNOB_LIMIT,
} from "../src/lib/vfx-lab/measure-v2";
import { RefinePlanV2Schema } from "../src/lib/vfx-lab/protocol-v2";

// ---------------------------------------------------------------------------
// A synthetic renderer.
//
// `area` answers to particleCount and particleSize, `p90` to rampIntensity,
// and nothing answers to the rest. Every response is smooth and monotone in the
// log knob, which is what a finite-difference solver assumes; the point of the
// test is that the solver finds the right point inside the named subspace and
// refuses everything else.
// ---------------------------------------------------------------------------

const zeroFeatures = (): FrameFeatures =>
  Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0])) as FrameFeatures;

const featuresFor = (knobs: readonly number[]): FrameFeatures => {
  const f = zeroFeatures();
  const [count, size] = [knobs[0], knobs[1]];
  f.area = 0.1 * count * Math.sqrt(size);
  f.p90 = 0.3 * knobs[5];
  f.occupancyH = 0.4;
  f.occupancyW = 0.4;
  return f;
};

const phaseFeatures = (knobs: readonly number[]) =>
  Object.fromEntries(
    PHASE_NAMES.map((name) => [name, featuresFor(knobs)]),
  ) as Record<PhaseName, FrameFeatures>;

const sheet = (): ReferenceSheet => {
  const target = zeroFeatures();
  // Reachable by particleCount alone: area 0.1 -> 0.2 at count 2.
  target.area = 0.2;
  target.p90 = 0.3;
  target.occupancyH = 0.4;
  target.occupancyW = 0.4;
  return {
    version: 1,
    case: "synthetic",
    duration: 1,
    impact: 0.4,
    phases: PHASE_NAMES.map((name, index) => ({
      name,
      start: index * 0.3,
      end: index * 0.3 + 0.2,
      sampleTimes: [index * 0.3 + 0.1],
      confidence: "high" as const,
      source: "video" as const,
      reference: index + 1,
      notes: [],
    })),
    targets: Object.fromEntries(
      PHASE_NAMES.map((name) => [name, target]),
    ) as Record<PhaseName, FrameFeatures>,
    weights: DEFAULT_FEATURE_WEIGHTS,
    envelope: null,
    notes: [],
  };
};

const evaluator =
  (options: { layers?: (knobs: readonly number[]) => number } = {}) =>
  async (knobs: number[]): Promise<EvaluateResult> => ({
    features: phaseFeatures(knobs),
    visibleLayers: options.layers ? options.layers(knobs) : 7,
    peakPosition: 0.5,
  });

const reference = { visibleLayers: 7, peakPosition: 0.5 };

test("the solver moves only the knobs the plan named, and reaches the target", async () => {
  const result = await solveKnobSubspace({
    sheet: sheet(),
    evaluate: evaluator(),
    plan: {
      knobs: [
        { name: "particleCount", direction: "up", reason: "area is short" },
        { name: "particleSize", direction: "up", reason: "area is short" },
      ],
      targets: ["area"],
    },
    reference,
  });
  assert.equal(result.accepted, true);
  assert.ok(result.improvement >= 0.1, `improvement ${result.improvement}`);
  assert.ok(result.residual < result.baselineResidual);
  // Two knobs: 2 * (2 * 2 + 1) evaluations at most, plus the baseline.
  assert.ok(result.evaluations <= 11, `evaluations ${result.evaluations}`);
  for (const [index, name] of KNOB_NAMES.entries())
    if (name !== "particleCount" && name !== "particleSize")
      assert.equal(result.logKnobs[index], 0, `${name} moved`);
  // area really did travel toward the sheet's 0.2.
  const solved = featuresFor(
    KNOB_NAMES.map((name) => result.knobValues[name]),
  );
  assert.ok(Math.abs(solved.area - 0.2) < Math.abs(0.1 - 0.2));
  // One round is a correction, not a redesign: no knob leaves 1/1.5 .. 1.5.
  for (const name of KNOB_NAMES) {
    assert.ok(result.knobValues[name] <= SUBSPACE_KNOB_LIMIT + 1e-6, name);
    assert.ok(result.knobValues[name] >= 1 / SUBSPACE_KNOB_LIMIT - 1e-6, name);
  }
});

test("the round's own box holds even when the residual wants more", async () => {
  // area answers to particleCount without limit, and the target is far away:
  // the solve should walk to the round's bound and stop there.
  const far = sheet();
  for (const phase of PHASE_NAMES) far.targets[phase].area = 4;
  const result = await solveKnobSubspace({
    sheet: far,
    evaluate: evaluator(),
    plan: {
      knobs: [{ name: "particleCount", direction: "up", reason: "far short" }],
      targets: ["area"],
    },
    reference,
  });
  assert.ok(result.knobValues.particleCount <= SUBSPACE_KNOB_LIMIT + 1e-6);
  assert.ok(result.knobValues.particleCount > 1.4);
});

test("the solver rejects a subspace that cannot move the named features", async () => {
  const result = await solveKnobSubspace({
    sheet: sheet(),
    evaluate: evaluator(),
    plan: {
      knobs: [{ name: "timeScale", direction: "down", reason: "guess" }],
      targets: ["area"],
    },
    reference,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.improvement, 0);
  assert.ok(result.trials.every((trial) => !trial.accepted));
});

test("the layer-loss guard refuses a solve that drops a layer", async () => {
  const result = await solveKnobSubspace({
    sheet: sheet(),
    evaluate: evaluator({ layers: (knobs) => (knobs[0] > 1.01 ? 6 : 7) }),
    plan: {
      knobs: [{ name: "particleCount", direction: "up", reason: "area" }],
      targets: ["area"],
    },
    reference,
  });
  assert.equal(result.accepted, false);
  assert.ok(
    result.trials.some((trial) => trial.reason.includes("visible layers")),
    JSON.stringify(result.trials),
  );
});

test("the peak-position guard refuses a solve that slides the effect in time", async () => {
  const evaluate = async (knobs: number[]): Promise<EvaluateResult> => ({
    features: phaseFeatures(knobs),
    visibleLayers: 7,
    // Any real move of the count knob drags the activity peak far off the
    // reference's position, which is exactly what the guard exists for.
    peakPosition: Math.abs(knobs[0] - 1) > 0.01 ? 0.95 : 0.5,
  });
  const result = await solveKnobSubspace({
    sheet: sheet(),
    evaluate,
    plan: {
      knobs: [{ name: "particleCount", direction: "up", reason: "area" }],
      targets: ["area"],
    },
    reference,
  });
  assert.equal(result.accepted, false);
  assert.ok(result.trials.some((trial) => trial.reason.includes("peak position")));
});

test("the collapse floor refuses a solve that renders nothing at all", async () => {
  // An empty frame measures as zeros, and zeros beat a real render on any row
  // whose target is small. Without the floor this is the optimum.
  const evaluate = async (knobs: number[]): Promise<EvaluateResult> => {
    const features = phaseFeatures(knobs);
    if (knobs[0] > 1.01)
      for (const phase of PHASE_NAMES) features[phase] = zeroFeatures();
    return { features, visibleLayers: 7, peakPosition: 0.5 };
  };
  const target = sheet();
  for (const phase of PHASE_NAMES) target.targets[phase].area = 0;
  const plan = {
    knobs: [{ name: "particleCount" as const, direction: "up" as const }],
    targets: ["area" as const],
  };
  const open = await solveKnobSubspace({
    sheet: target,
    evaluate,
    plan,
    reference,
  });
  assert.equal(open.accepted, true);
  const floored = await solveKnobSubspace({
    sheet: target,
    evaluate,
    plan,
    reference,
    minPeakArea: 0.025,
  });
  assert.equal(floored.accepted, false);
  assert.ok(
    floored.trials.some((trial) => trial.reason.includes("effect collapsed")),
    JSON.stringify(floored.trials),
  );
});

test("a plan naming an unknown knob or no measurable feature is refused", async () => {
  await assert.rejects(
    () =>
      solveKnobSubspace({
        sheet: sheet(),
        evaluate: evaluator(),
        plan: {
          knobs: [
            {
              name: "bloomStrength" as (typeof KNOB_NAMES)[number],
              direction: "down",
            },
          ],
          targets: ["area"],
        },
        reference,
      }),
    /outside the v2 knob set/,
  );
  await assert.rejects(
    () =>
      solveKnobSubspace({
        sheet: sheet(),
        evaluate: evaluator(),
        plan: {
          knobs: [{ name: "particleCount", direction: "up" }],
          targets: ["brightness" as (typeof FEATURE_NAMES)[number]],
        },
        reference,
      }),
    /no measurable feature/,
  );
});

test("the refine plan schema bounds what the model may ask for", () => {
  assert.doesNotThrow(() =>
    RefinePlanV2Schema.parse({
      knobs: [
        { name: "rampIntensity", direction: "down", reason: "p90 is +0.9" },
      ],
      targets: ["p90", "area"],
    }),
  );
  // Four knobs, an unknown knob, an unknown feature: all refused.
  assert.throws(() =>
    RefinePlanV2Schema.parse({
      knobs: KNOB_NAMES.slice(0, 4).map((name) => ({
        name,
        direction: "up",
        reason: "x",
      })),
      targets: ["area"],
    }),
  );
  assert.throws(() =>
    RefinePlanV2Schema.parse({
      knobs: [{ name: "exposure", direction: "up", reason: "x" }],
      targets: ["area"],
    }),
  );
  assert.throws(() =>
    RefinePlanV2Schema.parse({
      knobs: [{ name: "particleCount", direction: "up", reason: "x" }],
      targets: ["loudness"],
    }),
  );
});

test("the delta, influence and envelope tables read the measurement correctly", () => {
  const features = phaseFeatures(KNOB_NAMES.map(() => 1));
  const deltas = deltaTable(sheet(), features);
  const area = deltas.find((row) => row.feature === "area")!;
  // area is 0.1 against a target of 0.2: too little, so the delta is negative.
  assert.ok(area.delta < 0);
  assert.equal(area.render, 0.1);
  assert.equal(area.reference, 0.2);
  assert.equal(area.weight, DEFAULT_FEATURE_WEIGHTS.area);
  // Worst first.
  assert.ok(
    Math.abs(deltas[0].delta * deltas[0].weight) >=
      Math.abs(deltas[deltas.length - 1].delta * deltas[deltas.length - 1].weight),
  );
  // A feature that matches its target exactly is not at the top.
  assert.notEqual(deltas[0].feature, "occupancyH");

  const influences = influenceTable(
    ["peak.area", "peak.p90", "envelope.3"],
    KNOB_NAMES.map((_, j) => (j === 0 ? [2, 0, 0] : [0, 0, 0.1])),
    5,
  );
  assert.equal(influences[0].knob, "particleCount");
  assert.equal(influences[0].feature, "area");
  assert.equal(influences[0].phase, "peak");
  assert.equal(influences[0].slope, 2);
  assert.ok(influences.some((row) => row.phase === "envelope"));
  assert.equal(influences.length, 5);

  assert.equal(envelopeDistance([1, 0], [0, 0]), 0.7071);
  assert.equal(envelopeDistance([], []), 0);
});

test("the residual is restricted to the features the plan asked to reduce", () => {
  const features = phaseFeatures(KNOB_NAMES.map(() => 1));
  const only = selectedResidual(sheet(), features, ["area"]);
  assert.equal(only.labels.length, PHASE_NAMES.length);
  assert.ok(only.labels.every((label) => label.endsWith(".area")));
  const wider = selectedResidual(sheet(), features, ["area", "p90"]);
  assert.ok(wider.labels.length > only.labels.length);
});

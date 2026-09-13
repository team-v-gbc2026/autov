import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GUARDS,
  calibrate,
  checkGuards,
  dampedStep,
  describeJacobian,
  mulberry32,
  residualOf,
  solveLinearSystem,
  type EvaluateResult,
  type KnobInfluence,
  type PhaseFeatures,
} from "../src/lib/vfx-lab/calibrate-v2";
import {
  FEATURE_NAMES,
  featuresFromVector,
  type FrameFeatures,
} from "../src/lib/vfx-lab/features-v2";
import { KNOB_NAMES, toLogKnobs } from "../src/lib/vfx-lab/knobs-v2";
import { validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
import {
  PHASE_NAMES,
  buildReferenceSheet,
  parsePromptTiming,
  phaseSampleTimes,
  type ReferenceSheet,
} from "../src/lib/vfx-lab/reference-features";

// --- a synthetic renderer --------------------------------------------------
//
// Features are affine in log-knob space, so the correct Gauss-Newton step is
// exact and a working optimizer must land on the truth. Nothing here renders.

const N = KNOB_NAMES.length;

/** A plausible mid-range feature vector; every phase starts from this. */
const NEUTRAL: FrameFeatures = featuresFromVector(
  FEATURE_NAMES.map((name) =>
    name === "area" ? 0.2 : name === "washout" ? 0.005 : name === "edge" ? 0.05 : 0.5,
  ),
);

/** Which (phase, feature) each knob drives, one each, gain 0.3 per log unit. */
const DRIVEN: [number, (typeof PHASE_NAMES)[number], keyof FrameFeatures][] = [
  [0, "anticipation", "area"],
  [1, "anticipation", "p90"],
  [2, "peak", "area"],
  [3, "peak", "p90"],
  [4, "peak", "occupancyH"],
  [5, "dissipation", "area"],
  [6, "dissipation", "p90"],
  [7, "dissipation", "occupancyH"],
  [8, "peak", "elongation"],
  [9, "peak", "centroidY"],
  [10, "dissipation", "centroidY"],
];
const GAIN = 0.3;

function modelFeatures(log: number[], coupling = 0): PhaseFeatures {
  const out = Object.fromEntries(
    PHASE_NAMES.map((phase) => [phase, { ...NEUTRAL }]),
  ) as PhaseFeatures;
  for (const [knob, phase, feature] of DRIVEN) {
    // A little coupling to the next knob keeps the Jacobian non-diagonal.
    const neighbour = log[(knob + 1) % N];
    out[phase][feature] =
      NEUTRAL[feature] + GAIN * log[knob] + coupling * neighbour;
  }
  return out;
}

function sheetFor(truth: number[], coupling = 0): ReferenceSheet {
  const targets = modelFeatures(truth, coupling);
  return {
    version: 1,
    case: "synthetic",
    duration: 2,
    impact: 0.5,
    phases: PHASE_NAMES.map((name, i) => ({
      name,
      start: i * 0.5,
      end: i * 0.5 + 0.4,
      sampleTimes: [i * 0.5 + 0.2],
      confidence: "high" as const,
      source: "prompt" as const,
      reference: i + 1,
      notes: [],
    })),
    targets,
    weights: Object.fromEntries(FEATURE_NAMES.map((n) => [n, 1])),
    envelope: null,
    notes: [],
  };
}

const evaluator =
  (coupling = 0, visibleLayers = 5) =>
  async (knobs: number[]): Promise<EvaluateResult> => ({
    features: modelFeatures(toLogKnobs(knobs), coupling),
    visibleLayers,
  });

// --- linear algebra --------------------------------------------------------

test("the dense solver inverts a small system and reports singularity instead of guessing", () => {
  const x = solveLinearSystem(
    [
      [2, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ],
    [5, 10, 7],
  );
  assert.ok(x);
  [1.5, 2, 2.5].forEach((v, i) => assert.ok(Math.abs(x![i] - v) < 1e-9, `${x}`));
  assert.equal(
    solveLinearSystem(
      [
        [1, 2],
        [2, 4],
      ],
      [1, 2],
    ),
    null,
  );
});

test("an undamped step on an exactly linear residual is the Gauss-Newton solution", () => {
  // r = J d + r0 with J = I: the step must be exactly -r0.
  const jacobian = [
    [1, 0],
    [0, 1],
  ];
  const step = dampedStep(jacobian, [0.4, -0.7], 0);
  assert.ok(step);
  assert.ok(Math.abs(step![0] + 0.4) < 1e-9);
  assert.ok(Math.abs(step![1] - 0.7) < 1e-9);
  // Heavy damping shortens the step without turning it around.
  const damped = dampedStep(jacobian, [0.4, -0.7], 9)!;
  assert.ok(Math.abs(damped[0]) < Math.abs(step![0]));
  assert.ok(damped[0] < 0 && damped[1] > 0);
});

// --- residual and guards ---------------------------------------------------

test("the residual is zero at the target and grows with the weighted, scaled miss", () => {
  const sheet = sheetFor(new Array(N).fill(0));
  assert.equal(residualOf(sheet, modelFeatures(new Array(N).fill(0))).norm, 0);
  const off = residualOf(sheet, modelFeatures([0.5, 0, 0, 0, 0, 0, 0, 0]));
  assert.ok(off.norm > 0);
  assert.equal(off.labels.length, PHASE_NAMES.length * FEATURE_NAMES.length);
  assert.equal(off.labels[0], "anticipation.area");
  // Only anticipation.area moved.
  assert.equal(off.values.filter((v) => Math.abs(v) > 1e-12).length, 1);
});

test("guards reject blowout, coverage and structural change, and tolerate a bad start", () => {
  const clean = Object.fromEntries(
    PHASE_NAMES.map((p) => [p, { ...NEUTRAL }]),
  ) as PhaseFeatures;
  const reference = { visibleLayers: 5, worst: { p99: 0.8, washout: 0.005, area: 0.2 } };
  assert.equal(checkGuards(clean, 5, reference).ok, true);

  const blown = structuredClone(clean);
  blown.peak.washout = 0.4;
  blown.peak.p99 = 0.999;
  const report = checkGuards(blown, 5, reference);
  assert.equal(report.ok, false);
  assert.equal(report.violations.length, 2);
  assert.ok(report.violations.some((v) => v.startsWith("washout")));
  assert.ok(report.violations.some((v) => v.startsWith("p99")));

  const covered = structuredClone(clean);
  covered.dissipation.area = 0.9;
  assert.ok(
    checkGuards(covered, 5, reference).violations.some((v) => v.startsWith("area")),
  );
  assert.ok(
    checkGuards(clean, 4, reference).violations.some((v) =>
      v.startsWith("visible layers"),
    ),
  );

  const nan = structuredClone(clean);
  nan.peak.p90 = Number.NaN;
  assert.equal(checkGuards(nan, 5, reference).ok, false);

  // A document that already starts blown out is held to its own level, not to
  // the absolute limit, so it stays optimizable.
  const startsBlown = { visibleLayers: 5, worst: { p99: 0.999, washout: 0.4, area: 0.7 } };
  assert.equal(checkGuards(blown, 5, startsBlown, DEFAULT_GUARDS).ok, true);
});

// --- the search ------------------------------------------------------------

test("the response model converges on a synthetic linear renderer", async () => {
  const truth = [0.3, -0.4, 0.2, 0.1, 0.5, -0.3, 0.15, -0.2, 0.35, -0.25, 0.2];
  const sheet = sheetFor(truth);
  const result = await calibrate({
    sheet,
    evaluate: evaluator(),
    method: "response",
    budget: 60,
    iterations: 3,
  });
  assert.ok(result.baseline.residualNorm > 0.5, `${result.baseline.residualNorm}`);
  assert.ok(
    result.best.residualNorm < result.baseline.residualNorm * 0.02,
    `${result.baseline.residualNorm} -> ${result.best.residualNorm}`,
  );
  result.best.logKnobs.forEach((v, i) =>
    assert.ok(Math.abs(v - truth[i]) < 0.02, `${KNOB_NAMES[i]} ${v} vs ${truth[i]}`),
  );
  assert.ok(result.used <= 60);
  assert.ok(result.jacobian);
  // Each knob's strongest row must be the residual it actually drives.
  for (const [knob, phase, feature] of DRIVEN) {
    const entry: KnobInfluence = result.jacobian!.influence.find(
      (candidate: KnobInfluence) => candidate.knob === KNOB_NAMES[knob],
    )!;
    assert.equal(entry.top[0].row, `${phase}.${feature}`);
    // The slope is GAIN divided by that target's standardizing scale, so only
    // its sign and order of magnitude are fixed here.
    assert.ok(entry.top[0].slope > 0.2, `${entry.top[0].slope}`);
  }
});

test("it still converges when the response is coupled across knobs", async () => {
  const truth = [0.2, -0.3, 0.4, -0.1, 0.25, 0.3, -0.2, 0.1, -0.15, 0.2, -0.3];
  const sheet = sheetFor(truth, 0.12);
  const result = await calibrate({
    sheet,
    evaluate: evaluator(0.12),
    method: "response",
    budget: 60,
    iterations: 3,
  });
  assert.ok(
    result.best.residualNorm < result.baseline.residualNorm * 0.05,
    `${result.baseline.residualNorm} -> ${result.best.residualNorm}`,
  );
});

test("a step that improves the residual but blows the frame out is rejected", async () => {
  const truth = new Array(N).fill(0.6);
  const sheet = sheetFor(truth);
  let offered = 0;
  let rejected = 0;
  const result = await calibrate({
    sheet,
    evaluate: async (knobs) => {
      const log = toLogKnobs(knobs);
      const features = modelFeatures(log);
      // Any real move toward the target is washed out; only identity is clean.
      const moved = log.some((v) => Math.abs(v) > 1e-9);
      if (moved) {
        offered++;
        for (const phase of PHASE_NAMES) {
          features[phase].washout = 0.5;
          features[phase].p99 = 0.999;
        }
      }
      return { features, visibleLayers: 5 };
    },
    method: "response",
    budget: 60,
    iterations: 2,
  });
  assert.ok(offered > 0);
  for (const record of result.evaluations)
    if (record.stage.startsWith("lm") && !record.guards.ok) rejected++;
  assert.ok(rejected > 0, "no washed-out trial was ever examined");
  assert.equal(result.best.residualNorm, result.baseline.residualNorm);
  assert.deepEqual(result.best.logKnobs, new Array(N).fill(0));
  assert.ok(result.notes.some((n) => n.includes("no accepted step")));
});

test("every method logs every evaluation, honours the same budget and is deterministic", async () => {
  const sheet = sheetFor([0.4, -0.2, 0.3, 0, 0.2, -0.1, 0.25, 0, 0.3, -0.3, 0.15]);
  const budget = 30;
  const runs = await Promise.all(
    (["response", "random", "coordinate"] as const).map((method) =>
      calibrate({ sheet, evaluate: evaluator(), method, budget, seed: 7 }),
    ),
  );
  for (const run of runs) {
    assert.ok(run.used <= budget, `${run.method} used ${run.used}`);
    assert.equal(run.evaluations.length, run.used);
    assert.equal(run.evaluations[0].stage, "baseline");
    assert.ok(
      run.best.residualNorm <= run.baseline.residualNorm,
      `${run.method} got worse`,
    );
    for (const record of run.evaluations) {
      assert.equal(Object.keys(record.knobs).length, N);
      assert.ok(Number.isFinite(record.residualNorm));
    }
  }
  const [response, random, coordinate] = runs;
  // Both baselines spend their whole budget; the response model needs fewer.
  assert.equal(random.used, budget);
  assert.ok(response.used < budget);
  // On an exactly linear response the model search should beat brute force.
  assert.ok(response.best.residualNorm < random.best.residualNorm);
  assert.ok(response.best.residualNorm < coordinate.best.residualNorm);

  const again = await calibrate({
    sheet,
    evaluate: evaluator(),
    method: "random",
    budget,
    seed: 7,
  });
  assert.deepEqual(again.evaluations.map((e) => e.logKnobs), random.evaluations.map((e) => e.logKnobs));
  const other = await calibrate({
    sheet,
    evaluate: evaluator(),
    method: "random",
    budget,
    seed: 8,
  });
  assert.notDeepEqual(other.evaluations[1].logKnobs, random.evaluations[1].logKnobs);
});

test("a seeded generator is reproducible and stays in the unit interval", () => {
  const a = Array.from({ length: 200 }, mulberry32(42));
  const b = Array.from({ length: 200 }, mulberry32(42));
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(a, Array.from({ length: 200 }, mulberry32(43)));
});

test("the Jacobian table names the knob columns and ranks by response magnitude", () => {
  const table = describeJacobian(
    ["peak.area", "peak.p90"],
    [
      [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  );
  assert.deepEqual(table.columns, KNOB_NAMES);
  assert.equal(table.influence[0].knob, "dissipationStretch");
  assert.equal(table.influence[0].top[0].row, "peak.area");
  assert.equal(table.influence[1].knob, "particleCount");
});

// --- sheet construction ----------------------------------------------------

test("the benchmark prompt's timing block parses into phases", () => {
  const timing = parsePromptTiming(
    "Timing (3 seconds total): 0.0–0.3: a small yellow glint anticipates the burst." +
      " 0.3–1.2: purple smoke rises. 1.2–2.2: the base separates. 2.2–3.0: all residue fades.",
  );
  assert.ok(timing);
  assert.equal(timing!.total, 3);
  assert.equal(timing!.phases.length, 4);
  assert.deepEqual(
    timing!.phases.map((p) => [p.start, p.end]),
    [
      [0, 0.3],
      [0.3, 1.2],
      [1.2, 2.2],
      [2.2, 3],
    ],
  );
  assert.ok(timing!.phases[0].text.startsWith("a small yellow glint"));
  assert.equal(parsePromptTiming("no timing here"), null);
  assert.equal(parsePromptTiming("Timing (0 seconds total): 0–1: nothing"), null);
});

test("phase sample times sit inside the window and inside the document", () => {
  assert.deepEqual(phaseSampleTimes(0.3, 1.2, 3), [0.6, 0.9]);
  assert.deepEqual(phaseSampleTimes(0.3, 1.2, 3, 3), [0.525, 0.75, 0.975]);
  // A window past the end of the document is pulled back inside it.
  for (const t of phaseSampleTimes(4, 9, 2)) assert.ok(t <= 2 - 0.001 + 1e-9);
  // A collapsed window yields one time, not a list of duplicates.
  assert.equal(phaseSampleTimes(1, 1, 3).length, 1);
});

test("phases never share a window: an impact in the prompt's last segment splits it", () => {
  const doc = validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/fire-projectile/document.json", "utf8")),
  );
  // Plausible, non-degenerate reference features: an empty or blown-out still
  // would degrade the confidence flags this test is about.
  const stills = PHASE_NAMES.map(() => NEUTRAL);
  const build = (prompt: string, duration: number, impact: number) =>
    buildReferenceSheet({
      case: "t",
      doc: { ...doc, duration, impact },
      prompt,
      references: stills,
    });

  // Four segments, impact in the second: one window each, nothing shared.
  const spread = build(
    "Timing (3 seconds total): 0.0–0.3: glint. 0.3–1.2: rise. 1.2–2.2: break. 2.2–3.0: fade.",
    3,
    0.3,
  );
  assert.deepEqual(
    spread.phases.map((p) => [p.start, p.end]),
    [
      [0, 0.3],
      [0.3, 1.2],
      [2.2, 3],
    ],
  );
  assert.ok(spread.phases.every((p) => p.confidence === "high"));

  // Three segments whose last one contains the impact: peak and dissipation
  // must not end up measuring the same frames.
  const crowded = build(
    "Timing (4 seconds total): 0–0.6 s: charge. 0.6–0.85 s: strike. 0.85–2.5 s: debris.",
    1.5,
    0.6,
  );
  const [anticipation, peak, dissipation] = crowded.phases;
  assert.ok(peak.end <= dissipation.start, `${peak.end} vs ${dissipation.start}`);
  assert.ok(anticipation.end <= peak.start);
  assert.notDeepEqual(peak.sampleTimes, dissipation.sampleTimes);
  // The declared total disagrees with the document, so confidence drops.
  assert.ok(crowded.phases.every((p) => p.confidence === "medium"));
  assert.ok(
    crowded.phases.some((p) => p.notes.some((n) => n.includes("scaled by"))),
  );

  // No prompt at all: ratio fallback, flagged low.
  const fallback = build("no timing", 3, 1);
  assert.ok(fallback.phases.every((p) => p.confidence === "low"));
  assert.deepEqual(
    fallback.phases.map((p) => [p.start, p.end]),
    [
      [0.4, 1],
      [1, 1.15],
      [1.8, 2.4],
    ],
  );
  assert.equal(fallback.envelope, null);
  assert.ok(fallback.notes.some((n) => n.includes("no reference video")));
});

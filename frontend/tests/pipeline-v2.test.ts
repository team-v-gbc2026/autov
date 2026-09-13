import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePipeline, type Transport } from "../src/lib/vfx-lab/pipeline";
import type { MeasurementV2 } from "../src/lib/vfx-lab/measure-v2";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import {
  createPresetV2,
  exampleScaleSummary,
  RECIPE_V2_IDS,
  recipeV2For,
} from "../src/lib/vfx-lab/recipes-v2";
import {
  applyRefinementV2,
  applyStructuralRefinementV2,
} from "../src/lib/vfx-lab/refine";
import {
  effectExtentV2,
  isV2,
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";
import {
  acceptanceV2,
  REVIEW_V2_DEFECTS,
  scoreV2,
  type ReviewV2,
} from "../src/lib/vfx-lab/protocol-v2";

const fixture = () =>
  validateDocumentV2(
    JSON.parse(
      readFileSync("fixtures/v2/fire-projectile/document.json", "utf8"),
    ),
  );

/** The v2 reviewer's answer shape: six axes plus the full defect checklist. */
const reviewV2 = (
  score: number,
  defects: Partial<Record<(typeof REVIEW_V2_DEFECTS)[number], boolean>> = {},
  notes = ["denser secondary particles, longer erosion tail"],
): ReviewV2 => ({
  sufficientEvidence: true,
  semantic: score,
  motion: score,
  hierarchy: score,
  detail: score,
  smoothness: score,
  beauty: score,
  defects: Object.fromEntries(
    REVIEW_V2_DEFECTS.map((defect) => [defect, defects[defect] ?? false]),
  ) as ReviewV2["defects"],
  observations: [
    { criterion: "visible fire", result: "pass", evidence: "1 s" },
  ],
  verdict: "Observed",
  directorNotes: notes,
});
const capture = () => ({
  sheet: "data:image/jpeg;base64,TEST",
  strip: "data:image/jpeg;base64,STRIP",
  stripTimes: [0.9, 0.933, 0.966],
  jitterScore: 0.04,
  times: [0.5, 1, 2, 3.4],
  width: 640,
  height: 360,
  runtime: "test-v2",
  renderer: "test",
  camera: [5, 3, 7],
  layers: [],
  observations: [],
  renderedPixels: 5000,
});

test("v2 mode validates candidates against autov.lab/2 and records the contract", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request: Transport = async (body) => {
    bodies.push(body);
    if (body.action === "plan")
      return { runId: "v2-run", plan: {}, schema: "v2" };
    if (body.action === "candidate") return { document: fixture() };
    if (body.action === "review") return { review: reviewV2(5) };
    throw Error("unexpected");
  };
  const result = await generatePipeline({
    prompt: "a fire projectile",
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    signal: new AbortController().signal,
    request,
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.equal(result.schema, "v2");
  assert.ok(isV2(result.selected.document));
  assert.doesNotThrow(() => validateDocumentV2(result.selected.document));
  assert.ok(result.trace.some((line) => line.includes("v2")));
  assert.equal(bodies[0].schema, "v2");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].reviewV2?.semantic, 5);
  // v1's four-axis review is never populated on a v2 run.
  assert.equal(result.candidates[0].review, undefined);
  assert.equal(result.candidates[0].jitterScore, 0.04);
  // The reviewer is sent the motion strip and the spike measure alongside the
  // sheet; a perfect review needs no refinement round.
  const reviewBody = bodies.find((b) => b.action === "review")!;
  assert.equal(reviewBody.strip, "data:image/jpeg;base64,STRIP");
  assert.equal(reviewBody.jitter, 0.04);
  assert.equal(
    bodies.some((b) => b.action === "refine" || b.action === "restructure"),
    false,
  );
  assert.equal(acceptanceV2(result.candidates[0].reviewV2), "proposed");
  assert.ok(result.trace.some((line) => line.includes("Review v2: proposed")));
});

test("a weak v2 review drives the refinement rounds off the defect checklist", async () => {
  const bodies: Record<string, unknown>[] = [];
  const answers = [
    reviewV2(3, { floating: true, uniformParticles: true }),
    reviewV2(3.1, { floating: true, uniformParticles: true }),
    reviewV2(3.2, { floating: true, uniformParticles: true }),
  ];
  let reviews = 0;
  const result = await generatePipeline({
    prompt: "a fire projectile",
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    signal: new AbortController().signal,
    request: async (body) => {
      bodies.push(body);
      if (body.action === "plan")
        return {
          runId: "weak-run",
          plan: { criteria: ["visible fire"] },
          schema: "v2",
        };
      if (body.action === "candidate") return { document: fixture() };
      if (body.action === "review")
        return { review: answers[Math.min(reviews++, answers.length - 1)] };
      return { document: fixture() };
    },
    capture,
    progress: () => {},
    candidate: () => {},
  });
  // Both bounded rounds ran: the scalar one off the director notes, the
  // structural one off an admitted defect the scalar round cannot reach.
  assert.ok(bodies.some((b) => b.action === "refine"));
  assert.ok(bodies.some((b) => b.action === "restructure"));
  // The scalar round moved the score by less than the 0.15 margin and was not
  // adopted; the structural one cleared it.
  assert.ok(result.candidates.some((c) => c.id === "weak-run-refined"));
  assert.equal(result.selected.id, "weak-run-structural");
  // Clearing the margin is not acceptance: the defects are still admitted.
  assert.equal(acceptanceV2(result.selected.reviewV2), "rework");
  assert.ok(scoreV2(result.selected.reviewV2) < 3.8);
  assert.ok(
    result.trace.some((line) => line.includes("Review v2: needs rework")),
  );
});

/** What the measure stage hands the refiner, in miniature. */
const measurement = (knobs: Record<string, number> = {}): MeasurementV2 => ({
  phases: [
    {
      name: "peak",
      start: 0.5,
      end: 0.7,
      sampleTimes: [0.6],
      confidence: "high",
      source: "video",
      reference: 2,
      notes: [],
    },
  ],
  deltas: [
    {
      feature: "area",
      phase: "peak",
      render: 0.08,
      reference: 0.2,
      delta: -0.6,
      weight: 1,
    },
  ],
  envelope: { render: [0, 1, 0.3], reference: [0, 1, 0.6], distance: 0.17 },
  influences: [
    { knob: "particleCount", feature: "area", phase: "peak", slope: -1.9 },
  ],
  confidence: "high",
  notes: ["measured from a 42-frame clip"],
  sheet: "data:image/png;base64,ALIGNED",
  residualNorm: 4.2,
  knobs: knobs as MeasurementV2["knobs"],
});

/**
 * A measure stage with no browser in it: the same contract the real one
 * satisfies, so the pipeline's half of the round is tested on its own.
 */
const fakeMeasure = (
  outcome: { accepted: boolean; improvement: number },
  log: { plans: unknown[]; disposed: number },
) => {
  const solved = structuredClone(fixture());
  solved.name = "solved";
  return () => ({
    measurement: measurement(),
    solve: async (plan: unknown) => {
      log.plans.push(plan);
      return {
        accepted: outcome.accepted,
        document: solved,
        improvement: outcome.improvement,
        residual: 3.1,
        baselineResidual: 4.2,
        knobs: { particleCount: 1.6 },
        evaluations: 7,
        notes: ["particleCount up, as asked"],
        measurement: measurement({ particleCount: 1.6 }),
      };
    },
    dispose: () => {
      log.disposed++;
    },
  });
};

const knobPlan = {
  knobs: [
    { name: "particleCount", direction: "up", reason: "peak.area is -0.6" },
  ],
  targets: ["area"],
};

test("the measured v2 scalar round asks for knobs and solves them numerically", async () => {
  const bodies: Record<string, unknown>[] = [];
  const log = { plans: [] as unknown[], disposed: 0 };
  const answers = [reviewV2(3, { smallInFrame: true }), reviewV2(4.5)];
  let reviews = 0;
  const result = await generatePipeline({
    prompt: "a fire projectile",
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    referenceVideo: "/tmp/reference.mp4",
    signal: new AbortController().signal,
    request: async (body) => {
      bodies.push(body);
      if (body.action === "plan")
        return {
          runId: "measured-run",
          plan: { criteria: ["visible fire"] },
          schema: "v2",
          reference: { kind: "frames", fps: 10, frames: ["data:image/jpeg;base64,F"] },
        };
      if (body.action === "candidate") return { document: fixture() };
      if (body.action === "review")
        return { review: answers[Math.min(reviews++, answers.length - 1)] };
      if (body.action === "refine") return { plan: knobPlan };
      return { document: fixture() };
    },
    capture,
    measure: fakeMeasure({ accepted: true, improvement: 0.26 }, log),
    progress: () => {},
    candidate: () => {},
  });
  // The clip travelled with the plan request, and the resolved reference came
  // back for the measure stage.
  assert.equal(bodies[0].referenceVideo, "/tmp/reference.mp4");
  const refine = bodies.find((b) => b.action === "refine")!;
  // The refiner is shown the aligned sheet and the measurement, and no longer
  // an isolated diagnostic render.
  assert.equal(refine.alignedSheet, "data:image/png;base64,ALIGNED");
  assert.equal(refine.diagnostic, undefined);
  const sent = refine.measurement as MeasurementV2;
  assert.equal(sent.deltas[0].feature, "area");
  assert.equal(sent.influences[0].knob, "particleCount");
  assert.equal(sent.envelope.distance, 0.17);
  assert.equal(sent.confidence, "high");
  // The model's answer went to the solver, and the solved document was the one
  // rendered, reviewed and adopted.
  assert.deepEqual(log.plans, [knobPlan]);
  assert.equal(log.disposed, 1);
  const refined = result.candidates.find((c) => c.id === "measured-run-refined")!;
  assert.equal(refined.document.name, "solved");
  assert.equal(refined.measurement?.knobs?.particleCount, 1.6);
  assert.equal(result.selected.id, "measured-run-refined");
  // The measurement is kept on the candidate it describes.
  assert.equal(
    result.candidates.find((c) => c.origin === "generated")?.measurement?.residualNorm,
    4.2,
  );
  assert.ok(result.trace.some((line) => line.includes("Solving for particleCount up")));
  assert.ok(result.trace.some((line) => line.includes("26.0% better")));
});

test("a knob solve that does not clear the residual gate is never rendered", async () => {
  const bodies: Record<string, unknown>[] = [];
  const log = { plans: [] as unknown[], disposed: 0 };
  const result = await generatePipeline({
    prompt: "a fire projectile",
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    signal: new AbortController().signal,
    request: async (body) => {
      bodies.push(body);
      if (body.action === "plan")
        return {
          runId: "rejected-run",
          plan: { criteria: ["visible fire"] },
          schema: "v2",
        };
      if (body.action === "candidate") return { document: fixture() };
      if (body.action === "review")
        return { review: reviewV2(3, { smallInFrame: true }) };
      if (body.action === "refine") return { plan: knobPlan };
      return { document: fixture() };
    },
    capture,
    measure: fakeMeasure({ accepted: false, improvement: 0.04 }, log),
    progress: () => {},
    candidate: () => {},
  });
  assert.equal(log.disposed, 1);
  assert.equal(
    result.candidates.some((c) => c.id === "rejected-run-refined"),
    false,
  );
  assert.ok(result.trace.some((line) => line.includes("Knob solve rejected")));
  // The structural round still runs, and it is shown the aligned sheet.
  const structural = bodies.find((b) => b.action === "restructure");
  assert.equal(structural?.alignedSheet, "data:image/png;base64,ALIGNED");
});

test("a refiner that answers outside the knob vocabulary is rejected", async () => {
  const log = { plans: [] as unknown[], disposed: 0 };
  const result = await generatePipeline({
    prompt: "a fire projectile",
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    signal: new AbortController().signal,
    request: async (body) => {
      if (body.action === "plan")
        return {
          runId: "bad-plan-run",
          plan: { criteria: ["visible fire"] },
          schema: "v2",
        };
      if (body.action === "candidate") return { document: fixture() };
      if (body.action === "review")
        return { review: reviewV2(3, { smallInFrame: true }) };
      if (body.action === "refine")
        return {
          plan: { knobs: [{ name: "bloom", direction: "up", reason: "x" }], targets: ["area"] },
        };
      return { document: fixture() };
    },
    capture,
    measure: fakeMeasure({ accepted: true, improvement: 0.3 }, log),
    progress: () => {},
    candidate: () => {},
  });
  // The session is closed, nothing is solved, and the run continues.
  assert.equal(log.plans.length, 0);
  assert.equal(log.disposed, 1);
  assert.equal(
    result.candidates.some((c) => c.id === "bad-plan-run-refined"),
    false,
  );
  assert.ok(result.trace.some((line) => line.includes("Refinement rejected")));
});

test("a v1 document is never accepted as a v2 candidate", async () => {
  await assert.rejects(
    () =>
      generatePipeline({
        prompt: "x",
        references: [],
        mode: "fast",
        schema: "v2",
        signal: new AbortController().signal,
        request: async (body) =>
          body.action === "plan"
            ? { runId: "v2-run", plan: {} }
            : { document: createPreset("shockwave") },
        capture,
        progress: () => {},
        candidate: () => {},
      }),
    /No valid candidate/,
  );
});

test("v1 runs are unaffected by the schema option", async () => {
  const bodies: Record<string, unknown>[] = [];
  const doc = createPreset("shockwave");
  const result = await generatePipeline({
    prompt: "shockwave",
    references: [],
    mode: "fast",
    signal: new AbortController().signal,
    request: async (body) => {
      bodies.push(body);
      return body.action === "plan"
        ? { runId: "v1-run", plan: {} }
        : { document: doc };
    },
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.equal(result.schema, "v1");
  assert.equal("schema" in bodies[0], false);
  assert.equal(result.selected.document.schemaVersion, "autov.lab/1");
  assert.equal(
    result.trace.some((line) => line.includes("autov.lab/2")),
    false,
  );
});

test("the server may answer with the contract it actually used", async () => {
  const result = await generatePipeline({
    prompt: "x",
    references: [],
    mode: "fast",
    signal: new AbortController().signal,
    request: async (body) =>
      body.action === "plan"
        ? { runId: "env-run", plan: {}, schema: "v2" }
        : { document: fixture() },
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.equal(result.schema, "v2");
  assert.ok(isV2(result.selected.document));
});

test("lint warnings reach the trace without rejecting the candidate", async () => {
  const doc = fixture();
  // Uniform particle lifetimes: a warning, never a validation failure.
  const layer = doc.layers.find((l) => l.kind === "particles")!;
  layer.emitter!.life = [1, 1.05];
  assert.ok(lintDocumentV2(doc).length > 0);
  const result = await generatePipeline({
    prompt: "x",
    references: [],
    mode: "fast",
    schema: "v2",
    signal: new AbortController().signal,
    request: async (body) =>
      body.action === "plan"
        ? { runId: "lint-run", plan: {}, schema: "v2" }
        : { document: doc },
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.ok(result.trace.some((line) => line.startsWith("Schema v2 lint:")));
  assert.ok(isV2(result.selected.document));
});

test("every v2 recipe example is a valid, lint-clean document", () => {
  for (const id of RECIPE_V2_IDS) {
    const doc = createPresetV2(id);
    assert.doesNotThrow(() => validateDocumentV2(doc), id);
    assert.deepEqual(lintDocumentV2(doc), [], id);
    // A readable example, not a kitchen sink. The hand-authored exemplars sit
    // at the top of this range: beam needs the most layers (19) to carry a
    // charge, a triple-layer core/sheath/ribbons beam, muzzle and endpoint
    // flares, sparks and a post-shutoff residue burst across two lights.
    assert.ok(doc.layers.length <= 20, `${id} has ${doc.layers.length} layers`);
    assert.ok(
      doc.layers.some((l) => l.kind === "light"),
      `${id} has no light layer`,
    );
    // A particles layer needs a silhouette: a library mask, or a billboard
    // procedural (star4, softRadial, solid, flame, smoke) that IS one.
    assert.ok(
      doc.layers
        .filter((l) => l.kind === "particles")
        .every(
          (l) =>
            l.material?.mask.textureId || l.material?.procedural !== "none",
        ),
      `${id} has a particles layer with neither a mask nor a procedural`,
    );
  }
});

test("every v1 recipe id maps onto a v2 family", () => {
  for (const id of [
    "slash",
    "magic",
    "shockwave",
    "lightning",
    "projectile",
    "water",
    "smoke",
    "beam",
    "portal",
  ] as const)
    assert.ok(RECIPE_V2_IDS.includes(recipeV2For(id)), id);
});

test("scalar refinement translates director notes into v2 paths", () => {
  const doc = fixture();
  const next = applyRefinementV2(
    doc,
    {
      changes: [
        {
          layerId: "flame-shell",
          target: "intensity",
          value: 4,
          reason: "lower the core",
        },
        {
          layerId: "sparks",
          target: "turbulence",
          value: 1,
          reason: "more swirl",
        },
      ],
    },
    ["flame-shell", "sparks"],
  );
  const shell = next.layers.find((l) => l.id === "flame-shell")!;
  assert.equal(shell.material!.ramp.stops[0].intensity, 4);
  const sparks = next.layers.find((l) => l.id === "sparks")!;
  // v1 turbulence 0..2 becomes a 0..3 curl strength.
  assert.equal(sparks.emitter!.forces.curl!.strength, 1.5);
  // Untouched layers stay byte-identical.
  assert.deepEqual(
    next.layers.find((l) => l.id === "embers"),
    doc.layers.find((l) => l.id === "embers"),
  );
});

test("scalar refinement cannot leave the diagnosed layers", () => {
  assert.throws(
    () =>
      applyRefinementV2(
        fixture(),
        {
          changes: [
            {
              layerId: "sparks",
              target: "opacity",
              value: 0.5,
              reason: "dim",
            },
          ],
        },
        ["flame-shell"],
      ),
    /diagnosed layer scope/,
  );
});

test("structural repair is bounded by the baseline document", () => {
  const doc = fixture();
  // Structured Outputs sends every kind-dependent slot explicitly, as null,
  // and carries no embedded texture assets.
  const wire = (next: VfxDocumentV2) => {
    const copy = JSON.parse(JSON.stringify(next)) as Record<string, unknown> & {
      layers: Record<string, unknown>[];
    };
    delete copy.textures;
    for (const layer of copy.layers)
      for (const slot of [
        "material",
        "emitter",
        "geometry",
        "light",
        "blob",
        "splash",
        "ribbon",
        "wireBurst",
        "crystals",
        "arcs",
        "streakBurst",
        "reflection",
      ])
        if (layer[slot] === undefined) layer[slot] = null;
    return { document: copy, explanation: "repair" };
  };
  assert.doesNotThrow(() => applyStructuralRefinementV2(doc, wire(doc)));

  const reseeded = structuredClone(doc);
  reseeded.seed = doc.seed + 1;
  assert.throws(
    () => applyStructuralRefinementV2(doc, wire(reseeded)),
    /seed or global timing/,
  );

  const padded = structuredClone(doc);
  const extra = structuredClone(padded.layers[0]);
  for (const suffix of ["a", "b", "c"])
    padded.layers.push({ ...structuredClone(extra), id: `extra-${suffix}` });
  assert.throws(
    () => applyStructuralRefinementV2(doc, wire(padded)),
    /at most 2 layers/,
  );

  const brighter = structuredClone(doc);
  brighter.post.bloom.strength = doc.post.bloom.strength + 0.2;
  assert.throws(
    () => applyStructuralRefinementV2(doc, wire(brighter)),
    /only lower bloom/,
  );
});

test("lint reports the scale failures seen in the first live run", () => {
  const doc = fixture();
  const sparks = doc.layers.find((l) => l.id === "sparks")!;
  sparks.emitter!.count = 12;
  doc.environment.groundColor = "#211d27";
  doc.layers = doc.layers.filter((l) => l.kind !== "light");
  const warnings = lintDocumentV2(doc);
  assert.ok(warnings.some((w) => w.includes("particle count 12 is below 30")));
  assert.ok(warnings.some((w) => w.includes("near-black")));
  assert.ok(warnings.some((w) => w.includes("No light layer")));
  // Still a valid document: scale problems are warnings, never rejections.
  assert.doesNotThrow(() => validateDocumentV2(doc));
});

test("lint reports a hero adrift in an oversized shot, and a tiny effect", () => {
  const doc = fixture();
  const shell = doc.layers.find((l) => l.id === "flame-shell")!;
  shell.geometry!.length = 0.5;
  shell.geometry!.radius = 0.1;
  shell.transform.position = [0, 5.4, 0];
  assert.ok(
    lintDocumentV2(doc).some((w) => w.includes("frame mostly empty space")),
  );

  const small = fixture();
  small.layers = small.layers.filter((l) => l.id === "flame-shell");
  small.layers[0].geometry!.length = 0.4;
  small.layers[0].geometry!.radius = 0.1;
  assert.ok(effectExtentV2(small) < 1.5);
  assert.ok(
    lintDocumentV2(small).some((w) => w.includes("Effect extent is about")),
  );
});

test("the planner scale summary carries the exemplar magnitudes", () => {
  const summary = exampleScaleSummary("fire-projectile");
  assert.equal(summary.family, "fire-projectile");
  assert.ok(summary.heroExtentUnits >= 2.5);
  assert.ok(Math.min(...summary.particleCounts) >= 30);
  assert.ok(Math.max(...summary.lightIntensityPeak) >= 8);
  assert.ok(Math.max(...summary.lightRadius) >= 6);
});

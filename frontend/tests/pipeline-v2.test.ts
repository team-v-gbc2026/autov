import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePipeline, type Transport } from "../src/lib/vfx-lab/pipeline";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import {
  createPresetV2,
  RECIPE_V2_IDS,
  recipeV2For,
} from "../src/lib/vfx-lab/recipes-v2";
import {
  applyRefinementV2,
  applyStructuralRefinementV2,
} from "../src/lib/vfx-lab/refine";
import {
  isV2,
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";
import type { Review } from "../src/lib/vfx-lab/protocol";

const fixture = () =>
  validateDocumentV2(
    JSON.parse(
      readFileSync("fixtures/v2/fire-projectile/document.json", "utf8"),
    ),
  );

const review = (score: number): Review => ({
  sufficientEvidence: true,
  semantic: score,
  motion: score,
  hierarchy: score,
  finish: score,
  verdict: "Observed",
  observations: [
    { criterion: "visible fire", result: "pass", evidence: "1 s" },
  ],
  diagnoses: [
    {
      layerId: "flame-shell",
      symptom: "washed-out",
      hypothesis: "too bright",
      correction: "lower intensity",
    },
  ],
});
const capture = () => ({
  sheet: "data:image/jpeg;base64,TEST",
  times: [0.5, 1, 2, 3.4],
  width: 320,
  height: 180,
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
    if (body.action === "review") return { review: review(5) };
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
  assert.equal(result.candidates[0].review?.semantic, 5);
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
    assert.ok(doc.layers.length <= 9, `${id} has ${doc.layers.length} layers`);
    assert.ok(
      doc.layers.some((l) => l.kind === "light"),
      `${id} has no light layer`,
    );
    assert.ok(
      doc.layers
        .filter((l) => l.kind === "particles")
        .every((l) => l.material?.mask.textureId),
      `${id} has an unmasked particles layer`,
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
      for (const slot of ["material", "emitter", "geometry", "light"])
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

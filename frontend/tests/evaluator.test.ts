import test from "node:test";
import assert from "node:assert/strict";
import { RECIPES, createPreset } from "../src/lib/vfx-lab/recipes";
import {
  validateDocument,
  validateGeneratedDocument,
  DocumentWireSchema,
} from "../src/lib/vfx-lab/schema";
import {
  applyScopedEdit,
  evaluateLayer,
  particleAt,
  random,
  sampleTimes,
  windowWeight,
} from "../src/lib/vfx-lab/evaluate";
import { zodTextFormat } from "openai/helpers/zod";
test("transparent generated placeholders are rejected before paid visual review", () => {
  const doc = createPreset("shockwave");
  for (const layer of doc.layers) {
    layer.params.opacity = 0;
    layer.tracks = layer.tracks.filter((t) => t.target !== "opacity");
  }
  assert.throws(() => validateGeneratedDocument(doc), /no visible energy/);
  // Valid authored opacity animation remains supported despite a zero birth-time base.
  assert.doesNotThrow(() =>
    validateGeneratedDocument(createPreset("shockwave")),
  );
});
for (const id of Object.keys(RECIPES) as (keyof typeof RECIPES)[])
  test(`${id}: valid self-contained recipe and bounded samples`, () => {
    const doc = createPreset(id);
    assert.deepEqual(validateDocument(doc), doc);
    assert.equal(new Set(doc.layers.map((l) => l.id)).size, doc.layers.length);
    assert.ok(sampleTimes(doc).every((t) => t >= 0 && t < doc.duration));
  });
test("wire schema has no unsupported tuple prefixItems", () => {
  assert.equal(
    JSON.stringify(zodTextFormat(DocumentWireSchema, "effect")).includes(
      "prefixItems",
    ),
    false,
  );
});
test("scoped edit protects every unselected layer and exact outside-window values at 1000 random times", () => {
  const before = createPreset("shockwave");
  const edit = {
    target: "color",
    value: "#ffff00",
    start: 0.9,
    end: 1.4,
    fade: 0.1,
  };
  const after = applyScopedEdit(before, "shock-0", edit);
  for (const old of before.layers) {
    const next = after.layers.find((l) => l.id === old.id)!;
    if (old.id !== "shock-0") assert.deepEqual(old, next);
    for (let i = 0; i < 1000; i++) {
      const time = random(3, "scope", i, "time") * before.duration;
      if (old.id !== "shock-0" || time < 0.9 || time >= 1.4)
        assert.deepEqual(evaluateLayer(old, time), evaluateLayer(next, time));
    }
  }
  assert.equal(
    evaluateLayer(
      after.layers.find((l) => l.id === "shock-0")!,
      1.1,
    ).params.color,
    "#ffff00",
  );
  assert.deepEqual(before, createPreset("shockwave"));
});
test("window boundaries are half-open and smooth", () => {
  const edit = {
    target: "opacity" as const,
    value: 0.2,
    start: 1,
    end: 2,
    fade: 0.1,
  };
  assert.equal(windowWeight(edit, 0.99999), 0);
  assert.equal(windowWeight(edit, 1), 0);
  assert.equal(windowWeight(edit, 2), 0);
  assert.equal(windowWeight(edit, 1.5), 1);
  assert.ok(windowWeight(edit, 1.05) > 0.49 && windowWeight(edit, 1.05) < 0.51);
});
test("direct seek equals arbitrary history evaluation", () => {
  const doc = createPreset("magic");
  const layer = doc.layers[0];
  const expected = evaluateLayer(layer, 2.3);
  for (const t of [4, 0, 1, 3.99, 0.2]) evaluateLayer(layer, t);
  assert.deepEqual(evaluateLayer(layer, 2.3), expected);
});
test("particle IDs, births and motion remain stable when count increases", () => {
  const doc = createPreset("shockwave");
  const layer = doc.layers.find((l) => l.kind === "particles")!;
  const larger = structuredClone(layer);
  larger.params.count += 1000;
  for (let i = 0; i < 100; i++)
    assert.deepEqual(
      particleAt(doc, layer, i, 1.1),
      particleAt(doc, larger, i, 1.1),
    );
});
test("particle birth interval differs from lifetime", () => {
  const doc = createPreset("shockwave"),
    layer = doc.layers.find((l) => l.kind === "particles")!;
  const p = particleAt(doc, layer, 0, 1.2);
  assert.ok(p.birth < layer.start + layer.params.emission);
  assert.equal(p.alive, true);
});
const mutations: Record<string, (d: ReturnType<typeof createPreset>) => void> =
  {
    duplicate: (d: ReturnType<typeof createPreset>) =>
      d.layers.push(structuredClone(d.layers[0])),
    nan: (d: ReturnType<typeof createPreset>) =>
      (d.layers[0].params.radius = NaN),
    interval: (d: ReturnType<typeof createPreset>) => (d.layers[0].end = 99),
    track: (d: ReturnType<typeof createPreset>) =>
      (d.layers[0].tracks[0].keys = [
        [0, 1],
        [0.1, 999],
      ]),
    seed: (d: ReturnType<typeof createPreset>) => (d.seed = -1),
    code: (d: ReturnType<typeof createPreset>) =>
      Object.assign(d, { shader: "bad" }),
    particles: (d: ReturnType<typeof createPreset>) =>
      d.layers
        .filter((l) => l.kind === "particles")
        .forEach((l) => (l.params.count = 99999)),
  };
for (const [name, mutate] of Object.entries(mutations))
  test(`invalid ${name} is rejected`, () => {
    const doc = createPreset("shockwave");
    mutate(doc);
    assert.throws(() => validateDocument(doc));
  });
test("motion scope edits and unknown layers fail atomically", () => {
  const doc = createPreset("shockwave");
  assert.throws(() =>
    applyScopedEdit(doc, "sparks", {
      target: "speed",
      value: 4,
      start: 0.7,
      end: 1,
      fade: 0,
    }),
  );
  assert.throws(() =>
    applyScopedEdit(doc, "unknown", {
      target: "color",
      value: "#ffffff",
      start: 0.7,
      end: 1,
      fade: 0,
    }),
  );
  assert.deepEqual(doc, createPreset("shockwave"));
});
test("event sampling captures real flash onset despite inconsistent impact metadata", () => {
  const doc = createPreset("shockwave");
  doc.impact = 0.95;
  const times = sampleTimes(doc);
  assert.ok(times.includes(0.57));
  assert.ok(times.includes(0.63));
  assert.ok(times.length <= 12);
});

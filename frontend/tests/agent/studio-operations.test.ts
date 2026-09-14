import { z } from "zod";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editDocument,
  appendGenerated,
  mergePatch,
  summarize,
} from "../../src/lib/studio-tools/operations";
import { createPresetV2 } from "../../src/lib/vfx-lab/recipes-v2";
import { parseMentions } from "../../src/lib/studio-tools/mentions";

test("nested edit preserves unrelated fields and original input", () => {
  const original = createPresetV2("fire-projectile");
  const particle = original.layers.find((layer) => layer.emitter)!;
  const next = editDocument(original, {
    expectedRevision: 0,
    operations: [
      {
        type: "update_layer",
        layerId: particle.id,
        changes: { emitter: { velocity: { speed: [0.15, 0.4] } } },
      },
    ],
  });
  const edited = next.layers.find((layer) => layer.id === particle.id)!;
  assert.deepEqual(edited.emitter?.velocity.speed, [0.15, 0.4]);
  assert.deepEqual(
    edited.emitter?.velocity.direction,
    particle.emitter?.velocity.direction,
  );
  assert.notDeepEqual(particle.emitter?.velocity.speed, [0.15, 0.4]);
  assert.deepEqual(
    next.layers.filter((layer) => layer.id !== particle.id),
    original.layers.filter((layer) => layer.id !== particle.id),
  );
});
test("bad batches do not partially mutate, unknown fields and IDs fail", () => {
  const document = createPresetV2("fire-projectile"),
    snapshot = JSON.stringify(document);
  const invalidChanges: Record<string, z.infer<ReturnType<typeof z.json>>>[] = [
    { madeUp: 1 },
    { post: { bloom: { strength: -100 } } },
    { schemaVersion: "x" },
  ];
  for (const changes of invalidChanges) {
    assert.throws(() =>
      editDocument(document, {
        expectedRevision: 0,
        operations: [{ type: "update_effect", changes }],
      }),
    );
  }
  assert.throws(() =>
    editDocument(document, {
      expectedRevision: 0,
      operations: [
        { type: "remove_layer", layerId: document.layers[0].id },
        { type: "remove_layer", layerId: "missing" },
      ],
    }),
  );
  assert.equal(JSON.stringify(document), snapshot);
  assert.throws(() =>
    mergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}')),
  );
});
test("duplicate and remove are explicit and preserve complete layer structure", () => {
  const document = createPresetV2("fire-projectile"),
    layer = document.layers[0];
  const next = editDocument(document, {
    expectedRevision: 0,
    operations: [
      {
        type: "duplicate_layer",
        layerId: layer.id,
        newId: "smoke-copy",
        name: "Copy",
      },
      { type: "remove_layer", layerId: layer.id },
    ],
  });
  assert.equal(next.layers.length, document.layers.length);
  assert.deepEqual(next.layers.at(-1), {
    ...layer,
    id: "smoke-copy",
    name: "Copy",
  });
  assert.throws(() => summarize(document, ["missing"]));
});
test("additive generation preserves globals and old layers with non-colliding IDs", () => {
  const base = createPresetV2("fire-projectile");
  const generated = structuredClone(base);
  generated.layers = [generated.layers[0]];
  const next = appendGenerated(base, generated);
  assert.deepEqual(next.layers.slice(0, base.layers.length), base.layers);
  assert.equal(
    new Set(next.layers.map((layer) => layer.id)).size,
    next.layers.length,
  );
  assert.deepEqual({ ...next, layers: [] }, { ...base, layers: [] });
});
test("tags retain stable IDs, decode emitters, tolerate malformed and streaming text", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    parseMentions(
      `See @[Same](reference:${id}) and #[Same](emitter:smoke%2Dpuffs)`,
    ),
    [
      { type: "text", text: "See " },
      { type: "reference", id, label: "Same" },
      { type: "text", text: " and " },
      { type: "emitter", id: "smoke-puffs", label: "Same" },
    ],
  );
  assert.deepEqual(parseMentions("#[Smoke](emitter:sm", true), [
    { type: "text", text: "#Smoke" },
  ]);
  assert.equal(parseMentions("#[Bad](emitter:%zz)")[0].type, "text");
});

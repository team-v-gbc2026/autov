import test from "node:test";
import assert from "node:assert/strict";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import { applyStructuralRefinement } from "../src/lib/vfx-lab/refine";
import { type Layer } from "../src/lib/vfx-lab/schema";
const wire = (layer: Layer) => ({
  ...structuredClone(layer),
  geometry: layer.geometry ?? null,
  surface: layer.surface ?? null,
  motion: layer.motion ?? null,
  textureId: layer.textureId ?? null,
});
test("structural repair changes only diagnosed layers and preserves seed/assets/global timing", () => {
  const doc = createPreset("smoke"),
    before = structuredClone(doc),
    replacement = wire(doc.layers[0]);
  replacement.params.position = [1, 0.5, 0];
  replacement.geometry = "plane";
  replacement.params.length = 1.3;
  const result = applyStructuralRefinement(
    doc,
    { layers: [replacement], post: null, explanation: "Repair silhouette" },
    [replacement.id],
  );
  assert.deepEqual(doc, before);
  assert.deepEqual(result.layers.slice(1), doc.layers.slice(1));
  assert.deepEqual({ ...result, layers: [] }, { ...doc, layers: [] });
  assert.equal(result.layers[0].params.position[0], 1);
  assert.throws(
    () =>
      applyStructuralRefinement(
        doc,
        { layers: [replacement], post: null, explanation: "" },
        [],
      ),
    /scope/,
  );
  assert.throws(
    () =>
      applyStructuralRefinement(
        doc,
        { layers: [replacement, replacement], post: null, explanation: "" },
        [replacement.id],
      ),
    /scope/,
  );
});
test("structural repair rejects invalid motion and cannot amplify or change undiagnosed postprocessing", () => {
  const doc = createPreset("smoke"),
    replacement = wire(doc.layers[0]),
    proposal = {
      layers: [replacement],
      post: null as { bloom: number; exposure: number } | null,
      explanation: "",
    };
  replacement.motion = {
    keys: [
      [0, 0, 0, 0],
      [12, 1, 0, 0],
    ],
    ease: "linear",
  };
  assert.throws(
    () => applyStructuralRefinement(doc, proposal, [replacement.id]),
    /motion keys/,
  );
  replacement.motion = null;
  proposal.post = { bloom: doc.post.bloom, exposure: doc.post.exposure };
  assert.throws(
    () => applyStructuralRefinement(doc, proposal, [replacement.id]),
    /washout/,
  );
  proposal.post.bloom = 2;
  assert.throws(
    () => applyStructuralRefinement(doc, proposal, [replacement.id], true),
    /washout/,
  );
  proposal.post.bloom = 0;
  const next = applyStructuralRefinement(doc, proposal, [replacement.id], true);
  assert.equal(next.post.bloom, 0);
  assert.equal(next.post.background, doc.post.background);
});

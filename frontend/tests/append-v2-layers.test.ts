import { test } from "node:test";
import assert from "node:assert/strict";
import { appendGenerated } from "../src/lib/studio-tools/operations";
import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";
import { createDocument } from "../src/lib/vfx-lab/ui-bridge";

for (const family of [
  "healing-aura",
  "glitch-projectile",
  "fire-slash",
  "portal",
  "meteor-rain",
] as const) {
  test(`add ${family} remaps paths and cross-layer references while preserving the scene`, () => {
    const generated = createPresetV2(family);
    const base = createDocument();
    base.duration = generated.duration;
    base.layers[0].start = 0;
    base.layers[0].end = generated.duration;
    base.layers[0].id = generated.layers[0].id;
    base.paths = generated.paths.length
      ? [structuredClone(generated.paths[0])]
      : [];
    const before = structuredClone(base);
    const result = appendGenerated(base, generated);
    assert.deepEqual(base, before);
    assert.deepEqual(result.layers[0], before.layers[0]);
    assert.deepEqual(result.camera, base.camera);
    assert.equal(
      new Set(result.layers.map((layer) => layer.id)).size,
      result.layers.length,
    );
    assert.equal(
      new Set(result.paths.map((path) => path.id)).size,
      result.paths.length,
    );
    assert.equal(
      result.paths.length,
      base.paths.length + generated.paths.length,
    );
    assert.notEqual(result.layers[1].id, result.layers[0].id);
  });
}

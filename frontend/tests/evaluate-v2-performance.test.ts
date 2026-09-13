import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateLayerV2, evaluateLayerV2Readonly } from "../src/lib/vfx-lab/evaluate-v2";
import { validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

function freeze(value: unknown) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

for (const id of ["fire-projectile", "beam", "fire-slash", "ice-blast", "lightning-impact", "shield", "smoke-burst"]) {
  test(`read-only evaluation matches full cloning for ${id}, including seeks and overrides`, () => {
    const doc = validateDocumentV2(JSON.parse(readFileSync(new URL(`../fixtures/v2/${id}/document.json`, import.meta.url), "utf8")));
    for (const layer of doc.layers) {
      layer.tracks.push({ target: "transform.position[0]", keys: [[0, 0], [1, 2]], ease: "smooth" });
      layer.overrides.push({ target: "transform.position[0]", value: 3, start: 0.2, end: 0.8, fade: 0.1 });
    }
    freeze(doc);
    for (const time of [0.5, 0, 0.2, 0.4, 0.8, doc.duration, -1, 0.5])
      for (const layer of doc.layers)
        assert.deepEqual(evaluateLayerV2Readonly(layer, time), evaluateLayerV2(layer, time));
  });
}

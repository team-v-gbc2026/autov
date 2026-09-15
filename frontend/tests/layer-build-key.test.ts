import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";
import { layerBuildKey } from "../src/lib/vfx-lab/layer-build-key";

test("live appearance and speed changes reuse GPU structure, structural edits do not", () => {
  const layer = createPresetV2("fire-projectile").layers.find(layer => layer.emitter)!;
  const edited = structuredClone(layer);
  edited.material!.opacity = 0.2;
  edited.material!.ramp.stops[0].color = "#0000ff";
  edited.material!.ramp.stops[0].intensity = 0.5;
  edited.emitter!.velocity.speed = [1, 2];
  edited.emitter!.render.size = [0.2, 0.4];
  assert.equal(layerBuildKey(layer), layerBuildKey(edited));
  edited.enabled = !layer.enabled;
  assert.equal(layerBuildKey(layer), layerBuildKey(edited));
  edited.material!.blend = layer.material!.blend === "alpha" ? "additive" : "alpha";
  assert.notEqual(layerBuildKey(layer), layerBuildKey(edited));
});

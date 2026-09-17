import assert from "node:assert/strict";
import { test } from "node:test";
import { hasOnlyAvfxLayers } from "../src/lib/avfx/kinds";

test("studio AVFX action accepts only particle/geometry documents with enabled content", () => {
  const layers = ["particles", "ring", "shell", "trail", "beam", "sprite", "decal"].map(kind => ({ kind, enabled: true }));
  assert.equal(hasOnlyAvfxLayers(layers), true);
  assert.equal(hasOnlyAvfxLayers([]), false);
  assert.equal(hasOnlyAvfxLayers(layers.map(layer => ({ ...layer, enabled: false }))), false);
  for (const kind of ["light", "smoke", "vortex", "unknown"]) {
    assert.equal(hasOnlyAvfxLayers([...layers, { kind, enabled: true }]), false);
    assert.equal(hasOnlyAvfxLayers([...layers, { kind, enabled: false }]), false);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { hasExportableAvfxLayers } from "../src/lib/avfx/kinds";

test("studio AVFX action accepts mixed documents with enabled exportable content", () => {
  const layers = ["particles", "ring", "shell", "trail", "beam", "sprite", "decal"].map(kind => ({ kind, enabled: true }));
  assert.equal(hasExportableAvfxLayers(layers), true);
  assert.equal(hasExportableAvfxLayers([]), false);
  assert.equal(hasExportableAvfxLayers(layers.map(layer => ({ ...layer, enabled: false }))), false);
  assert.equal(hasExportableAvfxLayers([{ kind: "light", enabled: true }]), false);
  for (const kind of ["light", "smoke", "vortex", "unknown"]) {
    assert.equal(hasExportableAvfxLayers([...layers, { kind, enabled: true }]), true);
    assert.equal(hasExportableAvfxLayers([...layers, { kind, enabled: false }]), true);
  }
});

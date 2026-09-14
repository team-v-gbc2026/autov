import { test } from "node:test";
import assert from "node:assert/strict";
import { zodTextFormat } from "openai/helpers/zod";
import { DocumentV2WireSchema, fromWireV2 } from "../src/lib/vfx-lab/schema-v2";
import { generationExampleV2 } from "../src/lib/vfx-lab/generation-examples-v2";
import { RECIPE_V2_IDS } from "../src/lib/vfx-lab/recipes-v2";
import { StructuralRefinementV2Schema, TECHNICAL_GUIDE_V2 } from "../src/lib/vfx-lab/protocol-v2";

function wire(family: typeof RECIPE_V2_IDS[number]) {
  const { textures, ...doc } = generationExampleV2(family);
  return { ...doc, paths: doc.paths ?? [], layers: doc.layers.map(layer => ({
    ...layer, path: layer.path ?? null, material: layer.material ?? null,
    emitter: layer.emitter ?? null, geometry: layer.geometry ?? null, light: layer.light ?? null,
  })) };
}
test("model schemas contain only required properties and homogeneous arrays", () => {
  for (const contract of [DocumentV2WireSchema, StructuralRefinementV2Schema]) {
    const format = zodTextFormat(contract, "vfx_result");
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, any>;
      assert.equal(node.prefixItems, undefined);
      if (node.properties) {
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
        assert.equal(node.additionalProperties, false);
      }
      Object.values(node).forEach(visit);
    };
    visit(format.schema);
  }
});
test("all family generation examples round trip with editable path data", () => {
  for (const family of RECIPE_V2_IDS) {
    const input = wire(family);
    const doc = fromWireV2(input);
    assert.deepEqual(doc.paths, input.paths);
    assert.deepEqual(doc.layers.map(l => l.path ?? null), input.layers.map(l => l.path));
    const directional = ["beam", "fire-slash", "fire-projectile", "lightning-impact"].includes(family);
    assert.equal(!!doc.paths?.length, directional, family);
    if (directional) assert.ok(doc.layers.some(l => l.path?.mode === "shape"));
  }
});
test("invalid generated curve attachments fail runtime validation", () => {
  const input = wire("beam");
  input.layers.find(l => l.path)!.path!.pathId = "missing";
  assert.throws(() => fromWireV2(input), /Missing path/);
  const malformed = wire("beam");
  malformed.paths[0].points.pop();
  assert.throws(() => fromWireV2(malformed));
});
test("authoring instructions distinguish spatial paths from radial effects and preserve edits", () => {
  assert.match(TECHNICAL_GUIDE_V2, /Prefer a shared editable path/);
  assert.match(TECHNICAL_GUIDE_V2, /Do not attach radial/);
  assert.match(TECHNICAL_GUIDE_V2, /preserve path IDs/);
});

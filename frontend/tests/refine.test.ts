import test from "node:test";
import assert from "node:assert/strict";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import { applyRefinement } from "../src/lib/vfx-lab/refine";
import { evaluateLayer } from "../src/lib/vfx-lab/evaluate";
test("refinement rescales animated peak instead of amplifying tiny initial radius", () => {
  const doc = createPreset("shockwave"),
    layer = doc.layers.find((l) => l.id === "shock-0")!;
  layer.params.radius = 0.154;
  const next = applyRefinement(
    doc,
    {
      changes: [
        {
          layerId: "shock-0",
          target: "radius",
          value: 4.5,
          reason: "larger impact silhouette",
        },
      ],
    },
    ["shock-0"],
  );
  const changed = next.layers.find((l) => l.id === "shock-0")!;
  assert.ok(
    Math.abs(
      Math.max(
        ...changed.tracks
          .find((t) => t.target === "radius")!
          .keys.map((k) => k[1]),
      ) - 4.5,
    ) < 1e-12,
  );
  assert.ok(evaluateLayer(changed, 1).params.radius <= 4.5);
  assert.deepEqual(
    next.layers.filter((l) => l.id !== "shock-0"),
    doc.layers.filter((l) => l.id !== "shock-0"),
  );
  assert.equal(layer.params.radius, 0.154);
});
test("refinement cannot affect an undiagnosed layer", () => {
  assert.throws(
    () =>
      applyRefinement(
        createPreset("shockwave"),
        {
          changes: [
            {
              layerId: "sparks",
              target: "intensity",
              value: 3,
              reason: "unrelated",
            },
          ],
        },
        ["shock-0"],
      ),
    /scope/,
  );
});

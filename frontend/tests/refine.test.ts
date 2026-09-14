import test from "node:test";
import assert from "node:assert/strict";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import { applyExemplarCameraV2, applyRefinement } from "../src/lib/vfx-lab/refine";
import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";
import { lintDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
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

// ---------------------------------------------------------------------------
// Mesh-hero framing repair.
//
// A blob/crystals/crescent/frame/ribbon hero framed in the particle band is the
// one `smallInFrame` the knob solver cannot touch — there is no camera in the
// knob subspace, so the residual rejects the plan and nothing moves. The repair
// is the family exemplar's own camera, which is already the scale reference.
// ---------------------------------------------------------------------------

test("the exemplar camera repairs a mesh hero framed in the particle band", () => {
  const exemplar = createPresetV2("smoke-burst");
  // The live failure: the same document, framed the way the particle-era rule
  // asked for, with a wider fov and a lifted eye.
  const small = structuredClone(exemplar);
  small.camera = {
    ...small.camera,
    framing: 0.65,
    fov: 35,
    elevation: 0.24,
    azimuth: 0.28,
  };
  const fixed = applyExemplarCameraV2(small, exemplar);
  assert.equal(fixed.camera.framing, exemplar.camera.framing);
  assert.equal(fixed.camera.fov, exemplar.camera.fov);
  assert.equal(fixed.camera.elevation, exemplar.camera.elevation);
  assert.deepEqual(lintDocumentV2(fixed), []);
  // Shake and push-in are the shot's motion, not its framing: they survive.
  const shaken = structuredClone(small);
  shaken.camera.shake = {
    amplitude: 0.05,
    frequency: 20,
    start: 0,
    end: 0.4,
    fade: 0.6,
  };
  assert.deepEqual(
    applyExemplarCameraV2(shaken, exemplar).camera.shake,
    shaken.camera.shake,
  );
});

test("a correctly framed document is returned untouched by the camera repair", () => {
  const exemplar = createPresetV2("smoke-burst");
  assert.equal(applyExemplarCameraV2(exemplar, exemplar), exemplar);
  // A particle-hero document is never a mesh hero, whatever its framing.
  const fire = createPresetV2("fire-projectile");
  fire.camera.framing = 0.6;
  assert.equal(applyExemplarCameraV2(fire, exemplar), fire);
});

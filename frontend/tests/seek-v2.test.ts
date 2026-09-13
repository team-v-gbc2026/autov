import test from "node:test";
import assert from "node:assert/strict";
import {
  STRIKE_HZ,
  buildLightningGeometry,
  lightningBounds,
} from "../src/lib/vfx-lab/lightning-v2";
import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";
import { defaultGeometry, type GeometryV2 } from "../src/lib/vfx-lab/schema-v2";

// ---------------------------------------------------------------------------
// Seek == play for the one Phase B feature that rebuilds CPU-side state: the
// lightning bolt. Everything else is evaluated in the shader from (uniforms,
// attributes, time) and needs a GPU to exercise, so it is verified by the
// headless harness (scripts/render-v2-fixture.mjs), which fails the run unless
// the same time rendered twice is byte-identical.
// ---------------------------------------------------------------------------

function bolt(overrides: Partial<GeometryV2> = {}): GeometryV2 {
  return {
    ...defaultGeometry(),
    type: "lightning",
    radius: 0.6,
    length: 2.2,
    thickness: 0.06,
    lightning: {
      points: 20,
      jitter: 0.7,
      branches: 2,
      branchDepth: 2,
      widthCurve: {
        keys: [
          [0, 1],
          [1, 0.4],
        ],
        ease: "linear",
      },
      seedOffset: 17,
    },
    ...overrides,
  };
}

const positions = (strike: number, seed = 9041) =>
  Array.from(
    buildLightningGeometry(bolt(), seed, strike).getAttribute("position")
      .array as Float32Array,
  );

const strikeAt = (time: number) => Math.max(0, Math.floor(time * STRIKE_HZ));

test("a bolt is a pure function of (seed, seedOffset, strike)", () => {
  assert.deepEqual(positions(3), positions(3));
  assert.notDeepEqual(positions(3), positions(4));
  assert.notDeepEqual(positions(3), positions(3, 9042));
});

test("seeking inside one strike window draws the same bolt as playing to it", () => {
  // Same 1/STRIKE_HZ bucket: identical geometry however the time was reached.
  const within = [0.26, 0.3, 0.349].map(strikeAt);
  assert.equal(new Set(within).size, 1);
  assert.deepEqual(positions(within[0]), positions(strikeAt(0.3)));
  // The next bucket re-strikes.
  assert.notEqual(strikeAt(0.3), strikeAt(0.38));
});

test("the framing envelope covers every strike of a bolt", () => {
  const spread = lightningBounds(bolt(), 9041);
  const lo = [0, 1, 2].map((axis) =>
    Math.min(...spread.map((p) => p.getComponent(axis))),
  );
  const hi = [0, 1, 2].map((axis) =>
    Math.max(...spread.map((p) => p.getComponent(axis))),
  );
  // The envelope is sampled, not exhaustive: an unsampled strike may poke out
  // by a fraction of the box, which is invisible in framing terms. What must
  // never happen is a strike wandering outside it by any real margin.
  const slack = [0, 1, 2].map((axis) => (hi[axis] - lo[axis]) * 0.15);
  for (let strike = 0; strike < 200; strike++) {
    const values = positions(strike);
    for (let i = 0; i < values.length; i++) {
      const axis = i % 3;
      assert.ok(Number.isFinite(values[i]));
      assert.ok(
        values[i] >= lo[axis] - slack[axis] &&
          values[i] <= hi[axis] + slack[axis],
      );
    }
  }
});

test("the lightning example is authored as a white core plus a wider sheath", () => {
  const doc = createPresetV2("lightning-impact");
  const bolts = doc.layers.filter((l) => l.geometry?.type === "lightning");
  assert.equal(bolts.length, 2);
  const [sheath, core] = bolts;
  // One centerline: same seedOffset, same span, same origin.
  assert.equal(
    sheath.geometry!.lightning!.seedOffset,
    core.geometry!.lightning!.seedOffset,
  );
  assert.equal(sheath.geometry!.length, core.geometry!.length);
  assert.deepEqual(sheath.transform.position, core.transform.position);
  // The core is the thinner, brighter, shorter-lived of the two, and only the
  // sheath branches.
  assert.ok(core.geometry!.thickness < sheath.geometry!.thickness);
  assert.ok(
    core.material!.ramp.stops[0].intensity >
      sheath.material!.ramp.stops[0].intensity,
  );
  assert.ok(core.end < sheath.end);
  assert.equal(core.geometry!.lightning!.branches, 0);
  assert.ok(sheath.geometry!.lightning!.branches > 0);
});

test("every recipe example still validates with the Phase B fields in place", () => {
  const meteor = createPresetV2("meteor-rain");
  const child = meteor.layers.find((l) => l.emitter?.sub);
  assert.ok(child, "meteor-rain carries a sub-emitter");
  const parent = meteor.layers.find(
    (l) => l.id === child!.emitter!.sub!.parentLayerId,
  );
  assert.equal(parent?.kind, "particles");
  assert.ok(meteor.camera.shake);
  assert.ok(meteor.post.motionBlur > 0);
  assert.ok(
    meteor.layers.some((l) => l.material?.mask.flipbook),
    "meteor-rain carries a flipbook mask",
  );

  const shield = createPresetV2("shield");
  assert.ok(shield.camera.pushIn);
  assert.notEqual(shield.post.grade.tint, "#ffffff");
  assert.ok(
    shield.layers.some((l) => l.emitter?.forces.vortex),
    "shield carries a vortex",
  );
  assert.ok(
    shield.layers.some((l) => l.emitter?.velocity.speedCurve),
    "shield carries a speed curve",
  );

  for (const id of ["lightning-impact", "beam"] as const)
    assert.ok(
      createPresetV2(id).layers.some((l) => l.emitter?.trail),
      `${id} carries a trail`,
    );
});

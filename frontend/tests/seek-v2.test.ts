import test from "node:test";
import assert from "node:assert/strict";
import {
  STRIKE_HZ,
  buildLightningGeometry,
  lightningBounds,
} from "../src/lib/vfx-lab/lightning-v2";
import { blobLobes, lobeStateAt } from "../src/lib/vfx-lab/blob-v2";
import {
  splashBounds,
  splashSlivers,
  sliverStateAt,
} from "../src/lib/vfx-lab/splash-v2";
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

// ---------------------------------------------------------------------------
// Blob clusters and splash fans are the other Phase C feature whose state the
// CPU evaluates: `blobLobes` / `lobeStateAt` and `splashSlivers` /
// `sliverStateAt` are the same functions the renderer drives its meshes with
// and the framing pass measures, so verifying seek == play here verifies both.
// ---------------------------------------------------------------------------

const smoke = createPresetV2("smoke-burst");
const blobLayers = smoke.layers.filter((l) => l.blob);

test("a lobe table is a pure function of the blob spec", () => {
  for (const layer of blobLayers) {
    const spec = layer.blob!;
    assert.deepEqual(blobLobes(spec), blobLobes(structuredClone(spec)));
    assert.equal(blobLobes(spec).length, spec.count);
    // A different seed is a different cluster. Which fields it moves depends on
    // the arrangement: a column and a string are deterministic ladders whose
    // POSITIONS are fixed by the spec, and the seed varies only their radii,
    // lives and birth order.
    const reseeded = blobLobes({ ...structuredClone(spec), seed: spec.seed + 1 });
    assert.notDeepEqual(
      reseeded.map((l) => [l.radius, l.life, l.t0]),
      blobLobes(spec).map((l) => [l.radius, l.life, l.t0]),
    );
    if (spec.arrangement === "mound" || spec.arrangement === "ring")
      assert.notDeepEqual(
        reseeded.map((l) => l.base),
        blobLobes(spec).map((l) => l.base),
      );
  }
});

test("seeking to a time draws the same lobes as playing to it", () => {
  for (const layer of blobLayers) {
    const spec = layer.blob!;
    const span = layer.end - layer.start;
    const lobes = blobLobes(spec);
    for (const age of [0, 0.13, 0.4, span * 0.5, span * 0.93, span]) {
      // Ten "played" evaluations, then one cold seek: no accumulation anywhere,
      // so the last state must equal the first.
      const first = lobes.map((l) =>
        lobeStateAt(l, spec, age, span, layer.material!.opaqueUntil),
      );
      for (let step = 0; step < 10; step++)
        for (const l of lobes)
          lobeStateAt(l, spec, (step / 10) * span, span, layer.material!.opaqueUntil);
      const seeked = lobes.map((l) =>
        lobeStateAt(l, spec, age, span, layer.material!.opaqueUntil),
      );
      assert.deepEqual(seeked, first, `${layer.id} @${age}`);
      for (const state of seeked) {
        assert.ok(Number.isFinite(state.radius));
        assert.ok(state.position.every(Number.isFinite));
        assert.ok(state.alpha >= 0 && state.alpha <= 1);
      }
    }
  }
});

test("a lobe grows in, stays opaque to opaqueUntil, then fades to nothing", () => {
  const layer = blobLayers.find((l) => l.blob!.arrangement === "mound")!;
  const spec = layer.blob!;
  const span = layer.end - layer.start;
  const lobe = blobLobes(spec)[0];
  const at = (a: number) =>
    lobeStateAt(lobe, spec, lobe.t0 * span + a * lobe.life, span, 0.75);
  assert.equal(at(-0.01).alive, false);
  assert.equal(at(1.01).alive, false);
  // Grown by 1/grow of its life, shrinking again over the last 30%.
  assert.ok(at(1 / spec.grow).radius > at(0.01).radius);
  assert.ok(at(0.99).radius < at(0.5).radius);
  // Opaque and depth-writing until 75% of life, then falling to 0 at the end.
  assert.equal(at(0.5).alpha, 1);
  assert.equal(at(0.5).fading, false);
  assert.ok(at(0.9).alpha < 1 && at(0.9).alpha > 0);
  assert.equal(at(0.9).fading, true);
  assert.ok(at(0.999).alpha < 0.02);
  // With no opaque phase the lobe is simply never opaque, the old behaviour.
  assert.equal(lobeStateAt(lobe, spec, lobe.t0 * span + lobe.life * 0.9, span, null).alpha, 1);
});

test("a splash fan is mirrored, so it never pulls the framing off centre", () => {
  const layer = smoke.layers.find((l) => l.splash)!;
  const spec = layer.splash!;
  const slivers = splashSlivers(spec);
  assert.equal(slivers.length, spec.count);
  assert.deepEqual(slivers, splashSlivers(structuredClone(spec)));
  for (let i = 0; i + 1 < slivers.length; i += 2) {
    assert.ok(slivers[i].angle > 0 && slivers[i + 1].angle < 0);
    assert.equal(slivers[i].length, slivers[i + 1].length);
    assert.equal(slivers[i].curvature, -slivers[i + 1].curvature);
  }
  // Only the angle carries a per-sliver jitter, so the fan is mirrored to
  // within a few percent of its own width — not the half metre an
  // independently hashed fan drifts, which the camera would follow off centre.
  const points = splashBounds(spec);
  const xs = points.map((p) => p.x);
  const width = Math.max(...xs) - Math.min(...xs);
  assert.ok(
    Math.abs(Math.max(...xs) + Math.min(...xs)) < width * 0.06,
    `fan is off centre by ${(Math.max(...xs) + Math.min(...xs)).toFixed(3)}`,
  );
  // Seek == play for the slivers too.
  for (const u of [0, 0.2, 0.5, 0.8, 1]) {
    const first = slivers.map((s) => sliverStateAt(s, spec, u));
    for (let step = 0; step <= 10; step++)
      for (const s of slivers) sliverStateAt(s, spec, step / 10);
    assert.deepEqual(
      slivers.map((s) => sliverStateAt(s, spec, u)),
      first,
      `u=${u}`,
    );
  }
});

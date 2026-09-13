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
import {
  invertCurve,
  pathPoint,
  pathTangent,
} from "../src/lib/vfx-lab/paths-v2";
import {
  buildWireBurstGeometry,
  wireBurstBounds,
} from "../src/lib/vfx-lab/wire-burst-v2";
import { evaluateLayerV2 } from "../src/lib/vfx-lab/evaluate-v2";
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

// ---------------------------------------------------------------------------
// Paths, ribbons, wire bursts and layer jitter — the heal / glitch spike port.
//
// Same rule as everything above: the CPU half of each feature is the half the
// framing pass and the depth sort read, so verifying it here verifies that the
// document really is a pure function of (document, time, seed). The GPU half is
// verified by the headless harness, which refuses a run unless the same time
// rendered twice is byte-identical.
// ---------------------------------------------------------------------------

const healing = createPresetV2("healing-aura");
const glitch = createPresetV2("glitch-projectile");

test("a path is a pure function of u, and its tangent is a unit vector", () => {
  for (const doc of [healing, glitch])
    for (const path of doc.paths)
      for (const u of [0, 0.13, 0.5, 0.77, 1]) {
        assert.deepEqual(pathPoint(path, u), pathPoint(structuredClone(path), u));
        const tangent = pathTangent(path, u);
        assert.ok(Math.abs(Math.hypot(...tangent) - 1) < 1e-6, `${path.id}@${u}`);
        assert.ok(pathPoint(path, u).every(Number.isFinite));
      }
  // An orbit with height 0 is closed: u and u+1 are the same point, which is
  // what lets a ribbon head run past 1 and keep circling.
  const ring = healing.paths.find((p) => p.id === "ring")!;
  const a = pathPoint(ring, 0.25);
  const b = pathPoint(ring, 1.25);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9);
});

test("the head curve inverse is the inverse of the head curve", () => {
  const trail = glitch.layers.find(
    (l) => l.emitter?.spawn.mode === "pathAnchored",
  )!;
  const head = trail.emitter!.spawn.headCurve!;
  const sample = (u: number) => {
    const keys = head.keys;
    const x = Math.min(1, Math.max(0, u));
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++)
      if (x <= keys[i][0]) {
        let f = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        if (head.ease === "smooth") f = f * f * (3 - 2 * f);
        return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
      }
    return keys[keys.length - 1][1];
  };
  for (const y of [0, 0.1, 0.33, 0.5, 0.82, 0.99]) {
    const u = invertCurve(head, y);
    assert.ok(u >= 0 && u <= 1, `${y} -> ${u}`);
    assert.ok(Math.abs(sample(u) - y) < 2e-3, `${y} -> ${u} -> ${sample(u)}`);
  }
  // Births ascend along the path: instance i is always born before instance i+1.
  const births = Array.from({ length: 12 }, (_, i) =>
    invertCurve(head, i / 11),
  );
  for (let i = 1; i < births.length; i++)
    assert.ok(births[i] >= births[i - 1], `${i}`);
});

test("a wire burst is a pure function of its spec, and stays inside its core box", () => {
  const layer = glitch.layers.find((l) => l.wireBurst)!;
  const spec = layer.wireBurst!;
  const first = buildWireBurstGeometry(spec);
  const again = buildWireBurstGeometry(structuredClone(spec));
  const positions = (g: { geometry: { getAttribute(name: string): { array: ArrayLike<number> } } }) =>
    Array.from(g.geometry.getAttribute("position").array);
  assert.deepEqual(positions(first), positions(again));
  // A different seed is a different burst.
  const reseeded = buildWireBurstGeometry({ ...structuredClone(spec), seed: spec.seed + 1 });
  assert.notDeepEqual(positions(first), positions(reseeded));
  // Every outline vertex is inside the un-travelled radius band; the framing
  // box is the core, so the un-scaled buffer has to fit well inside it.
  const corners = wireBurstBounds(spec);
  const limit = Math.max(...corners.map((p) => Math.abs(p.x)));
  for (const value of positions(first)) {
    assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(value) <= first.reach + 1e-6);
  }
  assert.ok(limit > spec.radius, "the core box must at least hold the outlines");
  for (const built of [first, again, reseeded]) built.geometry.dispose();
});

test("layer jitter is stepped, gated and identical on a seek", () => {
  const head = glitch.layers.filter((l) => l.jitter && l.id.startsWith("dart"));
  assert.equal(head.length, 3);
  const layer = head[0];
  const spec = layer.jitter!;
  const step = 1 / spec.frequency;
  // The jitter OFFSET, isolated from the motion keys the same layer also
  // carries: the same layer evaluated with and without its jitter.
  const offsetOf = (source: typeof layer, t: number) => {
    const moved = evaluateLayerV2(source, t).layer.transform.position;
    const still = evaluateLayerV2({ ...source, jitter: null }, t).layer.transform
      .position;
    return moved.map((v, k) => Number((v - still[k]).toFixed(9)));
  };
  const at = (t: number) => offsetOf(layer, t);

  // Inside one window the offset never changes; it is a step, not a wobble.
  const base = layer.start + step * 3.2;
  assert.deepEqual(at(base), at(base + step * 0.5));
  // Ten "played" evaluations then a cold seek land on the same offset.
  const first = at(base);
  for (let i = 0; i <= 10; i++)
    at(layer.start + (i / 10) * (layer.end - layer.start));
  assert.deepEqual(at(base), first);
  // The gate really gates: some windows fire, most do not.
  let fired = 0;
  let windows = 0;
  for (let i = 0; i < 400; i++) {
    const t = layer.start + (i + 0.5) * step;
    if (t >= layer.end) break;
    windows++;
    if (at(t).some((v) => Math.abs(v) > 1e-9)) fired++;
  }
  assert.ok(fired > 0, "a gated jitter still fires sometimes");
  assert.ok(fired < windows, "a gated jitter does not fire every window");
  // Never further than the amplitude allows.
  for (let i = 0; i < 200; i++) {
    const t = layer.start + (i + 0.5) * step;
    if (t >= layer.end) break;
    for (const v of at(t)) assert.ok(Math.abs(v) <= spec.amplitude + 1e-9);
  }
  // Every dart layer shares one jitter spec, so they break by the same offset.
  for (const t of [base, base + step * 2, base + step * 7])
    for (const other of head.slice(1))
      assert.deepEqual(offsetOf(head[0], t), offsetOf(other, t), `${other.id}@${t}`);
});

test("both new exemplars carry a path every referencing layer can resolve", () => {
  for (const doc of [healing, glitch]) {
    const ids = new Set(doc.paths.map((p) => p.id));
    for (const layer of doc.layers) {
      if (layer.ribbon) {
        assert.ok(ids.has(layer.ribbon.pathId), layer.id);
        if (layer.ribbon.morph)
          assert.ok(ids.has(layer.ribbon.morph.pathId), layer.id);
      }
      if (layer.emitter?.shape.pathId)
        assert.ok(ids.has(layer.emitter.shape.pathId), layer.id);
    }
  }
});

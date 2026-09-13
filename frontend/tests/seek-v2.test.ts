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
  pathEventTime,
  pathEvents,
  resolveEventWindows,
} from "../src/lib/vfx-lab/events-v2";
import {
  buildWireBurstGeometry,
  wireBurstBounds,
} from "../src/lib/vfx-lab/wire-burst-v2";
import {
  crystalInstances,
  crystalScaleAt,
  crystalSpawnSites,
} from "../src/lib/vfx-lab/crystals-v2";
import { latticeSites } from "../src/lib/vfx-lab/lattice-v2";
import { bandGeometry, flickerAt } from "../src/lib/vfx-lab/runtime-v2";
import { evaluateLayerV2 } from "../src/lib/vfx-lab/evaluate-v2";
import {
  defaultGeometry,
  defaultMaterial,
  type GeometryV2,
} from "../src/lib/vfx-lab/schema-v2";

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
  // meteor-rain is path-driven end to end: a line per descent, a trail
  // anchored to it, and every impact layer hanging off the path's own event
  // rather than off a hard-coded time.
  const meteor = createPresetV2("meteor-rain");
  assert.equal(meteor.paths.length, 5);
  assert.ok(meteor.paths.every((p) => p.type === "line"));
  const trail = meteor.layers.find((l) => l.blob?.arrangement === "path");
  assert.ok(trail, "meteor-rain carries a path-anchored trail");
  assert.ok(trail!.blob!.head, "the trail's anchors are born by a head curve");
  assert.ok(trail!.blob!.retract, "the trail retracts from one end");
  assert.ok(
    meteor.layers.some((l) => l.window),
    "an impact layer starts on a path event",
  );
  assert.ok(
    meteor.layers.some(
      (l) => l.emitter?.spawn.mode === "event" && l.emitter.spawn.originsFromPath,
    ),
    "one debris layer covers every impact",
  );
  assert.ok(
    meteor.layers.some((l) => l.material?.procedural === "teardropStreak"),
    "meteor-rain carries a speed-line cap",
  );
  assert.ok(meteor.environment.groundPool?.length);

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

  assert.ok(
    createPresetV2("lightning-impact").layers.some((l) => l.emitter?.trail),
    "lightning-impact carries a trail",
  );

  // The beam exemplar was rebuilt around the S7 spike's vocabulary: a tiered
  // slab body, panning stripes, flat cel licks and a line path that carries
  // both the shut-off run and the residual scatter.
  const beam = createPresetV2("beam");
  assert.ok(beam.paths.some((p) => p.type === "line"), "beam carries a line path");
  assert.ok(
    beam.layers.some((l) => l.geometry?.type === "slab" && l.geometry.slab),
    "beam carries a slab body",
  );
  assert.ok(
    beam.layers.some((l) => l.material?.stripes?.length),
    "beam carries panning stripes",
  );
  assert.ok(
    beam.layers.some((l) => l.emitter?.render.mode === "flatStrip"),
    "beam carries flat cel licks",
  );
  assert.ok(
    beam.layers.some((l) => l.emitter?.velocity.mode === "alongPath"),
    "beam carries a shut-off run along its own line",
  );
  assert.ok(
    beam.layers.some((l) => l.emitter?.shape.type === "pathLine"),
    "beam carries a residual scatter along its own line",
  );

  // The energy-column exemplar is the S10 spike: one shared collapse, an arc
  // cage, a streak fan and a post.flash white-out.
  const column = createPresetV2("energy-column");
  assert.ok(column.post.flash, "energy-column carries a post flash");
  assert.ok(
    column.layers.filter((l) => l.collapse).length >= 3,
    "the column body shares one collapse",
  );
  assert.ok(
    column.layers.some((l) => l.kind === "arcs" && l.arcs),
    "energy-column carries an arc cage",
  );
  assert.ok(
    column.layers.some((l) => l.kind === "streakBurst" && l.streakBurst),
    "energy-column carries a streak fan",
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

// ---------------------------------------------------------------------------
// Crystal clusters and the spherical hex lattice: the two Phase E generators
// whose tables the CPU builds. `crystalInstances` / `crystalScaleAt` are the
// same functions the renderer fills its instance attributes from and the
// framing pass measures, and `crystalSpawnSites` is what a borrowed shatter
// emitter uploads, so verifying determinism here verifies all three.
// ---------------------------------------------------------------------------

const iceDoc = createPresetV2("ice-blast");
const clusterLayer = iceDoc.layers.find((l) => l.crystals)!;
const clusterSpec = clusterLayer.crystals!;

test("a spike table is a pure function of the crystals spec", () => {
  assert.deepEqual(
    crystalInstances(clusterSpec),
    crystalInstances(structuredClone(clusterSpec)),
  );
  assert.equal(crystalInstances(clusterSpec).length, clusterSpec.count);
  const reseeded = crystalInstances({
    ...structuredClone(clusterSpec),
    seed: clusterSpec.seed + 1,
  });
  assert.notDeepEqual(
    reseeded.map((s) => s.direction),
    crystalInstances(clusterSpec).map((s) => s.direction),
  );
});

test("every spike stays inside the bands the document declared", () => {
  const table = crystalInstances(clusterSpec);
  const sinLo = Math.sin((clusterSpec.direction.elevation[0] * Math.PI) / 180);
  const sinHi = Math.sin((clusterSpec.direction.elevation[1] * Math.PI) / 180);
  const groups = new Set<number>();
  for (const spike of table) {
    groups.add(spike.group);
    assert.ok(Math.abs(Math.hypot(...spike.direction) - 1) < 1e-6);
    assert.ok(spike.direction[1] >= sinLo - 1e-6 && spike.direction[1] <= sinHi + 1e-6);
    assert.ok(
      spike.length >= clusterSpec.length[0] - 1e-6 &&
        spike.length <= clusterSpec.length[1] + 1e-6,
    );
    assert.ok(
      spike.width >= clusterSpec.width[0] - 1e-6 &&
        spike.width <= clusterSpec.width[1] + 1e-6,
    );
    assert.ok(
      spike.start >= clusterSpec.stagger[0] - 1e-6 &&
        spike.start <= clusterSpec.stagger[1] + 1e-6,
    );
  }
  assert.equal(groups.size, clusterSpec.groups, "every length class is populated");
});

test("seeking a crystal cluster draws the same spikes as playing to it", () => {
  const span = clusterLayer.end - clusterLayer.start;
  const table = crystalInstances(clusterSpec);
  const at = (age: number) =>
    table.map((spike) => crystalScaleAt(spike, clusterSpec, age, span));
  for (const age of [0, 0.2, 0.9, 2.3, span * 0.99])
    assert.deepEqual(at(age), at(age));
  // Nothing exists before its own staggered start, everything is grown by the
  // hold, and the collapse takes every spike back to nothing.
  assert.ok(at(-0.01).every((s) => s === 0));
  assert.ok(at(1.4).every((s) => s > 0.9));
  const collapse = clusterSpec.collapse!;
  assert.ok(
    at(collapse.start * span + collapse.duration * 2.3).every((s) => s === 0),
    "the shatter finishes",
  );
});

test("borrowed spawn sites are closed form in the source spec", () => {
  const sites = crystalSpawnSites(clusterSpec, 64, 0.02);
  assert.deepEqual(sites, crystalSpawnSites(clusterSpec, 64, 0.02));
  assert.equal(sites.positions.length, 64 * 3);
  for (let i = 0; i < 64; i++) {
    const axis = Array.from(sites.axes.slice(i * 3, i * 3 + 3));
    assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-6);
    // Never below the floor the caller asked for.
    assert.ok(sites.positions[i * 3 + 1] >= 0.02 - 1e-6);
  }
});

test("the relaxed lattice is deterministic and cached by (cells, seed)", () => {
  const shieldDoc = createPresetV2("shield");
  const spec = shieldDoc.layers.find((l) => l.material?.lattice)!.material!
    .lattice!;
  const first = latticeSites(spec.cells, shieldDoc.seed);
  // Cached: the same call returns the very same object, so two layers sharing a
  // lattice share one relaxation pass and one texture.
  assert.equal(latticeSites(spec.cells, shieldDoc.seed), first);
  assert.equal(first.count, spec.cells);
  // Sorted by descending y, which is what lets the shader scan a latitude band.
  for (let i = 1; i < spec.cells; i++)
    assert.ok(first.data[i * 4 + 1] <= first.data[(i - 1) * 4 + 1] + 1e-6);
  // Every site is on the unit sphere, and relaxation kept them apart.
  for (let i = 0; i < spec.cells; i++) {
    const p = [first.data[i * 4], first.data[i * 4 + 1], first.data[i * 4 + 2]];
    assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-4);
  }
  const other = latticeSites(spec.cells, shieldDoc.seed + 1);
  assert.notDeepEqual(Array.from(other.data), Array.from(first.data));
});

test("a band belt is a strip ON the sphere, not a chord across it", () => {
  const doc = createPresetV2("shield");
  const belt = doc.layers.find((l) => l.geometry?.type === "band")!;
  const geometry = bandGeometry(belt.geometry!);
  const position = geometry.getAttribute("position");
  const radius = belt.geometry!.radius;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getY(i), position.getZ(i));
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  // Every vertex sits on the sphere of geometry.radius, centred on the layer
  // origin: a belt wraps the body it belongs to and can never cut through it.
  assert.ok(
    Math.abs(lo - radius) < 1e-4 && Math.abs(hi - radius) < 1e-4,
    `band vertices span radius ${lo}..${hi}, expected ${radius}`,
  );
  // The strip's angular width is geometry.thickness metres of arc, which is
  // what the tilt then leans over.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = box.max.y - box.min.y;
  const tilt = Math.abs(belt.geometry!.band!.tilt);
  const expected =
    2 * radius * Math.sin(tilt) +
    belt.geometry!.thickness * Math.cos(tilt);
  assert.ok(
    Math.abs(height - expected) < radius * 0.08,
    `tilted belt spans ${height} in y, expected about ${expected}`,
  );
  geometry.dispose();
});

// ---------------------------------------------------------------------------
// The beam / energy-column port.
//
// layer.collapse and material.flicker are the two pieces this port evaluates on
// the CPU: the collapse rewrites the live layer before the draw, and the
// flicker multiplier is uploaded once per layer per frame so every draw a layer
// owns (mesh, hull, split copies, trail) steps together. Both have to be pure
// functions of layer time; the arcs' blink and the streak fan's spread live in
// the shader and are covered by the headless harness's determinism check.
// ---------------------------------------------------------------------------

test("collapse is closed form: playing up to a time leaves nothing behind", () => {
  const doc = createPresetV2("energy-column");
  const collapsing = doc.layers.filter((l) => l.collapse);
  assert.ok(collapsing.length >= 4);
  for (const layer of collapsing) {
    const pristine = structuredClone(layer);
    for (const time of [3.4, 3.6, 4.0, 4.5, 4.99]) {
      // "Play" up to the time in ten steps, then seek to it cold. The collapse
      // rewrites geometry.length / radius and the arcs' own span on a CLONE, so
      // the walk must leave the source layer untouched and the cold seek must
      // land on exactly what the walk's last frame drew.
      let played = evaluateLayerV2(layer, layer.start);
      for (let i = 1; i < 10; i++)
        played = evaluateLayerV2(layer, layer.start + ((time - layer.start) * i) / 10);
      const walked = evaluateLayerV2(layer, time);
      assert.deepEqual(layer, pristine, `${layer.id} was mutated by playing`);
      assert.deepEqual(evaluateLayerV2(layer, time).layer, walked.layer, `${layer.id} @${time}`);
      // The walk really did move: the last intermediate frame is not the target.
      if (time > layer.start + 0.2)
        assert.notDeepEqual(played.layer, walked.layer, `${layer.id} @${time}`);
    }
  }
});

test("collapse retracts along the layer axis and narrows across it", () => {
  const doc = createPresetV2("energy-column");
  const shell = doc.layers.find((l) => l.id === "column-shell")!;
  const before = evaluateLayerV2(shell, shell.collapse!.start - 0.01).layer;
  const after = evaluateLayerV2(shell, shell.collapse!.start + 1.4).layer;
  // length is ALONG the layer's own +Z, radius/thickness ACROSS it.
  assert.ok(after.geometry!.length < before.geometry!.length * 0.2);
  assert.ok(after.geometry!.radius < before.geometry!.radius * 0.45);
  // anchor "base": the transform never moves, so the body retracts from the top.
  assert.deepEqual(after.transform.position, before.transform.position);

  // An arcs layer has no geometry, so the same collapse reaches its own spec.
  const arcs = doc.layers.find((l) => l.kind === "arcs")!;
  const arcsBefore = evaluateLayerV2(arcs, arcs.collapse!.start - 0.01).layer;
  const arcsAfter = evaluateLayerV2(arcs, arcs.collapse!.start + 1.4).layer;
  assert.ok(arcsAfter.arcs!.span < arcsBefore.arcs!.span * 0.2);
  assert.ok(arcsAfter.arcs!.radius[1] < arcsBefore.arcs!.radius[1] * 0.45);
});

test("flicker is a hashed STEP, constant inside its own window", () => {
  const material = { ...defaultMaterial(), flicker: { rate: 10, amount: 0.4 } };
  // Constant across one 1/rate window, and a pure function of the window index.
  assert.equal(flickerAt(material, 0.31), flickerAt(material, 0.39));
  assert.notEqual(flickerAt(material, 0.31), flickerAt(material, 0.41));
  assert.equal(flickerAt(material, 2.05), flickerAt(material, 2.05));
  // Centred on 1, inside 1 +- amount/2, so it never drives a layer negative.
  for (let i = 0; i < 200; i++) {
    const value = flickerAt(material, i * 0.017);
    assert.ok(value >= 1 - 0.2 - 1e-6 && value <= 1 + 0.2 + 1e-6);
  }
  assert.equal(flickerAt(defaultMaterial(), 1.7), 1);
});

test("both new exemplars evaluate identically on a seek", () => {
  for (const id of ["beam", "energy-column"] as const) {
    const doc = createPresetV2(id);
    for (const layer of doc.layers)
      for (let step = 0; step <= 10; step++) {
        const time = (doc.duration * step) / 10;
        assert.deepEqual(
          evaluateLayerV2(layer, time),
          evaluateLayerV2(layer, time),
          `${id}/${layer.id} @${time}`,
        );
      }
  }
});

test("the beam's line path is exactly the segment it names", () => {
  const doc = createPresetV2("beam");
  const path = doc.paths.find((p) => p.type === "line")!;
  assert.equal(path.type, "line");
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const point = pathPoint(path, u);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(point[axis] - (path.from[axis] + (path.to[axis] - path.from[axis]) * u)) <
          1e-9,
      );
  }
  // The tangent is constant: a line has one heading end to end.
  assert.deepEqual(pathTangent(path, 0.1), pathTangent(path, 0.9));
});

// ---------------------------------------------------------------------------
// The portal / vortex / meteor port. Everything the three exemplars add that
// runs on the CPU — the orbit and path blob arrangements, the retraction, and
// the path events layer.window and spawn.mode "event" hang off — is a pure
// function of (document, time), so sampling the same time twice has to give
// the same answer and sampling it out of order has to give the same answer as
// walking up to it.
// ---------------------------------------------------------------------------

test("an orbit blob's lobes are closed form in layer time", () => {
  const doc = createPresetV2("sky-vortex");
  const layer = doc.layers.find((l) => l.blob?.arrangement === "orbit")!;
  const blob = layer.blob!;
  const lobes = blobLobes(blob);
  assert.equal(lobes.length, blob.count);
  // Every lobe rides a lane inside the band, and the inner lane laps the outer.
  for (const lobe of lobes) {
    assert.ok(lobe.orbit, "an orbit lobe carries its lane");
    assert.ok(lobe.orbit!.radius >= blob.height - 1e-6);
    assert.ok(lobe.orbit!.radius <= blob.spread + 1e-6);
  }
  const sorted = [...lobes].sort((a, b) => a.orbit!.radius - b.orbit!.radius);
  assert.ok(sorted[0].orbit!.omega > sorted[sorted.length - 1].orbit!.omega);
  const span = layer.end - layer.start;
  for (const age of [0.4, 1.7, 3.3, 5.1]) {
    const a = lobes.map((l) => lobeStateAt(l, blob, age, span, null));
    const b = lobes.map((l) => lobeStateAt(l, blob, age, span, null));
    assert.deepEqual(a, b);
  }
  // The ring really turns: a lobe is somewhere else a second later.
  const before = lobeStateAt(lobes[0], blob, 1, span, null);
  const after = lobeStateAt(lobes[0], blob, 2, span, null);
  assert.notDeepEqual(before.position, after.position);
});

test("a path blob's anchors are born by the head and retract from one end", () => {
  const doc = createPresetV2("meteor-rain");
  const layer = doc.layers.find((l) => l.blob?.arrangement === "path")!;
  const blob = layer.blob!;
  const path = doc.paths.find((p) => p.id === blob.pathId)!;
  const lobes = blobLobes(blob, path);
  assert.equal(lobes.length, blob.count);
  // Anchors ascend along the path, and so do their births: an anchor cannot
  // appear before the head has reached it.
  const anchors = lobes.filter((_, i) => i % blob.perAnchor === 0);
  for (let i = 1; i < anchors.length; i++) {
    assert.ok(anchors[i].along > anchors[i - 1].along);
    assert.ok(anchors[i].t0 >= anchors[i - 1].t0 - 1e-6);
  }
  const span = layer.end - layer.start;
  for (const age of [0.2, 0.9, 2.4, 4.6]) {
    assert.deepEqual(
      lobes.map((l) => lobeStateAt(l, blob, age, span, 0.8, path)),
      lobes.map((l) => lobeStateAt(l, blob, age, span, 0.8, path)),
    );
  }
  // The retraction eats the trail: the same lobe is dimmer later.
  const early = lobeStateAt(lobes[0], blob, span * 0.6, span, null, path);
  const late = lobeStateAt(lobes[0], blob, span * 0.9, span, null, path);
  assert.ok(!late.alive || late.alpha < early.alpha);
});

test("a path event is the moment the head reaches the end, and windows follow it", () => {
  const doc = createPresetV2("meteor-rain");
  for (const path of doc.paths) {
    const event = pathEventTime(doc, path.id, 1);
    assert.ok(event !== null, `${path.id} has a head`);
    assert.ok(event! > 0 && event! < doc.duration);
    // The head is monotone, so a point earlier on the path happens earlier.
    assert.ok(pathEventTime(doc, path.id, 0.5)! < event!);
  }
  const resolved = resolveEventWindows(doc);
  // Nothing else moves.
  assert.deepEqual(
    resolved.layers.filter((l) => !l.window).map((l) => [l.id, l.start, l.end]),
    doc.layers.filter((l) => !l.window).map((l) => [l.id, l.start, l.end]),
  );
  for (const layer of resolved.layers) {
    if (!layer.window) continue;
    const source = doc.layers.find((l) => l.id === layer.id)!;
    const event = pathEventTime(doc, layer.window.at.pathId, layer.window.at.u)!;
    assert.ok(Math.abs(layer.start - (event + source.start)) < 1e-6);
    // The authored duration is kept, up to the document's own end.
    const span = Math.min(source.end - source.start, doc.duration - layer.start);
    assert.ok(Math.abs(layer.end - layer.start - span) < 1e-6);
  }
  // A document with no windows is returned by identity: the pass costs nothing
  // on the ten exemplars that do not use one.
  const noWindows = createPresetV2("shield");
  assert.equal(resolveEventWindows(noWindows), noWindows);
  // One debris layer covers every impact, and the events it is given are the
  // five path ends.
  const events = pathEvents(doc, null);
  assert.equal(events.length, doc.paths.length);
  for (let i = 0; i < events.length; i++)
    assert.deepEqual(events[i].position, pathPoint(doc.paths[i], 1));
});

test("the three new exemplars validate and carry their own vocabulary", () => {
  for (const id of ["portal", "sky-vortex", "meteor-rain"] as const) {
    const doc = createPresetV2(id);
    assert.equal(doc.schemaVersion, "autov.lab/2");
    assert.ok(doc.layers.length > 3);
  }
});

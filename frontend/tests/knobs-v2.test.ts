import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IDENTITY_KNOBS,
  KNOB_BOUNDS,
  KNOB_MAX,
  KNOB_MIN,
  KNOB_NAMES,
  MIN_PARTICLE_COUNT,
  applyKnobs,
  clampKnobs,
  fromLogKnobs,
  knobRecord,
  toLogKnobs,
  visibleLayerCount,
} from "../src/lib/vfx-lab/knobs-v2";
import {
  MESH_KINDS_V2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

const load = (id: string) =>
  validateDocumentV2(
    JSON.parse(readFileSync(`fixtures/v2/${id}/document.json`, "utf8")),
  );

const base = load("fire-projectile");
const knobsAt = (name: string, value: number) =>
  KNOB_NAMES.map((n) => (n === name ? value : 1));

test("identity knobs reproduce the document and leave the base untouched", () => {
  const before = JSON.stringify(base);
  const out = applyKnobs(base, IDENTITY_KNOBS);
  assert.deepEqual(out, base);
  assert.notEqual(out, base, "the result must be a fresh object");
  const twice = applyKnobs(applyKnobs(base, IDENTITY_KNOBS), IDENTITY_KNOBS);
  assert.deepEqual(twice, base);
  assert.equal(JSON.stringify(base), before, "the base was mutated");
});

test("apply is a pure function of (base, knobs): same input, same output, base unchanged", () => {
  const knobs = [1.7, 0.6, 0.8, 1.3, 1.4, 0.5, 2.1, 1.2, 0.7, 1.9, 1.4];
  const before = JSON.stringify(base);
  const a = applyKnobs(base, knobs);
  const b = applyKnobs(base, knobs);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(base), before);
  // Applying to the *result* is a different (composed) document, which is why
  // the optimizer always re-applies to the base.
  const composed = applyKnobs(a, knobs);
  assert.notDeepEqual(composed, a);
});

test("every knob vector still produces a document the schema accepts", () => {
  for (const value of [KNOB_MIN, 0.5, 1, 2, KNOB_MAX])
    for (const name of KNOB_NAMES)
      validateDocumentV2(applyKnobs(base, knobsAt(name, value)));
  // Per-knob boxes: time is narrower than the rest and clamping must honour it.
  assert.deepEqual(KNOB_BOUNDS.timeScale, [0.5, 2]);
  for (const name of KNOB_NAMES)
    if (name !== "timeScale")
      assert.deepEqual(KNOB_BOUNDS[name], [KNOB_MIN, KNOB_MAX], name);
  for (const id of ["smoke-burst", "lightning-impact", "beam", "shield"]) {
    const doc = load(id);
    validateDocumentV2(
      applyKnobs(doc, KNOB_NAMES.map((n) => KNOB_BOUNDS[n][1])),
    );
    validateDocumentV2(
      applyKnobs(doc, KNOB_NAMES.map((n) => KNOB_BOUNDS[n][0])),
    );
  }
});

test("knobs are clamped into the box and round-trip through log space", () => {
  assert.deepEqual(
    clampKnobs([0.01, 100, Number.NaN, 1, 1, 1, 1, 1, 1, 1, 99]),
    [KNOB_MIN, KNOB_MAX, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  );
  const knobs = [0.3, 0.5, 1, 1.5, 2, 3, 4, 0.9, 0.4, 2.5, 1.75];
  fromLogKnobs(toLogKnobs(knobs)).forEach((v, i) =>
    assert.ok(Math.abs(v - knobs[i]) < 1e-12, `${KNOB_NAMES[i]}`),
  );
  assert.throws(() => clampKnobs([1, 1, 1]));
  assert.deepEqual(Object.keys(knobRecord(IDENTITY_KNOBS)), [...KNOB_NAMES]);
});

test("particle count is rounded, floored at eight and applied to every spawn channel", () => {
  const emitterLayers = (doc: VfxDocumentV2) =>
    doc.layers.filter((l) => l.emitter);
  const up = applyKnobs(base, knobsAt("particleCount", 1.7));
  emitterLayers(up).forEach((layer, i) => {
    const source = emitterLayers(base)[i].emitter!;
    assert.equal(layer.emitter!.count, Math.round(source.count * 1.7));
    assert.equal(Number.isInteger(layer.emitter!.count), true);
    assert.ok(
      Math.abs(layer.emitter!.spawn.rate - source.spawn.rate * 1.7) < 1e-9,
    );
    layer.emitter!.spawn.bursts.forEach((burst, b) =>
      assert.equal(burst.count, Math.round(source.spawn.bursts[b].count * 1.7)),
    );
  });
  const down = applyKnobs(base, knobsAt("particleCount", KNOB_MIN));
  for (const layer of emitterLayers(down))
    assert.ok(
      layer.emitter!.count >= MIN_PARTICLE_COUNT,
      `count ${layer.emitter!.count} fell below the floor`,
    );
});

test("size, life, opacity and ramp intensity scale within their schema ranges", () => {
  const big = applyKnobs(base, [1, 4, 1, 4, 1, 4, 1, 1, 1, 1, 1]);
  for (const layer of big.layers) {
    if (layer.emitter) {
      layer.emitter.render.size.forEach((v) => assert.ok(v >= 0.001 && v <= 8));
      layer.emitter.life.forEach((v) => assert.ok(v >= 0.02 && v <= 12));
      assert.ok(layer.emitter.life[0] <= layer.emitter.life[1]);
    }
    if (layer.material)
      for (const stop of layer.material.ramp.stops)
        assert.ok(stop.intensity >= 0 && stop.intensity <= 8);
  }
  // Opacity is a fraction; doubling it cannot escape 1.
  const opaque = applyKnobs(base, knobsAt("particleOpacity", 4));
  for (const layer of opaque.layers)
    if (layer.emitter && layer.material)
      assert.ok(layer.material.opacity <= 1 && layer.material.opacity > 0);
  // A mesh layer's opacity belongs to no knob but K6's ramp, so it is untouched.
  const meshIndex = base.layers.findIndex(
    (l) => !l.emitter && l.material && (MESH_KINDS_V2 as readonly string[]).includes(l.kind),
  );
  assert.ok(meshIndex >= 0);
  assert.equal(
    opaque.layers[meshIndex].material!.opacity,
    base.layers[meshIndex].material!.opacity,
  );
});

test("mesh scale moves the transform and the primitive's own dimensions", () => {
  const scaled = applyKnobs(base, knobsAt("meshScale", 1.5));
  let touched = 0;
  scaled.layers.forEach((layer, i) => {
    const source = base.layers[i];
    if (!(MESH_KINDS_V2 as readonly string[]).includes(layer.kind)) {
      assert.deepEqual(layer.transform.scale, source.transform.scale);
      return;
    }
    touched++;
    layer.transform.scale.forEach((v, axis) =>
      assert.ok(Math.abs(v - source.transform.scale[axis] * 1.5) < 1e-9),
    );
    if (layer.geometry && source.geometry) {
      assert.ok(
        Math.abs(layer.geometry.radius - Math.min(8, source.geometry.radius * 1.5)) <
          1e-9,
      );
      assert.ok(
        Math.abs(layer.geometry.length - Math.min(12, source.geometry.length * 1.5)) <
          1e-9,
      );
    }
  });
  assert.ok(touched > 0, "the fixture has no mesh layer to scale");
});

test("light intensity curves scale and stay inside the curve range", () => {
  const lit = applyKnobs(base, knobsAt("lightIntensity", 3));
  let lights = 0;
  lit.layers.forEach((layer, i) => {
    if (!layer.light) return;
    lights++;
    layer.light.intensity.keys.forEach(([t, v], k) => {
      const [st, sv] = base.layers[i].light!.intensity.keys[k];
      assert.equal(t, st);
      assert.ok(Math.abs(v - Math.min(20, sv * 3)) < 1e-9);
    });
  });
  assert.ok(lights > 0, "the fixture has no light layer");
});

test("dissipation stretch keeps starts, clamps to the duration and never orphans a keyframe", () => {
  const doc = load("smoke-burst");
  const stretched = applyKnobs(doc, knobsAt("dissipationStretch", 4));
  stretched.layers.forEach((layer, i) => {
    assert.equal(layer.start, doc.layers[i].start, layer.id);
    assert.ok(layer.end <= doc.duration + 1e-12, `${layer.id} ${layer.end}`);
    if (doc.layers[i].end > doc.impact)
      assert.ok(layer.end >= doc.layers[i].end - 1e-9, layer.id);
    else assert.equal(layer.end, doc.layers[i].end, layer.id);
  });
  validateDocumentV2(stretched);

  const squeezed = applyKnobs(doc, knobsAt("dissipationStretch", KNOB_MIN));
  squeezed.layers.forEach((layer, i) => {
    assert.equal(layer.start, doc.layers[i].start);
    assert.ok(layer.end > layer.start, `${layer.id} collapsed`);
    // Keyframes are local times inside the span, so the span may not shrink
    // past the last key or the document stops validating.
    const keyed = Math.max(
      0,
      ...layer.tracks.flatMap((t) => t.keys.map(([time]) => time)),
      ...(layer.motion ? layer.motion.keys.map(([time]) => time) : []),
    );
    assert.ok(layer.end - layer.start >= keyed - 1e-9, `${layer.id} orphaned a key`);
  });
  validateDocumentV2(squeezed);
  assert.equal(visibleLayerCount(squeezed), visibleLayerCount(doc));
});

test("no knob changes how many layers the renderer draws", () => {
  const before = visibleLayerCount(base);
  for (const value of [KNOB_MIN, 0.5, 2, KNOB_MAX])
    for (const name of KNOB_NAMES)
      assert.equal(
        visibleLayerCount(applyKnobs(base, knobsAt(name, value))),
        before,
        `${name}=${value}`,
      );
});

test("camera, exposure, seed and layer identity are outside the knob space", () => {
  const wild = applyKnobs(base, [4, 0.25, 4, 0.25, 4, 0.25, 4, 2, 3, 0.5, 1]);
  assert.deepEqual(wild.camera, base.camera);
  assert.deepEqual(wild.post, base.post);
  assert.deepEqual(wild.environment, base.environment);
  assert.equal(wild.seed, base.seed);
  assert.equal(wild.duration, base.duration);
  assert.equal(wild.impact, base.impact);
  assert.deepEqual(
    wild.layers.map((l) => [l.id, l.kind, l.enabled]),
    base.layers.map((l) => [l.id, l.kind, l.enabled]),
  );
});

test("vertical stretch tilts particle motion and the mesh y axis without changing anything else", () => {
  const doc = load("smoke-burst");
  const stretched = applyKnobs(doc, knobsAt("verticalStretch", 2));
  let particles = 0;
  let meshes = 0;
  stretched.layers.forEach((layer, i) => {
    const source = doc.layers[i];
    if (layer.emitter && source.emitter) {
      particles++;
      const d = layer.emitter.velocity.direction;
      const s = source.emitter.velocity.direction;
      // Still a unit vector, and the y share of it has grown (or stayed put
      // when there was no y component to grow).
      const length = Math.hypot(...d);
      assert.ok(Math.abs(length - 1) < 1e-9 || length === 0, `${layer.id} ${length}`);
      if (Math.abs(s[1]) > 1e-6 && Math.hypot(s[0], s[2]) > 1e-6)
        assert.ok(Math.abs(d[1]) > Math.abs(s[1]) - 1e-9, layer.id);
      assert.ok(
        Math.abs(layer.emitter.forces.gravity[1] -
          Math.max(-12, Math.min(12, source.emitter.forces.gravity[1] * 2))) < 1e-9,
      );
      // The horizontal components are untouched.
      assert.equal(layer.emitter.forces.gravity[0], source.emitter.forces.gravity[0]);
      assert.equal(layer.emitter.shape.radius, source.emitter.shape.radius);
    }
    if (MESH_KINDS_V2.includes(layer.kind as never)) {
      meshes++;
      assert.equal(layer.transform.scale[0], source.transform.scale[0]);
      assert.equal(layer.transform.scale[2], source.transform.scale[2]);
      assert.ok(
        Math.abs(layer.transform.scale[1] - source.transform.scale[1] * 2) < 1e-9,
        layer.id,
      );
    }
  });
  assert.ok(particles > 0 && meshes > 0);
  validateDocumentV2(stretched);
});

test("spread scale opens the emission cone and the spawn region, and stays inside the schema", () => {
  const doc = load("smoke-burst");
  for (const value of [KNOB_MIN, 0.7, 2, KNOB_MAX]) {
    const spread = applyKnobs(doc, knobsAt("spreadScale", value));
    spread.layers.forEach((layer, i) => {
      const source = doc.layers[i].emitter;
      if (!layer.emitter || !source) return;
      assert.ok(
        layer.emitter.velocity.angle <= Math.PI + 1e-12 &&
          layer.emitter.velocity.angle >= 0,
      );
      if (source.velocity.angle * value <= Math.PI)
        assert.ok(
          Math.abs(layer.emitter.velocity.angle - source.velocity.angle * value) < 1e-9,
        );
      assert.ok(layer.emitter.shape.radius <= 12);
      // An inner radius may never overtake the outer one.
      assert.ok(layer.emitter.shape.innerRadius <= layer.emitter.shape.radius + 1e-12);
      // Mesh geometry is K5's business, not K10's.
      if (layer.geometry && doc.layers[i].geometry)
        assert.equal(layer.geometry.radius, doc.layers[i].geometry!.radius);
    });
    validateDocumentV2(spread);
  }
});

test("time scale stretches the whole schedule about the pivot and keeps the document valid", () => {
  const doc = load("smoke-burst");
  const pivot = 1.2;
  const at = (t: number) => pivot + (t - pivot) * 2;
  const slower = applyKnobs(doc, knobsAt("timeScale", 2), { pivot });
  validateDocumentV2(slower);

  // Duration grows, but never past 1.5x the base.
  assert.ok(slower.duration > doc.duration, `${slower.duration}`);
  assert.ok(slower.duration <= doc.duration * 1.5 + 1e-9, `${slower.duration}`);
  // Layer windows moved away from the pivot, in order, inside the document.
  slower.layers.forEach((layer, i) => {
    const source = doc.layers[i];
    assert.ok(layer.start < layer.end, layer.id);
    assert.ok(layer.end <= slower.duration + 1e-9, layer.id);
    // Exact only for layers the stretch does not push past either end of the
    // document; the rest are clamped into it, which is the point of the cap.
    if (at(source.start) >= 0 && at(source.end) <= slower.duration)
      assert.ok(Math.abs(layer.start - at(source.start)) < 1e-6, layer.id);
    else assert.ok(layer.start >= 0 && layer.end <= slower.duration + 1e-9, layer.id);
    // Particle life scales with the schedule, so the shape of the effect at a
    // given fraction of its own span is preserved.
    if (layer.emitter && source.emitter)
      assert.ok(
        Math.abs(layer.emitter.life[0] - Math.min(12, source.emitter.life[0] * 2)) < 1e-9,
        layer.id,
      );
  });
  // The pivot itself is a fixed point.
  const pinned = applyKnobs({ ...doc, impact: pivot }, knobsAt("timeScale", 1.7), {
    pivot,
  });
  assert.ok(Math.abs(pinned.impact - pivot) < 1e-3, `${pinned.impact}`);

  const faster = applyKnobs(doc, knobsAt("timeScale", 0.5), { pivot });
  validateDocumentV2(faster);
  assert.ok(faster.duration < doc.duration, `${faster.duration}`);
  assert.equal(visibleLayerCount(faster), visibleLayerCount(doc));
});

test("a time stretch never orphans, reorders or duplicates a keyframe", () => {
  for (const id of ["smoke-burst", "lightning-impact", "beam", "fire-slash"]) {
    const doc = load(id);
    for (const pivot of [0, doc.duration * 0.4, doc.duration]) {
      for (const k of [0.5, 0.75, 1.4, 2]) {
        const out = applyKnobs(doc, knobsAt("timeScale", k), { pivot });
        validateDocumentV2(out);
        for (const layer of out.layers) {
          const usable = layer.end - layer.start;
          for (const track of layer.tracks) {
            track.keys.forEach(([t], i) => {
              assert.ok(t <= usable + 1e-6, `${id}/${layer.id}/${track.target}`);
              if (i) assert.ok(t > track.keys[i - 1][0], `${id}/${layer.id} order`);
            });
          }
          assert.equal(
            new Set(layer.tracks.map((t) => t.target)).size,
            layer.tracks.length,
          );
        }
      }
    }
  }
});

test("the time knob is the only one that moves the document's own duration", () => {
  const doc = load("smoke-burst");
  for (const name of KNOB_NAMES) {
    if (name === "timeScale") continue;
    for (const value of KNOB_BOUNDS[name])
      assert.equal(
        applyKnobs(doc, knobsAt(name, value), { pivot: 1 }).duration,
        doc.duration,
        name,
      );
  }
});

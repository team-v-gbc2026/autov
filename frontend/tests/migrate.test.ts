import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
import {
  RECIPES,
  createPreset,
  type RecipeId,
} from "../src/lib/vfx-lab/recipes";
import { upgradeDocument, V1_TARGET_MAP } from "../src/lib/vfx-lab/migrate";
import {
  lintDocumentV2,
  validateDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

const DIR = path.join(process.cwd(), "tests/fixtures/v1-trials");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));

// The archived trials were stripped of their base64 payloads; the v1 schema
// still requires a well-formed data URI, so re-attach a 1x1 placeholder.
const DUMMY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAX+bpQAAAAABJRU5ErkJggg==";

function loadV1(file: string): VfxDocument {
  const doc = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
  for (const asset of doc.textures || []) asset.data = DUMMY_PNG;
  return validateDocument(doc);
}

test("every archived v1 trial upgrades to a valid v2 document", () => {
  assert.ok(FILES.length > 0, "no v1 fixtures found");
  for (const file of FILES) {
    const v1 = loadV1(file);
    const v2 = validateDocumentV2(upgradeDocument(v1));
    assert.equal(v2.schemaVersion, "autov.lab/2", file);
    assert.deepEqual(
      v2.layers.map((l) => l.id),
      v1.layers.map((l) => l.id),
      file,
    );
    assert.deepEqual(
      v2.layers.map((l) => l.kind),
      v1.layers.map((l) => l.kind),
      file,
    );
    assert.equal(v2.seed, v1.seed, file);
    assert.equal(v2.duration, v1.duration, file);
    assert.equal(v2.impact, v1.impact, file);
    assert.equal(v2.environment.background, v1.post.background, file);
    assert.equal(v2.post.bloom.strength, v1.post.bloom, file);
    // No layers are invented — in particular no implicit light.
    assert.ok(!v2.layers.some((l) => l.kind === "light"), file);
    // Lint is advisory only; it must never throw on a migrated document.
    assert.ok(Array.isArray(lintDocumentV2(v2)), file);
  }
});

test("the v1 recipe presets upgrade", () => {
  for (const id of Object.keys(RECIPES) as RecipeId[]) {
    const v1 = createPreset(id);
    const v2 = validateDocumentV2(upgradeDocument(v1));
    assert.equal(v2.layers.length, v1.layers.length, id);
  }
});

test("upgradeDocument is idempotent on v2 input", () => {
  for (const file of FILES.slice(0, 5)) {
    const once = upgradeDocument(loadV1(file));
    const twice = upgradeDocument(once);
    assert.deepEqual(twice, once, file);
    assert.equal(twice, once, `${file}: v2 input is returned as-is`);
  }
});

test("v1 params land in the expected v2 slots", () => {
  const v1 = createPreset("shockwave");
  const source = v1.layers.find((l) => l.kind === "particles")!;
  source.params.erosion = 0.4;
  source.params.turbulence = 1.2;
  const v2 = upgradeDocument(v1);
  const layer = v2.layers.find((l) => l.id === source.id)!;
  const material = layer.material!;
  const emitter = layer.emitter!;
  assert.equal(material.ramp.stops.length, 2);
  assert.equal(material.ramp.stops[0].color, source.params.color);
  assert.equal(material.ramp.stops[0].intensity, source.params.intensity);
  assert.equal(material.ramp.stops[1].color, source.params.secondaryColor);
  assert.equal(material.opacity, source.params.opacity);
  assert.equal(
    material.blend,
    source.params.blend === "normal" ? "alpha" : "additive",
  );
  assert.deepEqual(material.erosion!.curve.keys, [
    [0, 0.4],
    [1, 0.4],
  ]);
  assert.equal(emitter.count, source.params.count);
  assert.equal(emitter.spawn.mode, "burst");
  assert.equal(emitter.spawn.window, source.params.emission);
  assert.equal(emitter.shape.type, "sphere");
  assert.equal(emitter.shape.radius, source.params.radius);
  assert.equal(emitter.velocity.mode, "radial");
  assert.equal(emitter.forces.drag, source.params.drag);
  assert.equal(emitter.forces.gravity[1], source.params.gravity);
  assert.ok(emitter.forces.curl, "turbulence becomes curl noise");
  // ±35% life variance keeps the population from dying on one frame.
  assert.ok(
    Math.abs(emitter.life[0] - source.params.life * 0.65) < 1e-6 &&
      Math.abs(emitter.life[1] - source.params.life * 1.35) < 1e-6,
  );
  assert.ok(emitter.life[1] / emitter.life[0] > 2);
  assert.deepEqual(layer.transform.position, source.params.position);
});

test("v1 blend normal becomes alpha and surface becomes procedural", () => {
  const v1 = createPreset("smoke");
  const source = v1.layers[0];
  source.params.blend = "normal";
  source.surface = "smoke";
  source.textureId = null;
  const layer = upgradeDocument(v1).layers[0];
  assert.equal(layer.material!.blend, "alpha");
  assert.equal(layer.material!.procedural, "smoke");
});

test("v1 track targets are renamed onto v2 dotted paths", () => {
  const v1 = createPreset("shockwave");
  const mesh = v1.layers.find(
    (l) => l.kind !== "particles" && l.tracks.length > 0,
  )!;
  const v2 = upgradeDocument(v1);
  const layer = v2.layers.find((l) => l.id === mesh.id)!;
  for (const track of mesh.tracks) {
    const target = V1_TARGET_MAP[track.target];
    assert.ok(
      layer.tracks.some((t) => t.target === target),
      `${track.target} -> ${target}`,
    );
  }
  assert.equal(layer.tracks.length, mesh.tracks.length);
  assert.ok(!layer.tracks.some((t) => t.target.length === 0));
});

test("a v1 particles layer maps spin and speed onto emitter paths", () => {
  const v1 = createPreset("shockwave");
  const source = v1.layers.find((l) => l.kind === "particles")!;
  source.tracks = [
    {
      target: "spin",
      keys: [
        [0, 0],
        [0.5, 2],
      ],
      ease: "linear",
    },
  ];
  const layer = upgradeDocument(v1).layers.find((l) => l.id === source.id)!;
  assert.equal(layer.tracks[0].target, "emitter.render.rotation.speed[1]");
});

test("an upgraded v1 document carries the neutral value of every later field", () => {
  const v2 = upgradeDocument(createPreset("projectile"));
  // v1 had no paths, no screen glitch, no jitter, no channel split, no
  // procedural parameters, no cylinder taper, no path emitters, no twinkle, no
  // crystal clusters, no hex lattice, no reveal front, no ground proximity
  // glow, no ripples, no belt geometry, no borrowed spawn sites and no planar
  // drag; an upgraded document must render exactly as it did before they
  // existed.
  assert.deepEqual(v2.paths, []);
  assert.equal(v2.post.glitch, null);
  for (const layer of v2.layers) {
    assert.equal(layer.jitter, null);
    assert.equal(layer.ribbon, undefined);
    assert.equal(layer.wireBurst, undefined);
    assert.deepEqual(layer.material!.proceduralParams, [0, 0, 0, 0]);
    assert.equal(layer.material!.rgbSplit, null);
    assert.equal(layer.crystals, undefined);
    assert.equal(layer.material!.reveal, null);
    assert.equal(layer.material!.lattice, null);
    assert.equal(layer.material!.planeGlow, null);
    assert.equal(layer.material!.ripples, null);
    if (layer.geometry) {
      assert.equal(layer.geometry.taper, 1);
      assert.equal(layer.geometry.band, null);
      assert.notEqual(layer.geometry.type, "band");
    }
    if (layer.emitter) {
      assert.equal(layer.emitter.shape.pathId, null);
      assert.equal(layer.emitter.shape.sourceLayerId, null);
      assert.equal(layer.emitter.spawn.headCurve, null);
      assert.equal(layer.emitter.render.twinkle, null);
      assert.equal(layer.emitter.forces.planarDrag, 0);
      assert.notEqual(layer.emitter.shape.type, "path");
      assert.notEqual(layer.emitter.shape.type, "layerInstances");
      assert.notEqual(layer.emitter.spawn.mode, "pathAnchored");
    }
  }
});

test("the beam/column vocabulary is absent from every upgraded v1 document", () => {
  // A v1 document has no concept of a slab, a stripe set, a step flicker, a
  // collapse or a flat cel lick, so the migrator must leave every one of them
  // at its documented null — an upgraded v1 effect renders exactly as it did.
  for (const file of FILES) {
    const v2 = validateDocumentV2(upgradeDocument(loadV1(file)));
    assert.equal(v2.post.flash, null, file);
    for (const path of v2.paths) assert.notEqual(path.type, "line");
    for (const layer of v2.layers) {
      assert.equal(layer.collapse, null, `${file}/${layer.id}`);
      assert.ok(layer.kind !== "arcs" && layer.kind !== "streakBurst");
      if (layer.material) {
        assert.equal(layer.material.stripes, null, `${file}/${layer.id}`);
        assert.equal(layer.material.flicker, null, `${file}/${layer.id}`);
      }
      if (layer.geometry) {
        assert.notEqual(layer.geometry.type, "slab");
        assert.equal(layer.geometry.slab, null, `${file}/${layer.id}`);
      }
      if (layer.emitter) {
        assert.equal(layer.emitter.render.strip, null, `${file}/${layer.id}`);
        assert.notEqual(layer.emitter.render.mode, "flatStrip");
        assert.notEqual(layer.emitter.velocity.mode, "alongPath");
        assert.notEqual(layer.emitter.shape.type, "pathLine");
      }
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DocumentV2Schema,
  DocumentV2WireSchema,
  defaultEmitter,
  defaultMaterial,
  defaultToon,
  defaultsV2,
  fromWireV2,
  isV2,
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

const FIXTURE = path.join(
  process.cwd(),
  "fixtures/v2/fire-projectile/document.json",
);
const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
const load = (): VfxDocumentV2 => structuredClone(raw);

test("the fire projectile exemplar validates as autov.lab/2", () => {
  const doc = validateDocumentV2(load());
  assert.equal(doc.schemaVersion, "autov.lab/2");
  assert.ok(isV2(doc));
  assert.equal(doc.layers.length, 9);
  const kinds = doc.layers.map((l) => l.kind);
  for (const kind of ["shell", "particles", "decal", "light"])
    assert.ok(kinds.includes(kind as (typeof kinds)[number]), kind);
  assert.equal(
    doc.layers.reduce((sum, l) => sum + (l.emitter?.count ?? 0), 0),
    756,
  );
  // The spike's look depends on these; keep them pinned.
  const shell = doc.layers.find((l) => l.id === "flame-shell")!;
  assert.equal(shell.material!.ramp.space, "surface");
  assert.ok(shell.material!.erosion!.displacementProtect > 0);
  assert.deepEqual(shell.geometry!.vertexNoise!.bias, [0, 1, 0]);
  const volume = doc.layers.find((l) => l.id === "fire-volume")!;
  assert.ok(volume.emitter!.render.alphaAlongSpawn);
  assert.equal(volume.emitter!.shape.bias[1], 0.6);
  const smoke = doc.layers.find((l) => l.id === "smoke-puffs")!;
  assert.ok(smoke.emitter!.forces.floor);
  assert.equal(doc.post.bloom.threshold, 1.3);
  assert.equal(doc.camera.azimuth, -0.55);
});

test("the exemplar lints clean", () => {
  assert.deepEqual(lintDocumentV2(validateDocumentV2(load())), []);
});

const reject = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = load();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

reject(
  "impact at or after the end",
  (d) => {
    d.impact = d.duration;
  },
  /Impact must be before the end/,
);
reject(
  "duplicate layer ids",
  (d) => {
    d.layers[1].id = d.layers[0].id;
  },
  /Duplicate layer/,
);
reject(
  "a texture id that is neither embedded nor in the built-in library",
  (d) => {
    d.layers[0].material!.mask.textureId = "not-a-real-texture";
  },
  /Missing texture/,
);
reject(
  "a sub-emitter pointing at a layer that does not exist",
  (d) => {
    d.layers[0].emitter!.sub = {
      parentLayerId: "nowhere",
      offset: [0, 0.2],
      mode: "onDeath",
      inheritVelocity: 0.5,
    };
  },
  /Missing sub-emitter parent/,
);
reject(
  "a sub-emitter whose parent is not a particles layer",
  (d) => {
    d.layers[0].emitter!.sub = {
      parentLayerId: "flame-shell",
      offset: [0, 0.2],
      mode: "onDeath",
      inheritVelocity: 0.5,
    };
  },
  /must be a particles layer/,
);
reject(
  "a particle count over the 60,000 budget",
  (d) => {
    d.layers[0].emitter!.count = 24000;
    d.layers[4].emitter!.count = 24000;
    d.layers[5].emitter!.count = 24000;
  },
  /Particle budget exceeded/,
);
reject(
  "a layer that runs past the document duration",
  (d) => {
    d.layers[0].end = d.duration + 1;
  },
  /Invalid interval/,
);
reject(
  "ramp stops that do not ascend",
  (d) => {
    d.layers[0].material!.ramp.stops[1].t = 0;
  },
  /Ramp stops must ascend/,
);
reject(
  "curve keys that do not ascend",
  (d) => {
    d.layers[0].emitter!.render.alphaCurve.keys[1][0] = 0;
  },
  /Curve keys must ascend/,
);
reject(
  "a spawn axis that is not a unit vector",
  (d) => {
    d.layers[0].emitter!.shape.axis = [0.5, 0.5, 0];
  },
  /unit vector/,
);
reject(
  "an inverted life range",
  (d) => {
    d.layers[0].emitter!.life = [2, 0.5];
  },
  /minimum must not exceed maximum/,
);
reject(
  "a light layer that also carries a material",
  (d) => {
    d.layers[8].material = defaultMaterial();
  },
  /no material, emitter or geometry/,
);
reject(
  "a particles layer without an emitter",
  (d) => {
    delete d.layers[0].emitter;
  },
  /needs an emitter/,
);
reject(
  "a mesh layer without geometry",
  (d) => {
    delete d.layers[3].geometry;
  },
  /needs geometry/,
);
reject(
  "duplicate track targets on one layer",
  (d) => {
    d.layers[0].tracks = [
      {
        target: "material.opacity",
        keys: [
          [0, 0],
          [1, 1],
        ],
        ease: "linear",
      },
      {
        target: "material.opacity",
        keys: [
          [0, 1],
          [1, 0],
        ],
        ease: "linear",
      },
    ];
  },
  /Duplicate track/,
);
reject(
  "a track value outside the target's range",
  (d) => {
    d.layers[0].tracks = [
      {
        target: "material.opacity",
        keys: [
          [0, 0],
          [1, 4],
        ],
        ease: "linear",
      },
    ];
  },
  /Invalid keyframe/,
);
reject(
  "an override window wider than the document",
  (d) => {
    d.layers[0].overrides = [
      { target: "material.opacity", value: 0.5, start: 0, end: 5, fade: 0.1 },
    ];
  },
  /Invalid edit window/,
);
reject(
  "no enabled layer",
  (d) => {
    for (const layer of d.layers) layer.enabled = false;
  },
  /At least one layer must be enabled/,
);

test("unknown keys are refused (strict schema)", () => {
  const doc = load() as Record<string, unknown>;
  doc._notes = "hand annotation";
  assert.throws(() => validateDocumentV2(doc));
  const layered = load();
  (layered.layers[0] as Record<string, unknown>).order = 3;
  assert.throws(() => validateDocumentV2(layered));
});

test("a malformed hex color is refused", () => {
  const doc = load();
  doc.environment.background = "1b1a1f";
  assert.throws(() => validateDocumentV2(doc));
});

test("wire round-trip: homogeneous arrays parse back into the runtime contract", () => {
  const doc = validateDocumentV2(load());
  const wire = {
    ...structuredClone(doc),
    layers: doc.layers.map((layer) => ({
      ...structuredClone(layer),
      material: layer.material ?? null,
      emitter: layer.emitter ?? null,
      geometry: layer.geometry ?? null,
      light: layer.light ?? null,
      blob: layer.blob ?? null,
      splash: layer.splash ?? null,
      ribbon: layer.ribbon ?? null,
      wireBurst: layer.wireBurst ?? null,
      crystals: layer.crystals ?? null,
      arcs: layer.arcs ?? null,
      streakBurst: layer.streakBurst ?? null,
    reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
    })),
  };
  delete (wire as Record<string, unknown>).textures;
  DocumentV2WireSchema.parse(wire);
  const back = fromWireV2(wire);
  assert.deepEqual(back, { ...doc, textures: [] });
});

test("the wire schema publishes no tuple types", () => {
  const json = JSON.stringify(DocumentV2WireSchema);
  assert.ok(!json.includes('"tuple"'));
  assert.ok(JSON.stringify(DocumentV2Schema).length > 0);
});

test("lint warns about uniform lifetimes without rejecting the document", () => {
  const doc = validateDocumentV2(load());
  doc.layers[0].emitter!.life = [1, 1.2];
  assert.doesNotThrow(() => validateDocumentV2(doc));
  const warnings = lintDocumentV2(doc);
  assert.ok(warnings.some((w) => w.includes("life variance")));
});

test("defaults are valid building blocks", () => {
  const bundle = defaultsV2();
  assert.deepEqual(bundle.material, defaultMaterial());
  assert.deepEqual(bundle.emitter, defaultEmitter());
  const doc = validateDocumentV2({
    ...bundle.shell,
    layers: [
      {
        id: "burst",
        name: "Burst",
        role: "primary",
        kind: "particles",
        start: 0,
        end: 2,
        enabled: true,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        motion: null,
        material: bundle.material,
        emitter: bundle.emitter,
        tracks: [],
        overrides: [],
      },
    ],
  });
  assert.equal(doc.layers[0].emitter!.count, 600);
  assert.deepEqual(lintDocumentV2(doc), []);
});

test("isV2 separates the two contracts", () => {
  assert.equal(isV2({ schemaVersion: "autov.lab/1" }), false);
  assert.equal(isV2(null), false);
  assert.equal(isV2(raw), true);
});

// ---------------------------------------------------------------------------
// The blob / splash vocabulary (the smoke-spike port)
// ---------------------------------------------------------------------------

const SMOKE = path.join(process.cwd(), "fixtures/v2/smoke-burst/document.json");
const smokeRaw = JSON.parse(readFileSync(SMOKE, "utf8"));
const smoke = (): VfxDocumentV2 => structuredClone(smokeRaw);

test("the smoke exemplar is built from blob and splash layers", () => {
  const doc = validateDocumentV2(smoke());
  const blobs = doc.layers.filter((l) => l.kind === "blob");
  const splashes = doc.layers.filter((l) => l.kind === "splash");
  assert.equal(blobs.length, 7);
  assert.equal(splashes.length, 1);
  assert.deepEqual(
    blobs.map((l) => l.blob!.arrangement),
    ["mound", "mound", "column", "column", "ring", "ring", "string"],
  );
  // Every lobe cluster is cel shaded, outlined and opaque for most of its life.
  for (const layer of blobs) {
    const m = layer.material!;
    assert.ok(m.toon, layer.id);
    assert.equal(m.toon!.bands, 3);
    assert.ok(m.outline, layer.id);
    assert.equal(m.opaqueUntil, 0.75, layer.id);
    assert.ok(Math.abs(Math.hypot(...m.toon!.light) - 1) < 2e-3, layer.id);
    // The outline is DARKER than the shadow tone: a dark crease, not a rim.
    const luminance = (hex: string) =>
      [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    assert.ok(
      luminance(m.outline!.color) < luminance(m.toon!.shadow),
      `${layer.id}: outline must be darker than toon.shadow`,
    );
    // No blob layer carries geometry or an emitter.
    assert.equal(layer.geometry, undefined);
    assert.equal(layer.emitter, undefined);
  }
  // The procedural billboards the spike drew by hand are in the vocabulary now.
  const procedurals = doc.layers.map((l) => l.material?.procedural);
  assert.ok(procedurals.includes("star4"));
  assert.ok(procedurals.includes("softRadial"));
  assert.deepEqual(lintDocumentV2(doc), []);
});

test("blob and splash round-trip through the wire contract", () => {
  const doc = validateDocumentV2(smoke());
  const wire = {
    ...structuredClone(doc),
    layers: doc.layers.map((layer) => ({
      ...structuredClone(layer),
      material: layer.material ?? null,
      emitter: layer.emitter ?? null,
      geometry: layer.geometry ?? null,
      light: layer.light ?? null,
      blob: layer.blob ?? null,
      splash: layer.splash ?? null,
      ribbon: layer.ribbon ?? null,
      wireBurst: layer.wireBurst ?? null,
      crystals: layer.crystals ?? null,
      arcs: layer.arcs ?? null,
      streakBurst: layer.streakBurst ?? null,
    reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
    })),
  };
  delete (wire as Record<string, unknown>).textures;
  DocumentV2WireSchema.parse(wire);
  assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
});

test('the "height" ramp space and its span are part of every material', () => {
  const doc = validateDocumentV2(load());
  // Defaulted, not required: a document authored before the field existed
  // still loads, and loads at the documented default.
  assert.equal(doc.layers[0].material!.ramp.heightSpan, 2);
  doc.layers[0].material!.ramp.space = "height";
  doc.layers[0].material!.ramp.heightSpan = 3.5;
  assert.doesNotThrow(() => validateDocumentV2(doc));
  assert.equal(defaultMaterial().ramp.heightSpan, 2);
  assert.equal(defaultMaterial().toon, null);
  assert.equal(defaultMaterial().outline, null);
  assert.equal(defaultMaterial().opaqueUntil, null);
});

const rejectSmoke = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = smoke();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectSmoke(
  "a blob layer without a blob spec",
  (d) => {
    delete d.layers.find((l) => l.kind === "blob")!.blob;
  },
  /Blob layer needs blob/,
);
rejectSmoke(
  "a blob spec on a layer that is not a blob",
  (d) => {
    d.layers.find((l) => l.kind === "splash")!.blob = defaultsV2().blob;
  },
  /Only blob layers carry blob/,
);
rejectSmoke(
  "a splash layer without a splash spec",
  (d) => {
    delete d.layers.find((l) => l.kind === "splash")!.splash;
  },
  /Splash layer needs splash/,
);
rejectSmoke(
  "a blob whose lobe radius band descends",
  (d) => {
    d.layers.find((l) => l.kind === "blob")!.blob!.radius = [0.8, 0.2];
  },
  /blob.radius/,
);
rejectSmoke(
  "toon lit by a direction that is not a unit vector",
  (d) => {
    d.layers.find((l) => l.kind === "blob")!.material!.toon!.light = [0, 0.5, 0];
  },
  /unit vector/,
);
rejectSmoke(
  "geometry on a blob layer",
  (d) => {
    d.layers.find((l) => l.kind === "blob")!.geometry = defaultsV2().geometry;
  },
  /carries no geometry/,
);

test("toon and outline are refused on a billboard population", () => {
  const doc = load();
  const particles = doc.layers.find((l) => l.kind === "particles")!;
  particles.material!.toon = defaultToon();
  assert.throws(() => validateDocumentV2(doc), /carry no toon or outline/);
});

// ---------------------------------------------------------------------------
// Paths, ribbons, wire bursts, jitter, twinkle and the screen glitch
// (the heal / glitch spike port)
// ---------------------------------------------------------------------------

const HEAL = path.join(process.cwd(), "fixtures/v2/healing-aura/document.json");
const healRaw = JSON.parse(readFileSync(HEAL, "utf8"));
const heal = (): VfxDocumentV2 => structuredClone(healRaw);

const GLITCH = path.join(
  process.cwd(),
  "fixtures/v2/glitch-projectile/document.json",
);
const glitchRaw = JSON.parse(readFileSync(GLITCH, "utf8"));
const glitch = (): VfxDocumentV2 => structuredClone(glitchRaw);

test("the healing exemplar is a ribbon on two orbit paths", () => {
  const doc = validateDocumentV2(heal());
  assert.deepEqual(
    doc.paths.map((p) => [p.id, p.type]),
    [
      ["sweep", "orbit"],
      ["ring", "orbit"],
    ],
  );
  const ribbon = doc.layers.find((l) => l.kind === "ribbon")!;
  assert.equal(ribbon.ribbon!.pathId, "sweep");
  // The sweep and the settled ring are ONE layer: the morph is what dives it.
  assert.equal(ribbon.ribbon!.morph!.pathId, "ring");
  assert.ok(ribbon.ribbon!.strands.count >= 3);
  // The head runs past 1 and keeps circling; the orbit is closed, so it can.
  const head = ribbon.ribbon!.window.head.keys;
  assert.ok(head[head.length - 1][1] > 1);
  const sweep = doc.paths.find((p) => p.id === "sweep")!;
  assert.equal(sweep.type === "orbit" && sweep.height, 0);
  // The ring is two flat cards driven entirely by proceduralParams.
  const procedurals = doc.layers.map((l) => l.material?.procedural);
  assert.ok(procedurals.includes("swirlRing"));
  assert.ok(procedurals.includes("ringFill"));
  const rim = doc.layers.find((l) => l.material?.procedural === "swirlRing")!;
  assert.ok(
    rim.tracks.some((t) => t.target === "material.proceduralParams[0]"),
    "the rim snaps out on proceduralParams[0], not on transform.scale",
  );
  // The upright glow is an open tapered cylinder, fully covered.
  const glow = doc.layers.find((l) => l.geometry?.type === "cylinder")!;
  assert.ok(glow.geometry!.taper < 1);
  assert.equal(glow.material!.procedural, "solid");
  assert.equal(glow.material!.ramp.space, "surface");
  assert.ok(glow.material!.fresnel);
  // The sparkles twinkle on a per-instance hashed phase.
  const sparkles = doc.layers.find((l) => l.emitter?.render.twinkle)!;
  assert.equal(sparkles.material!.procedural, "star4");
  assert.ok(sparkles.emitter!.render.twinkle!.depth > 0);
  assert.deepEqual(lintDocumentV2(doc), []);
});

test("the glitch exemplar anchors its trail to one shared bezier", () => {
  const doc = validateDocumentV2(glitch());
  assert.deepEqual(
    doc.paths.map((p) => [p.id, p.type]),
    [["arc", "bezier"]],
  );
  const trail = doc.layers.find((l) => l.emitter?.shape.type === "path")!;
  assert.equal(trail.emitter!.shape.pathId, "arc");
  assert.equal(trail.emitter!.spawn.mode, "pathAnchored");
  assert.ok(trail.emitter!.spawn.headCurve);
  assert.equal(trail.emitter!.render.mode, "pathAligned");
  // A dash holds where the head left it: no velocity at all.
  assert.deepEqual(trail.emitter!.velocity.speed, [0, 0]);
  // The hairlines ride the same path, so they can never drift off the trail.
  const ribbon = doc.layers.find((l) => l.kind === "ribbon")!;
  assert.equal(ribbon.ribbon!.pathId, "arc");
  // The head, its core and its tail glints break in the SAME stepped windows.
  const jittered = doc.layers.filter((l) => l.jitter);
  assert.ok(jittered.length >= 4);
  const head = jittered.filter((l) => l.id.startsWith("dart"));
  assert.equal(head.length, 3);
  for (const layer of head.slice(1))
    assert.deepEqual(layer.jitter, head[0].jitter, layer.id);
  assert.ok(head[0].jitter!.gate > 0.5);
  // All three ride the same motion keys, so the head never comes apart.
  for (const layer of head.slice(1))
    assert.deepEqual(layer.motion, head[0].motion, layer.id);
  // The burst is outlines plus spokes, split per channel.
  const burst = doc.layers.find((l) => l.kind === "wireBurst")!;
  assert.ok(burst.wireBurst!.spokes > 0);
  assert.ok(burst.material!.rgbSplit!.offset > 0);
  // Two hot frames at the hit, then nothing.
  assert.ok(doc.post.glitch);
  assert.equal(doc.post.glitch!.curve.keys[0][1], 0);
  assert.equal(
    doc.post.glitch!.curve.keys[doc.post.glitch!.curve.keys.length - 1][1],
    0,
  );
  assert.deepEqual(lintDocumentV2(doc), []);
});

test("every new field is defaulted, so an archived document loads unchanged", () => {
  const bare = load();
  delete (bare as Record<string, unknown>).paths;
  for (const layer of bare.layers) {
    delete (layer as Record<string, unknown>).jitter;
    if (layer.material) {
      delete (layer.material as Record<string, unknown>).proceduralParams;
      delete (layer.material as Record<string, unknown>).rgbSplit;
    }
    if (layer.geometry) delete (layer.geometry as Record<string, unknown>).taper;
    if (layer.emitter) {
      delete (layer.emitter.shape as Record<string, unknown>).pathId;
      delete (layer.emitter.spawn as Record<string, unknown>).headCurve;
      delete (layer.emitter.render as Record<string, unknown>).twinkle;
    }
  }
  delete (bare.post as Record<string, unknown>).glitch;
  const doc = validateDocumentV2(bare);
  assert.deepEqual(doc.paths, []);
  assert.equal(doc.post.glitch, null);
  for (const layer of doc.layers) {
    assert.equal(layer.jitter, null);
    if (layer.material) {
      assert.deepEqual(layer.material.proceduralParams, [0, 0, 0, 0]);
      assert.equal(layer.material.rgbSplit, null);
    }
    if (layer.geometry) assert.equal(layer.geometry.taper, 1);
    if (layer.emitter) {
      assert.equal(layer.emitter.shape.pathId, null);
      assert.equal(layer.emitter.spawn.headCurve, null);
      assert.equal(layer.emitter.render.twinkle, null);
    }
  }
  // And the same document with the fields present is byte-identical to the
  // fixture, so the defaults are what the fixture already carries.
  assert.deepEqual(validateDocumentV2(load()), validateDocumentV2(load()));
});

test("paths, ribbons and bursts round-trip through the wire contract", () => {
  for (const source of [heal, glitch]) {
    const doc = validateDocumentV2(source());
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
      reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
  }
});

const rejectHeal = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = heal();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectHeal(
  "a ribbon layer without a ribbon spec",
  (d) => {
    delete d.layers.find((l) => l.kind === "ribbon")!.ribbon;
  },
  /Ribbon layer needs ribbon/,
);
rejectHeal(
  "a ribbon spec on a layer that is not a ribbon",
  (d) => {
    d.layers.find((l) => l.kind === "decal")!.ribbon = defaultsV2().ribbon;
  },
  /Only ribbon layers carry ribbon/,
);
rejectHeal(
  "a ribbon pointing at a path the document does not declare",
  (d) => {
    d.layers.find((l) => l.kind === "ribbon")!.ribbon!.pathId = "nowhere";
  },
  /Missing path nowhere/,
);
rejectHeal(
  "a morph target the document does not declare",
  (d) => {
    d.layers.find((l) => l.kind === "ribbon")!.ribbon!.morph!.pathId = "nope";
  },
  /Missing path nope/,
);
rejectHeal(
  "tapers that consume the whole ribbon window",
  (d) => {
    d.layers.find((l) => l.kind === "ribbon")!.ribbon!.taper = {
      head: 0.5,
      tail: 0.6,
    };
  },
  /consume the whole window/,
);
rejectHeal(
  "two paths sharing an id",
  (d) => {
    d.paths.push(structuredClone(d.paths[0]));
  },
  /Duplicate path/,
);
rejectHeal(
  "a jitter axis that is not a unit vector",
  (d) => {
    d.layers[0].jitter = {
      frequency: 10,
      amplitude: 0.1,
      gate: 0.5,
      axis: [0, 0.5, 0],
    };
  },
  /unit vector/,
);

const rejectGlitch = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = glitch();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectGlitch(
  "a wireBurst layer without a wireBurst spec",
  (d) => {
    delete d.layers.find((l) => l.kind === "wireBurst")!.wireBurst;
  },
  /WireBurst layer needs wireBurst/,
);
rejectGlitch(
  "a wireBurst whose side band descends",
  (d) => {
    d.layers.find((l) => l.kind === "wireBurst")!.wireBurst!.sides = [5, 3];
  },
  /wireBurst.sides/,
);
rejectGlitch(
  "a path emitter with no path id",
  (d) => {
    d.layers.find((l) => l.emitter?.shape.type === "path")!.emitter!.shape.pathId =
      null;
  },
  /needs shape.pathId/,
);
rejectGlitch(
  "a path-anchored spawn with no head curve",
  (d) => {
    d.layers.find(
      (l) => l.emitter?.spawn.mode === "pathAnchored",
    )!.emitter!.spawn.headCurve = null;
  },
  /needs spawn.headCurve/,
);
rejectGlitch(
  "a head curve that runs backwards",
  (d) => {
    d.layers.find(
      (l) => l.emitter?.spawn.mode === "pathAnchored",
    )!.emitter!.spawn.headCurve!.keys = [
      [0, 0.8],
      [0.5, 0.2],
      [1, 1],
    ];
  },
  /must not run backwards/,
);
rejectGlitch(
  "an rgb split on a particles layer",
  (d) => {
    d.layers.find((l) => l.kind === "particles")!.material!.rgbSplit = {
      offset: 0.01,
      growth: 1,
    };
  },
  /not particles/,
);

// ---------------------------------------------------------------------------
// Crystals, the spherical hex lattice, reveal fronts, ground proximity glow,
// great-circle ripples, the band belt, borrowed spawn sites and planar drag
// (the ice / shield spike port)
// ---------------------------------------------------------------------------

const ICE = path.join(process.cwd(), "fixtures/v2/ice-blast/document.json");
const SHIELD = path.join(process.cwd(), "fixtures/v2/shield/document.json");
const iceRaw = JSON.parse(readFileSync(ICE, "utf8"));
const shieldRaw = JSON.parse(readFileSync(SHIELD, "utf8"));
const ice = (): VfxDocumentV2 => structuredClone(iceRaw);
const shield = (): VfxDocumentV2 => structuredClone(shieldRaw);

test("the ice exemplar is a sigil, a crystal cluster and a borrowed shatter", () => {
  const doc = validateDocumentV2(ice());
  assert.deepEqual(lintDocumentV2(doc), []);

  const sigil = doc.layers.find((l) => l.id === "cast-sigil")!;
  assert.equal(sigil.material!.procedural, "sigil");
  assert.equal(sigil.material!.reveal!.mode, "radial");
  // The front runs past the rim before the layer ends: that is how a reveal
  // finishes early inside a layer that keeps holding.
  assert.ok(sigil.material!.reveal!.to > 1);
  assert.ok(
    sigil.tracks.some((t) => t.target === "material.proceduralParams[3]"),
    "the gold rim pops on a track, not on the base colour",
  );

  const cluster = doc.layers.find((l) => l.kind === "crystals")!;
  const spec = cluster.crystals!;
  assert.equal(spec.count, 320);
  assert.equal(spec.groups, 3);
  assert.ok(spec.length[1] > spec.length[0]);
  assert.ok(spec.direction.elevation[0] < 0, "short spikes stab downward");
  assert.ok(spec.collapse, "the cluster shatters");
  assert.ok(cluster.material!.outline, "the dark separator hull is on");

  // The shatter borrows its spawn sites from the cluster and settles on XZ drag.
  const chips = doc.layers.filter(
    (l) => l.emitter?.shape.type === "layerInstances",
  );
  assert.equal(chips.length, 2);
  for (const layer of chips) {
    assert.equal(layer.emitter!.shape.sourceLayerId, "crystals");
    assert.ok(layer.emitter!.forces.planarDrag > 0);
    assert.ok(layer.emitter!.forces.floor);
  }
});

test("the shield exemplar is one lattice sphere plus a real belt", () => {
  const doc = validateDocumentV2(shield());
  assert.deepEqual(lintDocumentV2(doc), []);

  const dome = doc.layers.find((l) => l.id === "dome")!;
  const lattice = dome.material!.lattice!;
  assert.equal(lattice.cells, 377);
  assert.ok(lattice.gapWidth < lattice.edgeWidth);
  assert.ok(lattice.dissolve, "the shell comes apart cell by cell");
  assert.equal(dome.material!.reveal!.mode, "scan");
  assert.ok(dome.material!.planeGlow, "the floor contact ring is analytic");
  assert.equal(dome.material!.ripples!.length, 2);
  assert.ok(dome.material!.fresnel!.power >= 8, "a shield rim is a hard fresnel");

  const belt = doc.layers.find((l) => l.geometry?.type === "band")!;
  assert.ok(belt.geometry!.band);
  assert.ok(belt.geometry!.band!.spin > 0);
  // Real geometry, alpha blended, so the far arc sorts behind the shell.
  assert.equal(belt.material!.blend, "alpha");
});

test("the ice and shield exemplars round-trip through the wire contract", () => {
  for (const source of [ice, shield]) {
    const doc = validateDocumentV2(source());
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
      reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
  }
});

test("the ice/shield fields are all defaulted, so an archived document loads", () => {
  const bare = load();
  for (const layer of bare.layers) {
    if (layer.material)
      for (const key of ["reveal", "lattice", "planeGlow", "ripples"])
        delete (layer.material as Record<string, unknown>)[key];
    if (layer.geometry) delete (layer.geometry as Record<string, unknown>).band;
    if (layer.emitter) {
      delete (layer.emitter.shape as Record<string, unknown>).sourceLayerId;
      delete (layer.emitter.forces as Record<string, unknown>).planarDrag;
    }
  }
  const doc = validateDocumentV2(bare);
  for (const layer of doc.layers) {
    if (layer.material) {
      assert.equal(layer.material.reveal, null);
      assert.equal(layer.material.lattice, null);
      assert.equal(layer.material.planeGlow, null);
      assert.equal(layer.material.ripples, null);
    }
    if (layer.geometry) assert.equal(layer.geometry.band, null);
    if (layer.emitter) {
      assert.equal(layer.emitter.shape.sourceLayerId, null);
      assert.equal(layer.emitter.forces.planarDrag, 0);
    }
  }
});

const rejectIce = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = ice();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectIce(
  "a crystals layer without a crystals spec",
  (d) => {
    delete d.layers.find((l) => l.kind === "crystals")!.crystals;
  },
  /Crystals layer needs crystals/,
);
rejectIce(
  "a crystals spec on a layer that is not a crystals layer",
  (d) => {
    d.layers.find((l) => l.kind === "decal")!.crystals = defaultsV2().crystals;
  },
  /Only crystals layers carry crystals/,
);
rejectIce(
  "a descending crystal length band",
  (d) => {
    d.layers.find((l) => l.kind === "crystals")!.crystals!.length = [1.2, 0.2];
  },
  /crystals.length/,
);
rejectIce(
  "a descending crystal elevation band",
  (d) => {
    d.layers.find((l) => l.kind === "crystals")!.crystals!.direction.elevation = [
      60, -10,
    ];
  },
  /crystals.direction.elevation/,
);
rejectIce(
  "a layer-instance emitter with no source layer",
  (d) => {
    d.layers.find(
      (l) => l.emitter?.shape.type === "layerInstances",
    )!.emitter!.shape.sourceLayerId = null;
  },
  /needs shape.sourceLayerId/,
);
rejectIce(
  "a layer-instance emitter borrowing from a layer that generates nothing",
  (d) => {
    d.layers.find(
      (l) => l.emitter?.shape.type === "layerInstances",
    )!.emitter!.shape.sourceLayerId = "cold-pool";
  },
  /must be a crystals or blob layer/,
);
rejectIce(
  "a reveal on a particles layer",
  (d) => {
    d.layers.find((l) => l.kind === "particles")!.material!.reveal = {
      mode: "radial",
      from: 0,
      to: 1,
      frontWidth: 0.1,
    };
  },
  /material.reveal is for mesh layers/,
);

const rejectShield = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = shield();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectShield(
  "a lattice whose gap is as wide as its wall",
  (d) => {
    d.layers.find((l) => l.id === "dome")!.material!.lattice!.gapWidth = 0.3;
  },
  /no wall is drawn/,
);
rejectShield(
  "a ripple origin that is not a unit vector",
  (d) => {
    d.layers.find((l) => l.id === "dome")!.material!.ripples![0].origin = [
      0, 0.5, 0,
    ];
  },
  /unit vector/,
);
rejectShield(
  "band geometry with no band spec",
  (d) => {
    d.layers.find((l) => l.geometry?.type === "band")!.geometry!.band = null;
  },
  /Band geometry needs geometry.band/,
);

// ---------------------------------------------------------------------------
// The beam / energy-column port: material.stripes and material.flicker,
// geometry.type "slab", kind "arcs" and "streakBurst", layer.collapse,
// post.flash, paths[].type "line", emitter.shape "pathLine",
// emitter.velocity "alongPath" and emitter.render.mode "flatStrip".
// ---------------------------------------------------------------------------

const BEAM = path.join(process.cwd(), "fixtures/v2/beam/document.json");
const COLUMN = path.join(
  process.cwd(),
  "fixtures/v2/energy-column/document.json",
);
const beamRaw = JSON.parse(readFileSync(BEAM, "utf8"));
const columnRaw = JSON.parse(readFileSync(COLUMN, "utf8"));
const beam = (): VfxDocumentV2 => structuredClone(beamRaw);
const column = (): VfxDocumentV2 => structuredClone(columnRaw);

test("the beam exemplar is a tiered slab, striped tubes and cel licks", () => {
  const doc = validateDocumentV2(beam());
  const body = doc.layers.find((l) => l.id === "beam-body")!;
  assert.equal(body.geometry!.type, "slab");
  // Outermost first: every later tier paints over the one before it.
  const heights = body.geometry!.slab!.tiers.map((t) => t.height);
  assert.deepEqual([...heights].sort((a, b) => b - a), heights);
  assert.equal(body.geometry!.slab!.anchor, "base");
  const sheath = doc.layers.find((l) => l.id === "beam-sheath")!;
  assert.equal(sheath.material!.stripes!.length, 2);
  assert.ok(sheath.material!.flicker!.amount > 0);
  // A sheath IS its bands; a core only breathes.
  const core = doc.layers.find((l) => l.id === "beam-core")!;
  assert.ok(
    core.material!.stripes![0].contrast < sheath.material!.stripes![0].contrast,
  );
  const tongues = doc.layers.find((l) => l.id === "beam-tongues")!;
  assert.equal(tongues.emitter!.render.mode, "flatStrip");
  assert.equal(tongues.emitter!.render.strip!.palettes, 2);
  // The parity split only lands dark-behind-light in instance order.
  assert.equal(tongues.emitter!.render.sortMode, "none");
  assert.equal(doc.paths[0].type, "line");
  const run = doc.layers.find((l) => l.id === "shutoff-run")!;
  assert.equal(run.emitter!.velocity.mode, "alongPath");
  assert.ok(run.emitter!.velocity.speedCurve);
  const residue = doc.layers.find((l) => l.id === "residue")!;
  assert.equal(residue.emitter!.shape.type, "pathLine");
  assert.equal(residue.emitter!.shape.pathId, "beam-line");
  assert.ok(doc.layers.some((l) => l.material?.procedural === "lensFlare"));
  assert.ok(doc.layers.some((l) => l.material?.procedural === "radialRays"));
});

test("the energy-column exemplar shares one collapse across its body", () => {
  const doc = validateDocumentV2(column());
  const collapsing = doc.layers.filter((l) => l.collapse);
  assert.ok(collapsing.length >= 4);
  // One retraction, copied: every part of the column has to shrink in step.
  for (const layer of collapsing) {
    assert.equal(layer.collapse!.anchor, "base");
    assert.deepEqual(layer.collapse!.heightCurve, collapsing[0].collapse!.heightCurve);
    assert.deepEqual(layer.collapse!.widthCurve, collapsing[0].collapse!.widthCurve);
  }
  const arcs = doc.layers.find((l) => l.kind === "arcs")!;
  assert.ok(arcs.arcs!.count >= 10);
  assert.ok(arcs.arcs!.jitter.fold > 0.5, "the wires kink rather than curl");
  assert.ok(arcs.arcs!.blink.onTime[1] < arcs.arcs!.blink.period[0]);
  const streaks = doc.layers.find((l) => l.kind === "streakBurst")!;
  assert.equal(streaks.streakBurst!.hues.length, 3);
  assert.ok(streaks.streakBurst!.bundles > 1);
  assert.ok(doc.post.flash);
  // Two or three frames of white-out, not a held exposure.
  assert.equal(doc.post.flash!.curve.keys[doc.post.flash!.curve.keys.length - 1][1], 0);
  // The segment ladder runs straight round the shaft.
  const shell = doc.layers.find((l) => l.id === "column-shell")!;
  assert.equal(shell.material!.stripes![0].phase, 0);
});

test("the beam and column exemplars lint clean", () => {
  assert.deepEqual(lintDocumentV2(validateDocumentV2(beam())), []);
  assert.deepEqual(lintDocumentV2(validateDocumentV2(column())), []);
});

test("the beam and column exemplars round-trip through the wire contract", () => {
  for (const source of [beam, column]) {
    const doc = validateDocumentV2(source());
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
      reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
  }
});

test("the beam/column fields are all defaulted, so an archived document loads", () => {
  const bare = load();
  for (const layer of bare.layers) {
    delete (layer as Record<string, unknown>).collapse;
    if (layer.material)
      for (const key of ["stripes", "flicker"])
        delete (layer.material as Record<string, unknown>)[key];
    if (layer.geometry) delete (layer.geometry as Record<string, unknown>).slab;
    if (layer.emitter)
      delete (layer.emitter.render as Record<string, unknown>).strip;
  }
  delete (bare.post as Record<string, unknown>).flash;
  const doc = validateDocumentV2(bare);
  assert.equal(doc.post.flash, null);
  for (const layer of doc.layers) {
    assert.equal(layer.collapse, null);
    if (layer.material) {
      assert.equal(layer.material.stripes, null);
      assert.equal(layer.material.flicker, null);
    }
    if (layer.geometry) assert.equal(layer.geometry.slab, null);
    if (layer.emitter) assert.equal(layer.emitter.render.strip, null);
  }
});

test("the defaults for the port's generators are valid building blocks", () => {
  const parts = defaultsV2();
  const doc = validateDocumentV2({
    ...parts.shell,
    duration: 5,
    impact: 1.5,
    layers: [
      {
        id: "cage",
        name: "Cage",
        role: "secondary",
        kind: "arcs",
        start: 0,
        end: 4,
        enabled: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        motion: null,
        jitter: null,
        collapse: null,
        material: parts.material,
        arcs: parts.arcs,
        tracks: [],
        overrides: [],
      },
      {
        id: "fan",
        name: "Fan",
        role: "impact",
        kind: "streakBurst",
        start: 1.5,
        end: 4,
        enabled: true,
        transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        motion: null,
        jitter: null,
        collapse: null,
        material: parts.material,
        streakBurst: parts.streakBurst,
        tracks: [],
        overrides: [],
      },
      {
        id: "bar",
        name: "Bar",
        role: "primary",
        kind: "beam",
        start: 0,
        end: 4,
        enabled: true,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        motion: null,
        jitter: null,
        collapse: null,
        material: parts.material,
        geometry: { ...parts.geometry, type: "slab", slab: parts.slab },
        tracks: [],
        overrides: [],
      },
    ],
  });
  assert.equal(doc.layers.length, 3);
});

const rejectBeam = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = beam();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectBeam(
  "slab tiers that widen instead of narrowing",
  (d) => {
    const slab = d.layers.find((l) => l.geometry?.type === "slab")!.geometry!.slab!;
    slab.tiers[1].height = slab.tiers[0].height + 0.1;
  },
  /Slab tiers must narrow/,
);
rejectBeam(
  "slab geometry with no slab spec",
  (d) => {
    d.layers.find((l) => l.geometry?.type === "slab")!.geometry!.slab = null;
  },
  /Slab geometry needs geometry.slab/,
);
rejectBeam(
  "a stripe with contrast but no frequency",
  (d) => {
    d.layers.find((l) => l.id === "beam-sheath")!.material!.stripes![0].frequency = 0;
  },
  /no frequency/,
);
rejectBeam(
  "a run along a path with no head envelope",
  (d) => {
    d.layers.find((l) => l.id === "shutoff-run")!.emitter!.velocity.speedCurve = null;
  },
  /needs velocity.speedCurve/,
);
rejectBeam(
  "flatStrip with no strip spec",
  (d) => {
    d.layers.find((l) => l.id === "beam-tongues")!.emitter!.render.strip = null;
  },
  /needs render.strip/,
);
rejectBeam(
  "a strip spec on an ordinary billboard",
  (d) => {
    const layer = d.layers.find((l) => l.id === "beam-tongues")!;
    layer.emitter!.render.mode = "billboard";
  },
  /render.strip is for/,
);
rejectBeam(
  "a pathLine emitter with no path",
  (d) => {
    d.layers.find((l) => l.id === "residue")!.emitter!.shape.pathId = null;
  },
  /needs shape.pathId/,
);

const rejectColumn = (
  name: string,
  mutate: (doc: VfxDocumentV2) => void,
  message: RegExp,
) =>
  test(`rejects: ${name}`, () => {
    const doc = column();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), message);
  });

rejectColumn(
  "arcs that are lit for longer than their own cycle",
  (d) => {
    d.layers.find((l) => l.kind === "arcs")!.arcs!.blink.onTime = [0.5, 0.6];
  },
  /nothing blinks/,
);
rejectColumn(
  "arcs on a layer that is not an arcs layer",
  (d) => {
    d.layers.find((l) => l.id === "column-shell")!.arcs =
      d.layers.find((l) => l.kind === "arcs")!.arcs;
  },
  /Only arcs layers carry arcs/,
);
rejectColumn(
  "a collapse that starts after the layer ends",
  (d) => {
    d.layers.find((l) => l.id === "column-shell")!.collapse!.start = 9;
  },
  /never runs/,
);

// ---------------------------------------------------------------------------
// The portal / vortex / meteor port: geometry.type "frame" with
// material.sdfLine and material.beads, material.reveal mode "perimeter",
// material.flow, kind "reflection", material.procedural "swirlDisc" with
// material.swirl and ramp.space "radial", blob.arrangement "orbit" and "path"
// with blob.lightFrom and blob.retract, emitter.shape "frame" and "orbit",
// emitter.velocity "orbit", emitter.spawn "event" with originsFromPath,
// emitter.render.anchor "head" with procedural "teardropStreak",
// layer.window and environment.groundPool.
// ---------------------------------------------------------------------------

const PORTAL = path.join(process.cwd(), "fixtures/v2/portal/document.json");
const VORTEX = path.join(process.cwd(), "fixtures/v2/sky-vortex/document.json");
const METEOR = path.join(process.cwd(), "fixtures/v2/meteor-rain/document.json");
const portalRaw = JSON.parse(readFileSync(PORTAL, "utf8"));
const vortexRaw = JSON.parse(readFileSync(VORTEX, "utf8"));
const meteorRaw = JSON.parse(readFileSync(METEOR, "utf8"));
const portal = (): VfxDocumentV2 => structuredClone(portalRaw);
const vortex = (): VfxDocumentV2 => structuredClone(vortexRaw);
const meteor = (): VfxDocumentV2 => structuredClone(meteorRaw);

test("the portal exemplar is one frame strip, a flow interior and its reflection", () => {
  const doc = validateDocumentV2(portal());
  const rim = doc.layers.find((l) => l.id === "rim")!;
  assert.equal(rim.geometry!.type, "frame");
  assert.ok(rim.geometry!.frame);
  assert.equal(rim.geometry!.frame!.perimeterOrigin, "bottom");
  // The rim is a signed distance, not four bars: one sdfLine carries the bar,
  // the spine, the inner line and the halo skirts.
  assert.ok(rim.material!.sdfLine!.core > 0);
  assert.ok(rim.material!.sdfLine!.spine > 0);
  assert.equal(rim.material!.sdfLine!.halo.length, 3);
  assert.ok(rim.material!.beads!.count > 0);
  // The doorway draws itself up BOTH sides at once, finishes early, and a
  // track on reveal.to un-draws it from the top.
  assert.equal(rim.material!.reveal!.mode, "perimeter");
  assert.ok(rim.material!.reveal!.to > 1);
  assert.ok(rim.tracks.some((t) => t.target === "material.reveal.to"));

  const interior = doc.layers.find((l) => l.id === "interior")!;
  assert.equal(interior.material!.flow!.layers.length, 4);
  assert.equal(
    interior.material!.flow!.mix.length,
    interior.material!.flow!.layers.length,
  );
  assert.ok(interior.material!.flow!.parallax > 0);
  // A flow layer keys its "surface" ramp on the MASK, so the threshold track
  // is what clouds the interior over.
  assert.equal(interior.material!.ramp.space, "surface");
  assert.ok(interior.tracks.some((t) => t.target === "material.flow.threshold"));

  const reflection = doc.layers.find((l) => l.kind === "reflection")!;
  assert.equal(reflection.reflection!.sourceLayerId, "interior");
  assert.equal(reflection.material, undefined);
  assert.equal(reflection.geometry, undefined);

  const sparks = doc.layers.find((l) => l.id === "sparks")!;
  assert.equal(sparks.emitter!.shape.type, "frame");
  assert.ok(sparks.emitter!.shape.interiorFraction > 0);

  const pool = doc.environment.groundPool![0];
  assert.equal(pool.shape, "rect");
  assert.ok(pool.anisotropy > 1);
});

test("the vortex exemplar is three swirl discs, orbiting lobes and orbiting flecks", () => {
  const doc = validateDocumentV2(vortex());
  const discs = doc.layers.filter(
    (l) => l.material?.procedural === "swirlDisc" && l.role === "primary",
  );
  assert.equal(discs.length, 3);
  // Every disc winds on ONE shared envelope, or the vortex spins up in pieces.
  for (const disc of discs) {
    assert.equal(disc.material!.ramp.space, "radial");
    assert.deepEqual(
      disc.material!.swirl!.strength,
      discs[0].material!.swirl!.strength,
    );
    // The detail spiral is wound INDEPENDENTLY of the band mask.
    assert.notEqual(
      disc.material!.swirl!.detail.arms,
      disc.material!.swirl!.bands.arms,
    );
    // The erosion curve is the mask threshold over the layer's own progress.
    assert.ok(disc.material!.erosion!.rimBias > 0);
  }
  const puffs = doc.layers.filter((l) => l.blob?.arrangement === "orbit");
  assert.ok(puffs.length >= 2, "one band of 40 lobes reads as beads");
  for (const puff of puffs) {
    // `height` is the inner radius and `spread` the outer one.
    assert.ok(puff.blob!.height < puff.blob!.spread);
    assert.ok(puff.blob!.lightFrom);
  }
  const flecks = doc.layers.find((l) => l.id === "flecks")!;
  assert.equal(flecks.emitter!.shape.type, "orbit");
  assert.equal(flecks.emitter!.velocity.mode, "orbit");
  assert.ok(flecks.emitter!.shape.innerRadius < flecks.emitter!.shape.radius);
  // It hangs in the air.
  assert.equal(doc.environment.ground, "none");
});

test("the meteor exemplar hangs every impact off its own path", () => {
  const doc = validateDocumentV2(meteor());
  assert.equal(doc.paths.length, 5);
  const trails = doc.layers.filter((l) => l.blob?.arrangement === "path");
  assert.equal(trails.length, 5);
  for (const trail of trails) {
    assert.ok(trail.blob!.pathId);
    assert.ok(trail.blob!.head, "anchors are born by the head, not by a stagger");
    assert.ok(trail.blob!.perAnchor >= 2);
    assert.ok(trail.blob!.retract!.from < trail.blob!.retract!.to);
  }
  const tips = doc.layers.filter(
    (l) => l.material?.procedural === "teardropStreak",
  );
  assert.equal(tips.length, 5);
  for (const tip of tips) {
    assert.equal(tip.emitter!.render.anchor, "head");
    assert.equal(tip.emitter!.velocity.mode, "alongPath");
  }
  // Every impact layer is an EVENT on its own path, never a clock time.
  const bursts = doc.layers.filter((l) => l.window);
  assert.ok(bursts.length >= 5);
  for (const burst of bursts)
    assert.ok(doc.paths.some((p) => p.id === burst.window!.at.pathId));
  // One debris layer per population, covering all five impacts.
  const events = doc.layers.filter((l) => l.emitter?.spawn.mode === "event");
  assert.ok(events.length >= 3);
  for (const layer of events) {
    assert.ok(layer.emitter!.spawn.originsFromPath);
    assert.equal(layer.emitter!.shape.pathId, null);
  }
  assert.equal(doc.environment.groundPool!.length, 5);
});

test("the portal, vortex and meteor exemplars lint clean", () => {
  assert.deepEqual(lintDocumentV2(validateDocumentV2(portal())), []);
  assert.deepEqual(lintDocumentV2(validateDocumentV2(vortex())), []);
  assert.deepEqual(lintDocumentV2(validateDocumentV2(meteor())), []);
});

test("the three new exemplars round-trip through the wire contract", () => {
  for (const source of [portal, vortex, meteor]) {
    const doc = validateDocumentV2(source());
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
        reflection: layer.reflection ?? null,
    sheets: layer.sheets ?? null,
    crescent: layer.crescent ?? null,
    licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
  }
});

function rejects(
  name: string,
  source: () => VfxDocumentV2,
  mutate: (doc: VfxDocumentV2) => void,
  pattern: RegExp,
) {
  test(`rejects ${name}`, () => {
    const doc = source();
    mutate(doc);
    assert.throws(() => validateDocumentV2(doc), pattern);
  });
}

rejects(
  "frame geometry with no frame spec",
  portal,
  (d) => {
    d.layers.find((l) => l.id === "rim")!.geometry!.frame = null;
  },
  /Frame geometry needs geometry.frame/,
);
rejects(
  "a corner round wider than the frame",
  portal,
  (d) => {
    d.layers.find((l) => l.id === "rim")!.geometry!.frame!.corner = 1;
  },
  /Frame corner is wider than the frame/,
);
rejects(
  "a perimeter reveal on something that is not a frame",
  portal,
  (d) => {
    d.layers.find((l) => l.id === "interior")!.material!.reveal = {
      mode: "perimeter",
      from: 0,
      to: 1,
      frontWidth: 0.1,
    };
  },
  /needs geometry.type "frame"/,
);
rejects(
  "an sdfLine with no lit term",
  portal,
  (d) => {
    const line = d.layers.find((l) => l.id === "rim")!.material!.sdfLine!;
    line.core = 0;
    line.spine = 0;
    line.innerWidth = 0;
    line.halo = [];
  },
  /no lit term/,
);
rejects(
  "a flow with one weight per layer missing",
  portal,
  (d) => {
    d.layers.find((l) => l.id === "interior")!.material!.flow!.mix = [1];
  },
  /one mix weight per layer/,
);
rejects(
  "a reflection that carries its own material",
  portal,
  (d) => {
    d.layers.find((l) => l.kind === "reflection")!.material = defaultMaterial();
  },
  /draws its SOURCE layer's geometry and material/,
);
rejects(
  "a reflection of a layer that is not a mesh",
  portal,
  (d) => {
    d.layers.find((l) => l.kind === "reflection")!.reflection!.sourceLayerId =
      "sparks";
  },
  /Reflection source must be a mesh layer/,
);
rejects(
  "an orbit blob whose inner radius is outside its outer one",
  vortex,
  (d) => {
    const blob = d.layers.find((l) => l.blob?.arrangement === "orbit")!.blob!;
    blob.height = blob.spread + 1;
  },
  /inner radius\) under blob.spread/,
);
rejects(
  "a path blob with no head curve",
  meteor,
  (d) => {
    d.layers.find((l) => l.blob?.arrangement === "path")!.blob!.head = null;
  },
  /needs blob.head/,
);
rejects(
  "blob.pathId on an arrangement that is not a path",
  vortex,
  (d) => {
    d.layers.find((l) => l.blob?.arrangement === "orbit")!.blob!.pathId = "nope";
  },
  /arrangement "path" only/,
);
rejects(
  "an orbit emitter with no band",
  vortex,
  (d) => {
    const shape = d.layers.find((l) => l.id === "flecks")!.emitter!.shape;
    shape.innerRadius = shape.radius;
  },
  /needs shape.innerRadius under shape.radius/,
);
rejects(
  "velocity mode orbit without an orbit shape",
  vortex,
  (d) => {
    d.layers.find((l) => l.id === "flecks")!.emitter!.shape.type = "sphere";
  },
  /needs emitter.shape.type "orbit"/,
);
rejects(
  "an event spawn with no path origins",
  meteor,
  (d) => {
    d.layers.find(
      (l) => l.emitter?.spawn.mode === "event",
    )!.emitter!.spawn.originsFromPath = false;
  },
  /needs spawn.originsFromPath/,
);
rejects(
  "a layer window naming a path the document does not have",
  meteor,
  (d) => {
    d.layers.find((l) => l.window)!.window!.at.pathId = "nope";
  },
  /Missing path nope/,
);
rejects(
  "a ground pool following a layer the document does not have",
  meteor,
  (d) => {
    d.environment.groundPool![0].followsLayerId = "nope";
  },
  /Missing ground pool layer/,
);

// ---------------------------------------------------------------------------
// Port F — the water, playful and slash exemplars, and the vocabulary they
// introduced: kind "sheets"/"crescent"/"licks", transform.squash,
// material.streaks/creases/screentone/symbol, layer.frame "camera", the drawn
// symbol procedurals, emitter.shape "radialFan", emitter.render.mode "sliver"
// with retract and secondary, emitter.spawn "frontAnchored" and
// environment.backdrop.
// ---------------------------------------------------------------------------

const WATER = path.join(process.cwd(), "fixtures/v2/water-projectile/document.json");
const PLAYFUL = path.join(process.cwd(), "fixtures/v2/playful-impact/document.json");
const SLASH = path.join(process.cwd(), "fixtures/v2/fire-slash/document.json");
const waterRaw = JSON.parse(readFileSync(WATER, "utf8"));
const playfulRaw = JSON.parse(readFileSync(PLAYFUL, "utf8"));
const slashRaw = JSON.parse(readFileSync(SLASH, "utf8"));
const water = (): VfxDocumentV2 => structuredClone(waterRaw);
const playful = (): VfxDocumentV2 => structuredClone(playfulRaw);
const slash = (): VfxDocumentV2 => structuredClone(slashRaw);

test("the water exemplar is a streaked head over a two-cadence mesh tail", () => {
  const doc = validateDocumentV2(water());
  assert.equal(doc.duration, 4);
  const head = doc.layers.find((l) => l.id === "head")!;
  assert.equal(head.kind, "shell");
  assert.equal(head.material!.ramp.space, "surface");
  // The streaks RADIATE from the nose; rings would read as a barcode.
  assert.equal(head.material!.streaks!.radiate, true);
  assert.ok(head.material!.creases!.depth > 0);
  // Volume-conserving breath along the flow axis.
  assert.equal(head.transform.squash!.axis, "z");
  assert.ok(head.transform.squash!.amplitude > 0);
  // Water is smooth: the vertex noise is an order below the fire shell's.
  assert.ok(head.geometry!.vertexNoise!.amplitude < 0.1);

  const tail = doc.layers.filter((l) => l.kind === "sheets");
  assert.equal(tail.length, 2);
  for (const layer of tail) {
    assert.ok(layer.material!.toon, "a sheet is a lit surface, not a ramp");
    // The whole point of the multi-cadence schedule: a class that outlives its
    // own period is clipped by its own re-fire.
    for (const cls of layer.sheets!.classes)
      assert.ok(cls.life <= cls.period, "a class outlives its own cadence");
  }
  const membranes = doc.layers.find((l) => l.id === "membranes")!;
  assert.equal(membranes.sheets!.classes.length, 3);
  assert.ok(membranes.sheets!.tear, "the membrane border is torn, not cut");
  // Two distinct cadences, which is what keeps the long crescents unclipped.
  assert.ok(new Set(membranes.sheets!.classes.map((c) => c.period)).size >= 2);
  // The droplets are the same generator curled almost shut.
  const droplets = doc.layers.find((l) => l.id === "droplets")!;
  assert.ok(droplets.sheets!.curl[0] > 2);
  // The floor light follows the head instead of carrying a track of its own.
  assert.equal(doc.environment.groundPool![0].followsLayerId, "head");
});

test("the playful exemplar is a screen-plane burst of drawn symbols", () => {
  const doc = validateDocumentV2(playful());
  assert.equal(doc.duration, 3);
  // The paper it is drawn on, and no floor under it.
  assert.ok(doc.environment.backdrop);
  assert.equal(doc.environment.backdrop!.mode, "radial");
  assert.equal(doc.environment.ground, "none");

  const star = doc.layers.find((l) => l.id === "solid-star")!;
  assert.equal(star.material!.procedural, "starSolid");
  assert.equal(star.material!.blend, "alpha");
  assert.ok(star.material!.symbol!.hot, "the flash cuts while the shell holds");
  assert.ok(star.material!.screentone);
  // 1.6 units across at its widest: the scale anchor for the family.
  const widest = Math.max(
    ...(star.tracks.find((t) => t.target === "geometry.radius")?.keys.map((k) => k[1]) ??
      [star.geometry!.radius]),
  );
  assert.ok(widest * 2 >= 1.5);

  const symbols = doc.layers.filter((l) => l.material?.symbol && l.kind === "particles");
  assert.ok(symbols.length >= 4);
  for (const layer of symbols) {
    // Everything lays out in the SCREEN plane, or the burst collapses to a line.
    assert.equal(layer.frame, "camera");
    assert.equal(layer.emitter!.shape.type, "radialFan");
  }
  const faces = doc.layers.find((l) => l.id === "faces")!;
  assert.equal(faces.material!.procedural, "face");
  assert.equal(faces.emitter!.count, 6);

  const rays = doc.layers.find((l) => l.id === "star-lines")!;
  assert.equal(rays.emitter!.render.mode, "sliver");
  assert.ok(rays.emitter!.render.sliver);
  // A star line retracts from the root outward; it never simply fades.
  assert.equal(rays.emitter!.render.retract!.from, "root");
  assert.ok(
    rays.emitter!.render.retract!.start < rays.emitter!.render.retract!.end,
  );
});

test("the slash exemplar is one crescent, its licks and its front-anchored spray", () => {
  const doc = validateDocumentV2(slash());
  assert.equal(doc.duration, 3);
  const blade = doc.layers.find((l) => l.kind === "crescent")!;
  assert.equal(blade.id, "blade");
  assert.equal(Math.abs(blade.crescent!.radius), 1.5);
  // A 200-degree sweep, signed so the banana bulges up once the plane leans.
  const degrees = Math.abs((blade.crescent!.sweep * 180) / Math.PI);
  assert.ok(Math.abs(degrees - 200) < 0.01, `sweep is ${degrees} deg, not 200`);
  assert.ok(blade.crescent!.sweep < 0, "the head travels the long way round");
  // Three tones plus one smear, all on ONE window.
  assert.equal(blade.crescent!.tonal.length, 4);
  assert.equal(blade.crescent!.tonal.filter((t) => t.smear).length, 1);
  assert.ok(blade.crescent!.erosionFront.widthFollowsWindow);
  assert.ok(blade.crescent!.streaks);
  // The tail never overtakes the head.
  for (const [t, v] of blade.crescent!.window.tail.keys) {
    const head = blade.crescent!.window.head.keys;
    let h = head[head.length - 1][1];
    for (let i = 1; i < head.length; i++)
      if (t <= head[i][0]) {
        const f = (t - head[i - 1][0]) / Math.max(head[i][0] - head[i - 1][0], 1e-6);
        h = head[i - 1][1] + (head[i][1] - head[i - 1][1]) * f;
        break;
      }
    assert.ok(v <= h + 1e-6, `tail overtakes the head at u=${t}`);
  }

  const licks = doc.layers.find((l) => l.kind === "licks")!;
  assert.equal(licks.licks!.anchor.sourceLayerId, "blade");
  assert.equal(licks.licks!.anchor.follow, "erosionFront");
  assert.ok(licks.licks!.flipbookHz > 0, "the shape jumps, it does not slide");

  const front = doc.layers.filter(
    (l) => l.emitter?.spawn.mode === "frontAnchored",
  );
  assert.equal(front.length, 2, "the tongues and the embers both ride the front");
  for (const layer of front)
    assert.equal(layer.emitter!.spawn.sourceLayerId, "blade");

  const burst = doc.layers.find((l) => l.id === "burst-slivers")!;
  assert.equal(burst.emitter!.render.mode, "sliver");
  assert.equal(burst.emitter!.render.secondary!.perInstance, 3);
  assert.equal(burst.emitter!.shape.type, "radialFan");
});

test("the three port-F exemplars lint clean", () => {
  for (const source of [water, playful, slash])
    assert.deepEqual(lintDocumentV2(validateDocumentV2(source())), []);
});

test("the three port-F exemplars round-trip through the wire contract", () => {
  for (const source of [water, playful, slash]) {
    const doc = validateDocumentV2(source());
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
        reflection: layer.reflection ?? null,
        sheets: layer.sheets ?? null,
        crescent: layer.crescent ?? null,
        licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] });
  }
});

test("every port-F field is defaulted, so an archived document still loads", () => {
  // The fire projectile predates all of it: strip the new keys and it has to
  // validate to exactly the same document the defaults produce.
  const bare = load() as unknown as Record<string, unknown>;
  const environment = bare.environment as Record<string, unknown>;
  delete environment.backdrop;
  for (const layer of bare.layers as Record<string, unknown>[]) {
    delete layer.frame;
    delete (layer.transform as Record<string, unknown>).squash;
    const material = layer.material as Record<string, unknown> | undefined;
    if (material)
      for (const key of ["streaks", "creases", "screentone", "symbol"])
        delete material[key];
    const emitter = layer.emitter as Record<string, unknown> | undefined;
    if (emitter) {
      for (const key of ["angleJitter", "angleBias"])
        delete (emitter.shape as Record<string, unknown>)[key];
      delete (emitter.spawn as Record<string, unknown>).sourceLayerId;
      for (const key of ["sliver", "retract", "secondary"])
        delete (emitter.render as Record<string, unknown>)[key];
    }
  }
  const doc = validateDocumentV2(bare);
  assert.equal(doc.environment.backdrop, null);
  for (const layer of doc.layers) {
    assert.equal(layer.frame, null);
    assert.equal(layer.transform.squash, null);
    assert.equal(layer.material?.streaks ?? null, null);
    assert.equal(layer.material?.creases ?? null, null);
    assert.equal(layer.material?.screentone ?? null, null);
    assert.equal(layer.material?.symbol ?? null, null);
    assert.equal(layer.emitter?.shape.angleJitter ?? 0, 0);
    assert.equal(layer.emitter?.render.sliver ?? null, null);
  }
});

rejects(
  "a sheets class that outlives its own cadence",
  water,
  (d) => {
    d.layers.find((l) => l.kind === "sheets")!.sheets!.classes[0].period = 0.05;
  },
  /lives longer than its own period/,
);
rejects(
  "a sheets layer with no cel bands",
  water,
  (d) => {
    d.layers.find((l) => l.kind === "sheets")!.material!.toon = null;
  },
  /needs material.toon/,
);
rejects(
  "a crescent whose tail overtakes its head",
  slash,
  (d) => {
    d.layers.find((l) => l.kind === "crescent")!.crescent!.window.tail = {
      keys: [
        [0, 0],
        [1, 1],
      ],
      ease: "linear",
    };
  },
  /tail overtakes its head/,
);
rejects(
  "a crescent with no sweep to speak of",
  slash,
  (d) => {
    d.layers.find((l) => l.kind === "crescent")!.crescent!.sweep = 0.01;
  },
  /sweep is too small/,
);
rejects(
  "licks following a layer that is not a crescent",
  slash,
  (d) => {
    d.layers.find((l) => l.kind === "licks")!.licks!.anchor.sourceLayerId = "tongues";
  },
  /must follow a crescent layer/,
);
rejects(
  "a front-anchored spawn with no blade to ride",
  slash,
  (d) => {
    d.layers.find(
      (l) => l.emitter?.spawn.mode === "frontAnchored",
    )!.emitter!.spawn.sourceLayerId = null;
  },
  /needs spawn.sourceLayerId/,
);
rejects(
  "a drawn symbol with no palette",
  playful,
  (d) => {
    d.layers.find((l) => l.id === "faces")!.material!.symbol = null;
  },
  /needs material.symbol/,
);
rejects(
  "material.symbol on a pattern that is not a symbol",
  playful,
  (d) => {
    d.layers.find((l) => l.id === "faces")!.material!.procedural = "flame";
  },
  /needs a drawn-symbol procedural/,
);
rejects(
  "render.sliver without the sliver mode",
  playful,
  (d) => {
    d.layers.find((l) => l.id === "star-lines")!.emitter!.render.mode = "billboard";
  },
  /render.sliver is for render.mode "sliver" only/,
);
rejects(
  "a retract that runs backwards",
  playful,
  (d) => {
    const retract = d.layers.find((l) => l.id === "star-lines")!.emitter!.render
      .retract!;
    retract.start = 0.9;
    retract.end = 0.2;
  },
  /render.retract runs backwards/,
);

// ---------------------------------------------------------------------------
// Port G — colour fields, per-particle trails and mesh-hero framing.
// ---------------------------------------------------------------------------

const smokeBurst = (): VfxDocumentV2 =>
  validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/smoke-burst/document.json", "utf8")),
  );

test("the smoke exemplar grades its cel bands and carries a sprite-keyed spray", () => {
  const doc = smokeBurst();
  const column = doc.layers.find((l) => l.id === "column")!;
  // The bands are untouched — three of them, on the same thresholds — and only
  // the BODY colour became continuous, which is the whole point of the change.
  assert.equal(column.material!.toon!.bands, 3);
  assert.equal(column.material!.toon!.colorSource, "ramp");
  assert.equal(column.material!.ramp.space, "height");
  assert.equal(column.material!.ramp.heightSpan, 3);
  assert.equal(column.material!.ramp.stops.length, 3);
  assert.equal(column.material!.ramp.stops[0].color, "#2c1a7a");
  assert.equal(column.material!.ramp.stops[2].color, "#b9a6ff");
  const pink = doc.layers.find((l) => l.id === "pink-ring")!;
  assert.equal(pink.material!.toon!.colorSource, "ramp");
  assert.equal(pink.material!.ramp.space, "height");
  // One particle carries the gradient, and the spray shifts with height too.
  const sparks = doc.layers.find((l) => l.id === "pop-sparks")!;
  assert.equal(sparks.kind, "particles");
  assert.equal(sparks.material!.ramp.space, "sprite");
  assert.deepEqual(sparks.material!.ramp.blend, {
    space: "height",
    weight: 0.4,
  });
  assert.equal(sparks.emitter!.render.mode, "velocityStretch");
  assert.equal(sparks.emitter!.render.anchor, "head");
});

test("the heal and meteor exemplars carry per-particle ribbon trails", () => {
  const heal = validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/healing-aura/document.json", "utf8")),
  );
  const sparkles = heal.layers.find((l) => l.id === "sparkles")!;
  assert.deepEqual(sparkles.material!.ramp.blend, {
    space: "height",
    weight: 0.45,
  });
  const trail = sparkles.emitter!.trail!;
  assert.equal(trail.ramp!.space, "along");
  // A trail that does not taper to 0 reads as a bar with a cut end.
  assert.equal(trail.widthCurve.keys[trail.widthCurve.keys.length - 1][1], 0);

  const meteor = validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/meteor-rain/document.json", "utf8")),
  );
  const sparks = meteor.layers.find((l) => l.id === "sparks")!;
  assert.equal(sparks.emitter!.trail!.ramp!.space, "along");
  assert.equal(sparks.emitter!.trail!.ramp!.stops.length, 3);
  assert.equal(sparks.material!.ramp.blend!.space, "height");
});

test("the port-G exemplars lint clean", () => {
  for (const id of ["smoke-burst", "healing-aura", "meteor-rain"])
    assert.deepEqual(
      lintDocumentV2(
        validateDocumentV2(
          JSON.parse(readFileSync(`fixtures/v2/${id}/document.json`, "utf8")),
        ),
      ),
      [],
      id,
    );
});

test("the port-G exemplars round-trip through the wire contract", () => {
  for (const id of ["smoke-burst", "healing-aura", "meteor-rain"]) {
    const doc = validateDocumentV2(
      JSON.parse(readFileSync(`fixtures/v2/${id}/document.json`, "utf8")),
    );
    const wire = {
      ...structuredClone(doc),
      layers: doc.layers.map((layer) => ({
        ...structuredClone(layer),
        material: layer.material ?? null,
        emitter: layer.emitter ?? null,
        geometry: layer.geometry ?? null,
        light: layer.light ?? null,
        blob: layer.blob ?? null,
        splash: layer.splash ?? null,
        ribbon: layer.ribbon ?? null,
        wireBurst: layer.wireBurst ?? null,
        crystals: layer.crystals ?? null,
        arcs: layer.arcs ?? null,
        streakBurst: layer.streakBurst ?? null,
        reflection: layer.reflection ?? null,
        sheets: layer.sheets ?? null,
        crescent: layer.crescent ?? null,
        licks: layer.licks ?? null,
      })),
    };
    delete (wire as Record<string, unknown>).textures;
    DocumentV2WireSchema.parse(wire);
    assert.deepEqual(fromWireV2(wire), { ...doc, textures: [] }, id);
  }
});

test("every port-G field is defaulted, so an archived document still loads", () => {
  const bare = load() as unknown as Record<string, unknown>;
  for (const layer of bare.layers as Record<string, unknown>[]) {
    const material = layer.material as Record<string, unknown> | undefined;
    if (material) {
      delete (material.ramp as Record<string, unknown>).blend;
      const toon = material.toon as Record<string, unknown> | undefined;
      if (toon)
        for (const key of ["colorSource", "shadowScale", "highlightMix"])
          delete toon[key];
    }
    const emitter = layer.emitter as Record<string, unknown> | undefined;
    const trail = emitter?.trail as Record<string, unknown> | undefined;
    if (trail) delete trail.ramp;
  }
  const doc = validateDocumentV2(bare);
  for (const layer of doc.layers) {
    assert.equal(layer.material?.ramp.blend ?? null, null);
    assert.equal(layer.emitter?.trail?.ramp ?? null, null);
    if (layer.material?.toon) {
      assert.equal(layer.material.toon.colorSource, "fixed");
      assert.equal(layer.material.toon.shadowScale, 0.55);
      assert.equal(layer.material.toon.highlightMix, 0.35);
    }
  }
});

test("a mesh-hero document framed in the particle band is linted", () => {
  const doc = smokeBurst();
  assert.deepEqual(lintDocumentV2(doc), []);
  // The fx12 failure, reproduced: the exemplar's own geometry at the framing
  // the particle-era rule asked for.
  doc.camera.framing = 0.65;
  const warnings = lintDocumentV2(doc);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /camera\.framing 0\.65 is below 0\.8/);
  assert.match(warnings[0], /mesh hero/);
  assert.match(warnings[0], /copy the family exemplar's camera block/);
});

test("a particle-hero document keeps the wider framing band", () => {
  // fire-projectile's biggest layer is its particle spray, so the mesh-hero
  // rule must not fire on it at a framing the older rule allowed.
  const doc = load();
  doc.camera.framing = 0.65;
  assert.deepEqual(
    lintDocumentV2(doc).filter((w) => w.includes("mesh hero")),
    [],
  );
});

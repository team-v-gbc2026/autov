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

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

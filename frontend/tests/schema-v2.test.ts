import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DocumentV2Schema,
  DocumentV2WireSchema,
  defaultEmitter,
  defaultMaterial,
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

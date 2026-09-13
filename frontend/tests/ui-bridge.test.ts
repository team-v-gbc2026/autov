import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  addLayer,
  applyDuration,
  createDocument,
  applyEnvironment,
  applyLayerPatch,
  emptyUiDocument,
  projectToUi,
} from "../src/lib/vfx-lab/ui-bridge";
import {
  normalizeVfxDocument,
  PARAMETER_NAMES,
} from "../src/components/vfx-studio/ui-model";
import {
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

const FIXTURE_ROOT = path.join(process.cwd(), "fixtures/v2");
const FIXTURE_IDS = readdirSync(FIXTURE_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const load = (id: string): VfxDocumentV2 =>
  validateDocumentV2(
    JSON.parse(readFileSync(path.join(FIXTURE_ROOT, id, "document.json"), "utf8")),
  );

test("every v2 exemplar exists to project", () => {
  assert.ok(FIXTURE_IDS.length >= 7, FIXTURE_IDS.join(","));
});

for (const id of FIXTURE_IDS) {
  test(`projecting ${id} satisfies the product timeline's invariants`, () => {
    const doc = load(id);
    const ui = projectToUi(doc);
    // normalizeVfxDocument is Rahul's UI contract: it throws on anything the
    // emitter timeline cannot render.
    const normalized = normalizeVfxDocument(structuredClone(ui));
    assert.equal(normalized.layers.length, doc.layers.length);
    assert.deepEqual(
      normalized.layers.map((layer) => layer.id),
      doc.layers.map((layer) => layer.id),
    );
    assert.equal(ui.duration, doc.duration);
    assert.equal(ui.name, doc.name);
    for (const layer of ui.layers) {
      assert.match(layer.color, /^#[0-9a-fA-F]{6}$/, layer.id);
      assert.match(layer.secondaryColor, /^#[0-9a-fA-F]{6}$/, layer.id);
      assert.ok(layer.blend === "additive" || layer.blend === "normal");
      for (const name of PARAMETER_NAMES) {
        const value = layer.parameters[name];
        assert.ok(
          Number.isFinite(value) && value >= 0 && value <= 100,
          `${layer.id}/${name} = ${value}`,
        );
      }
    }
    for (const key of ["bloom", "exposure"] as const) {
      const value = ui.environment[key];
      assert.ok(value >= 0 && value <= 100, `${key} = ${value}`);
    }
  });

  test(`every UI edit on ${id} keeps the document valid`, () => {
    const base = load(id);
    for (const layer of base.layers) {
      for (const name of PARAMETER_NAMES) {
        for (const value of [0, 1, 37.5, 100]) {
          const next = applyLayerPatch(base, layer.id, {
            parameters: {
              ...projectToUi(base).layers.find((l) => l.id === layer.id)!
                .parameters,
              [name]: value,
            },
          });
          // Either the write applied (and validates) or the bridge returned the
          // previous document; both are valid v2 documents, never a throw.
          assert.doesNotThrow(() => validateDocumentV2(structuredClone(next)));
        }
      }
      const recoloured = applyLayerPatch(base, layer.id, {
        color: "#123456",
        secondaryColor: "#abcdef",
        blend: layer.material?.blend === "additive" ? "normal" : "additive",
        enabled: !layer.enabled,
      });
      assert.doesNotThrow(() =>
        validateDocumentV2(structuredClone(recoloured)),
      );
      const retimed = applyLayerPatch(base, layer.id, {
        start: 0,
        end: base.duration,
      });
      assert.doesNotThrow(() => validateDocumentV2(structuredClone(retimed)));
    }
  });
}

test("Opacity round-trips through the bridge", () => {
  const doc = load("fire-projectile");
  for (const layer of doc.layers.filter((item) => item.material)) {
    const next = applyLayerPatch(doc, layer.id, {
      parameters: { ...projectToUi(doc).layers[0].parameters, Opacity: 50 },
    });
    const projected = projectToUi(next).layers.find((l) => l.id === layer.id)!;
    assert.ok(
      Math.abs(projected.parameters.Opacity - 50) <= 1,
      `${layer.id}: ${projected.parameters.Opacity}`,
    );
  }
});

test("Intensity, Radius and Speed round-trip on a particles layer", () => {
  const doc = load("fire-projectile");
  const layer = doc.layers.find((item) => item.kind === "particles")!;
  const parameters = projectToUi(doc).layers.find((l) => l.id === layer.id)!
    .parameters;
  for (const name of ["Intensity", "Radius", "Speed", "Turbulence"] as const) {
    const next = applyLayerPatch(doc, layer.id, {
      parameters: { ...parameters, [name]: 42 },
    });
    const value = projectToUi(next).layers.find((l) => l.id === layer.id)!
      .parameters[name];
    assert.ok(Math.abs(value - 42) <= 1, `${name}: ${value}`);
  }
});

test("Radius round-trips on a mesh layer and on a light layer", () => {
  const doc = load("beam");
  for (const kind of ["beam", "light"] as const) {
    const layer = doc.layers.find((item) => item.kind === kind)!;
    const parameters = projectToUi(doc).layers.find((l) => l.id === layer.id)!
      .parameters;
    const next = applyLayerPatch(doc, layer.id, {
      parameters: { ...parameters, Radius: 30 },
    });
    const value = projectToUi(next).layers.find((l) => l.id === layer.id)!
      .parameters.Radius;
    assert.ok(Math.abs(value - 30) <= 1, `${kind}: ${value}`);
  }
});

test("colour writes land on the ramp and on the light", () => {
  const doc = load("fire-projectile");
  const mesh = doc.layers.find((item) => item.material)!;
  const withColor = applyLayerPatch(doc, mesh.id, {
    color: "#112233",
    secondaryColor: "#445566",
  });
  const projected = projectToUi(withColor).layers.find((l) => l.id === mesh.id)!;
  assert.equal(projected.color, "#112233");
  assert.equal(projected.secondaryColor, "#445566");

  const light = doc.layers.find((item) => item.kind === "light")!;
  const relit = applyLayerPatch(doc, light.id, { color: "#00ff00" });
  assert.equal(
    projectToUi(relit).layers.find((l) => l.id === light.id)!.color,
    "#00ff00",
  );
});

test("blend projection is idempotent across all four v2 blend modes", () => {
  const doc = load("fire-projectile");
  for (const layer of doc.layers.filter((item) => item.material)) {
    const ui = projectToUi(doc).layers.find((l) => l.id === layer.id)!;
    const next = applyLayerPatch(doc, layer.id, { blend: ui.blend });
    const after = next.layers.find((l) => l.id === layer.id)!;
    assert.equal(after.material!.blend, layer.material!.blend, layer.id);
  }
});

test("timing writes are clamped inside the document", () => {
  const doc = load("smoke-burst");
  const layer = doc.layers[0];
  const next = applyLayerPatch(doc, layer.id, { start: -5, end: 99 });
  const after = next.layers.find((l) => l.id === layer.id)!;
  assert.equal(after.start, 0);
  assert.ok(after.end <= doc.duration + 1e-9);
});

test("environment sliders map onto post bloom and exposure", () => {
  const doc = load("shield");
  const next = applyEnvironment(doc, { bloom: 50, exposure: 50 });
  assert.ok(Math.abs(next.post.bloom.strength - 1) < 1e-6);
  assert.ok(Math.abs(next.post.exposure - 1.15) < 1e-6);
  const ui = projectToUi(next).environment;
  assert.ok(Math.abs(ui.bloom - 50) <= 1);
  assert.ok(Math.abs(ui.exposure - 50) <= 1);
});

test("duration changes keep every layer and edit inside the document", () => {
  const doc = load("beam");
  const shorter = applyDuration(doc, 1.5);
  assert.equal(shorter.duration, 1.5);
  assert.doesNotThrow(() => validateDocumentV2(structuredClone(shorter)));
  for (const layer of shorter.layers) assert.ok(layer.end <= 1.5 + 1e-9);
  // Out-of-contract requests clamp instead of throwing.
  assert.equal(applyDuration(doc, 99).duration, 12);
  assert.equal(applyDuration(doc, 0).duration, 0.5);
});

test("addLayer appends a renderable particles emitter with a unique id", () => {
  const doc = load("fire-slash");
  const next = addLayer(doc, doc.layers.length);
  assert.equal(next.layers.length, doc.layers.length + 1);
  const added = next.layers[next.layers.length - 1];
  assert.equal(added.kind, "particles");
  assert.equal(added.name, `Emitter ${doc.layers.length + 1}`);
  assert.match(added.id, /^[a-z][a-z0-9-]{0,47}$/);
  assert.doesNotThrow(() => validateDocumentV2(structuredClone(next)));
  const ui = projectToUi(next);
  assert.doesNotThrow(() => normalizeVfxDocument(structuredClone(ui)));
});

test("addLayer works from an empty-ish document and never collides", () => {
  let doc = load("fire-slash");
  for (let i = 0; i < 4; i++) doc = addLayer(doc, doc.layers.length);
  assert.equal(new Set(doc.layers.map((l) => l.id)).size, doc.layers.length);
});

test("the empty projection is a valid UI document with no emitters", () => {
  const ui = projectToUi(null);
  assert.deepEqual(ui, emptyUiDocument());
  assert.equal(ui.layers.length, 0);
  assert.equal(ui.duration, 3);
  assert.equal(ui.environment.bloom, 64);
  assert.equal(ui.environment.exposure, 48);
  // normalizeVfxDocument rejects an empty layer list, which is why the
  // projection never routes through it.
  assert.throws(() => normalizeVfxDocument(structuredClone(ui)));
});

test("an unknown layer id leaves the document untouched", () => {
  const doc = load("shield");
  assert.equal(applyLayerPatch(doc, "no-such-layer", { enabled: false }), doc);
});

test("createDocument truncates an over-long project name to the contract cap", () => {
  const name = "x".repeat(120);
  const doc = createDocument(name);
  assert.equal(doc.name.length, 100);
  assert.equal(doc.layers.length, 1);
  assert.doesNotThrow(() => validateDocumentV2(structuredClone(doc)));
  // A blank name still produces a valid document rather than a schema error.
  assert.ok(createDocument("   ").name.length > 0);
});

test("addLayer never returns a document without the new layer", () => {
  // The layer-less shell createDocument starts from is the case that used to
  // come back unchanged and crash callers indexing the new emitter.
  const shell = { ...createDocument("Probe"), layers: [] } as VfxDocumentV2;
  const grown = addLayer(shell, 0);
  assert.equal(grown.layers.length, 1);
  // A document already at the contract's layer cap must throw, not fall back.
  let full = createDocument("Full");
  for (let i = 1; i < 24; i++) full = addLayer(full, full.layers.length);
  assert.equal(full.layers.length, 24);
  assert.throws(() => addLayer(full, full.layers.length));
});

test("driving Intensity to zero keeps the ramp's relative shape", () => {
  const doc = load("fire-projectile");
  const layer = doc.layers.find(
    (item) => (item.material?.ramp.stops.length ?? 0) > 2,
  )!;
  const before = layer.material!.ramp.stops.map((stop) => stop.intensity);
  const parameters = projectToUi(doc).layers.find((l) => l.id === layer.id)!
    .parameters;
  const zeroed = applyLayerPatch(doc, layer.id, {
    parameters: { ...parameters, Intensity: 0 },
  });
  const low = zeroed.layers.find((l) => l.id === layer.id)!.material!.ramp.stops;
  assert.ok(Math.max(...low.map((s) => s.intensity)) > 0, "shape survives zero");
  const raised = applyLayerPatch(zeroed, layer.id, {
    parameters: { ...parameters, Intensity: parameters.Intensity },
  });
  const after = raised.layers
    .find((l) => l.id === layer.id)!
    .material!.ramp.stops.map((stop) => stop.intensity);
  const peak = Math.max(...before);
  before.forEach((value, index) => {
    assert.ok(
      Math.abs(value / peak - after[index] / Math.max(...after)) < 0.02,
      `stop ${index}: ${value} vs ${after[index]}`,
    );
  });
});

test("an inward emitter keeps its negative speed", () => {
  const doc = load("beam");
  const layer = doc.layers.find(
    (item) => item.emitter && item.emitter.velocity.speed[1] < 0,
  )!;
  const parameters = projectToUi(doc).layers.find((l) => l.id === layer.id)!
    .parameters;
  for (const value of [10, 70, 0]) {
    const next = applyLayerPatch(doc, layer.id, {
      parameters: { ...parameters, Speed: value },
    });
    const speed = next.layers.find((l) => l.id === layer.id)!.emitter!.velocity
      .speed;
    assert.ok(speed[0] < 0 && speed[1] < 0, `Speed ${value}: ${speed}`);
    assert.ok(speed[0] <= speed[1], `range order at ${value}: ${speed}`);
  }
});

test("a documented no-op returns the same document identity", () => {
  const doc = load("beam");
  const light = doc.layers.find((item) => item.kind === "light")!;
  const parameters = projectToUi(doc).layers.find((l) => l.id === light.id)!
    .parameters;
  // Opacity has no meaning for a light layer.
  assert.equal(
    applyLayerPatch(doc, light.id, {
      parameters: { ...parameters, Opacity: 12 },
    }),
    doc,
  );
  // Re-applying the projected values changes nothing either.
  assert.equal(applyLayerPatch(doc, light.id, { parameters }), doc);
});

test("Radius reaches a ribbon's strand width and a burst's reach", () => {
  const heal = load("healing-aura");
  const ribbonId = heal.layers.find((l) => l.kind === "ribbon")!.id;
  const before = projectToUi(heal).layers.find((l) => l.id === ribbonId)!;
  const wider = applyLayerPatch(heal, ribbonId, {
    parameters: { ...before.parameters, Radius: 80 },
  });
  const layer = wider.layers.find((l) => l.id === ribbonId)!;
  assert.ok(layer.ribbon!.width > heal.layers.find((l) => l.id === ribbonId)!.ribbon!.width);
  assert.ok(projectToUi(wider).layers.find((l) => l.id === ribbonId)!.parameters.Radius > before.parameters.Radius);

  const glitch = load("glitch-projectile");
  const burstId = glitch.layers.find((l) => l.kind === "wireBurst")!.id;
  const source = glitch.layers.find((l) => l.id === burstId)!.wireBurst!;
  const grown = applyLayerPatch(glitch, burstId, {
    parameters: {
      ...projectToUi(glitch).layers.find((l) => l.id === burstId)!.parameters,
      Radius: 40,
    },
  }).layers.find((l) => l.id === burstId)!.wireBurst!;
  // Radius and travel move together: outlines that grow without flying further
  // just turn the burst into a solid ball.
  assert.ok(grown.radius > source.radius);
  assert.ok(grown.travel > source.travel);
  assert.equal(grown.shapes, source.shapes);
  assert.equal(grown.spokes, source.spokes);
});

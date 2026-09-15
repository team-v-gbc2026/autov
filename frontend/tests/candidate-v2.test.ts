import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  groundingRepairV2,
  repairCandidateV2,
} from "../src/lib/vfx-lab/candidate-v2";
import {
  createPresetV2,
  RECIPE_V2_IDS,
  type RecipeV2Id,
} from "../src/lib/vfx-lab/recipes-v2";
import {
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

/** The family exemplar with its grounding stripped out, one failure at a time. */
function ungrounded(
  family: RecipeV2Id,
  edit: (doc: VfxDocumentV2) => void,
): VfxDocumentV2 {
  const doc = createPresetV2(family);
  edit(doc);
  return validateDocumentV2(doc);
}

test("a candidate with no light layer takes the family exemplar's lights", () => {
  const doc = ungrounded("fire-slash", (d) => {
    d.layers = d.layers.filter((l) => l.kind !== "light");
  });
  const exemplarLights = createPresetV2("fire-slash").layers.filter(
    (l) => l.kind === "light",
  );
  const { document, warnings } = groundingRepairV2(doc, "fire-slash");
  const lights = document.layers.filter((l) => l.enabled && l.kind === "light");
  assert.equal(lights.length, exemplarLights.length);
  assert.deepEqual(
    lights.map((l) => l.light!.color),
    exemplarLights.map((l) => l.light!.color),
  );
  assert.ok(lights.every((l) => l.end <= document.duration));
  assert.ok(lights.every((l) => l.window === null));
  assert.ok(
    warnings.some((w) =>
      w.startsWith(
        "Grounding repair: no light layer; copied the fire-slash exemplar's light layer (slash-light)",
      ),
    ),
    warnings.join("\n"),
  );
  assert.ok(
    !lintDocumentV2(document).some((w) => w.startsWith("No light layer")),
  );
});

test("a light copied into a shorter document is clamped to its duration", () => {
  const doc = ungrounded("fire-slash", (d) => {
    d.layers = d.layers.filter((l) => l.kind !== "light");
  });
  // The ice-blast light runs 1-6s; the fire-slash candidate is three seconds
  // long, so the copy has to end with the document rather than past it.
  const donor = createPresetV2("ice-blast");
  assert.ok(donor.layers.find((l) => l.kind === "light")!.end > doc.duration);
  const { document } = groundingRepairV2(doc, "fire-slash", donor);
  const light = document.layers.find((l) => l.kind === "light")!;
  assert.equal(light.end, doc.duration);
  assert.ok(light.start < light.end);
});

test("a synthesised light is used when the exemplar carries none", () => {
  const bare = ungrounded("fire-slash", (d) => {
    d.layers = d.layers.filter((l) => l.kind !== "light");
  });
  // An exemplar with no light of its own: the repair has to invent one rather
  // than leave the document unlit.
  const lightless = validateDocumentV2({
    ...createPresetV2("fire-slash"),
    layers: createPresetV2("fire-slash").layers.filter(
      (l) => l.kind !== "light",
    ),
  });
  const { document, warnings } = groundingRepairV2(
    bare,
    "fire-slash",
    lightless,
  );
  const light = document.layers.find((l) => l.kind === "light")!;
  const peak = Math.max(...light.light!.intensity.keys.map((k) => k[1]));
  assert.equal(light.id, "grounding-light");
  assert.ok(peak >= 8 && peak <= 30, String(peak));
  assert.ok(light.light!.radius >= 6 && light.light!.radius <= 16);
  // The invented light takes the document's own dominant ramp colour.
  assert.match(light.light!.color, /^#[0-9a-f]{6}$/);
  assert.ok(
    warnings.some((w) =>
      w.startsWith("Grounding repair: no light layer; added a synthesised #"),
    ),
    warnings.join("\n"),
  );
});

test("a near-black ground is lifted to the exemplar's ground colour", () => {
  const doc = ungrounded("lightning-impact", (d) => {
    d.environment.groundColor = "#0a0a0c";
  });
  const { document, warnings } = groundingRepairV2(doc, "lightning-impact");
  assert.equal(
    document.environment.groundColor,
    createPresetV2("lightning-impact").environment.groundColor,
  );
  assert.ok(
    warnings.some((w) =>
      w.startsWith(
        "Grounding repair: ground color #0a0a0c is near-black; lifted to #",
      ),
    ),
    warnings.join("\n"),
  );
  assert.ok(!lintDocumentV2(document).some((w) => w.includes("near-black")));
});

test("a hidden ground is left alone", () => {
  const doc = ungrounded("playful-impact", (d) => {
    d.environment.groundColor = "#0a0a0c";
    d.layers = d.layers.filter((l) => l.kind !== "light");
  });
  const { document, warnings } = groundingRepairV2(doc, "playful-impact");
  assert.deepEqual(warnings, []);
  assert.equal(document, doc);
});

test("an impact document with no ground contact takes the exemplar's decal", () => {
  const doc = ungrounded("lightning-impact", (d) => {
    d.layers = d.layers.filter((l) => l.id !== "ground-glow");
  });
  const { document, warnings } = groundingRepairV2(doc, "lightning-impact");
  const decal = document.layers.find((l) => l.kind === "decal")!;
  assert.equal(decal.id, "ground-glow");
  assert.equal(decal.role, "impact");
  assert.ok(
    warnings.some((w) =>
      w.startsWith(
        "Grounding repair: no ground-contact decal; copied the lightning-impact exemplar's ground-glow decal",
      ),
    ),
    warnings.join("\n"),
  );
});

test("a document with no impact role keeps its bare ground", () => {
  // fire-projectile's exemplar carries a ground glow, but a document that
  // declares no contact is not missing one.
  const doc = ungrounded("fire-projectile", (d) => {
    d.layers = d.layers.filter((l) => l.kind !== "decal");
  });
  assert.ok(
    createPresetV2("fire-projectile").layers.some((l) => l.kind === "decal"),
  );
  const { document, warnings } = groundingRepairV2(doc, "fire-projectile");
  assert.deepEqual(warnings, []);
  assert.equal(
    document.layers.some((l) => l.kind === "decal"),
    false,
  );
});

test("all three repairs together leave a document the schema accepts", () => {
  const doc = ungrounded("lightning-impact", (d) => {
    d.environment.groundColor = "#0b0b0e";
    d.layers = d.layers.filter((l) => l.kind !== "light" && l.kind !== "decal");
  });
  const { document, warnings } = groundingRepairV2(doc, "lightning-impact");
  assert.equal(warnings.length, 3);
  assert.ok(
    warnings.every((w) => w.startsWith("Grounding repair: ")),
    warnings.join("\n"),
  );
  assert.doesNotThrow(() => validateDocumentV2(document));
  assert.ok(document.layers.some((l) => l.kind === "light"));
  assert.ok(document.layers.some((l) => l.kind === "decal"));
  assert.equal(document.environment.groundColor, "#584c4a");
  const lint = lintDocumentV2(document);
  assert.ok(!lint.some((w) => w.startsWith("No light layer")));
  assert.ok(!lint.some((w) => w.includes("near-black")));
});

for (const family of RECIPE_V2_IDS)
  test(`the ${family} exemplar passes through repairCandidateV2 unchanged`, () => {
    const exemplar = createPresetV2(family);
    const { document, warnings } = repairCandidateV2(
      createPresetV2(family),
      family,
    );
    assert.deepEqual(document, exemplar);
    assert.deepEqual(
      warnings.filter((w) => w.startsWith("Grounding repair: ")),
      [],
    );
  });

// The shipped fixtures include the two "classic" variants, which are dev
// presets rather than family exemplars but are held to the same bar: a
// hand-authored document is the reference the repair copies FROM.
for (const name of readdirSync(join(process.cwd(), "fixtures/v2")))
  test(`the ${name} fixture is grounded as authored`, () => {
    const doc = validateDocumentV2(
      JSON.parse(
        readFileSync(
          join(process.cwd(), "fixtures/v2", name, "document.json"),
          "utf8",
        ),
      ),
    );
    const family = name.replace(/-classic$/, "") as RecipeV2Id;
    assert.ok((RECIPE_V2_IDS as readonly string[]).includes(family));
    const { document, warnings } = groundingRepairV2(doc, family);
    assert.deepEqual(document, doc);
    assert.deepEqual(warnings, []);
  });

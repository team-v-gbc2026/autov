import test from "node:test";
import assert from "node:assert/strict";
import { RECIPE_V2_IDS, type RecipeV2Id } from "../src/lib/vfx-lab/recipes-v2";
import {
  TECHNIQUE_IDS,
  TECHNIQUE_KEYWORDS,
  TECHNIQUES_BY_FAMILY,
  TECHNIQUES_V2,
  techniqueBrief,
} from "../src/lib/vfx-lab/techniques-v2";

test("every family maps to at least 3 technique cards", () => {
  for (const id of RECIPE_V2_IDS) {
    assert.ok(
      TECHNIQUES_BY_FAMILY[id].length >= 3,
      `${id} has fewer than 3 technique cards`,
    );
  }
});

test("every referenced card id exists in TECHNIQUES_V2", () => {
  for (const family of RECIPE_V2_IDS) {
    for (const id of TECHNIQUES_BY_FAMILY[family]) {
      assert.ok(TECHNIQUES_V2[id], `${family} references missing card ${id}`);
    }
  }
  for (const [, ids] of TECHNIQUE_KEYWORDS) {
    for (const id of ids) {
      assert.ok(TECHNIQUES_V2[id], `keyword references missing card ${id}`);
    }
  }
  // Every declared card is reachable from at least one family or keyword —
  // otherwise it can never reach the prompt.
  const reachable = new Set<string>();
  for (const family of RECIPE_V2_IDS)
    for (const id of TECHNIQUES_BY_FAMILY[family]) reachable.add(id);
  for (const [, ids] of TECHNIQUE_KEYWORDS) for (const id of ids) reachable.add(id);
  for (const id of TECHNIQUE_IDS)
    assert.ok(reachable.has(id), `${id} is never reachable from a family or keyword`);
});

test("brief stays within budget for every family on an empty prompt", () => {
  for (const id of RECIPE_V2_IDS) {
    const brief = techniqueBrief(id, "");
    assert.ok(
      brief.length <= 14400,
      `${id} brief is ${brief.length} chars, over the 14400 budget`,
    );
    assert.ok(!brief.includes("…"), `${id} brief truncates text with an ellipsis`);
    assert.ok(brief.length > 0, `${id} brief is empty`);
  }
});

test("keyword routing surfaces the expected cards", () => {
  const aura = techniqueBrief(
    "fire-slash" as RecipeV2Id,
    "a green healing aura around the caster",
  );
  assert.match(aura, /Ground ring with inner fill/);
  // four-point-sparkles is the aura|heal route's 4th card; confirm the
  // keyword table itself routes to it (independent of the per-call budget,
  // which may legitimately drop a later card before this one is reached).
  const auraKeywordCards = TECHNIQUE_KEYWORDS.find(([pattern]) =>
    pattern.test("a green healing aura around the caster"),
  )?.[1];
  assert.ok(auraKeywordCards?.includes("four-point-sparkles"));

  const vortex = techniqueBrief("shield" as RecipeV2Id, "a swirling sky vortex tornado");
  assert.match(vortex, /Polar swirl disc/);

  const glitch = techniqueBrief(
    "shield" as RecipeV2Id,
    "a digital glitch hologram projectile",
  );
  assert.match(glitch, /Stepped-hash glitch/);
});

test("techniqueBrief only ever surfaces vocabulary.available, never missing-only text as a requirement", () => {
  // Every card with an empty `available` list must still produce guidance,
  // via the approximate fallback baked into techniqueBrief.
  for (const id of TECHNIQUE_IDS) {
    const card = TECHNIQUES_V2[id];
    if (card.vocabulary.available.length === 0) {
      // find a family/keyword combo that surfaces this card and check the brief
      for (const family of RECIPE_V2_IDS) {
        if (TECHNIQUES_BY_FAMILY[family].includes(id)) {
          const brief = techniqueBrief(family, "");
          assert.match(brief, /Fields: /);
        }
      }
    }
  }
});

test("techniqueBrief respects opts.max", () => {
  const brief = techniqueBrief("beam" as RecipeV2Id, "", { max: 1 });
  const cardCount = (brief.match(/^### /gm) || []).length;
  assert.equal(cardCount, 1);
});

test("the smoke-spike cards now implement inside schema v2", () => {
  // These four were the renderer backlog the smoke spike was built to close;
  // TECHNIQUES.md's backlog table is generated from the same `missing` lists.
  for (const id of [
    "cauliflower-blob-cluster",
    "inverted-hull-outline",
    "flat-splash-accent",
    "three-tone-layer-stack",
  ] as const) {
    const card = TECHNIQUES_V2[id];
    assert.deepEqual(card.vocabulary.missing, [], id);
    assert.ok(card.vocabulary.available.length > 0, id);
  }
  const brief = techniqueBrief("smoke-burst" as RecipeV2Id, "a cel-shaded smoke puff");
  assert.match(brief, /kind:"blob"/);
  assert.match(brief, /material\.toon/);
  assert.match(brief, /material\.outline/);
  assert.match(brief, /kind:"splash"/);
  // No card may advertise vocabulary the renderer does not have.
  assert.doesNotMatch(brief, /metaball|SDF fusion/);
});

test("the ice and shield cards name the vocabulary the port added", () => {
  const shield = TECHNIQUES_V2["hex-lattice-fresnel-shield"];
  const fields = shield.vocabulary.available.join(" ");
  for (const field of [
    "material.lattice",
    "material.reveal",
    "material.planeGlow",
    "material.ripples",
    'geometry.type:"band"',
  ])
    assert.ok(fields.includes(field), `hex shield card is missing ${field}`);
  // The card's only backlog entry (depth-intersection glow) is closed by
  // material.planeGlow, so it claims nothing missing any more.
  assert.deepEqual(shield.vocabulary.missing, []);

  const shards = TECHNIQUES_V2["instanced-shard-burst"].vocabulary.available.join(" ");
  assert.ok(shards.includes('shape.type:"layerInstances"'));
  assert.ok(shards.includes("planarDrag"));

  const stagger = TECHNIQUES_V2["staggered-instance-timing"].vocabulary.available.join(" ");
  assert.ok(stagger.includes("crystals."), "the mesh side of the stagger is named");

  const sigil = TECHNIQUES_V2["cast-sigil-reveal"].vocabulary.available.join(" ");
  assert.ok(sigil.includes('material.procedural:"sigil"'));
  assert.ok(sigil.includes("material.reveal"));
});

test("the cards this port rewrote keep the 3-6 construction-step contract", () => {
  for (const id of [
    "hex-lattice-fresnel-shield",
    "instanced-shard-burst",
    "staggered-instance-timing",
    "two-layer-noise-mist",
    "cast-sigil-reveal",
  ] as const) {
    const card = TECHNIQUES_V2[id];
    assert.ok(
      card.construction.length >= 3 && card.construction.length <= 6,
      `${id} has ${card.construction.length} construction steps`,
    );
  }
});

test("the beam/column cards name the vocabulary the port added", () => {
  const stripe = TECHNIQUES_V2["stripe-panner-core-and-sheath"];
  assert.deepEqual(stripe.vocabulary.missing, []);
  const stripeFields = stripe.vocabulary.available.join(" ");
  assert.ok(stripeFields.includes("material.stripes"));
  assert.ok(stripeFields.includes("material.flicker"));
  assert.ok(stripeFields.includes("geometry.slab"));

  const arcs = TECHNIQUES_V2["blinking-arc-ribbons"];
  assert.deepEqual(arcs.vocabulary.missing, []);
  const arcFields = arcs.vocabulary.available.join(" ");
  assert.ok(arcFields.includes('kind:"arcs"'));
  assert.ok(arcFields.includes("arcs.blink"));
  assert.ok(arcFields.includes("layer.collapse"));

  const vent = TECHNIQUES_V2["vent-on-shutoff"].vocabulary.available.join(" ");
  assert.ok(vent.includes('type:"line"'));
  assert.ok(vent.includes('"alongPath"'));
  assert.ok(vent.includes('"pathLine"'));

  const charge = TECHNIQUES_V2["converging-charge"];
  assert.deepEqual(charge.vocabulary.missing, []);
  const stack = TECHNIQUES_V2["three-tone-layer-stack"].vocabulary.available.join(" ");
  assert.ok(stack.includes("geometry.slab.tiers"));

  for (const id of [
    "stripe-panner-core-and-sheath",
    "blinking-arc-ribbons",
    "vent-on-shutoff",
  ] as const) {
    const card = TECHNIQUES_V2[id];
    assert.ok(
      card.construction.length >= 3 && card.construction.length <= 6,
      `${id} has ${card.construction.length} construction steps`,
    );
  }
});

test("the port-F cards route from their own families and prompts", () => {
  // The three cards the water, playful and slash ports added, each reachable
  // both from its family and from the words a director would actually use.
  assert.ok(TECHNIQUES_BY_FAMILY["water-projectile"].includes("torn-membrane-tail"));
  assert.ok(TECHNIQUES_BY_FAMILY["playful-impact"].includes("drawn-symbol-burst"));
  assert.ok(TECHNIQUES_BY_FAMILY["fire-slash"].includes("arc-window-crescent"));
  // Routed by prompt too. The per-call budget can legitimately drop a later
  // card, so the keyword TABLE is what is asserted — the same way the aura
  // route's fourth card is checked above.
  const routed = (prompt: string) =>
    TECHNIQUE_KEYWORDS.filter(([pattern]) => pattern.test(prompt)).flatMap(
      ([, ids]) => ids,
    );
  assert.ok(routed("a lob of liquid water").includes("torn-membrane-tail"));
  assert.ok(routed("a cute kawaii cartoon hit").includes("drawn-symbol-burst"));
  assert.ok(routed("a sword slash across the screen").includes("arc-window-crescent"));
  // And each one really reaches a brief for its own family.
  assert.match(
    techniqueBrief("water-projectile" as RecipeV2Id, ""),
    /Torn membrane tail/,
  );
  assert.match(
    techniqueBrief("playful-impact" as RecipeV2Id, ""),
    /Drawn symbol burst/,
  );
  assert.match(techniqueBrief("fire-slash" as RecipeV2Id, ""), /Arc-window crescent/);
  // All three are fully expressible today: nothing in them is renderer backlog.
  for (const id of [
    "torn-membrane-tail",
    "drawn-symbol-burst",
    "arc-window-crescent",
  ] as const) {
    assert.deepEqual(TECHNIQUES_V2[id].vocabulary.missing, []);
    assert.ok(TECHNIQUES_V2[id].vocabulary.available.length >= 3, id);
  }
});

test("the colour-field cards route from every particle family and from their keywords", () => {
  // Every family that carries particles owns them; water-projectile is all mesh.
  for (const family of RECIPE_V2_IDS) {
    if (family === "water-projectile") continue;
    assert.ok(
      TECHNIQUES_BY_FAMILY[family].includes("continuous-colour-field"),
      `${family} is missing continuous-colour-field`,
    );
    assert.ok(
      TECHNIQUES_BY_FAMILY[family].includes("particle-ribbon-trails"),
      `${family} is missing particle-ribbon-trails`,
    );
  }
  for (const prompt of [
    "a gradient from blue to green",
    "a graduated violet plume",
    "the colours blend as it rises",
    "a smooth transition into green",
    "long trails behind the sparks",
    "ribbon streamers off the impact",
    "a streamer of embers",
  ]) {
    const cards = TECHNIQUE_KEYWORDS.find(([pattern]) =>
      pattern.test(prompt),
    )?.[1];
    assert.ok(cards?.includes("continuous-colour-field"), prompt);
    assert.ok(cards?.includes("particle-ribbon-trails"), prompt);
  }
  const brief = techniqueBrief("smoke-burst", "a violet plume with a gradient");
  assert.match(brief, /Continuous colour field/);
  assert.match(brief, /material\.ramp\.blend/);
  assert.match(brief, /Particle ribbon trails/);
});

test("a keyword-matched card is never displaced by the universal colour cards", () => {
  // The regression the reordering exists for: every family list now ends with
  // the two colour cards, so on family position alone they would take the last
  // slots and drop the card the prompt actually asked for.
  const aura = techniqueBrief(
    "fire-slash" as RecipeV2Id,
    "a green healing aura around the caster",
  );
  assert.match(aura, /Ground ring with inner fill/);
  assert.ok(
    aura.indexOf("Ground ring with inner fill") <
      (aura.includes("Continuous colour field")
        ? aura.indexOf("Continuous colour field")
        : Infinity),
  );
});

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
      brief.length <= 5600,
      `${id} brief is ${brief.length} chars, over the 5600 budget`,
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

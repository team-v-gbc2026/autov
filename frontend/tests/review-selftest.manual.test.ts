import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  REVIEW_V2_SYSTEM,
  ReviewV2Schema,
  scoreV2,
  type ReviewV2,
} from "../src/lib/vfx-lab/protocol-v2";
import { describeLayersV2 } from "../src/lib/vfx-lab/protocol-v2";
import { callModel } from "../src/lib/vfx-lab/server";
import {
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";

// ---------------------------------------------------------------------------
// Seeded-defect self-test for the v2 reviewer.
//
// Every other test in this suite proves the review MATHS. None of them proves
// the reviewer can SEE. This one takes the accepted fire exemplar, breaks it in
// four known ways, renders all five through the real headless capture and asks
// the real reviewer to judge them blind. It passes only if the intact fixture
// outscores every variant and each seeded defect is ticked on the checklist.
//
// It spends money and needs a browser, so it is skipped unless AUTOV_LIVE=1.
//   AUTOV_LIVE=1 npx tsx --test tests/review-selftest.manual.test.ts
// ---------------------------------------------------------------------------

const live = process.env.AUTOV_LIVE === "1";
const OUT_DIR = path.join(
  process.cwd(),
  ".autov-local",
  "v2-verify",
  "review",
  "selftest",
);

const fixture = () =>
  validateDocumentV2(
    JSON.parse(
      readFileSync("fixtures/v2/fire-projectile/document.json", "utf8"),
    ),
  );

/** Turn the antialiasing off: edges should read as stair-stepped. */
function seedAliasing(doc: VfxDocumentV2) {
  doc.quality.aa = "none";
  return doc;
}
/** Strip every mask: particles become bare quads with visible corners. */
function seedCards(doc: VfxDocumentV2) {
  for (const layer of doc.layers)
    if (layer.material) layer.material.mask.textureId = null;
  return doc;
}
/** Collapse every ramp to its endpoints: no gradient from core to edge. */
function seedFlatColor(doc: VfxDocumentV2) {
  for (const layer of doc.layers) {
    const ramp = layer.material?.ramp;
    if (ramp && ramp.stops.length > 2)
      ramp.stops = [ramp.stops[0], ramp.stops[ramp.stops.length - 1]];
  }
  return doc;
}
/** Remove the curl noise: particles travel on straight ballistic lines. */
function seedLinearMotion(doc: VfxDocumentV2) {
  for (const layer of doc.layers)
    if (layer.emitter?.forces.curl) layer.emitter.forces.curl.strength = 0;
  return doc;
}

const VARIANTS: {
  id: string;
  defect: keyof ReviewV2["defects"];
  seed: (doc: VfxDocumentV2) => VfxDocumentV2;
}[] = [
  { id: "aa-off", defect: "aliasedEdges", seed: seedAliasing },
  { id: "masks-removed", defect: "visibleCards", seed: seedCards },
  { id: "flat-ramp", defect: "flatColor", seed: seedFlatColor },
  { id: "no-curl", defect: "linearMotion", seed: seedLinearMotion },
];

const CRITERIA = [
  "a fire projectile travelling with a burning head",
  "a trailing smoke plume that outlives the flame",
  "warm light pooling on the ground under the projectile",
];

test(
  "the reviewer ranks the intact exemplar above four seeded defects",
  { skip: live ? false : "set AUTOV_LIVE=1 to run the live review self-test" },
  async (t) => {
    const { captureDocumentsV2, writeDataUrlAsPng } =
      await import("../scripts/capture-v2-harness.mjs");
    const documents = [
      { id: "intact", document: fixture() },
      ...VARIANTS.map((variant) => ({
        id: variant.id,
        document: validateDocumentV2(variant.seed(fixture())),
      })),
    ];
    const { results, problems } = await captureDocumentsV2(documents);
    assert.deepEqual(problems, [], "the headless capture logged page errors");
    assert.equal(results.length, documents.length);

    mkdirSync(OUT_DIR, { recursive: true });
    const reviews = new Map<string, ReviewV2>();
    for (const [index, { id, evidence }] of results.entries()) {
      assert.equal(evidence.times.length, 24, `${id}: sheet tile count`);
      assert.equal(evidence.stripTimes?.length, 12, `${id}: strip frame count`);
      assert.ok(evidence.renderedPixels! > 20, `${id}: nothing rendered`);
      await writeDataUrlAsPng(
        evidence.sheet,
        path.join(OUT_DIR, `${id}-sheet.png`),
      );
      await writeDataUrlAsPng(
        evidence.strip,
        path.join(OUT_DIR, `${id}-strip.png`),
      );
      // The reviewer is told nothing about which document it is looking at.
      const answer = await callModel(
        ReviewV2Schema,
        REVIEW_V2_SYSTEM,
        JSON.stringify({
          prompt:
            "a fire projectile arcing across frame, trailing smoke and embers",
          criteria: CRITERIA,
          sheetTimes: evidence.times,
          stripStepSeconds: 0.033,
          renderedActivity: evidence.temporal,
          jitterScore: evidence.jitterScore,
          layers: describeLayersV2(documents[index].document),
        }),
        [evidence.sheet, evidence.strip!],
        AbortSignal.timeout(240000),
        12000,
      );
      reviews.set(id, answer.value);
      writeFileSync(
        path.join(OUT_DIR, `${id}-review.json`),
        JSON.stringify(answer.value, null, 2),
      );
      t.diagnostic(
        `${id}: ${scoreV2(answer.value)} / 5 — ${
          Object.entries(answer.value.defects)
            .filter(([, raised]) => raised)
            .map(([defect]) => defect)
            .join(", ") || "no defects"
        }`,
      );
    }

    const intact = reviews.get("intact")!;
    assert.ok(intact.sufficientEvidence, "intact evidence was unreadable");
    for (const variant of VARIANTS) {
      const review = reviews.get(variant.id)!;
      assert.ok(
        scoreV2(intact) > scoreV2(review),
        `${variant.id} scored ${scoreV2(review)}, intact scored ${scoreV2(intact)}`,
      );
      assert.equal(
        review.defects[variant.defect],
        true,
        `${variant.id} did not raise ${variant.defect}`,
      );
      assert.equal(
        intact.defects[variant.defect],
        false,
        `intact fixture wrongly raised ${variant.defect}`,
      );
    }
  },
);

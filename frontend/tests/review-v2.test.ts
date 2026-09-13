import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceV2,
  axisScoresV2,
  DEFECT_PENALTY_V2,
  defectCountV2,
  improvesV2,
  REVIEW_V2_AXES,
  REVIEW_V2_DEFECT_AXIS,
  REVIEW_V2_DEFECTS,
  REVIEW_V2_WEIGHTS,
  ReviewV2Schema,
  scoreV2,
  validateReviewV2Criteria,
  type ReviewV2,
} from "../src/lib/vfx-lab/protocol-v2";
import { jitterScore } from "../src/lib/vfx-lab/temporal";

const defects = (
  raised: Partial<Record<(typeof REVIEW_V2_DEFECTS)[number], boolean>> = {},
) =>
  Object.fromEntries(
    REVIEW_V2_DEFECTS.map((defect) => [defect, raised[defect] ?? false]),
  ) as ReviewV2["defects"];

const review = (
  axes: Partial<Record<(typeof REVIEW_V2_AXES)[number], number>> = {},
  raised: Partial<Record<(typeof REVIEW_V2_DEFECTS)[number], boolean>> = {},
  extra: Partial<ReviewV2> = {},
): ReviewV2 => ({
  sufficientEvidence: true,
  semantic: 4,
  motion: 4,
  hierarchy: 4,
  detail: 4,
  smoothness: 4,
  beauty: 4,
  ...axes,
  defects: defects(raised),
  observations: [{ criterion: "one bolt", result: "pass", evidence: "0.4 s" }],
  verdict: "Reads as a bolt.",
  directorNotes: ["denser secondary particles, longer erosion tail"],
  ...extra,
});

test("the six axis weights are a partition, so the score stays on the v1 scale", () => {
  assert.equal(
    Number(
      REVIEW_V2_AXES.reduce(
        (sum, axis) => sum + REVIEW_V2_WEIGHTS[axis],
        0,
      ).toFixed(4),
    ),
    1,
  );
  assert.deepEqual(
    [...REVIEW_V2_AXES].sort(),
    [
      "beauty",
      "detail",
      "hierarchy",
      "motion",
      "semantic",
      "smoothness",
    ].sort(),
  );
  // A flat 5 across a clean checklist is exactly 5; a flat 0 is exactly 0.
  assert.equal(
    scoreV2(
      review({
        semantic: 5,
        motion: 5,
        hierarchy: 5,
        detail: 5,
        smoothness: 5,
        beauty: 5,
      }),
    ),
    5,
  );
  assert.equal(
    scoreV2(
      review({
        semantic: 0,
        motion: 0,
        hierarchy: 0,
        detail: 0,
        smoothness: 0,
        beauty: 0,
      }),
    ),
    0,
  );
});

test("the weighted score follows the stated axis weights", () => {
  const scored = review({
    semantic: 4,
    motion: 3,
    hierarchy: 5,
    detail: 2,
    smoothness: 1,
    beauty: 4,
  });
  // 4*.25 + 3*.2 + 5*.15 + 2*.15 + 1*.1 + 4*.15 = 1 + .6 + .75 + .3 + .1 + .6
  assert.equal(scoreV2(scored), 3.35);
  assert.equal(scoreV2(undefined), -1);
  assert.equal(scoreV2(review({}, {}, { sufficientEvidence: false })), -1);
});

test("each admitted defect costs 0.3 on its own axis and nothing on the others", () => {
  for (const defect of REVIEW_V2_DEFECTS) {
    const charged = REVIEW_V2_DEFECT_AXIS[defect];
    const scores = axisScoresV2(review({}, { [defect]: true }));
    for (const axis of REVIEW_V2_AXES)
      assert.equal(
        scores[axis],
        axis === charged ? 4 - DEFECT_PENALTY_V2 : 4,
        `${defect} -> ${axis}`,
      );
    assert.equal(
      scoreV2(review({}, { [defect]: true })),
      Number((4 - DEFECT_PENALTY_V2 * REVIEW_V2_WEIGHTS[charged]).toFixed(4)),
    );
  }
});

test("defects stack on a shared axis and clamp at zero, never below", () => {
  // uniformParticles, visibleCards and aliasedEdges are all charged to detail.
  const stacked = review(
    { detail: 0.5 },
    { uniformParticles: true, visibleCards: true, aliasedEdges: true },
  );
  assert.equal(axisScoresV2(stacked).detail, 0);
  assert.equal(defectCountV2(stacked), 3);
  // detail contributes nothing; the other five axes are untouched at 4.
  assert.equal(
    scoreV2(stacked),
    Number((4 * (1 - REVIEW_V2_WEIGHTS.detail)).toFixed(4)),
  );
});

test("acceptance needs the weighted bar AND every charged axis at three", () => {
  const strong = review({
    semantic: 4,
    motion: 4,
    hierarchy: 4,
    detail: 4,
    smoothness: 4,
    beauty: 4,
  });
  assert.equal(scoreV2(strong), 4);
  assert.equal(acceptanceV2(strong), "proposed");

  // 3.8 exactly, every axis at 3.8: the bar is inclusive.
  const onTheLine = review({
    semantic: 3.8,
    motion: 3.8,
    hierarchy: 3.8,
    detail: 3.8,
    smoothness: 3.8,
    beauty: 3.8,
  });
  assert.equal(scoreV2(onTheLine), 3.8);
  assert.equal(acceptanceV2(onTheLine), "proposed");

  // A high average cannot buy a weak axis: smoothness falls to 2.9 once the
  // score is charged, and the weighted total still clears 3.8.
  const lopsided = review({
    semantic: 5,
    motion: 5,
    hierarchy: 5,
    detail: 5,
    smoothness: 3.2,
    beauty: 5,
  });
  assert.ok(scoreV2(lopsided) >= 3.8);
  assert.equal(acceptanceV2(lopsided), "proposed");
  const jittery = review(
    {
      semantic: 5,
      motion: 5,
      hierarchy: 5,
      detail: 5,
      smoothness: 3.2,
      beauty: 5,
    },
    { linearMotion: false },
  );
  jittery.smoothness = 2.9;
  assert.ok(scoreV2(jittery) >= 3.8);
  assert.equal(acceptanceV2(jittery), "rework");

  assert.equal(acceptanceV2(undefined), "rework");
  assert.equal(
    acceptanceV2(review({}, {}, { sufficientEvidence: false })),
    "rework",
  );
});

test("a reviewer answer parses, and an incomplete checklist does not", () => {
  const answer = {
    sufficientEvidence: true,
    semantic: 4.5,
    motion: 3,
    hierarchy: 4,
    detail: 2.5,
    smoothness: 3.5,
    beauty: 4,
    defects: {
      uniformParticles: true,
      visibleCards: false,
      washout: false,
      linearMotion: true,
      simultaneousDeath: false,
      floating: true,
      smallInFrame: false,
      aliasedEdges: false,
      flatColor: false,
    },
    observations: [
      { criterion: "one connected bolt", result: "pass", evidence: "0.36 s" },
      { criterion: "white core", result: "fail", evidence: "0.42 s, orange" },
    ],
    verdict: "Reads as lightning but never touches the ground.",
    directorNotes: [
      "add a ground decal and contact light under the strike",
      "stagger the ember lifetimes and widen the size range",
    ],
  };
  const parsed = ReviewV2Schema.parse(answer);
  assert.equal(defectCountV2(parsed), 3);
  assert.deepEqual(
    validateReviewV2Criteria(answer, ["one connected bolt", "white core"]),
    parsed,
  );
  // The same rule v1 enforces: no omitting, substituting or reordering.
  assert.throws(
    () => validateReviewV2Criteria(answer, ["white core"]),
    /original criteria/,
  );
  assert.throws(
    () =>
      validateReviewV2Criteria(answer, ["white core", "one connected bolt"]),
    /original criteria/,
  );
  // A checklist the reviewer left half-answered is not a review.
  const partial = {
    ...answer,
    defects: { ...answer.defects, flatColor: undefined },
  };
  assert.equal(ReviewV2Schema.safeParse(partial).success, false);
  // Neither is one that invents an extra defect, or more than three notes.
  assert.equal(
    ReviewV2Schema.safeParse({
      ...answer,
      defects: { ...answer.defects, blurry: true },
    }).success,
    false,
  );
  assert.equal(
    ReviewV2Schema.safeParse({
      ...answer,
      directorNotes: ["a", "b", "c", "d"],
    }).success,
    false,
  );
  assert.equal(
    ReviewV2Schema.safeParse({ ...answer, semantic: 6 }).success,
    false,
  );
});

test("improvesV2 needs the margin, and refuses a trade of one defect for another", () => {
  const baseline = review({ semantic: 3, motion: 3 }, { floating: true });
  const better = review({ semantic: 4, motion: 4 }, { floating: true });
  assert.ok(scoreV2(better) > scoreV2(baseline) + 0.15);
  assert.ok(improvesV2(better, baseline));

  // Fixing the defect as well is still an improvement.
  assert.ok(improvesV2(review({ semantic: 4, motion: 4 }), baseline));

  // Too small a gain.
  assert.equal(
    improvesV2(
      review({ semantic: 3.2, motion: 3 }, { floating: true }),
      baseline,
    ),
    false,
  );
  // A new defect the baseline did not admit, however good the score.
  assert.equal(
    improvesV2(
      review({ semantic: 5, motion: 5 }, { floating: true, washout: true }),
      baseline,
    ),
    false,
  );
  // Same count, different defect: a trade, not a repair.
  assert.equal(
    improvesV2(review({ semantic: 5, motion: 5 }, { washout: true }), baseline),
    false,
  );
  // Unreadable evidence never improves anything.
  assert.equal(improvesV2(undefined, baseline), false);
  assert.equal(
    improvesV2(
      review({ semantic: 5, motion: 5 }, {}, { sufficientEvidence: false }),
      baseline,
    ),
    false,
  );
  // A criterion that passed may not start failing.
  assert.equal(
    improvesV2(
      review(
        { semantic: 5, motion: 5 },
        {},
        {
          observations: [
            { criterion: "one bolt", result: "fail", evidence: "gone" },
          ],
        },
      ),
      baseline,
    ),
    false,
  );
  // An axis may not fall below three once the baseline had it there.
  assert.equal(
    improvesV2(
      review({ semantic: 5, motion: 5, smoothness: 2 }, { floating: true }),
      baseline,
    ),
    false,
  );
});

test("jitterScore separates a clean ramp from a stepped one, and ignores the impact", () => {
  const smooth = Array.from({ length: 40 }, (_, i) => i / 39);
  assert.equal(jitterScore(smooth, 30, 0.5), 0);

  // A staircase covering the same range: it holds for three frames and jumps on
  // the fourth, and those jumps are what the measure is looking for.
  const stepped = Array.from({ length: 40 }, (_, i) => Math.floor(i / 4) / 9);
  assert.ok(jitterScore(stepped, 30, -1) > jitterScore(smooth, 30, -1));
  assert.ok(jitterScore(stepped, 30, -1) > 0);

  // A single flash at 0.5 s is a deliberate discontinuity, so excluding the
  // impact window removes it from the measure entirely.
  const flash = Array.from({ length: 40 }, (_, i) => (i === 15 ? 1 : 0.1));
  assert.ok(jitterScore(flash, 30, -1) > 0);
  assert.equal(jitterScore(flash, 30, 15 / 30), 0);

  assert.equal(jitterScore([0.5, 0.5], 30, -1), 0);
  assert.throws(() => jitterScore([1], 30));
  assert.throws(() => jitterScore([0, Number.NaN], 30));
});

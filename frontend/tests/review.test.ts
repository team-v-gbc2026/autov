import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewCriteria } from "../src/lib/vfx-lab/protocol";
test("a critic cannot omit, substitute or reorder the original evaluation criteria", () => {
  const criteria = ["one connected beam", "white core"],
    r = {
      sufficientEvidence: true,
      semantic: 4,
      motion: 4,
      hierarchy: 4,
      finish: 4,
      verdict: "readable",
      diagnoses: [],
      observations: criteria.map((criterion) => ({
        criterion,
        result: "pass",
        evidence: "visible",
      })),
    };
  assert.deepEqual(validateReviewCriteria(r, criteria), r);
  for (const observations of [
    r.observations.slice(0, 1),
    [...r.observations].reverse(),
    [r.observations[0], r.observations[0]],
  ])
    assert.throws(
      () => validateReviewCriteria({ ...r, observations }, criteria),
      /original criteria/,
    );
});

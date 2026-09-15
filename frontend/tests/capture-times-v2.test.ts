import { test } from "node:test";
import assert from "node:assert/strict";
import { captureTimesV2 } from "../src/lib/vfx-lab/capture-v2";
import { addLayer, createWorkspaceDocument } from "../src/lib/vfx-lab/ui-bridge";
import type { VfxDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

/** A document whose single layer runs for `end` seconds of a longer duration. */
function document(duration: number, end = duration): VfxDocumentV2 {
  const base = addLayer(createWorkspaceDocument("coverage"), 0);
  const layers = base.layers.map((layer) => ({ ...layer, enabled: true, start: 0, end }));
  if (!layers.length) throw new Error("fixture needs at least one layer");
  return { ...base, duration, impact: Math.min(base.impact, end / 2), layers };
}

test("every returned set is chronological, for contact sheets", () => {
  for (const limit of [3, 6, 12, 24]) {
    const times = captureTimesV2(document(10), limit);
    assert.deepEqual([...times].sort((a, b) => a - b), times, `limit ${limit} must be sorted`);
  }
});

test("a small still budget still spans the effect rather than clustering at the start", () => {
  const duration = 10;
  const times = captureTimesV2(document(duration), 6);
  assert.equal(times.length, 6);
  // The regression this guards: slicing a sorted 24-time set returned only the
  // first ~25% of the effect. Real coverage must reach the final quarter.
  assert.ok(
    times[times.length - 1] > duration * 0.75,
    `last still ${times[times.length - 1]} should be in the final quarter of ${duration}s`,
  );
  assert.ok(times[0] < duration * 0.25, "coverage should still include the opening");
});

test("stills stop at the last active frame instead of trailing into empty time", () => {
  // Twelve seconds of document, but everything is over by four.
  const times = captureTimesV2(document(12, 4), 6);
  assert.ok(
    times.every((time) => time <= 4),
    `no still should fall after the last layer ends: ${times.join(", ")}`,
  );
});

test("the default keeps the full contact-sheet budget", () => {
  assert.equal(captureTimesV2(document(10)).length, 24);
});

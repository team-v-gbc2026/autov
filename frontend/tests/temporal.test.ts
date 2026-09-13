import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeActivity,
  measureFrameActivity,
} from "../src/lib/vfx-lab/temporal";
import { TemporalDiagnosticsSchema } from "../src/lib/vfx-lab/protocol";

test("dense rendered activity locates an internal gap without treating the empty lead-in and tail as gaps", () => {
  const energies = [0, 0, 20, 60, 100, 80, 0, 0, 45, 30, 15, 0, 0];
  const result = summarizeActivity(energies, 30);
  assert.deepEqual(result.lowActivityIntervals, [[0.2, 0.2333]]);
  assert.equal(result.abruptDrops[0].time, 0.2);
  assert.equal(TemporalDiagnosticsSchema.safeParse(result).success, true);
  const continuous = summarizeActivity([0, 20, 40, 100, 80, 60, 40, 20, 0]);
  assert.deepEqual(continuous.lowActivityIntervals, []);
  const blank = summarizeActivity(Array(361).fill(0));
  assert.deepEqual(blank.abruptDrops, []);
  assert(blank.activityCurve.every(([, v]) => v === 0));
  assert.equal(blank.activityCurve.length, 41);
});

test("activity compares rendered RGB to the same background and preserves an exact fractional endpoint", () => {
  const background = Uint8ClampedArray.from([25, 25, 25, 0, 25, 25, 25, 255]);
  assert.equal(
    measureFrameActivity([25, 25, 25, 255, 36, 25, 25, 255], background),
    0,
  );
  assert.equal(
    measureFrameActivity([25, 25, 25, 255, 55, 25, 25, 255], background),
    30,
  );
  const result = summarizeActivity(Array(33).fill(1), 30, 1.05);
  assert.equal(result.activityCurve.at(-1)?.[0], 1.05);
  assert.throws(() => summarizeActivity([0, NaN]));
  assert.throws(() => measureFrameActivity([1, 2, 3, 4], []));
  assert.equal(
    TemporalDiagnosticsSchema.safeParse({ ...result, frames: 10000 }).success,
    false,
  );
});

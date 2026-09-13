import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FEATURE_WEIGHTS,
  FEATURE_NAMES,
  FEATURE_SCALE_FLOORS,
  featureVector,
  featuresFromVector,
  featuresFromMask,
  luminance,
  maskAgainstBackground,
  maskStill,
  meanFeatures,
  renderedFrameFeatures,
  stillFeatures,
  type RgbaFrame,
} from "../src/lib/vfx-lab/features-v2";

// --- synthetic frames ------------------------------------------------------

function blank(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { width, height, data } satisfies RgbaFrame;
}

function paintRect(
  frame: RgbaFrame,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) {
  const data = frame.data as Uint8ClampedArray;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * frame.width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  return frame;
}

test("a bright rectangle over a flat plate has the area, occupancy and percentiles it was drawn with", () => {
  const background = blank(100, 100, [10, 10, 10]);
  const frame = paintRect(blank(100, 100, [10, 10, 10]), 20, 10, 40, 50, [
    200, 200, 200,
  ]);
  const { features, mask } = renderedFrameFeatures(frame, background);
  assert.equal(mask.count, 40 * 50);
  assert.equal(features.area, 0.2);
  // The bbox trim clips 1% off each end of a 2000-pixel block, so the extent
  // comes back a shade under the drawn 50/100 and 40/100.
  assert.ok(Math.abs(features.occupancyH - 0.5) < 0.02, `${features.occupancyH}`);
  assert.ok(Math.abs(features.occupancyW - 0.4) < 0.02, `${features.occupancyW}`);
  const expected = luminance(200, 200, 200);
  for (const p of [features.p50, features.p90, features.p99])
    assert.ok(Math.abs(p - expected) < 1e-9);
  assert.equal(features.sat, 0);
  assert.equal(features.washout, 0);
  // Only the rectangle's own border carries a gradient, so edge density is
  // small but non-zero.
  assert.ok(features.edge > 0 && features.edge < 0.2, `${features.edge}`);
});

test("the difference threshold follows the plate's noise instead of a fixed constant", () => {
  const clean = blank(64, 64, [12, 12, 12]);
  const quiet = maskAgainstBackground(clean, clean, {});
  assert.equal(quiet.count, 0);
  assert.equal(quiet.noise, 0);
  assert.ok(quiet.threshold > 0, "a noiseless plate still needs a positive bar");

  // A plate with +/- 6 counts of dither: a 10-count wash must not register.
  const noisy = blank(64, 64, [12, 12, 12]);
  const noisyData = noisy.data as Uint8ClampedArray;
  for (let p = 0; p < 64 * 64; p++) {
    const v = 12 + (p % 2 ? 6 : -6);
    noisyData[p * 4] = v;
    noisyData[p * 4 + 1] = v;
    noisyData[p * 4 + 2] = v;
  }
  const wash = blank(64, 64, [22, 22, 22]);
  const against = maskAgainstBackground(wash, noisy, {});
  assert.ok(against.noise > 0, "dithered plate has a measurable MAD");
  assert.ok(
    against.threshold > 10 / 255,
    `threshold ${against.threshold} should exceed the 10-count wash`,
  );
  assert.equal(against.count, 0);
});

test("a still is masked against its own per-row side margins, so a vertical gradient is background", () => {
  const width = 120;
  const height = 80;
  const frame = blank(width, height, [0, 0, 0]);
  const data = frame.data as Uint8ClampedArray;
  // Background: a strong top-to-bottom gradient, like the benchmark stills.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = Math.round(70 * (1 - y / height));
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  const withEffect = { width, height, data: Uint8ClampedArray.from(data) };
  paintRect(withEffect, 50, 20, 20, 40, [180, 40, 200]);

  const backgroundOnly = maskStill(frame);
  assert.equal(
    backgroundOnly.count,
    0,
    "a pure gradient must not read as foreground",
  );
  const { features, mask } = stillFeatures(withEffect);
  assert.equal(mask.count, 20 * 40);
  assert.ok(Math.abs(features.area - (20 * 40) / (width * height)) < 1e-9);
  assert.ok(features.sat > 0.7, `saturated magenta, got ${features.sat}`);
  // This magenta sits at ~292 degrees: cos just positive, sin strongly negative.
  assert.ok(features.hueCos > 0 && features.hueSin < -0.8);
  assert.ok(Math.abs(Math.hypot(features.hueCos, features.hueSin) - 1) < 1e-9);
});

test("washout counts only pixels blown out in every channel", () => {
  const background = blank(40, 40, [0, 0, 0]);
  const frame = blank(40, 40, [0, 0, 0]);
  paintRect(frame, 0, 0, 20, 40, [255, 255, 255]);
  paintRect(frame, 20, 0, 20, 40, [255, 250, 100]);
  const { features } = renderedFrameFeatures(frame, background);
  assert.equal(features.area, 1);
  assert.ok(Math.abs(features.washout - 0.5) < 1e-9, `${features.washout}`);
  assert.ok(features.p99 > 0.99);
});

test("the dominant hue is the luminance-weighted mean and the accent is a separate mode", () => {
  const background = blank(60, 60, [0, 0, 0]);
  const frame = blank(60, 60, [0, 0, 0]);
  // Mostly red with a cyan sliver. Cyan is the brighter hue, so the sliver has
  // to be small before the luminance weighting lets red win — which is the
  // point of weighting at all.
  paintRect(frame, 0, 0, 55, 60, [200, 0, 0]);
  paintRect(frame, 55, 0, 5, 60, [0, 200, 200]);
  const { features } = renderedFrameFeatures(frame, background);
  assert.ok(features.hueCos > 0.9, `red dominant, got ${features.hueCos}`);
  assert.ok(Math.abs(features.hueSin) < 0.2);
  // Cyan is 180 degrees away.
  assert.ok(features.accentCos < -0.9, `cyan accent, got ${features.accentCos}`);
});

test("an empty foreground yields an all-zero vector rather than NaN", () => {
  const plate = blank(32, 32, [5, 5, 5]);
  const { features } = renderedFrameFeatures(plate, plate);
  assert.deepEqual(
    featureVector(features),
    FEATURE_NAMES.map(() => 0),
  );
});

test("vector round-trips, means are component-wise, and every feature has a weight and a scale floor", () => {
  const values = FEATURE_NAMES.map((_, i) => (i + 1) / 20);
  assert.deepEqual(featureVector(featuresFromVector(values)), values);
  const a = featuresFromVector(FEATURE_NAMES.map(() => 0));
  const b = featuresFromVector(FEATURE_NAMES.map(() => 1));
  assert.deepEqual(
    featureVector(meanFeatures([a, b])),
    FEATURE_NAMES.map(() => 0.5),
  );
  for (const name of FEATURE_NAMES) {
    assert.ok(DEFAULT_FEATURE_WEIGHTS[name] > 0, name);
    assert.ok(FEATURE_SCALE_FLOORS[name] > 0, name);
  }
  assert.throws(() => featuresFromVector([1, 2, 3]));
});

test("a mask of the wrong size and a malformed frame are rejected", () => {
  const frame = blank(8, 8, [0, 0, 0]);
  assert.throws(() => featuresFromMask(frame, new Uint8Array(10)));
  assert.throws(() =>
    featuresFromMask({ width: 8, height: 8, data: new Uint8ClampedArray(4) }, new Uint8Array(64)),
  );
});

test("the silhouette signature separates a tall column from a wide dome of the same area", () => {
  const plate = blank(120, 120, [0, 0, 0]);
  // Same pixel count, opposite proportions.
  const column = paintRect(blank(120, 120, [0, 0, 0]), 50, 10, 20, 100, [200, 200, 200]);
  const dome = paintRect(blank(120, 120, [0, 0, 0]), 10, 80, 100, 20, [200, 200, 200]);
  const tall = renderedFrameFeatures(column, plate).features;
  const wide = renderedFrameFeatures(dome, plate).features;

  assert.ok(Math.abs(tall.area - wide.area) < 1e-9, "the two must match on area");
  assert.ok(tall.elongation > 4, `${tall.elongation}`);
  assert.ok(wide.elongation < 0.3, `${wide.elongation}`);
  // The column spans every row band (the two end bands only partly, since it
  // starts and stops inside them); the dome fills only two bands near the floor.
  for (let i = 1; i < 7; i++)
    assert.ok(tall[`vprof${i}` as never] > 0.95, `band ${i}`);
  assert.ok(tall.vprof0 > 0.2 && tall.vprof7 > 0.2);
  for (let i = 0; i < 4; i++) assert.equal(wide[`vprof${i}` as never], 0, `band ${i}`);
  assert.ok(wide.vprof5 > 0.5 && wide.vprof6 > 0.5);
  // Centroid: 1 is the top of the frame.
  assert.ok(tall.centroidY > wide.centroidY + 0.2, `${tall.centroidY} ${wide.centroidY}`);
  assert.ok(wide.centroidY < 0.3);
});

test("profiles are normalized by their own peak, so shape is read independently of area", () => {
  const plate = blank(80, 80, [0, 0, 0]);
  const small = paintRect(blank(80, 80, [0, 0, 0]), 34, 0, 10, 80, [120, 120, 120]);
  const large = paintRect(blank(80, 80, [0, 0, 0]), 25, 0, 30, 80, [120, 120, 120]);
  const a = renderedFrameFeatures(small, plate).features;
  const b = renderedFrameFeatures(large, plate).features;
  assert.ok(b.area > a.area * 2.9, `${a.area} ${b.area}`);
  // Both are full-height bars: every vertical band is equally covered.
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(a[`vprof${i}` as never] - 1) < 1e-9, `a ${i}`);
    assert.ok(Math.abs(b[`vprof${i}` as never] - 1) < 1e-9, `b ${i}`);
  }
});

test("a difference threshold floor can be raised for noisy sources", () => {
  const plate = blank(64, 64, [10, 10, 10]);
  const dithered = blank(64, 64, [10, 10, 10]);
  const data = dithered.data as Uint8ClampedArray;
  for (let p = 0; p < 64 * 64; p += 3) {
    data[p * 4] = 18;
    data[p * 4 + 1] = 18;
    data[p * 4 + 2] = 18;
  }
  // Default floor (one 8-bit code) lets the dither through.
  assert.ok(maskAgainstBackground(dithered, plate).count > 0);
  // A floor above the dither level does not.
  assert.equal(maskAgainstBackground(dithered, plate, { floor: 0.05 }).count, 0);
});

test("the difference mask assumes the effect is a minority of the frame", () => {
  // Documented limit, not a bug to be surprised by later: the threshold is
  // derived from the median of the difference image, so once the effect covers
  // half the frame the "background" the threshold describes is the effect, and
  // the mask empties out. Every real evaluation is guarded by the area ceiling
  // long before this.
  const plate = blank(80, 80, [0, 0, 0]);
  const half = paintRect(blank(80, 80, [0, 0, 0]), 0, 0, 40, 80, [120, 120, 120]);
  assert.equal(renderedFrameFeatures(half, plate).mask.count, 0);
  const third = paintRect(blank(80, 80, [0, 0, 0]), 0, 0, 26, 80, [120, 120, 120]);
  assert.equal(renderedFrameFeatures(third, plate).mask.count, 26 * 80);
});

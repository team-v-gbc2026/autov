import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEATURE_NAMES,
  featuresFromVector,
  maskAgainstBackground,
  type FrameFeatures,
  type RgbaFrame,
} from "../src/lib/vfx-lab/features-v2";
import {
  ENVELOPE_BINS,
  ENVELOPE_WEIGHT,
  PHASE_NAMES,
  analyzeReferenceVideo,
  binCentre,
  buildVideoReferenceSheet,
  documentPhaseTimes,
  documentWindowsFromCurve,
  envelopeFromAreaCurve,
  findPeaks,
  impactWindows,
  referenceTimeToDocument,
  sampleCurve,
  temporalBackground,
  temporalMedianBackground,
  type TimedFrame,
} from "../src/lib/vfx-lab/reference-features";
import {
  DEFAULT_GUARDS,
  calibrate,
  checkGuards,
  residualOf,
} from "../src/lib/vfx-lab/calibrate-v2";
import { validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

// --- a synthetic clip ------------------------------------------------------
//
// A bright blob on a dark set, growing and shrinking over 3 s at 10 fps, with
// a "character" bar that is present in every single frame — the thing gameplay
// footage always has and no background plate can remove.

const W = 64;
const H = 48;

function makeFrame(radius: number, noiseSeed: number, barX = 0): RgbaFrame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Set: a dark vertical gradient plus a bright bar. A static bar belongs
      // to the plate; a moving one is the gameplay-footage case the plate
      // cannot remove.
      let v = 12 + Math.round((y / H) * 8);
      if (x >= barX && x < barX + 5) v = 150;
      // Codec-ish dither: deterministic, +/- 2 codes.
      v += ((x * 7 + y * 13 + noiseSeed * 31) % 5) - 2;
      const cx = W / 2;
      const cy = H / 2;
      const inside = Math.hypot(x - cx, y - cy) < radius;
      data[i] = inside ? 250 : v;
      data[i + 1] = inside ? 90 : v;
      data[i + 2] = inside ? 250 : v;
      data[i + 3] = 255;
    }
  return { width: W, height: H, data };
}

/** Radii for a single clean 3 s event: nothing, grow, peak at 1.5 s, decay. */
const RADII = [0, 0, 1, 3, 5, 7, 9, 11, 13, 14, 15, 15, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLIP: TimedFrame[] = RADII.map((radius, i) => ({
  time: i / 10,
  frame: makeFrame(radius, i),
}));

test("the background plate is a low temporal quantile, not the median, so an effect-dominated clip still resolves", () => {
  // Nine frames, six of which carry a big blob: the median is the blob.
  const dominated = [3, 4, 5, 6, 7, 8].map((i) => CLIP[i].frame);
  const empty = [0, 1, 28].map((i) => CLIP[i].frame);
  const frames = [...dominated, ...empty];
  const median = temporalMedianBackground(frames);
  const low = temporalBackground(frames, 0.2);
  const centre = ((H / 2) * W + W / 2) * 4;
  assert.ok(median.data[centre] > 200, "the median plate has swallowed the effect");
  assert.ok(low.data[centre] < 60, "the low quantile plate is the dark set");
  assert.throws(() => temporalBackground([]));
  assert.throws(() =>
    temporalBackground([CLIP[0].frame, { width: 2, height: 2, data: new Uint8ClampedArray(16) }]),
  );
});

test("peak finding ignores start and end shoulders and separates repeats", () => {
  // A monotone rise: the last sample is the maximum and the only peak.
  assert.deepEqual(findPeaks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), [10]);
  // A clip that starts mid-effect: sample 0 is a shoulder, not an event.
  assert.deepEqual(findPeaks([9, 8, 6, 3, 0, 3, 7, 10, 7, 3, 0]), [7]);
  // Two separated events: both found, first one first.
  const twice = [0, 4, 10, 4, 0, 0, 0, 3, 9, 3, 0];
  assert.deepEqual(findPeaks(twice), [2, 8]);
  assert.deepEqual(findPeaks([0, 0, 0]), []);
});

test("a clean synthetic clip yields one peak, ordered phases and a bell envelope", () => {
  const analysis = analyzeReferenceVideo(CLIP);
  assert.equal(analysis.frames, CLIP.length);
  assert.ok(Math.abs(analysis.fps - 10) < 1e-9);
  assert.equal(analysis.peakCount, 1);
  assert.equal(analysis.confidence, "high");
  // The blob is largest at 1.0-1.1 s.
  assert.ok(Math.abs(analysis.peakTime - 1.05) <= 0.15, `${analysis.peakTime}`);
  // The bar never moves, so the plate absorbs it and there is no resting level.
  assert.ok(analysis.floorArea < 0.02, `${analysis.floorArea}`);
  assert.ok(!analysis.notes.some((n) => n.includes("resting level")));

  const { anticipation, peak, dissipation } = analysis.windows;
  assert.ok(anticipation.start <= anticipation.end);
  assert.ok(anticipation.end <= peak.start + 1e-9);
  assert.ok(peak.end <= dissipation.end);
  assert.ok(Math.abs(peak.end - peak.start - 0.15) < 1e-9, "the peak window is 0.15 s");

  assert.equal(analysis.envelope.length, ENVELOPE_BINS);
  assert.ok(analysis.envelope.every((v) => v >= 0 && v <= 1));
  const top = analysis.envelope.indexOf(Math.max(...analysis.envelope));
  assert.ok(top > 2 && top < ENVELOPE_BINS - 3, `envelope peaks at bin ${top}`);
  assert.ok(analysis.envelope[0] < 0.3 && analysis.envelope[ENVELOPE_BINS - 1] < 0.3);

  // Every phase target is a real feature vector, not a hole.
  for (const phase of ["anticipation", "peak", "dissipation"] as const)
    for (const name of FEATURE_NAMES)
      assert.ok(Number.isFinite(analysis.targets[phase][name]), `${phase}.${name}`);
  assert.ok(analysis.targets.peak.area > analysis.targets.anticipation.area);
  assert.throws(() => analyzeReferenceVideo(CLIP.slice(0, 2)));
});

test("a moving set element becomes a resting level that is subtracted and flagged", () => {
  // The bar walks across the frame, so it is foreground in every frame — what
  // a character in real gameplay footage does to the mask.
  const moving: TimedFrame[] = RADII.map((radius, i) => ({
    time: i / 10,
    frame: makeFrame(radius, i, (i * 2) % 40),
  }));
  const analysis = analyzeReferenceVideo(moving);
  assert.ok(analysis.floorArea > 0.05, `${analysis.floorArea}`);
  assert.ok(analysis.notes.some((n) => n.includes("resting level")));
  // Despite the permanent contamination the event is still found in the middle.
  assert.ok(analysis.peakTime > 0.5 && analysis.peakTime < 2, `${analysis.peakTime}`);
  // The contamination is still inside the per-phase targets, which is why the
  // note exists rather than a silent correction.
  assert.ok(analysis.targets.dissipation.area > 0.05);
});

test("the video noise floor keeps codec dither out of the foreground", () => {
  const frames = CLIP.map((f) => f.frame);
  const plate = temporalBackground(frames);
  // An empty frame against the plate: dither only.
  const bare = maskAgainstBackground(CLIP[0].frame, plate);
  const floored = maskAgainstBackground(CLIP[0].frame, plate, { floor: 0.05 });
  assert.ok(floored.count <= bare.count);
  assert.ok(
    floored.count / (W * H) < 0.02,
    `an empty frame should read as almost nothing, got ${floored.count / (W * H)}`,
  );
});

// --- document-side anchoring ----------------------------------------------

const doc = validateDocumentV2(
  JSON.parse(readFileSync("fixtures/v2/fire-projectile/document.json", "utf8")),
);

test("document phases are anchored on impact, never on a share of the duration", () => {
  const windows = impactWindows({ ...doc, duration: 4, impact: 1 });
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(windows.anticipation.start, 0.2);
  near(windows.anticipation.end, 1);
  near(windows.peak.start, 1);
  near(windows.peak.end, 1.15);
  near(windows.dissipation.start, 1.9);
  near(windows.dissipation.end, 3.4);
  // An impact at the very start still yields ordered, non-empty windows.
  const early = impactWindows({ ...doc, duration: 2, impact: 0 });
  assert.equal(early.anticipation.start, 0);
  assert.ok(early.peak.end > early.peak.start);
  assert.ok(early.dissipation.start < early.dissipation.end);
});

test("reference time maps onto document time with the peak pinned to impact", () => {
  const analysis = { peakTime: 2, span: [1, 5] as [number, number] };
  const target = { ...doc, duration: 4, impact: 1 };
  assert.ok(Math.abs(referenceTimeToDocument(2, analysis, target) - 1) < 1e-9);
  // Start of the reference span maps to the start of the document.
  assert.ok(Math.abs(referenceTimeToDocument(1, analysis, target) - 0) < 1e-9);
  // End of the span maps to the end of the document.
  assert.ok(Math.abs(referenceTimeToDocument(5, analysis, target) - 3.999) < 1e-3);
  // Monotone, and always inside the document.
  let previous = -1;
  for (let t = 0; t <= 6; t += 0.25) {
    const mapped = referenceTimeToDocument(t, analysis, target);
    assert.ok(mapped >= previous - 1e-12, `${t}`);
    assert.ok(mapped >= 0 && mapped < target.duration);
    previous = mapped;
  }
});

test("sampleCurve interpolates and clamps, and bin centres cover the span", () => {
  assert.equal(sampleCurve([0, 1, 2], [0, 10, 20], -5), 0);
  assert.equal(sampleCurve([0, 1, 2], [0, 10, 20], 9), 20);
  assert.equal(sampleCurve([0, 1, 2], [0, 10, 20], 0.5), 5);
  assert.equal(sampleCurve([], [], 1), 0);
  assert.ok(binCentre(0, 1, 0, 4) === 0.125 && binCentre(0, 1, 3, 4) === 0.875);
});

// --- envelope as a residual ------------------------------------------------

test("the envelope becomes weighted residual terms that vanish on a perfect match", () => {
  const analysis = analyzeReferenceVideo(CLIP);
  const sheet = buildVideoReferenceSheet({ case: "synthetic", doc, analysis });
  assert.ok(sheet.envelope);
  assert.equal(sheet.envelope!.bins, ENVELOPE_BINS);
  assert.equal(sheet.envelope!.weight, ENVELOPE_WEIGHT);
  assert.equal(sheet.envelope!.values.length, ENVELOPE_BINS);
  assert.equal(sheet.envelope!.documentTimes.length, ENVELOPE_BINS);
  assert.ok(sheet.envelope!.sampleTimes.length >= 2);
  assert.ok(
    sheet.envelope!.sampleTimes.every((t) => t >= 0 && t < doc.duration),
    "every curve sample must be renderable",
  );
  assert.ok(sheet.phases.every((p) => p.source === "video"));
  assert.ok(sheet.notes.some((n) => n.includes("anchored on impact")));

  // A render whose (normalized) area curve reproduces the target exactly adds
  // nothing to the residual; the phase features are matched too.
  const exact = sheet.envelope!.documentTimes.map((_, k) => sheet.envelope!.values[k]);
  const withCurve = residualOf(sheet, analysis.targets, undefined, exact);
  const withoutCurve = residualOf(sheet, analysis.targets, undefined, []);
  assert.equal(withCurve.values.length, withoutCurve.values.length);
  assert.equal(
    withCurve.labels.filter((l) => l.startsWith("envelope.")).length,
    ENVELOPE_BINS,
  );
  assert.ok(withCurve.norm < 1e-9, `${withCurve.norm}`);
  assert.ok(withoutCurve.norm > 1, "a missing curve must cost, not be ignored");

  // And a sheet without an envelope adds no envelope rows at all.
  const plain = { ...sheet, envelope: null };
  assert.equal(
    residualOf(plain, analysis.targets).labels.filter((l) => l.startsWith("envelope."))
      .length,
    0,
  );
});

test("a render's area curve is peak-normalized before it is compared", () => {
  const analysis = analyzeReferenceVideo(CLIP);
  const sheet = buildVideoReferenceSheet({ case: "synthetic", doc, analysis });
  const times = sheet.envelope!.sampleTimes;
  const areas = times.map((t) => 0.1 + 0.2 * Math.sin((Math.PI * t) / doc.duration));
  const a = envelopeFromAreaCurve(sheet, times, areas);
  // Ten times brighter/bigger, same shape: the same envelope.
  const b = envelopeFromAreaCurve(
    sheet,
    times,
    areas.map((v) => v * 10),
  );
  assert.equal(a.length, ENVELOPE_BINS);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `bin ${i}`));
  assert.ok(Math.max(...a) <= 1 + 1e-12);
  // An all-zero curve is a legitimate (bad) answer, not a crash.
  assert.deepEqual(
    envelopeFromAreaCurve(sheet, times, times.map(() => 0)),
    new Array(ENVELOPE_BINS).fill(0),
  );
  assert.throws(() => envelopeFromAreaCurve(sheet, times, [1, 2]));
  assert.deepEqual(
    envelopeFromAreaCurve({ ...sheet, envelope: null }, times, areas),
    [],
  );
});

test("a repeating clip anchors on its first event and says so", () => {
  // The same event three times over: only the first is the one the document
  // renders once.
  const repeated: TimedFrame[] = [];
  for (let repeat = 0; repeat < 3; repeat++)
    RADII.slice(0, 24).forEach((radius, i) =>
      repeated.push({
        time: (repeat * 24 + i) / 10,
        frame: makeFrame(radius, repeat * 24 + i),
      }),
    );
  const analysis = analyzeReferenceVideo(repeated);
  assert.ok(analysis.peakCount >= 2, `${analysis.peakCount}`);
  assert.ok(analysis.peakTime < 2, `anchored at ${analysis.peakTime}`);
  assert.ok(analysis.confidence !== "high");
  assert.ok(analysis.notes.some((n) => n.includes("it repeats")));
  // The dissipation window must stop before the second event starts.
  assert.ok(analysis.windows.dissipation.end < 2.4, `${analysis.windows.dissipation.end}`);
  assert.ok(analysis.span[1] <= 2.4);
});

test("phase targets survive a degenerate window instead of producing NaN", () => {
  // A clip with no quiet lead-in at all: the anticipation window collapses.
  const abrupt: TimedFrame[] = [15, 15, 14, 12, 8, 4, 1, 0, 0, 0].map((radius, i) => ({
    time: i / 10,
    frame: makeFrame(radius, i),
  }));
  const analysis = analyzeReferenceVideo(abrupt);
  for (const phase of ["anticipation", "peak", "dissipation"] as const)
    for (const name of FEATURE_NAMES)
      assert.ok(Number.isFinite(analysis.targets[phase][name]), `${phase}.${name}`);
  const sheet = buildVideoReferenceSheet({ case: "abrupt", doc, analysis });
  assert.ok(sheet.phases.every((p) => p.sampleTimes.length >= 1));
  assert.ok(
    residualOf(sheet, analysis.targets, undefined, sheet.envelope!.values).norm < 1e-9,
  );
});

test("an empty feature vector is a legal, maximally wrong answer", () => {
  const analysis = analyzeReferenceVideo(CLIP);
  const sheet = buildVideoReferenceSheet({ case: "synthetic", doc, analysis });
  const blank = featuresFromVector(FEATURE_NAMES.map(() => 0));
  const residual = residualOf(
    sheet,
    { anticipation: blank, peak: blank, dissipation: blank },
    undefined,
    new Array(ENVELOPE_BINS).fill(0),
  );
  assert.ok(residual.values.every(Number.isFinite));
  assert.ok(residual.norm > 0);
});

test("every logged evaluation carries the envelope it was scored on", async () => {
  const analysis = analyzeReferenceVideo(CLIP);
  const sheet = buildVideoReferenceSheet({ case: "synthetic", doc, analysis });
  const result = await calibrate({
    sheet,
    // A renderer whose curve is always half the target's: the envelope rows
    // must be a constant, non-zero share of every evaluation's residual.
    evaluate: async () => ({
      features: analysis.targets,
      visibleLayers: 3,
      envelope: sheet.envelope!.values.map((v) => v / 2),
    }),
    method: "coordinate",
    budget: 5,
  });
  assert.equal(result.evaluations.length, 5);
  for (const record of result.evaluations) {
    assert.equal(record.envelope?.length, ENVELOPE_BINS);
    assert.ok((record.envelopeNorm ?? 0) > 0);
    // Nothing but the envelope is wrong here, so it is the whole residual.
    assert.ok(Math.abs(record.envelopeNorm! - record.residualNorm) < 1e-9);
  }
});

test("document phases are read off the document's own rendered area curve", () => {
  // A rise to a clear peak at 1.0 s, then a decay: 0 .. 0.1 .. 1.0 .. 0.
  const times = Array.from({ length: 21 }, (_, i) => i / 10);
  const areas = [
    0, 0.002, 0.01, 0.05, 0.12, 0.2, 0.28, 0.34, 0.38, 0.39, 0.4,
    0.36, 0.3, 0.22, 0.16, 0.1, 0.06, 0.03, 0.012, 0.004, 0,
  ];
  const m = documentWindowsFromCurve(times, areas, 2.1);
  // The peak is sub-sample: the parabola through 0.39/0.40/0.36 sits just left
  // of the sample at 1.0 s. Snapping to the sample is what round three's first
  // pilot did, and it made the objective jump under the optimizer's feet.
  assert.ok(Math.abs(m.peakTime - 1) < 0.06, `${m.peakTime}`);
  assert.ok(m.peakTime !== 1, "the peak must not snap back to a sample");
  assert.ok(Math.abs(m.peakArea - 0.4) < 1e-9);
  // Anticipation runs from the rise start all the way to the peak.
  assert.equal(m.windows.anticipation.end, m.peakTime);
  assert.ok(m.windows.anticipation.start < m.peakTime);
  // Peak is a 0.15 s window centred on the peak.
  assert.ok(Math.abs(m.windows.peak.end - m.windows.peak.start - 0.15) < 1e-9);
  // Window edges are interpolated crossings, so they sit between samples.
  const interpolate = (from: number, to: number, level: number) =>
    times[from] +
    ((times[to] - times[from]) * (areas[from] - level)) / (areas[from] - areas[to]);
  assert.ok(
    Math.abs(m.windows.anticipation.start - interpolate(3, 2, 0.05 * 0.4)) < 1e-9,
    `${m.windows.anticipation.start}`,
  );
  assert.ok(
    Math.abs(m.windows.dissipation.start - interpolate(13, 14, 0.5 * 0.4)) < 1e-9,
    `${m.windows.dissipation.start}`,
  );
  assert.ok(m.windows.dissipation.start > m.peakTime);
  assert.ok(m.windows.dissipation.end > m.windows.dissipation.start);

  // Continuity is the property that matters: nudging the curve must move the
  // windows by a little, never by a whole sample.
  const nudged = documentWindowsFromCurve(
    times,
    areas.map((v, i) => (i === 10 ? v : v * 1.001)),
    2.1,
  );
  assert.ok(Math.abs(nudged.peakTime - m.peakTime) < 0.02, `${nudged.peakTime}`);
  assert.ok(
    Math.abs(nudged.windows.dissipation.start - m.windows.dissipation.start) < 0.02,
  );
  // Position inside the active span, which is what the timing guard compares.
  assert.ok(m.peakPosition > 0 && m.peakPosition < 1, `${m.peakPosition}`);

  // Sample times land inside their windows and inside the document.
  const phases = documentPhaseTimes(m, 2.1);
  for (const name of ["anticipation", "peak", "dissipation"] as const) {
    assert.ok(phases[name].length >= 1, name);
    for (const t of phases[name]) {
      assert.ok(t >= m.windows[name].start - 1e-9 && t <= m.windows[name].end + 1e-9, name);
      assert.ok(t >= 0 && t < 2.1);
    }
  }
});

test("a document that renders nothing yields finite windows rather than NaN", () => {
  const times = [0, 0.5, 1, 1.5];
  const m = documentWindowsFromCurve(times, [0, 0, 0, 0], 1.5);
  assert.ok(Number.isFinite(m.peakPosition));
  assert.equal(m.peakArea, 0);
  for (const name of ["anticipation", "peak", "dissipation"] as const) {
    assert.ok(Number.isFinite(m.windows[name].start));
    assert.ok(m.windows[name].end >= m.windows[name].start);
  }
  assert.throws(() => documentWindowsFromCurve([], [], 1));
  assert.throws(() => documentWindowsFromCurve([0, 1], [0], 1));
});

test("the timing guard rejects a render whose peak has slid away from the reference's", () => {
  const clean = Object.fromEntries(
    PHASE_NAMES.map((p) => [
      p,
      featuresFromVector(
        FEATURE_NAMES.map((name) => (name === "washout" ? 0 : 0.2)),
      ),
    ]),
  ) as Record<(typeof PHASE_NAMES)[number], FrameFeatures>;
  const reference = { visibleLayers: 4, peakPosition: 0.5 };
  // Inside the +/- 25% band.
  assert.equal(checkGuards(clean, 4, reference, DEFAULT_GUARDS, 0.6).ok, true);
  assert.equal(checkGuards(clean, 4, reference, DEFAULT_GUARDS, 0.74).ok, true);
  // Outside it.
  const drifted = checkGuards(clean, 4, reference, DEFAULT_GUARDS, 0.9);
  assert.equal(drifted.ok, false);
  assert.ok(drifted.violations.some((v) => v.startsWith("peak position")));
  assert.equal(drifted.peakPosition, 0.9);
  // With nothing to compare against, the guard stays quiet instead of guessing.
  assert.equal(checkGuards(clean, 4, { visibleLayers: 4 }, DEFAULT_GUARDS, 0.9).ok, true);
  assert.equal(checkGuards(clean, 4, reference, DEFAULT_GUARDS).ok, true);
  assert.equal(DEFAULT_GUARDS.peakPosition, 0.25);
});

test("the envelope's time mapping follows the document's measured peak, not its impact", () => {
  const analysis = analyzeReferenceVideo(CLIP);
  const measured = documentWindowsFromCurve(
    [0, 0.5, 1, 1.5, 2, 2.5, 3],
    [0, 0.05, 0.1, 0.4, 0.2, 0.05, 0],
    3.5,
  );
  const anchored = buildVideoReferenceSheet({
    case: "anchored",
    doc,
    analysis,
    measured,
  });
  const byImpact = buildVideoReferenceSheet({ case: "impact", doc, analysis });
  assert.notDeepEqual(anchored.envelope!.documentTimes, byImpact.envelope!.documentTimes);
  assert.ok(anchored.notes.some((n) => n.includes("measured peak")));
  assert.deepEqual(
    anchored.phases.map((p) => [p.start, p.end]),
    PHASE_NAMES.map((n) => [
      Math.round(measured.windows[n].start * 1000) / 1000,
      Math.round(measured.windows[n].end * 1000) / 1000,
    ]),
  );
  // The reference's peak bin maps to the document's measured peak.
  const peakBin = analysis.envelope.indexOf(Math.max(...analysis.envelope));
  assert.ok(
    Math.abs(anchored.envelope!.documentTimes[peakBin] - measured.peakTime) < 0.3,
    `${anchored.envelope!.documentTimes[peakBin]} vs ${measured.peakTime}`,
  );
});

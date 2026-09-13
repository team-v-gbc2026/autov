// ---------------------------------------------------------------------------
// Screen features for reference-conditioned renderer response calibration.
//
// Pure functions over RGBA pixels. Nothing here touches the DOM, WebGL or the
// document schema, so the same code runs in the calibration browser bundle (on
// rendered frames) and in node (on decoded reference stills) and the two are
// guaranteed to measure the same quantities the same way.
//
// The vector is deliberately small, low-level and effect-agnostic: how much of
// the screen the effect covers, how tall and wide it is, how bright it is at
// three percentiles, how saturated, what hue it leans on, how much fine detail
// it carries, and how much of it is blown out. Those are the quantities the
// eight global knobs in knobs-v2.ts can actually move.
//
// Colour is measured in sRGB display values (0..1), not linear light: what the
// optimizer targets is what the reference image shows, and the reference is a
// JPEG.
// ---------------------------------------------------------------------------

export interface RgbaFrame {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel, length === width * height * 4. */
  data: ArrayLike<number>;
}

/** Row/column bins in the silhouette signature. */
export const PROFILE_BINS = 8;

const profileNames = (axis: "v" | "h") =>
  Array.from({ length: PROFILE_BINS }, (_, i) => `${axis}prof${i}` as const);

/** Fixed order of the feature vector. Never reorder: reports key on it. */
export const FEATURE_NAMES = [
  "area",
  "occupancyH",
  "occupancyW",
  "p50",
  "p90",
  "p99",
  "sat",
  "hueCos",
  "hueSin",
  "accentCos",
  "accentSin",
  "edge",
  "washout",
  // Silhouette signature: where the foreground sits, not just how much of it
  // there is. Without these the residual cannot tell a tall column from a
  // squat dome of the same area and bounding box.
  "centroidY",
  "elongation",
  ...profileNames("v"),
  ...profileNames("h"),
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FrameFeatures = Record<FeatureName, number>;

/**
 * Residual weights. Silhouette and exposure are what a viewer reads first, so
 * they carry full weight; colour and texture are corrections on top.
 */
export const DEFAULT_FEATURE_WEIGHTS: Record<FeatureName, number> = {
  area: 1,
  occupancyH: 1,
  occupancyW: 1,
  p50: 0.5,
  p90: 1,
  p99: 0.5,
  sat: 0.5,
  hueCos: 0.5,
  hueSin: 0.5,
  accentCos: 0.25,
  accentSin: 0.25,
  edge: 0.5,
  washout: 1,
  centroidY: 0.7,
  elongation: 0.7,
  ...(Object.fromEntries(
    [...profileNames("v"), ...profileNames("h")].map((name) => [name, 0.7]),
  ) as Record<string, number>),
} as Record<FeatureName, number>;

/**
 * Lower bounds on the scale each residual is divided by. Without them a target
 * that happens to be near zero (a dark anticipation frame's area, say) would
 * dominate the whole least-squares problem.
 */
export const FEATURE_SCALE_FLOORS: Record<FeatureName, number> = {
  area: 0.05,
  occupancyH: 0.1,
  occupancyW: 0.1,
  p50: 0.1,
  p90: 0.1,
  p99: 0.1,
  sat: 0.15,
  hueCos: 0.5,
  hueSin: 0.5,
  accentCos: 0.5,
  accentSin: 0.5,
  edge: 0.05,
  washout: 0.05,
  centroidY: 0.2,
  elongation: 0.3,
  ...(Object.fromEntries(
    [...profileNames("v"), ...profileNames("h")].map((name) => [name, 0.2]),
  ) as Record<string, number>),
} as Record<FeatureName, number>;

export interface MaskResult {
  mask: Uint8Array;
  /** Pixels marked foreground. */
  count: number;
  /** The luminance-difference (or luminance-above-background) threshold used. */
  threshold: number;
  /** Median absolute deviation the threshold was derived from. */
  noise: number;
}

export interface FeatureOptions {
  /** Multiplier on the background noise MAD (difference masking). */
  tau?: number;
  /** Saturation above which a still's pixel is foreground regardless of luminance. */
  saturationFloor?: number;
  /** Fraction of the image width sampled from each side as a still's background. */
  borderFraction?: number;
  /** Trim applied to each end of the foreground bbox, as a fraction of foreground pixels. */
  bboxTrim?: number;
  /**
   * Lower bound on the difference threshold. A deterministic renderer's plate
   * has literally zero noise, so one 8-bit code is enough there; a compressed
   * video's plate needs a real floor or codec dither reads as foreground.
   */
  floor?: number;
}

const DEFAULTS = {
  tau: 4,
  saturationFloor: 0.25,
  borderFraction: 0.06,
  bboxTrim: 0.01,
  floor: 1 / 255,
} as const;

/** Perceptual weights on sRGB display values — not a linear-light luminance. */
export function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function percentileOfSorted(sorted: ArrayLike<number>, q: number) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))),
  );
  return sorted[index];
}

function medianOf(values: Float64Array) {
  if (!values.length) return 0;
  const copy = Float64Array.from(values);
  copy.sort();
  return percentileOfSorted(copy, 0.5);
}

function assertFrame(frame: RgbaFrame, label = "frame") {
  const { width, height, data } = frame;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    data.length !== width * height * 4
  )
    throw new Error(`Invalid RGBA ${label} (${width}x${height}, ${data.length})`);
}

/** Per-pixel sRGB luminance of a frame, in 0..1. */
export function luminanceField(frame: RgbaFrame) {
  assertFrame(frame);
  const { width, height, data } = frame;
  const out = new Float64Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4)
    out[p] = luminance(data[i], data[i + 1], data[i + 2]);
  return out;
}

/**
 * Foreground = pixels whose luminance differs from the background plate by more
 * than `tau` times the plate's own noise. The MAD is taken over the whole
 * difference image: the effect occupies a minority of the frame, so the median
 * and the deviation around it describe the background, not the effect.
 *
 * `floor` keeps a background whose MAD is zero — which a deterministic renderer
 * does produce, and which a codec-dithered video plate produces too, since most
 * pixels match it exactly — from marking the entire frame.
 */
export function maskAgainstBackground(
  frame: RgbaFrame,
  background: RgbaFrame,
  options: FeatureOptions = {},
): MaskResult {
  assertFrame(frame);
  assertFrame(background, "background");
  if (frame.width !== background.width || frame.height !== background.height)
    throw new Error("Frame and background differ in size");
  const tau = options.tau ?? DEFAULTS.tau;
  const a = luminanceField(frame);
  const b = luminanceField(background);
  const diff = new Float64Array(a.length);
  for (let p = 0; p < a.length; p++) diff[p] = Math.abs(a[p] - b[p]);
  const median = medianOf(diff);
  const spread = new Float64Array(diff.length);
  for (let p = 0; p < diff.length; p++) spread[p] = Math.abs(diff[p] - median);
  const noise = medianOf(spread);
  const threshold = Math.max(tau * noise, options.floor ?? DEFAULTS.floor);
  const mask = new Uint8Array(a.length);
  let count = 0;
  for (let p = 0; p < diff.length; p++)
    if (diff[p] > threshold) {
      mask[p] = 1;
      count++;
    }
  return { mask, count, threshold, noise };
}

function saturationOf(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  if (max <= 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

/**
 * Reference stills have no background plate, so the background is estimated
 * from the side margins of each row. Per row, not globally: benchmark
 * references are shot against vertical gradients and lit floors, and a single
 * global level would call the top half of the image foreground.
 *
 * A pixel is foreground when it is colourful (saturation above `saturationFloor`)
 * or clearly brighter than its row's background level.
 */
export function maskStill(
  frame: RgbaFrame,
  options: FeatureOptions = {},
): MaskResult {
  assertFrame(frame);
  const { width, height, data } = frame;
  const tau = options.tau ?? DEFAULTS.tau;
  const saturationFloor = options.saturationFloor ?? DEFAULTS.saturationFloor;
  const border = Math.max(
    1,
    Math.round(width * (options.borderFraction ?? DEFAULTS.borderFraction)),
  );
  const lum = luminanceField(frame);

  const rowLevel = new Float64Array(height);
  const rowSpread = new Float64Array(height);
  const sample = new Float64Array(border * 2);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let k = 0; k < border; k++) {
      sample[k] = lum[row + k];
      sample[border + k] = lum[row + width - 1 - k];
    }
    const level = medianOf(sample);
    const deviation = new Float64Array(sample.length);
    for (let k = 0; k < sample.length; k++)
      deviation[k] = Math.abs(sample[k] - level);
    rowLevel[y] = level;
    rowSpread[y] = medianOf(deviation);
  }
  // One shared noise figure: a row that happens to cut through the effect's
  // own glow would otherwise raise its own bar and hide the effect.
  const noise = medianOf(rowSpread);
  const threshold = Math.max(tau * noise, 0.06);

  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const y = (p / width) | 0;
    const colourful =
      saturationOf(data[i], data[i + 1], data[i + 2]) > saturationFloor;
    if (colourful || lum[p] > rowLevel[y] + threshold) {
      mask[p] = 1;
      count++;
    }
  }
  return { mask, count, threshold, noise };
}

/** Trimmed extent of the marked pixels along one axis, as a fraction of `size`. */
function occupancy(positions: Float64Array, size: number, trim: number) {
  if (!positions.length) return 0;
  const sorted = Float64Array.from(positions);
  sorted.sort();
  const lo = percentileOfSorted(sorted, trim);
  const hi = percentileOfSorted(sorted, 1 - trim);
  return (hi - lo + 1) / size;
}

/** Sobel gradient magnitude of the luminance field, normalized to roughly 0..1. */
function sobelField(lum: Float64Array, width: number, height: number) {
  const out = new Float64Array(lum.length);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const tl = lum[p - width - 1];
      const tc = lum[p - width];
      const tr = lum[p - width + 1];
      const ml = lum[p - 1];
      const mr = lum[p + 1];
      const bl = lum[p + width - 1];
      const bc = lum[p + width];
      const br = lum[p + width + 1];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      // |g| tops out at 4 for a 0..1 field; divide so `edge` reads as 0..1.
      out[p] = Math.min(1, Math.hypot(gx, gy) / 4);
    }
  return out;
}

const HUE_BINS = 36;

/**
 * Features of the pixels `mask` marks. `mask` must have one entry per pixel of
 * `frame`; everything else is measured from `frame` alone.
 */
export function featuresFromMask(
  frame: RgbaFrame,
  mask: Uint8Array,
  options: FeatureOptions = {},
): FrameFeatures {
  assertFrame(frame);
  const { width, height, data } = frame;
  if (mask.length !== width * height) throw new Error("Mask size mismatch");
  const trim = options.bboxTrim ?? DEFAULTS.bboxTrim;
  const lum = luminanceField(frame);
  const sobel = sobelField(lum, width, height);

  let count = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) count++;
  if (!count)
    return Object.fromEntries(
      FEATURE_NAMES.map((name) => [name, 0]),
    ) as FrameFeatures;

  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const values = new Float64Array(count);
  const histogram = new Float64Array(HUE_BINS);
  const rowBins = new Float64Array(PROFILE_BINS);
  const columnBins = new Float64Array(PROFILE_BINS);
  let ySum = 0;
  let satSum = 0;
  let edgeSum = 0;
  let washout = 0;
  let hueX = 0;
  let hueY = 0;

  for (let p = 0, n = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const x = p % width;
    const y = (p / width) | 0;
    xs[n] = x;
    ys[n] = y;
    values[n] = lum[p];
    n++;
    ySum += y;
    rowBins[Math.min(PROFILE_BINS - 1, Math.floor((y / height) * PROFILE_BINS))]++;
    columnBins[
      Math.min(PROFILE_BINS - 1, Math.floor((x / width) * PROFILE_BINS))
    ]++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max > 0 ? (max - min) / max : 0;
    satSum += saturation;
    edgeSum += sobel[p];
    if (r > 242 && g > 242 && b > 242) washout++;
    if (max === min) continue;
    const span = max - min;
    let hue: number;
    if (max === r) hue = ((g - b) / span + 6) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    const angle = (hue / 6) * Math.PI * 2;
    // Weight by how much colour the pixel actually carries: a dim, washed-out
    // pixel's hue is numerically real and perceptually meaningless.
    const weight = lum[p] * saturation;
    hueX += Math.cos(angle) * weight;
    hueY += Math.sin(angle) * weight;
    histogram[Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS))] +=
      weight;
  }

  values.sort();
  const hueMagnitude = Math.hypot(hueX, hueY);

  // Accent hue: the strongest bin outside a +/- 2-bin neighbourhood of the
  // dominant one, so a shaded version of the dominant hue is not "the accent".
  let dominantBin = 0;
  for (let k = 1; k < HUE_BINS; k++)
    if (histogram[k] > histogram[dominantBin]) dominantBin = k;
  let accentBin = -1;
  for (let k = 0; k < HUE_BINS; k++) {
    const distance = Math.min(
      Math.abs(k - dominantBin),
      HUE_BINS - Math.abs(k - dominantBin),
    );
    if (distance <= 2) continue;
    if (accentBin < 0 || histogram[k] > histogram[accentBin]) accentBin = k;
  }
  const accentWeight = accentBin >= 0 ? histogram[accentBin] : 0;
  const accentAngle =
    accentBin >= 0 ? ((accentBin + 0.5) / HUE_BINS) * Math.PI * 2 : 0;
  const accentPresent = accentWeight > 0 && histogram[dominantBin] > 0;

  // Silhouette signature. Each bin holds the fraction of that band's pixels
  // that are foreground — "how wide is the effect at this height" — and the
  // profile is then normalized by its own peak, so it describes shape
  // independently of how much of the screen the effect covers.
  const bandRows = height / PROFILE_BINS;
  const bandColumns = width / PROFILE_BINS;
  const vertical = Array.from(rowBins, (v) => v / (bandRows * width));
  const horizontal = Array.from(columnBins, (v) => v / (bandColumns * height));
  const normalize = (profile: number[]) => {
    const peak = Math.max(...profile);
    return peak > 0 ? profile.map((v) => v / peak) : profile;
  };
  const vProfile = normalize(vertical);
  const hProfile = normalize(horizontal);
  const extentH = occupancy(ys, height, trim);
  const extentW = occupancy(xs, width, trim);

  return {
    area: count / mask.length,
    occupancyH: extentH,
    occupancyW: extentW,
    // 1 is the top of the frame: image rows run downward, and "high in frame"
    // is the reading that matches how the references are described.
    centroidY: 1 - ySum / count / height,
    // Taller than wide is > 1. Capped so a one-pixel-wide sliver cannot
    // dominate the residual.
    elongation: Math.min(8, extentH / Math.max(extentW, 1 / width)),
    ...(Object.fromEntries([
      ...vProfile.map((v, i) => [`vprof${i}`, v]),
      ...hProfile.map((v, i) => [`hprof${i}`, v]),
    ]) as Record<string, number>),
    p50: percentileOfSorted(values, 0.5),
    p90: percentileOfSorted(values, 0.9),
    p99: percentileOfSorted(values, 0.99),
    sat: satSum / count,
    hueCos: hueMagnitude > 0 ? hueX / hueMagnitude : 0,
    hueSin: hueMagnitude > 0 ? hueY / hueMagnitude : 0,
    accentCos: accentPresent ? Math.cos(accentAngle) : 0,
    accentSin: accentPresent ? Math.sin(accentAngle) : 0,
    edge: edgeSum / count,
    washout: washout / count,
  };
}

/** Features of a rendered frame against its background plate. */
export function renderedFrameFeatures(
  frame: RgbaFrame,
  background: RgbaFrame,
  options: FeatureOptions = {},
) {
  const mask = maskAgainstBackground(frame, background, options);
  return { features: featuresFromMask(frame, mask.mask, options), mask };
}

/** Features of a reference still, which has no background plate. */
export function stillFeatures(frame: RgbaFrame, options: FeatureOptions = {}) {
  const mask = maskStill(frame, options);
  return { features: featuresFromMask(frame, mask.mask, options), mask };
}

export function featureVector(features: FrameFeatures) {
  return FEATURE_NAMES.map((name) => features[name]);
}

export function featuresFromVector(values: readonly number[]): FrameFeatures {
  if (values.length !== FEATURE_NAMES.length)
    throw new Error("Feature vector length mismatch");
  return Object.fromEntries(
    FEATURE_NAMES.map((name, i) => [name, values[i]]),
  ) as FrameFeatures;
}

/**
 * Arithmetic mean, component-wise. The hue components are unit vectors per
 * frame, so averaging them is a circular mean whose shrinking magnitude records
 * that the frames disagreed — which is the behaviour the residual wants.
 */
export function meanFeatures(list: readonly FrameFeatures[]): FrameFeatures {
  if (!list.length) throw new Error("meanFeatures needs at least one frame");
  const out = {} as FrameFeatures;
  for (const name of FEATURE_NAMES)
    out[name] = list.reduce((sum, f) => sum + f[name], 0) / list.length;
  return out;
}

export function isFiniteFeatures(features: FrameFeatures) {
  return FEATURE_NAMES.every((name) => Number.isFinite(features[name]));
}

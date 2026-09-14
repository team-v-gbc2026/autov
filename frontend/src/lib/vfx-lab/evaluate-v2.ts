import { clamp, windowWeight } from "./evaluate";
import type { LayerV2, VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Per-time evaluation for autov.lab/2 layers.
//
// Same contract as v1's evaluateLayer: tracks are keyed on layer-local time and
// applied first, then time-windowed overrides blend on top. An override outside
// its window contributes nothing at all (weight 0 short-circuits before any
// arithmetic), which is what keeps out-of-window frames byte-identical to the
// unedited document.
//
// The one difference is the target vocabulary: v1 targets were flat parameter
// names, v2 targets are dotted paths into the layer object
// ("material.ramp.stops[0].intensity", "emitter.velocity.speed[1]", ...).
// ---------------------------------------------------------------------------

type Path = (string | number)[];

const pathCache = new Map<string, Path>();

/** "a.b[0].c" -> ["a","b",0,"c"]. Malformed paths resolve to nothing. */
export function parseTargetPath(target: string): Path {
  const cached = pathCache.get(target);
  if (cached) return cached;
  const path: Path = [];
  for (const token of target.match(/[a-zA-Z0-9_]+|\[\d+\]/g) ?? []) {
    path.push(
      token.startsWith("[") ? Number(token.slice(1, -1)) : (token as string),
    );
  }
  pathCache.set(target, path);
  return path;
}

function container(root: unknown, path: Path): Record<string, unknown> | null {
  let node = root as Record<string, unknown> | null;
  for (let i = 0; i < path.length - 1; i++) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[path[i] as string] as Record<
      string,
      unknown
    > | null;
  }
  return node && typeof node === "object" ? node : null;
}

export function readTarget(root: unknown, target: string): unknown {
  const path = parseTargetPath(target);
  if (!path.length) return undefined;
  const parent = container(root, path);
  return parent ? parent[path[path.length - 1] as string] : undefined;
}

/** Writes only over an existing leaf of the same type; unknown paths are ignored. */
export function writeTarget(root: unknown, target: string, value: unknown) {
  const path = parseTargetPath(target);
  if (!path.length) return;
  const parent = container(root, path);
  if (!parent) return;
  const key = path[path.length - 1] as string;
  if (typeof parent[key] !== typeof value) return;
  parent[key] = value;
}

function sampleKeys(
  keys: readonly (readonly [number, number])[],
  t: number,
  ease: string,
) {
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      let u = clamp((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
      if (ease === "smooth") u = u * u * (3 - 2 * u);
      if (ease === "outCubic") u = 1 - (1 - u) ** 3;
      if (ease === "inQuad") u *= u;
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u;
    }
  }
  return keys[0][1];
}

/** The renderer's own hash, so a CPU jitter matches the GLSL one bit for bit. */
function hash11(p: number) {
  let x = (p * 0.1031) % 1;
  if (x < 0) x += 1;
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

function mixColor(a: string, b: string, w: number) {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      parseInt(a.slice(i, i + 2), 16) * (1 - w) +
        parseInt(b.slice(i, i + 2), 16) * w,
    )
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

export interface EvaluatedLayerV2 {
  layer: LayerV2;
  visible: boolean;
  age: number;
  /** Layer-local time normalized to 0..1; the "layerTime" ramp space. */
  u: number;
}

/**
 * Resolve a layer at `time`: tracks, then overrides, applied to a deep clone so
 * the source document is never mutated.
 */
export function evaluateLayerV2(layer: LayerV2, time: number): EvaluatedLayerV2 {
  const next = structuredClone(layer) as LayerV2;
  const age = time - layer.start;
  const span = Math.max(layer.end - layer.start, 1e-6);

  for (const track of next.tracks)
    writeTarget(
      next,
      track.target,
      sampleKeys(track.keys as [number, number][], age, track.ease),
    );

  if (next.motion) {
    const keys = next.motion.keys;
    let offset: number[] = keys[0].slice(1);
    if (age >= keys[keys.length - 1][0])
      offset = keys[keys.length - 1].slice(1);
    else
      for (let i = 1; i < keys.length; i++)
        if (age <= keys[i][0]) {
          let u = clamp((age - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
          if (next.motion.ease === "smooth") u = u * u * (3 - 2 * u);
          offset = [1, 2, 3].map(
            (j) => keys[i - 1][j] + (keys[i][j] - keys[i - 1][j]) * u,
          );
          break;
        }
    next.transform.position = next.transform.position.map(
      (v, i) => v + offset[i],
    ) as [number, number, number];
  }

  // layer.jitter: a stepped-hash offset on the transform, applied after motion
  // so it perturbs wherever the layer already is. floor(age * frequency) is the
  // only state, so a seek lands inside exactly the window playback was in.
  if (next.jitter && next.jitter.amplitude > 0 && age >= 0) {
    const { frequency, amplitude, gate, axis } = next.jitter;
    const step = Math.floor(age * frequency);
    if (hash11(step * 1.7 + 0.3) >= gate) {
      const offset = axis
        ? axis.map((v) => v * (hash11(step * 3.1) - 0.5) * 2 * amplitude)
        : [3.1, 5.3, 7.9].map((k) => (hash11(step * k) - 0.5) * 2 * amplitude);
      next.transform.position = next.transform.position.map(
        (v, i) => v + offset[i],
      ) as [number, number, number];
    }
  }

  // layer.collapse: ONE retraction applied uniformly, so every part of a
  // composite body shrinks in step instead of each carrying its own tracks and
  // drifting apart. It runs after tracks and motion and before the overrides,
  // which stay the last word on any value. anchor "base" keeps the transform
  // where it is, so a body authored with its base at the layer origin retracts
  // from the top.
  if (next.collapse && age >= next.collapse.start) {
    const { start, duration, heightCurve, widthCurve } = next.collapse;
    const p = clamp((age - start) / Math.max(duration, 1e-4));
    const h = sampleKeys(heightCurve.keys as [number, number][], p, heightCurve.ease);
    const w = sampleKeys(widthCurve.keys as [number, number][], p, widthCurve.ease);
    if (next.geometry) {
      // Along the layer's own +Z axis; across it is radius/thickness.
      next.geometry.length = Math.max(0.01, next.geometry.length * h);
      next.geometry.radius = Math.max(0.01, next.geometry.radius * w);
      next.geometry.thickness = Math.max(0.001, next.geometry.thickness * w);
    } else if (next.arcs) {
      next.arcs.span = Math.max(0.05, next.arcs.span * h);
      next.arcs.radius = [
        Math.max(0.02, next.arcs.radius[0] * w),
        Math.max(0.02, next.arcs.radius[1] * w),
      ];
    } else {
      next.transform.scale = [
        next.transform.scale[0] * w,
        next.transform.scale[1] * h,
        next.transform.scale[2] * w,
      ];
    }
  }

  // transform.squash: a volume-conserving breath on the layer's own scale. The
  // named axis takes 1 + amplitude*sin(2*PI*frequency*age) and the two cross
  // axes the inverse square root of it, so the body keeps its volume instead of
  // pumping — and because it multiplies transform.scale it reaches every kind
  // with no per-kind branch anywhere. It runs after collapse and before the
  // overrides, which stay the last word on any value.
  if (next.transform.squash && age >= 0) {
    const { axis, amplitude, frequency } = next.transform.squash;
    const k = 1 + amplitude * Math.sin(age * 2 * Math.PI * frequency);
    const cross = 1 / Math.sqrt(Math.max(k, 1e-4));
    const factor: [number, number, number] =
      axis === "x"
        ? [k, cross, cross]
        : axis === "y"
          ? [cross, k, cross]
          : [cross, cross, k];
    next.transform.scale = next.transform.scale.map(
      (v, i) => v * factor[i],
    ) as [number, number, number];
  }

  for (const override of next.overrides) {
    const w = windowWeight(override, time);
    // Exactly preserve protected values; no round-trip conversion at weight 0.
    if (w === 0) continue;
    const current = readTarget(next, override.target);
    if (typeof override.value === "string") {
      if (typeof current === "string")
        writeTarget(next, override.target, mixColor(current, override.value, w));
    } else if (typeof current === "number") {
      writeTarget(next, override.target, current + (override.value - current) * w);
    }
  }

  return {
    layer: next,
    visible: layer.enabled && age >= 0 && time < layer.end,
    age,
    u: clamp(age / span),
  };
}

/** Frames a viewer or capture should sample; mirrors v1's spacing rules. */
export function sampleTimesV2(doc: VfxDocumentV2, count = 8) {
  const times: number[] = [];
  for (let i = 0; i < count; i++)
    times.push((doc.duration * i) / Math.max(1, count - 1));
  return times;
}

import * as THREE from "three";
import type { GeometryV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Analytic branched bolt for `geometry.lightning`.
//
// The bolt is a pure function of (document seed, seedOffset, strike index).
// The strike index is floor(layerTime * STRIKE_HZ), so the bolt re-shapes over
// time — the "re-strike" flicker — while still being a function of time alone:
// seeking to t rebuilds exactly the bolt that playing to t would show.
//
// Geometry is a tube around the jittered centerline: uv.x runs around the tube,
// uv.y runs 0..1 from the start of the bolt to its end, which is what the
// surface shader keys its ramp and erosion on.
// ---------------------------------------------------------------------------

/** Re-strikes per second of layer time. */
export const STRIKE_HZ = 8;

/** Deterministic 0..1 hash; the only randomness the bolt has. */
function hash(...values: number[]) {
  let h = 2166136261 >>> 0;
  for (const value of values) {
    // Quantize so float noise can never change a strike's shape.
    let v = Math.round(value * 1000) | 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (v & 255), 16777619) >>> 0;
      v >>= 8;
    }
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function sampleCurve(keys: readonly (readonly [number, number])[], u: number) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (u <= keys[i][0]) {
      const span = keys[i][0] - keys[i - 1][0] || 1;
      const f = (u - keys[i - 1][0]) / span;
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
}

function orthoOf(a: THREE.Vector3) {
  const helper =
    Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const out = new THREE.Vector3().crossVectors(a, helper);
  return out.lengthSq() > 1e-10 ? out.normalize() : new THREE.Vector3(1, 0, 0);
}

interface Path {
  points: THREE.Vector3[];
  /** Width scale applied on top of the width curve (branches are thinner). */
  scale: number;
  /** Where this path starts in the parent bolt's 0..1 length domain. */
  from: number;
  to: number;
}

/**
 * Samples `points` positions along `axis` and jitters each one sideways with a
 * seeded hash. The ends stay pinned so the bolt still spans its full length.
 */
function makePath(
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  length: number,
  count: number,
  jitter: number,
  radius: number,
  key: number,
  from: number,
  to: number,
  scale: number,
): Path {
  const a1 = orthoOf(axis);
  const a2 = new THREE.Vector3().crossVectors(axis, a1);
  const points: THREE.Vector3[] = [];
  // A few long bends carry the silhouette; the per-point term is the crackle
  // on top of them. One frequency alone reads as either an arc or as fuzz.
  const control = Math.max(2, Math.round(count / 5));
  const bend = (channel: number, i: number) => {
    const x = (i / (count - 1)) * control;
    const lo = Math.floor(x);
    const f = x - lo;
    const s = f * f * (3 - 2 * f);
    const a = hash(key, lo, channel, 9) * 2 - 1;
    const b = hash(key, lo + 1, channel, 9) * 2 - 1;
    return a + (b - a) * s;
  };
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Pinned ends, widest wander in the middle.
    const taper = Math.pow(Math.sin(Math.PI * t), 0.4);
    const amount = jitter * radius * taper;
    const h1 = bend(1, i) * 0.7 + (hash(key, i, 1) * 2 - 1) * 0.3;
    const h2 = bend(2, i) * 0.7 + (hash(key, i, 2) * 2 - 1) * 0.3;
    points.push(
      origin
        .clone()
        .addScaledVector(axis, length * t)
        .addScaledVector(a1, h1 * amount)
        .addScaledVector(a2, h2 * amount * 0.7),
    );
  }
  return { points, scale, from, to };
}

function tube(
  path: Path,
  thickness: number,
  widthKeys: readonly (readonly [number, number])[],
  sides: number,
  positions: number[],
  normals: number[],
  uvs: number[],
) {
  const { points } = path;
  const base = positions.length / 3;
  for (let i = 0; i < points.length; i++) {
    const tangent = points[Math.min(points.length - 1, i + 1)]
      .clone()
      .sub(points[Math.max(0, i - 1)]);
    if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0);
    tangent.normalize();
    const n1 = orthoOf(tangent);
    const n2 = new THREE.Vector3().crossVectors(tangent, n1).normalize();
    const along = i / (points.length - 1);
    const domain = path.from + (path.to - path.from) * along;
    const width = Math.max(
      1e-4,
      thickness * path.scale * Math.max(0, sampleCurve(widthKeys, domain)),
    );
    for (let j = 0; j <= sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const normal = n1
        .clone()
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(n2, Math.sin(angle));
      const v = points[i].clone().addScaledVector(normal, width);
      positions.push(v.x, v.y, v.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(j / sides, domain);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const k = base + i * (sides + 1) + j;
      indices.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1);
    }
  return indices;
}

/**
 * Builds the bolt for one strike. `geometry.length` is spanned along the
 * layer's local +Y axis, centred on the layer origin; `geometry.radius` scales
 * the jitter and `geometry.thickness` the tube width.
 */
export function buildLightningGeometry(
  geometry: GeometryV2,
  seed: number,
  strike: number,
): THREE.BufferGeometry {
  const spec = geometry.lightning!;
  const axis = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3(0, geometry.length * 0.5, 0);
  const key = (seed + spec.seedOffset + strike * 7919) >>> 0;
  const paths: Path[] = [
    makePath(
      origin,
      axis,
      geometry.length,
      spec.points,
      spec.jitter,
      geometry.radius,
      key,
      0,
      1,
      1,
    ),
  ];

  // Child bolts leave the trunk at a sampled point and fall away from it.
  let level = [paths[0]];
  for (let depth = 0; depth < spec.branchDepth; depth++) {
    const next: Path[] = [];
    const count = depth === 0 ? spec.branches : Math.max(0, spec.branches - 1);
    for (const parent of level)
      for (let b = 0; b < count; b++) {
        const branchKey = (key + (depth + 1) * 104729 + b * 1299721) >>> 0;
        const pick = 0.2 + hash(branchKey, 0) * 0.55;
        const index = Math.min(
          parent.points.length - 2,
          Math.max(1, Math.round(pick * (parent.points.length - 1))),
        );
        const start = parent.points[index];
        const tangent = parent.points[index + 1].clone().sub(start);
        if (tangent.lengthSq() < 1e-10) continue;
        tangent.normalize();
        const side = orthoOf(tangent);
        const other = new THREE.Vector3().crossVectors(tangent, side);
        const angle = hash(branchKey, 1) * Math.PI * 2;
        const lean = 0.5 + hash(branchKey, 2) * 0.6;
        const direction = tangent
          .clone()
          .addScaledVector(side, Math.cos(angle) * lean)
          .addScaledVector(other, Math.sin(angle) * lean)
          .normalize();
        const span =
          geometry.length * (0.18 + hash(branchKey, 3) * 0.22) * (depth ? 0.6 : 1);
        const from = parent.from + (parent.to - parent.from) * (index / (parent.points.length - 1));
        next.push(
          makePath(
            start,
            direction,
            span,
            Math.max(4, Math.round(spec.points / (depth ? 4 : 3))),
            spec.jitter,
            geometry.radius * 0.6,
            branchKey,
            from,
            Math.min(1, from + 0.35),
            parent.scale * 0.45,
          ),
        );
      }
    paths.push(...next);
    level = next;
    if (!next.length) break;
  }

  const sides = Math.min(8, Math.max(3, Math.round(geometry.radialSegments / 3)));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const path of paths)
    indices.push(
      ...tube(
        path,
        geometry.thickness,
        spec.widthCurve.keys,
        sides,
        positions,
        normals,
        uvs,
      ),
    );

  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  result.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  return result;
}

/** Local-space bounding points of a bolt, for camera framing. */
const boundsCache = new Map<string, THREE.Vector3[]>();

/**
 * The envelope this bolt's strikes fit inside: the union of the first sixteen
 * strikes plus a small pad. Strike-independent by construction, so the camera
 * framing never breathes with the flicker.
 */
export function lightningBounds(geometry: GeometryV2, seed = 0) {
  const spec = geometry.lightning!;
  const key = JSON.stringify([
    seed,
    geometry.length,
    geometry.radius,
    geometry.thickness,
    geometry.radialSegments,
    spec,
  ]);
  const cached = boundsCache.get(key);
  if (cached) return cached.map((p) => p.clone());
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let strike = 0; strike < 16; strike++) {
    const built = buildLightningGeometry(geometry, seed, strike);
    const values = built.getAttribute("position").array as ArrayLike<number>;
    for (let i = 0; i < values.length; i += 3) {
      lo.x = Math.min(lo.x, values[i]);
      lo.y = Math.min(lo.y, values[i + 1]);
      lo.z = Math.min(lo.z, values[i + 2]);
      hi.x = Math.max(hi.x, values[i]);
      hi.y = Math.max(hi.y, values[i + 1]);
      hi.z = Math.max(hi.z, values[i + 2]);
    }
    built.dispose();
  }
  // A strike the sample did not see can wander a little further; the pad keeps
  // the framing stable rather than exactly minimal.
  const pad = hi.clone().sub(lo).multiplyScalar(0.12);
  lo.sub(pad);
  hi.add(pad);
  const points: THREE.Vector3[] = [];
  for (const x of [lo.x, hi.x])
    for (const y of [lo.y, hi.y])
      for (const z of [lo.z, hi.z]) points.push(new THREE.Vector3(x, y, z));
  boundsCache.set(key, points);
  return points.map((p) => p.clone());
}

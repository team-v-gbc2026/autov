import * as THREE from "three";
import type { Splash } from "./schema-v2";
import { easeOutCubic, smoothstep } from "./blob-v2";

// ---------------------------------------------------------------------------
// The splash generator: `layer.splash` -> a fan of flat slivers.
//
// A sliver is a two-sided strip, pointed at both ends, with independently
// notched left and right edges and a sideways bow. It carries no lighting and
// no ramp: the fill is a vertical gradient between splash.color and a darker
// version of it, and a backing copy 14% larger sits behind it in
// splash.backing. Exactly the spike's grey shards.
//
// Everything is a pure function of (splash, index, layer-local time).
// ---------------------------------------------------------------------------

export interface Sliver {
  index: number;
  /** Angle from +Y, signed: negative is the left half of the fan. */
  angle: number;
  length: number;
  width: number;
  curvature: number;
  /** Distance from the layer origin the root sits at. */
  radius: number;
  /** Vertical offset of the root, and the depth it is parked at. */
  y: number;
  z: number;
  /** Metres it flies once it detaches, outward and up. */
  fly: [number, number];
  /** Fraction of the layer window this sliver's scale-in is delayed by. */
  delay: number;
  /** A long shard flies further and thins more than a short bowl-hugger. */
  long: boolean;
  /** Hash base for the jagged edges. */
  hash: number;
}

function hash(seed: number, index: number, channel: number) {
  const x =
    Math.sin(seed * 0.0137 + index * 127.1 + channel * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The fan. Slivers alternate sides and step outward through `spread`.
 *
 * The two slivers of a pair share their shape hashes, so the fan is MIRRORED:
 * every long shard on the left has a twin on the right. That is not only what
 * the spike's hand-written table did, it is what keeps the camera centred on
 * the burst — an independently hashed fan is lopsided by half a metre or so and
 * the auto-framing dutifully follows it off centre. Only the angle carries a
 * per-sliver jitter, so the twins are not identical.
 */
export function splashSlivers(splash: Splash): Sliver[] {
  const slivers: Sliver[] = [];
  const perSide = Math.max(1, Math.ceil(splash.count / 2));
  for (let i = 0; i < splash.count; i++) {
    const side = i % 2 ? -1 : 1;
    const step = Math.floor(i / 2);
    const k = perSide > 1 ? step / (perSide - 1) : 0;
    const h = (n: number) => hash(splash.seed, step, n);
    const jitter = (hash(splash.seed, i, 21) - 0.5) * 0.16;
    const angle =
      side * Math.min(Math.max(lerp(splash.spread[0], splash.spread[1], k) + jitter, splash.spread[0]), splash.spread[1]);
    const mul = 0.5 + 1.1 * h(2);
    const length = lerp(splash.length[0], splash.length[1], Math.min(1, mul * 0.7));
    const long = mul > 1.25;
    slivers.push({
      index: i,
      angle,
      length,
      width: splash.width * (0.7 + 0.6 * h(4)),
      curvature: -side * splash.curvature * (0.6 + 0.6 * h(6)),
      // Roots sit out on the rim of the burst, hidden inside whatever the
      // splash is bursting out of.
      radius: length * (0.5 + 0.3 * h(12)),
      y: length * 0.2 * h(14),
      z: h(10) < 0.3 ? length * 0.4 : -length * 0.4,
      fly: [side * length * (0.35 + 0.4 * h(16)), length * (0.1 + 0.5 * h(18))],
      delay: h(8),
      long,
      hash: step * 9 + 1 + (side < 0 ? 4 : 0),
    });
  }
  return slivers;
}

/**
 * One sliver's geometry, in its own local XY plane: the root at the origin, the
 * tip at +Y. `jaggedness` notches each edge independently with 2-4 teeth of a
 * hashed depth, so no two slivers share a silhouette.
 */
export function sliverGeometry(sliver: Sliver, jaggedness: number) {
  const N = 34;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const h = (n: number) => hash(1, sliver.hash, n);
  const teeth = [2 + Math.floor(h(0) * 3), 2 + Math.floor(h(7) * 3)];
  const offset = [h(3), h(11)];
  const depth = [
    jaggedness * (0.34 + 0.3 * h(5)),
    jaggedness * (0.34 + 0.3 * h(13)),
  ];
  const edge = (t: number, base: number, side: number) =>
    base * (1 - depth[side] * ((t * teeth[side] + offset[side]) % 1));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x =
      (Math.sin(Math.PI * t * 0.5) - 0.25 * Math.sin(Math.PI * t)) *
      sliver.curvature;
    const y = sliver.length * t;
    // Pointed at the tip (the (1-t) taper) and at the root (the smoothstep).
    const base =
      sliver.width *
      Math.pow(1 - t, 1.6) *
      Math.pow(smoothstep(0, 0.3, t), 0.7);
    positions.push(x - edge(t, base, 0), y, 0, x + edge(t, base, 1), y, 0);
    uvs.push(0, 1 - t, 1, 1 - t);
  }
  for (let i = 0; i < N; i++) {
    const k = i * 2;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export interface SliverState {
  visible: boolean;
  position: [number, number, number];
  /** Roll in the layer's billboard plane, radians. */
  roll: number;
  /** Scale along the sliver's own width and length. */
  scale: [number, number];
  alpha: number;
}

/**
 * A sliver at layer-local progress `u` (0..1 across the layer window). The
 * three windows are the document's own: it scales out, then detaches and flies
 * outward while thinning, then fades.
 */
export function sliverStateAt(
  sliver: Sliver,
  splash: Splash,
  u: number,
): SliverState {
  const span = splash.scaleIn[1] - splash.scaleIn[0];
  const start = splash.scaleIn[0] + span * 0.5 * sliver.delay;
  const grow = easeOutCubic((u - start) / Math.max(span, 1e-4));
  const detach = smoothstep(splash.detach[0], splash.detach[1], u);
  const alpha = 1 - smoothstep(splash.fade[0], splash.fade[1], u);
  if (u <= start || alpha <= 0.01)
    return {
      visible: false,
      position: [0, 0, 0],
      roll: 0,
      scale: [0, 0],
      alpha: 0,
    };
  const thin = sliver.long ? 0.55 : 0.35;
  const scale = grow * (1 + 0.22 * detach);
  return {
    visible: true,
    position: [
      Math.sin(sliver.angle) * sliver.radius + sliver.fly[0] * detach,
      Math.cos(sliver.angle) * sliver.radius * 0.35 +
        sliver.y +
        sliver.fly[1] * detach,
      sliver.z,
    ],
    roll: -sliver.angle + detach * Math.sign(sliver.angle) * 0.5,
    scale: [scale * (1 - thin * detach), scale * (1 - 0.15 * detach)],
    alpha,
  };
}

/**
 * Layer-local envelope of the whole fan, for framing: the root and the tip of
 * every sliver, once it has detached and flown. A box around `length` in every
 * direction would claim the quadrants a 40-degree fan never reaches and push the
 * camera back until the burst it decorates filled a corner of the shot.
 */
export function splashBounds(splash: Splash): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const sliver of splashSlivers(splash)) {
    const end = sliverStateAt(sliver, splash, splash.detach[1]);
    const [x, y, z] = end.position;
    // roll takes the sliver's local +Y (its length) round to its own heading.
    const c = Math.cos(end.roll);
    const sn = Math.sin(end.roll);
    const reach = sliver.length * Math.max(end.scale[1], 0.2);
    points.push(new THREE.Vector3(x, y, z));
    points.push(new THREE.Vector3(x - sn * reach, y + c * reach, z));
  }
  return points;
}

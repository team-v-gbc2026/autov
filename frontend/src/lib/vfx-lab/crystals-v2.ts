import * as THREE from "three";
import type { Crystals } from "./schema-v2";

// ---------------------------------------------------------------------------
// The crystal generator: `layer.crystals` -> a table of spikes, plus the one
// low-poly mesh every instance shares.
//
// The document never lists spikes. It describes a cluster (count, direction
// band, length/width bands, groups, stagger, growth, collapse) and this file
// hashes each spike's direction, length, width, base offset, start time and
// twist out of (crystals.seed, index), exactly the way the hand-built ice spike
// did by hand. Everything is a pure function of (crystals, index): no
// accumulation, and no dependence on draw order — which is what lets an
// emitter borrow the same sites (`emitter.shape.type:"layerInstances"`) without
// ever reading the renderer's state.
//
// The growth, the swell and the collapse are applied in the vertex shader from
// layer time (see crystalVertexV2 in shaders-v2.ts); `crystalScaleAt` is the
// CPU mirror the shatter emitter and the framing pass read.
// ---------------------------------------------------------------------------

/** One generated spike. Every field is closed form in (crystals.seed, index). */
export interface CrystalInstance {
  index: number;
  /** Unit direction the spike grows along. */
  direction: [number, number, number];
  /** Base position, layer-local. */
  origin: [number, number, number];
  /** Length and base half-width at full growth, in metres. */
  length: number;
  width: number;
  /** Birth time in seconds since layer.start. */
  start: number;
  /** Hashed 0..1: the facet twist, the glint phase and the collapse jitter. */
  seed: number;
  /** Length class, 0 = the long spikes. */
  group: number;
}

/** The ice spike's hash: one deterministic uniform per (index, channel). */
function hash11(n: number) {
  let p = (n * 0.1031) % 1;
  if (p < 0) p += 1;
  p *= p + 33.33;
  p *= p + p;
  return p - Math.floor(p);
}

function hash(seed: number, index: number, channel: number) {
  return hash11(index * 1.618 + channel * 37.71 + 0.137 + (seed % 8191) * 0.0011);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const DEG = Math.PI / 180;

/**
 * Which length class instance `i` belongs to. The cycle is 2*groups-1 long and
 * gives the long group one slot and every other group two, so a 3-group cluster
 * is 1 long : 2 mid : 2 short — the spike's own ratio.
 */
function groupOf(index: number, groups: number) {
  const cycle = Math.max(1, groups * 2 - 1);
  const slot = index % cycle;
  return slot === 0 ? 0 : Math.min(groups - 1, Math.ceil(slot / 2));
}

/**
 * The whole spike table for one crystals spec. Pure in (crystals); the caller
 * builds it once per document, never per frame.
 */
export function crystalInstances(spec: Crystals): CrystalInstance[] {
  const out: CrystalInstance[] = [];
  const groups = Math.max(1, spec.groups);
  const last = Math.max(1, groups - 1);
  // sin(elevation) is what is sampled uniformly, so an unbiased cluster is an
  // even urchin rather than a crowd around the poles.
  const sinHi = Math.sin(spec.direction.elevation[1] * DEG);
  const sinLo = Math.sin(spec.direction.elevation[0] * DEG);
  const span = spec.length[1] - spec.length[0];
  for (let i = 0; i < spec.count; i++) {
    const group = groupOf(i, groups);
    const gu = group / last;
    const ha = hash(spec.seed, i, 1);
    const hb = hash(spec.seed, i, 2);
    const hc = hash(spec.seed, i, 3);
    const hd = hash(spec.seed, i, 4);
    const he = hash(spec.seed, i, 5);
    const hf = hash(spec.seed, i, 6);
    const hg = hash(spec.seed, i, 7);

    // Only the shortest group reaches the bottom of the elevation band: long
    // spikes stay above the horizon, short ones also stab downward.
    const floor = sinLo * gu;
    // upBias pulls the hashed elevation toward the top of the band, and pulls
    // it hardest on the long spikes.
    const bias = Math.pow(hb, Math.max(0.2, 1 - spec.direction.upBias * (1 - gu)));
    const dy = floor + (sinHi - floor) * bias;
    // Golden-angle azimuth, offset per group, keeps the burst even all the way
    // round instead of clumping.
    const azimuth = ha * Math.PI * 2 + group * 0.41;
    const chord = Math.sqrt(Math.max(0, 1 - dy * dy));
    const dx = chord * Math.cos(azimuth);
    const dz = chord * Math.sin(azimuth);

    // Length classes carve overlapping sub-bands out of [length[0],length[1]],
    // longest first; the hash exponent makes the short ones cluster short.
    const hi = spec.length[0] + span * (1 - group / groups);
    const lo = Math.max(
      spec.length[0],
      spec.length[0] + span * (1 - (group + 1.4) / groups),
    );
    const length = lo + (hi - lo) * Math.pow(hc, 0.6 + group * 0.7);
    // Short spikes are relatively fatter; the hash spreads the band either way.
    const width = lerp(spec.width[0], spec.width[1], clamp01(gu * 0.5 + hd * 0.5));

    // The base sits off centre along the spike's own direction, further out for
    // the short groups, so the cluster has a core rather than a single point.
    const radius = spec.baseRadius * (0.33 + he) * (0.8 + 0.325 * group);
    const start =
      lerp(
        spec.stagger[0],
        spec.stagger[1],
        clamp01(gu * 0.75 + hg * 0.25),
      );
    out.push({
      index: i,
      direction: [dx, dy, dz],
      origin: [dx * radius, dy * radius * 0.95 + 0.05 * hf, dz * radius],
      length,
      width,
      start,
      seed: hash(spec.seed, i, 8),
      group,
    });
  }
  return out;
}

/**
 * A spike's live scale at layer-local time `age`, over a window of `span`
 * seconds: easeOutBack growth from its own staggered start, then the optional
 * collapse. The vertex shader computes the same expression; this is the mirror
 * the shatter emitter and the framing pass read.
 */
export function crystalScaleAt(
  instance: CrystalInstance,
  spec: Crystals,
  age: number,
  span: number,
) {
  const born = instance.start * span;
  const u = clamp01((age - born) / Math.max(spec.growth.duration, 1e-4));
  const k = spec.growth.overshoot;
  let scale = u >= 1 ? 1 : u * u * ((k + 1) * u - k);
  scale = Math.max(scale, 0);
  if (spec.collapse) {
    const from =
      spec.collapse.start * span + instance.seed * spec.collapse.duration * 1.125;
    const to = from + spec.collapse.duration;
    const t = clamp01((age - from) / Math.max(to - from, 1e-4));
    scale *= 1 - t * t * (3 - 2 * t);
  }
  return scale;
}

/**
 * Where a shatter emitter's instance `i` is born and which way it is thrown:
 * a point `u` of the way up one spike's axis, and that spike's own direction.
 * Closed form in (crystals, i), so the burst leaves the spikes it broke off
 * however the two layers happen to be drawn.
 */
export function crystalSpawnSites(
  spec: Crystals,
  count: number,
  lift: number,
): { positions: Float32Array; axes: Float32Array } {
  const table = crystalInstances(spec);
  const positions = new Float32Array(count * 3);
  const axes = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const spike = table[i % table.length];
    const u = 0.15 + 0.85 * hash(spec.seed, i, 11);
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] =
        spike.origin[k] + spike.direction[k] * spike.length * u;
      axes[i * 3 + k] = spike.direction[k];
    }
    positions[i * 3 + 1] = Math.max(lift, positions[i * 3 + 1]);
  }
  return { positions, axes };
}

/**
 * The cluster's own volume, in layer-local space: every base plus the furthest
 * tip it can reach. Unlike a particle spray this is exactly what is drawn, so
 * the whole box is claimed.
 */
export function crystalBounds(spec: Crystals): THREE.Vector3[] {
  const reach = spec.baseRadius + spec.length[1] + spec.width[1];
  const sinLo = Math.sin(spec.direction.elevation[0] * DEG);
  const sinHi = Math.sin(spec.direction.elevation[1] * DEG);
  return [
    new THREE.Vector3(-reach, Math.min(0, sinLo * reach), -reach),
    new THREE.Vector3(reach, Math.max(0.1, sinHi * reach), reach),
  ];
}

/**
 * The shared low-poly spike: an elongated hexagonal prism that narrows into a
 * pyramid, built NON-INDEXED so computeVertexNormals leaves every face flat.
 * It is unit sized — y runs 0 at the base to 1 at the apex and the ring radius
 * is 1 — and scaled per instance in the vertex shader. `aAlong` carries the
 * position along the axis, which keys the tip colour and the sliding glint.
 */
export function crystalGeometry(): THREE.BufferGeometry {
  const rings = [
    { y: 0, r: 1 },
    { y: 0.22, r: 0.92 },
    { y: 0.62, r: 0.54 },
    { y: 0.88, r: 0.2 },
  ];
  const sides = 6;
  const point = (ring: number, i: number): [number, number, number] => {
    const a = (i / sides) * Math.PI * 2;
    // A small per-column radius jitter so the facets are not perfectly regular.
    const jitter = 0.86 + 0.28 * hash11(i * 4.3 + 1.7);
    const r = rings[ring].r * jitter;
    return [Math.cos(a) * r, rings[ring].y, Math.sin(a) * r];
  };
  const apex: [number, number, number] = [0, 1, 0];
  const positions: number[] = [];
  const along: number[] = [];
  const push = (v: [number, number, number]) => {
    positions.push(v[0], v[1], v[2]);
    along.push(v[1]);
  };
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let i = 0; i < sides; i++) {
      const a = point(ring, i);
      const b = point(ring, (i + 1) % sides);
      const c = point(ring + 1, i);
      const d = point(ring + 1, (i + 1) % sides);
      push(a);
      push(b);
      push(d);
      push(a);
      push(d);
      push(c);
    }
  for (let i = 0; i < sides; i++) {
    push(point(rings.length - 1, i));
    push(point(rings.length - 1, (i + 1) % sides));
    push(apex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  geometry.computeVertexNormals();
  return geometry;
}

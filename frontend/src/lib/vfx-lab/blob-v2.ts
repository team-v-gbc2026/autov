import * as THREE from "three";
import { invertCurve, pathPoint, pathTangent } from "./paths-v2";
import type { Blob, BlobArrangement, PathV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// The blob generator: `layer.blob` -> a table of lobes, and every lobe's state
// at a time.
//
// The document never lists lobes. It describes a cluster (arrangement, count,
// spread, height, rise, ...) and this file hashes each lobe's birth time,
// radius, base position, drift, life and noise seed out of (blob.seed, index),
// exactly the way the hand-built spike's tables did by hand. Everything is a
// pure function of (blob, index, layer-local time): no accumulation, so
// seeking to t produces the same lobe positions as playing to t.
//
// Both the renderer (runtime-v2's createBlobLayer) and the CPU-side framing
// pass read the same two functions, so what is drawn and what the camera frames
// can never drift apart.
// ---------------------------------------------------------------------------

/** One generated lobe. Every field is closed form in (blob.seed, index). */
export interface Lobe {
  index: number;
  /** Birth time as a fraction of the layer window. */
  t0: number;
  /** Life in seconds. */
  life: number;
  /** Radius at full growth, in metres. */
  radius: number;
  /** Position at birth, layer-local. */
  base: [number, number, number];
  /** Metres of outward drift, applied on sqrt(a). */
  drift: [number, number];
  /** Metres travelled up over one life, and the downward pull on that arc. */
  rise: number;
  gravity: number;
  /** Lateral sway amplitude / rate / phase (string wisps only). */
  sway: [number, number, number];
  /** Noise seed for the radius field. */
  seed: number;
  /** Comma bend (signed) and tail heading, both 0 when blob.comma is null. */
  curl: number;
  rot: number;
  taper: number;
  /** Vertical stretch, blob.squash with a small per-lobe variation. */
  squash: number;
  /** Radius-field amplitude; the fatter filler lobes of a column are smoother. */
  amplitude: number;
  frequency: number;
  /** Draw order inside the layer: filler lobes sit behind the pairs. */
  depth: number;
  /**
   * arrangement "orbit": the ring lane this lobe rides. `radius` is its own
   * lane, `omega` its angular speed in radians a second (r^-0.65, so the inner
   * lane laps the outer one), `phase` where it starts and `bob` how far it
   * wanders out of the ring plane.
   */
  orbit: { radius: number; omega: number; phase: number; bob: number } | null;
  /**
   * arrangement "path": the path parameter this lobe is anchored at, and its
   * offset in the path's own frame (back along the tangent, up, across).
   */
  along: number;
  pathOffset: [number, number, number] | null;
}

/** The spike's hash: one deterministic uniform per (seed, index, channel). */
function hash(seed: number, index: number, channel: number) {
  const x =
    Math.sin(seed * 0.0137 + index * 127.1 + channel * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

export function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

/** One line per arrangement, for the guide and for describeLayersV2. */
export function describeArrangement(arrangement: BlobArrangement): string {
  switch (arrangement) {
    case "mound":
      return "base cluster: a half-egg of lobes `spread` wide and `height` tall, the foot a column grows out of";
    case "column":
      return "rising stack: paired lobes per level with a smoother filler lobe behind each pair, laddered up over `height`, each level rising further and later";
    case "ring":
      return "billows around the base: two tiers of lobes on a ring of radius `spread`, drifting outward, centre left open";
    case "string":
      return "thin vertical chain of wisps, alternating left/right and swaying, each smaller and shorter-lived than the last";
    case "orbit":
      return "lobes on a ring band between `height` (inner) and `spread` (outer) in the layer's own XY plane, orbiting at r^-0.65 so the inner lane laps the outer one; the far half of the ring draws first, smaller and dimmer";
    case "path":
      return "lobes anchored at fixed parameters of blob.pathId, born as blob.head passes them and drifting back along the path, up and across it; slot 0 of each anchor is the smoother core lobe";
  }
}

/**
 * Place lobe `i` of `count`. Returns the base position plus the per-lobe
 * modulation an arrangement wants (radius taper, rise scale, draw depth).
 *
 * The three arrangements that build upward (column, string) put successive
 * lobes higher AND later, so the cluster grows on screen instead of appearing
 * whole; `ring` and `mound` spread their lobes around instead.
 */
function place(blob: Blob, i: number, path: PathV2 | null) {
  const { count, spread, height } = blob;
  const h0 = hash(blob.seed, i, 0);
  const h1 = hash(blob.seed, i, 1);
  const h2 = hash(blob.seed, i, 2);
  let base: [number, number, number] = [0, 0, 0];
  // 0..1 along whatever the arrangement's principal axis is; drives the radius
  // taper, the rise scale and the birth order.
  let along = 0;
  let riseScale = 1;
  let radiusScale = 1;
  let depth = 1;
  let orbit: Lobe["orbit"] = null;
  let pathOffset: [number, number, number] | null = null;

  switch (blob.arrangement) {
    case "mound": {
      // An arch from (-spread, low) over (0, height) to (+spread, low), with
      // every third lobe pulled toward the centre so the egg is filled, not a
      // hollow outline.
      const u = count > 1 ? (i + 0.5) / count : 0.5;
      const phi = Math.PI * u;
      const arch: [number, number] = [
        -spread * Math.cos(phi),
        height * (0.06 + 0.94 * Math.sin(phi)),
      ];
      const centre: [number, number] = [0, height * 0.18];
      const fill = 0.72 + 0.28 * h0;
      base = [
        centre[0] + (arch[0] - centre[0]) * fill,
        centre[1] + (arch[1] - centre[1]) * fill,
        (h1 - 0.5) * spread,
      ];
      along = h2;
      // The rim lobes are the big ones; the infill sits behind them.
      radiusScale = 0.85 + 0.3 * fill;
      depth = fill > 0.9 ? 1 : 0;
      break;
    }
    case "column": {
      // Three lobes per level: a pair at +-half the spacing and a fatter,
      // smoother filler behind them that keeps the fused contour continuous.
      const levels = Math.max(1, Math.ceil(count / 3));
      const level = Math.floor(i / 3);
      const slot = i % 3;
      const lv = levels > 1 ? Math.min(level, levels - 1) / (levels - 1) : 0;
      const wob = spread * 0.3 * Math.sin(level * 0.8);
      const half = spread * (0.5 - 0.28 * lv);
      const x = slot === 2 ? wob : wob + (slot === 0 ? -half : half);
      base = [x, height * lv, slot === 2 ? -0.15 * spread : (h1 - 0.5) * spread * 0.6];
      along = lv;
      // The top of the stack reaches `rise`; the foot barely moves.
      riseScale = 0.18 + 0.82 * lv;
      radiusScale = slot === 2 ? 1.3 : 1;
      depth = slot === 2 ? 0 : 1;
      break;
    }
    case "ring": {
      // Two tiers of billows on a ring in XZ; the upper tier sits further out.
      const tier = i % 2;
      const step = Math.max(1, Math.ceil(count / 2));
      const k = Math.floor(i / 2);
      const theta =
        (2 * Math.PI * (k + 0.5 * tier)) / step + (h0 - 0.5) * 0.5;
      const radius = spread * (0.72 + 0.28 * tier);
      base = [
        Math.cos(theta) * radius,
        height * tier + (h1 - 0.5) * height * 0.15,
        Math.sin(theta) * radius * 0.55,
      ];
      along = tier ? 0.6 + 0.4 * h2 : h2 * 0.5;
      radiusScale = 1 - 0.18 * tier;
      depth = 1;
      break;
    }
    case "string": {
      const u = count > 1 ? i / (count - 1) : 0;
      base = [
        (i % 2 ? -1 : 1) * spread * (0.3 + 0.3 * u),
        height * u,
        spread * 0.7,
      ];
      along = u;
      riseScale = 1 - 0.25 * u;
      radiusScale = 1;
      depth = 1;
      break;
    }
    case "orbit": {
      // A ring BAND, not a ring: the lane is hashed inside [height, spread] on
      // a sqrt so the population is even in area rather than in radius, and the
      // angular speed falls off as r^-0.65 so the lanes shear past each other.
      const inner = Math.min(height, spread * 0.98);
      const r = inner + (spread - inner) * Math.sqrt(h0);
      const phase = h1 * Math.PI * 2;
      base = [Math.cos(phase) * r, Math.sin(phase) * r, 0];
      orbit = {
        radius: r,
        omega: Math.pow(Math.max(r, 1e-3) / Math.max(spread, 1e-3), -0.65),
        phase,
        bob: (h2 - 0.5) * blob.drift,
      };
      // 1 at the inner edge, 0 at the outer one: the inner lobes are the lit,
      // slightly larger ones, exactly as the lanes read against a hot core.
      along = 1 - clamp01((r - inner) / Math.max(spread - inner, 1e-3));
      radiusScale = 0.82 + 0.36 * h1;
      depth = 1;
      break;
    }
    case "path": {
      // Anchor k owns u = (k + 0.55)/anchors; its `perAnchor` lobes are offset
      // in the path's OWN frame so the trail is a thick chunky column rather
      // than a string of beads on a line.
      const per = Math.max(1, blob.perAnchor);
      const anchors = Math.max(1, Math.ceil(count / per));
      const k = Math.min(anchors - 1, Math.floor(i / per));
      const slot = i % per;
      const u = (k + 0.55) / anchors;
      const core = slot === 0;
      const point = path ? pathPoint(path, u) : [0, 0, 0];
      base = [point[0], point[1], point[2]];
      // (back along the tangent, up, across), in metres.
      pathOffset = [
        (h2 - 0.5) * (core ? 0.1 : 0.3) * spread,
        (h1 - 0.5) * (core ? 0.18 : 0.62) * spread,
        (h0 - 0.5) * (core ? 0.2 : 0.78) * spread,
      ];
      along = u;
      // The trail thins toward the tail it came from.
      radiusScale = (core ? 1.26 : 1) * (0.62 + 0.5 * (1 - u));
      depth = core ? 0 : 1;
      break;
    }
  }
  return { base, along, riseScale, radiusScale, depth, orbit, pathOffset, h0, h1, h2 };
}

/**
 * The whole lobe table for one blob spec. Pure in (blob); the caller is
 * expected to build it once per document, not per frame.
 */
export function blobLobes(blob: Blob, path: PathV2 | null = null): Lobe[] {
  const lobes: Lobe[] = [];
  // `mound` and `ring` spread out sideways, so their lobes are born in index
  // order; `column` and `string` build upward, so theirs are born by height.
  for (let i = 0; i < blob.count; i++) {
    const p = place(blob, i, path);
    const order = blob.count > 1 ? i / (blob.count - 1) : 0;
    // A path blob is born by the HEAD, not by the stagger: anchor k appears the
    // instant blob.head passes its own u, which is the whole point of anchoring
    // a trail instead of trailing it.
    const headBirth =
      blob.arrangement === "path" && blob.head
        ? clamp01(invertCurve(blob.head, p.along))
        : null;
    const birth =
      blob.arrangement === "column" || blob.arrangement === "string"
        ? p.along
        : order;
    // A little hashed slack on the stagger so a row never pops in lockstep.
    const t0 =
      headBirth !== null
        ? headBirth
        : blob.stagger[0] +
          (blob.stagger[1] - blob.stagger[0]) *
            clamp01(birth + (p.h2 - 0.5) * 0.12);
    // Stacks taper toward the top; clusters just vary.
    const taperRadius =
      blob.arrangement === "column" || blob.arrangement === "string"
        ? lerp(blob.radius[1], blob.radius[0], p.along)
        : lerp(blob.radius[0], blob.radius[1], p.h0);
    const radius = taperRadius * p.radiusScale * (0.92 + 0.16 * p.h1);
    const life = lerp(blob.life[0], blob.life[1], p.h2) * (1 - 0.18 * p.along);
    // The comma's tail points away from the cluster centre and its hook curls
    // back; both are read off the lobe's own base position, so a ring of
    // commas fans outward without the document saying so.
    let curl = 0;
    let rot = 0;
    if (blob.comma) {
      const dx = p.base[0];
      const dy = Math.max(0.25, p.base[1] * 0.35);
      const length = Math.hypot(dx, dy) || 1;
      curl = blob.comma.curl * (0.7 + 0.3 * p.h0) * (dx < 0 ? -1 : 1);
      rot = -Math.atan2(dx / length, dy / length);
    }
    lobes.push({
      index: i,
      t0,
      life,
      radius,
      base: p.base,
      drift: [
        blob.drift * (p.base[0] >= 0 ? 1 : -1) * (0.5 + Math.abs(p.base[0])),
        blob.drift * Math.sign(p.base[2]) * Math.abs(p.base[2]) * 0.5,
      ],
      rise: blob.rise * p.riseScale,
      gravity: blob.gravity * p.riseScale,
      sway:
        blob.arrangement === "string"
          ? [blob.spread * (0.22 + 0.2 * p.along), 4.2, i * 1.7]
          : [0, 0, 0],
      seed: (i + 1) * 1.37 + (blob.seed % 97) * 0.11,
      curl,
      rot,
      taper: blob.comma?.taper ?? 0,
      squash: blob.squash * (1 + 0.1 * (p.h1 - 0.5)),
      amplitude: blob.bump.amplitude * (p.depth === 0 ? 0.55 : 1),
      frequency: blob.bump.frequency * (p.depth === 0 ? 0.8 : 1),
      depth: p.depth,
      orbit: p.orbit,
      along: p.along,
      pathOffset: p.pathOffset,
    });
  }
  return lobes;
}

export interface LobeState {
  alive: boolean;
  /** Normalized lobe age, 0..1. */
  age: number;
  position: [number, number, number];
  /** Live radius, after the grow-in and the shrink-away. */
  radius: number;
  /** Alpha, 1 until `opaqueUntil` then falling to 0. */
  alpha: number;
  /** True once the lobe has stopped being opaque and depth-writing. */
  fading: boolean;
}

/**
 * A lobe at layer-local time `age` seconds, over a window of `span` seconds.
 * The equations are the spike's, unchanged: an eased grow-in over 1/grow of the
 * life, a shrink over the last 30%, a ballistic rise, an outward drift on
 * sqrt(a), and an opaque phase ending at `opaqueUntil`.
 */
export function lobeStateAt(
  lobe: Lobe,
  blob: Blob,
  age: number,
  span: number,
  opaqueUntil: number | null,
  path: PathV2 | null = null,
): LobeState {
  const a = (age - lobe.t0 * span) / Math.max(lobe.life, 1e-4);
  if (!(a > 0 && a < 1))
    return {
      alive: false,
      age: a,
      position: [0, 0, 0],
      radius: 0,
      alpha: 0,
      fading: false,
    };
  let radius =
    lobe.radius *
    easeOutCubic(Math.min(a * blob.grow, 1)) *
    (1 - smoothstep(0.7, 1, a));
  const sa = Math.sqrt(a);
  const cut = opaqueUntil ?? 1;
  let alpha = opaqueUntil === null ? 1 : 1 - smoothstep(cut, 1, a);
  let position: [number, number, number];
  if (lobe.orbit) {
    // A closed-form orbit: the lane's own angle plus omega * layer seconds, and
    // an out-of-plane bob on its own hashed rate. Nothing accumulates.
    // blob.rise is the angular speed at the OUTER edge, in radians a second.
    const theta = lobe.orbit.phase + age * lobe.orbit.omega * blob.rise;
    position = [
      Math.cos(theta) * lobe.orbit.radius,
      Math.sin(theta) * lobe.orbit.radius,
      lobe.orbit.bob * Math.sin(age * 0.9 + lobe.orbit.phase),
    ];
  } else if (lobe.pathOffset && path) {
    // The lobe holds the anchor it was born at and drifts back along the path,
    // up and across it — all on sqrt(a), which is what reads as billowing.
    const tangent = pathTangent(path, lobe.along);
    const side = orthoTangent(tangent);
    const up: [number, number, number] = [
      side[1] * tangent[2] - side[2] * tangent[1],
      side[2] * tangent[0] - side[0] * tangent[2],
      side[0] * tangent[1] - side[1] * tangent[0],
    ];
    const back = -blob.drift * sa + lobe.pathOffset[0];
    const lift = blob.rise * sa + lobe.pathOffset[1];
    const across = lobe.pathOffset[2];
    position = [
      lobe.base[0] + tangent[0] * back + up[0] * lift + side[0] * across,
      lobe.base[1] + tangent[1] * back + up[1] * lift + side[1] * across,
      lobe.base[2] + tangent[2] * back + up[2] * lift + side[2] * across,
    ];
  } else {
    position = [
      lobe.base[0] +
        lobe.drift[0] * sa +
        lobe.sway[0] * Math.sin(lobe.sway[1] * a + lobe.sway[2]),
      lobe.base[1] + lobe.rise * a - 0.5 * lobe.gravity * a * a,
      lobe.base[2] + lobe.drift[1] * sa,
    ];
  }
  // The trail retracts from one end over the LAYER's own progress, so the whole
  // column thins away in order instead of every lobe dying at once.
  if (blob.retract && span > 1e-6) {
    const u = clamp01(age / span);
    const shift =
      blob.retract.alongBias * lobe.along * (blob.retract.to - blob.retract.from);
    const keep =
      1 - smoothstep(blob.retract.from + shift, blob.retract.to + shift, u);
    radius *= 0.35 + 0.65 * keep;
    alpha *= keep;
  }
  return {
    alive: true,
    age: a,
    position,
    radius: Math.max(radius, 1e-4),
    alpha,
    fading: a > cut || (blob.retract !== null && alpha < 0.995),
  };
}

/** A unit vector across `tangent`, horizontal wherever the tangent is not. */
function orthoTangent(t: readonly number[]): [number, number, number] {
  const x = t[2];
  const z = -t[0];
  const length = Math.hypot(x, z);
  return length > 1e-5 ? [x / length, 0, z / length] : [1, 0, 0];
}

/**
 * The cluster's own volume, in layer-local space: where the lobes are BORN plus
 * their largest radius, never where a fast column ends up. Framing on the
 * trajectory would pull the camera back until the burst filled a corner, the
 * same failure `spawnBoundsV2` avoids for particles.
 */
export function blobBounds(blob: Blob, path: PathV2 | null = null): THREE.Vector3[] {
  const reach = blob.radius[1] * 1.4;
  // A ring claims its own band in the layer's XY plane and nothing along +Z;
  // an orbit that also claimed its bob would ask the camera for depth it never
  // uses, the same way spawnBoundsV2 refuses to claim a flat ring's axis.
  if (blob.arrangement === "orbit") {
    const outer = blob.spread + reach;
    const bob = Math.abs(blob.drift) + reach;
    return [
      new THREE.Vector3(-outer, -outer, -bob),
      new THREE.Vector3(outer, outer, bob),
    ];
  }
  // A path blob claims the path it is anchored to, plus one lobe either side.
  if (blob.arrangement === "path" && path) {
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i <= 16; i++) {
      const point = new THREE.Vector3().fromArray(pathPoint(path, i / 16));
      lo.min(point);
      hi.max(point);
    }
    const pad = reach + blob.spread * 0.5;
    return [
      lo.subScalar(pad),
      hi.addScalar(pad + Math.max(0, blob.rise)),
    ];
  }
  const lateral = blob.spread + reach + Math.abs(blob.drift) * 0.5;
  // A rising cluster claims a FIFTH of its reach: nothing, and the camera
  // frames a column at the knees; all of it, and a stack that deliberately
  // shoots out of the top of the shot drags everything else into the distance.
  const lift = Math.max(0, blob.rise) * 0.2;
  return [
    new THREE.Vector3(-lateral, -reach, -lateral),
    new THREE.Vector3(lateral, blob.height + reach + lift, lateral),
  ];
}

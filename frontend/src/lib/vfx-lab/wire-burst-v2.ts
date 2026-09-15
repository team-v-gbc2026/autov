import * as THREE from "three";
import type { WireBurst } from "./schema-v2";

// ---------------------------------------------------------------------------
// The wireBurst generator: `layer.wireBurst` -> one LineSegments buffer.
//
// A generator, like blob and splash: the document says how many outlines, how
// wide and how far they travel, and every shape's plane, vertex radii, spin and
// travel share are hashed out of (seed, index). The document never places a
// shape, and the buffer is built once — the outward travel and the scale
// envelope are applied in the vertex shader from layer time, so seek == play.
//
// `aKind` separates the two populations: 0 = a polygon outline (closed), 1 = a
// straight spoke, which travels half again as far and draws a little dimmer.
// ---------------------------------------------------------------------------

/** A spoke reaches this much further than an outline of the same hash. */
export const SPOKE_REACH = 1.5;

function hash11(p: number) {
  let x = (p * 0.1031) % 1;
  if (x < 0) x += 1;
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

/** Unit direction on the upper hemisphere, hashed from two channels. */
function direction(a: number, b: number, lift: number, base: number) {
  const theta = a * Math.PI * 2;
  const phi = Math.acos(1 - 2 * b);
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi) * lift + base,
    Math.sin(phi) * Math.sin(theta),
  );
  return v.normalize();
}

export interface WireBurstGeometry {
  geometry: THREE.BufferGeometry;
  /** Furthest any vertex reaches at full travel and full scale, in metres. */
  reach: number;
}

export function buildWireBurstGeometry(spec: WireBurst): WireBurstGeometry {
  const positions: number[] = [];
  const dirs: number[] = [];
  const seeds: number[] = [];
  const kinds: number[] = [];
  const push = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    d: THREE.Vector3,
    seed: number,
    kind: number,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    dirs.push(d.x, d.y, d.z, d.x, d.y, d.z);
    seeds.push(seed, seed);
    kinds.push(kind, kind);
  };
  const s = spec.seed;
  let reach = 0;

  for (let k = 0; k < spec.shapes; k++) {
    const key = s * 0.0137 + k;
    const sides =
      spec.sides[0] +
      Math.floor(hash11(key * 3.7 + 1.1) * (spec.sides[1] - spec.sides[0] + 1));
    const d = direction(
      hash11(key * 1.31 + 0.7),
      hash11(key * 2.17 + 5.5),
      0.7,
      0.28,
    );
    // Two axes in the shape's own plane; the plane's normal is its travel
    // direction, so an outline flies face-on to where it is going.
    const e1 = new THREE.Vector3()
      .crossVectors(d, new THREE.Vector3(0, 1, 0.001))
      .normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
    const radius = spec.radius * (0.55 + 0.75 * hash11(key * 5.9 + 2.2));
    const spin = hash11(key * 7.3 + 9.1) * Math.PI * 2;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = spin + (i / sides) * Math.PI * 2;
      // Per-vertex radius jitter is what makes the outline read as a shard
      // rather than as a regular polygon.
      const rr = radius * (0.72 + 0.55 * hash11(key * 11.3 + i * 2.7));
      points.push(
        new THREE.Vector3()
          .addScaledVector(e1, Math.cos(angle) * rr)
          .addScaledVector(e2, Math.sin(angle) * rr),
      );
      reach = Math.max(reach, rr);
    }
    for (let i = 0; i < sides; i++)
      push(points[i], points[(i + 1) % sides], d, k + 0.5, 0);
  }

  for (let k = 0; k < spec.spokes; k++) {
    const key = s * 0.0137 + k + 101;
    const d = direction(
      hash11(key * 4.13 + 17.3),
      hash11(key * 6.71 + 3.9),
      0.85,
      0.12,
    );
    const near = spec.radius * (0.4 + 0.8 * hash11(key * 2.9 + 8.1));
    const far = near + spec.radius * (1.2 + 2.2 * hash11(key * 9.7 + 4.4));
    push(
      d.clone().multiplyScalar(near),
      d.clone().multiplyScalar(far),
      d,
      k + 30.5,
      1,
    );
    reach = Math.max(reach, far);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("aDir", new THREE.Float32BufferAttribute(dirs, 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute("aKind", new THREE.Float32BufferAttribute(kinds, 1));
  return { geometry, reach };
}

/**
 * Corners of the burst's CORE, in layer space: the outline population at full
 * scale plus the median travel. Deliberately not the furthest spoke — a spoke
 * is a long thin line that leaves the frame on purpose, and framing the camera
 * on it would shrink the whole effect to a dot, exactly the way a particle
 * layer's stragglers are excluded from the hero box.
 */
export function wireBurstBounds(spec: WireBurst): THREE.Vector3[] {
  const scale = Math.max(...spec.scale.keys.map(([, v]) => v), 0);
  const extent = spec.travel * 0.9 + spec.radius * 1.3 * scale;
  const points: THREE.Vector3[] = [];
  for (const x of [-extent, extent])
    for (const y of [-extent, extent])
      for (const z of [-extent, extent])
        points.push(new THREE.Vector3(x, y, z));
  return points;
}

import * as THREE from "three";
import type { Licks } from "./schema-v2";

// ---------------------------------------------------------------------------
// The licks generator: `layer.licks` -> one instanced strip buffer.
//
// Flat cel flame strips that peel off a crescent's erosion front. The buffer is
// a plain (u along the strip, side) ladder; length, width, lateral offset and
// curl are re-hashed on floor(layerTime * flipbookHz) in the vertex program, so
// the whole set JUMPS on a flipbook step instead of sliding. Sliding the same
// shape along reads as a smear; jumping reads as hand-drawn fire, and that is
// the only difference between the two.
//
// A lick has no velocity of its own: it is ANCHORED to where the source
// crescent's tail is at this instant, which is why the birth order matches the
// order the blade tears.
// ---------------------------------------------------------------------------

/** Quads along one lick. 14 is enough for the curl to read as a curve. */
export const LICK_SEGMENTS = 14;

export function buildLicksGeometry(spec: Licks): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= LICK_SEGMENTS; i++) {
    const u = i / LICK_SEGMENTS;
    positions.push(u, -1, 0, u, 1, 0);
    if (i < LICK_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const seeds = new Float32Array(spec.count);
  const sides = new Float32Array(spec.count);
  for (let i = 0; i < spec.count; i++) {
    seeds[i] = i * 3.7 + 1.3 + spec.seed * 0.0137;
    // Alternating sides, so the licks fan off both edges of the tear.
    sides[i] = i % 2 === 0 ? 1 : -1;
  }
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute("aSide", new THREE.InstancedBufferAttribute(sides, 1));
  geometry.instanceCount = spec.count;
  return geometry;
}

/**
 * Corners of the volume a lick can reach from wherever it is anchored, in the
 * ANCHOR's own frame. The licks layer's bounds are then this box around the
 * source crescent's arc, which the runtime supplies; on its own a licks layer
 * claims nothing but its own reach.
 */
export function licksBounds(spec: Licks): THREE.Vector3[] {
  const reach = spec.length[1] + Math.max(...spec.drift.map(Math.abs)) * spec.life[1];
  const points: THREE.Vector3[] = [];
  for (const x of [-reach, reach])
    for (const y of [-reach, reach])
      for (const z of [-reach, reach])
        points.push(new THREE.Vector3(x, y, z));
  return points;
}

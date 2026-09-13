import * as THREE from "three";
import type { Arcs } from "./schema-v2";

// ---------------------------------------------------------------------------
// The arcs generator: `layer.arcs` -> one instanced strip buffer.
//
// A generator like blob, crystals and wireBurst: the document says how many
// arcs, how wide the helix band is and how they blink, and every arc's radius,
// pitch, base height, span, phase and blink offset are hashed out of
// (arcs.seed, index) AND out of its own blink index inside the vertex shader.
//
// The buffer carries no positions at all — every vertex is (u along the arc,
// side, 0) and the helix is swept in the vertex program — so nothing is rebuilt
// when an arc re-hashes, and the same layer time always draws the same cage.
// ---------------------------------------------------------------------------

/** Quads along one arc. Enough for a 1.8-turn helix to read as a curve. */
export const ARC_SEGMENTS = 26;

export function buildArcsGeometry(spec: Arcs): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const u = i / ARC_SEGMENTS;
    positions.push(u, -1, 0, u, 1, 0);
    if (i < ARC_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  // The per-arc seed: the spike's own stride, so the population spreads through
  // the hash instead of walking one bucket at a time.
  const seeds = new Float32Array(spec.count);
  for (let i = 0; i < spec.count; i++)
    seeds[i] = i * 3.77 + 0.91 + spec.seed * 0.0137;
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = spec.count;
  return geometry;
}

/**
 * Corners of the cylinder the cage can reach, in layer space: the widest helix
 * grown by its own jitter, over the full span. Deliberately the whole volume
 * rather than the arcs lit at one instant — framing is computed once per
 * document, and every arc visits its own band over the sustain.
 */
export function arcBounds(spec: Arcs): THREE.Vector3[] {
  const r = spec.radius[1] * (1 + spec.jitter.amplitude * 0.7);
  const points: THREE.Vector3[] = [];
  for (const x of [-r, r])
    for (const z of [-r, r]) for (const y of [0, spec.span]) points.push(new THREE.Vector3(x, y, z));
  return points;
}

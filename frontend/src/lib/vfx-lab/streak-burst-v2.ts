import * as THREE from "three";
import type { StreakBurst } from "./schema-v2";

// ---------------------------------------------------------------------------
// The streakBurst generator: `layer.streakBurst` -> one instanced quad buffer.
//
// A generator, like arcs and wireBurst: heading, length, width, curvature, hue
// and stagger are all hashed out of (seed, index) in the vertex shader. The
// buffer is one quad per streak and never changes; the radial spread comes from
// `grow` sampled on the layer's own 0..1 progress.
// ---------------------------------------------------------------------------

export function buildStreakGeometry(
  spec: StreakBurst,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  const seeds = new Float32Array(spec.count);
  for (let i = 0; i < spec.count; i++)
    seeds[i] = i * 2.313 + 0.37 + spec.seed * 0.0137;
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = spec.count;
  return geometry;
}

/**
 * Corners of the fan's CORE, in layer space. The longest streaks deliberately
 * run off the frame — that is what a speed line is for — so the box claims the
 * median reach rather than the maximum, the same way wireBurstBounds excludes
 * its spokes and a particle layer excludes its stragglers.
 */
export function streakBurstBounds(spec: StreakBurst): THREE.Vector3[] {
  const reach = (spec.length[0] + spec.length[1]) * 0.35;
  const points: THREE.Vector3[] = [];
  for (const x of [-reach, reach])
    for (const y of [-reach, reach])
      for (const z of [-reach, reach])
        points.push(new THREE.Vector3(x, y, z));
  return points;
}

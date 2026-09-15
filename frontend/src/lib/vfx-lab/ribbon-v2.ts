import * as THREE from "three";
import type { Curve, PathV2, Ribbon } from "./schema-v2";
import { pathPoint } from "./paths-v2";

// ---------------------------------------------------------------------------
// The ribbon generator: `layer.ribbon` -> one strip buffer per strand.
//
// The buffer carries no positions at all: every vertex is (w along the window,
// side, strand index) and the position is swept in the vertex shader from the
// document path, the live window and the live morph blend. That is what makes a
// ribbon closed form — there is nothing to rebuild when the head moves, and the
// same head at the same layer time always draws the same strip.
// ---------------------------------------------------------------------------

/** Quads along one strand. Enough for a full orbit wrap to read as a curve. */
export const RIBBON_SEGMENTS = 180;

/** `curve` sampled at u; the strip's own head/taper evaluation on the CPU. */
export function sampleCurve(curve: Curve, u: number) {
  const keys = curve.keys;
  const x = Math.min(1, Math.max(0, u));
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x <= keys[i][0]) {
      let f = (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-5);
      if (curve.ease === "smooth") f = f * f * (3 - 2 * f);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
}

export function buildRibbonGeometry(spec: Ribbon): THREE.BufferGeometry {
  const strands = spec.strands.count;
  const geometry = new THREE.BufferGeometry();
  const vertices = strands * (RIBBON_SEGMENTS + 1) * 2;
  const positions = new Float32Array(vertices * 3);
  const indices: number[] = [];
  let v = 0;
  for (let s = 0; s < strands; s++) {
    const base = v;
    for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
      const w = i / RIBBON_SEGMENTS;
      for (const side of [-1, 1]) {
        positions[v * 3] = w;
        positions[v * 3 + 1] = side;
        positions[v * 3 + 2] = s;
        v++;
      }
    }
    for (let i = 0; i < RIBBON_SEGMENTS; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Corners of the volume the ribbon can reach over its whole life, in layer
 * space: both paths sampled end to end, grown by the widest strand and by the
 * strand spread. Deliberately the whole path rather than the lit window —
 * framing is computed once per document, and a window that sweeps the path
 * visits all of it.
 */
export function ribbonBounds(
  spec: Ribbon,
  path: PathV2,
  morphPath: PathV2 | null,
  samples = 48,
): THREE.Vector3[] {
  const margin = spec.width * (1 + spec.strands.widthJitter) + spec.strands.spread;
  const points: THREE.Vector3[] = [];
  for (const source of morphPath ? [path, morphPath] : [path])
    for (let i = 0; i <= samples; i++) {
      const p = pathPoint(source, i / samples);
      points.push(new THREE.Vector3(p[0], p[1], p[2]).addScalar(margin));
      points.push(new THREE.Vector3(p[0], p[1], p[2]).addScalar(-margin));
    }
  return points;
}

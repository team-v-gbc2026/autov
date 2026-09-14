import * as THREE from "three";
import type { Crescent, Curve } from "./schema-v2";

// ---------------------------------------------------------------------------
// The crescent generator: `layer.crescent` -> one strip swept along an arc.
//
// The strip buffer carries no positions at all: every vertex is (s along the
// arc, q across it) and the world position is swept in the vertex program from
// the live window, exactly the way a ribbon is swept along a path. Nothing is
// rebuilt as the head travels, and the same layer time always draws the same
// blade.
//
// The arc lives in the LAYER's own XY plane, leaned by `planeTilt` about its
// +X. Seen from an elevated oblique camera a circle in that plane projects to
// an ellipse, which is what turns a 200-degree sweep into a banana instead of a
// "C": the lean is the whole read, and it is one number rather than a hand-built
// basis.
// ---------------------------------------------------------------------------

/** Quads along the arc, and across the strip. 260 is smooth at R = 1.5. */
export const CRESCENT_SEGMENTS_S = 260;
export const CRESCENT_SEGMENTS_Q = 5;

export function buildCrescentGeometry(): THREE.BufferGeometry {
  const nv = (CRESCENT_SEGMENTS_S + 1) * (CRESCENT_SEGMENTS_Q + 1);
  const positions = new Float32Array(nv * 3);
  const aS = new Float32Array(nv);
  const aQ = new Float32Array(nv);
  const indices: number[] = [];
  let v = 0;
  for (let i = 0; i <= CRESCENT_SEGMENTS_S; i++)
    for (let j = 0; j <= CRESCENT_SEGMENTS_Q; j++) {
      aS[v] = i / CRESCENT_SEGMENTS_S;
      aQ[v] = j / CRESCENT_SEGMENTS_Q;
      v++;
    }
  for (let i = 0; i < CRESCENT_SEGMENTS_S; i++)
    for (let j = 0; j < CRESCENT_SEGMENTS_Q; j++) {
      const a = i * (CRESCENT_SEGMENTS_Q + 1) + j;
      const b = a + (CRESCENT_SEGMENTS_Q + 1);
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
  geometry.setAttribute("aQ", new THREE.BufferAttribute(aQ, 1));
  geometry.setIndex(indices);
  return geometry;
}

export interface ArcFrame {
  /** In-plane axes and the plane normal, all in LAYER space. */
  ex: THREE.Vector3;
  ey: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * The arc's own basis: +X of the layer, and +Y leaned by `planeTilt` toward
 * +Z. A tilt of 0 is the layer's own XY plane; the layer transform then aims
 * the whole thing, so a blade that lies flat over the ground is the ordinary
 * [-PI/2, 0, 0] rotation and nothing here has to know about the camera.
 */
export function arcFrame(spec: Crescent): ArcFrame {
  const c = Math.cos(spec.planeTilt);
  const s = Math.sin(spec.planeTilt);
  const ex = new THREE.Vector3(1, 0, 0);
  const ey = new THREE.Vector3(0, c, s);
  return { ex, ey, normal: new THREE.Vector3().crossVectors(ex, ey).normalize() };
}

/** The point at arc parameter `s` (0 = the tail end), in layer space. */
export function arcPoint(spec: Crescent, s: number, out = new THREE.Vector3()) {
  const { ex, ey } = arcFrame(spec);
  const ph = spec.phase + s * spec.sweep;
  return out
    .set(0, 0, 0)
    .addScaledVector(ex, Math.cos(ph) * spec.radius)
    .addScaledVector(ey, Math.sin(ph) * spec.radius);
}

/** Unit tangent at `s`, pointing the way the head travels. */
export function arcTangent(spec: Crescent, s: number, out = new THREE.Vector3()) {
  const { ex, ey } = arcFrame(spec);
  const ph = spec.phase + s * spec.sweep;
  return out
    .set(0, 0, 0)
    .addScaledVector(ex, -Math.sin(ph))
    .addScaledVector(ey, Math.cos(ph))
    .normalize();
}

/** Piecewise curve sample on the layer's own 0..1 progress. */
export function sampleCrescentCurve(curve: Curve, u: number) {
  const x = Math.min(1, Math.max(0, u));
  const keys = curve.keys;
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x <= keys[i][0]) {
      let f = (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-5);
      if (curve.ease === "smooth") f = f * f * (3 - 2 * f);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
}

/**
 * The inverse of a non-decreasing curve: the progress u at which the curve
 * first reaches `y`. Closed form, so a front-anchored ember's birth is a
 * function of its own arc parameter and never a stored table. Mirrors
 * `glslCurveInverse` term for term.
 */
export function invertCrescentCurve(curve: Curve, y: number) {
  const keys = curve.keys;
  for (let i = 1; i < keys.length; i++) {
    const [ax, ay] = keys[i - 1];
    const [bx, by] = keys[i];
    if (y <= by || i === keys.length - 1) {
      const s = Math.min(1, Math.max(0, (y - ay) / Math.max(by - ay, 1e-5)));
      const f =
        curve.ease === "smooth"
          ? 0.5 - Math.sin(Math.asin(Math.min(1, Math.max(-1, 1 - 2 * s))) / 3)
          : s;
      return ax + (bx - ax) * f;
    }
  }
  return keys[keys.length - 1][0];
}

/** Head and tail of the window at layer progress `u`, clamped to the arc. */
export function crescentWindowAt(spec: Crescent, u: number) {
  const head = Math.min(1, Math.max(1e-4, sampleCrescentCurve(spec.window.head, u)));
  const tail = Math.min(1, Math.max(0, sampleCrescentCurve(spec.window.tail, u)));
  return { head, tail };
}

/**
 * Corners of the blade's own volume, in layer space: the arc itself, sampled
 * over the whole sweep and pushed out by the fattest half-thickness. The window
 * is deliberately ignored — framing is computed once per document and the head
 * visits every part of the arc over the sweep.
 */
export function crescentBounds(spec: Crescent): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const half = spec.thickness.max * 0.5 + Math.abs(spec.thickness.max) * 0.2;
  const scale = Math.max(...spec.tonal.map((t) => t.scale), 1);
  const { normal } = arcFrame(spec);
  for (let i = 0; i <= 16; i++) {
    const p = arcPoint(spec, i / 16);
    const radial = p.clone().normalize().multiplyScalar(half * scale);
    points.push(p.clone().add(radial));
    points.push(p.clone().sub(radial));
    points.push(p.clone().addScaledVector(normal, half * scale));
  }
  return points;
}

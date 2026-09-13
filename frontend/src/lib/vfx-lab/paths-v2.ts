import * as THREE from "three";
import type { Curve, PathV2, VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Document paths.
//
// A path is a pure function of u in 0..1. Everything that travels — a ribbon's
// window, a path-anchored emitter, a morph target — reads the SAME function, on
// the CPU (framing, depth sorting) and in GLSL (the draw), so a ribbon and the
// dashes anchored to it can never drift apart.
//
// The GLSL half lives in `glslPath` below and is written against the same five
// uniform vectors `pathUniforms` packs, term for term. The tangent is a forward
// difference on both sides rather than an analytic derivative, because the
// orbit's wobble makes the analytic form long and the two copies would be the
// first thing to diverge.
// ---------------------------------------------------------------------------

/** Step the tangent difference uses, in path parameter. Mirrored in GLSL. */
const TANGENT_STEP = 1e-3;

export type Vec3 = [number, number, number];

export function pathPoint(path: PathV2, u: number): Vec3 {
  if (path.type === "line") {
    const m = 1 - u;
    return [0, 1, 2].map((axis) => m * path.from[axis] + u * path.to[axis]) as Vec3;
  }
  if (path.type === "bezier") {
    const m = 1 - u;
    return [0, 1, 2].map(
      (axis) =>
        m * m * path.from[axis] +
        2 * m * u * path.control[axis] +
        u * u * path.to[axis],
    ) as Vec3;
  }
  const theta = Math.PI * 2 * path.turns * u + path.phase;
  const wobble = path.wobble;
  const r = path.radius + wobble.amplitude * Math.sin(wobble.frequency * theta);
  // The vertical wobble runs at twice the radial one, phase-shifted: an integer
  // multiple, so an orbit with height 0 and an integer frequency*turns CLOSES
  // (u and u+1 are the same point) and a ribbon head may run past 1.
  const y =
    path.center[1] +
    path.height * u +
    wobble.amplitude * 0.5 * Math.sin(wobble.frequency * theta * 2 + 1.3);
  return [
    path.center[0] + Math.cos(theta) * r,
    y,
    path.center[2] + Math.sin(theta) * r,
  ];
}

/** Unit tangent at u; falls back to +Z on a degenerate path. */
export function pathTangent(path: PathV2, u: number): Vec3 {
  const a = pathPoint(path, u - TANGENT_STEP);
  const b = pathPoint(path, u + TANGENT_STEP);
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  return length > 1e-6 ? ([d[0] / length, d[1] / length, d[2] / length] as Vec3) : [0, 0, 1];
}

/** Sampled hull of the whole path, for the framing pass. */
export function pathBounds(path: PathV2, samples = 32): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++)
    points.push(new THREE.Vector3().fromArray(pathPoint(path, i / samples)));
  return points;
}

/**
 * Inverse of a monotone non-decreasing piecewise-linear curve: the 0..1 domain
 * position that produces `y`. The CPU mirror of `glslCurveInverse`; the smooth
 * ease is undone analytically, so a path-anchored instance's birth time is
 * closed form rather than a stored table.
 */
export function invertCurve(curve: Curve, y: number): number {
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

export function findPath(doc: VfxDocumentV2, id: string | null): PathV2 | null {
  if (!id) return null;
  return doc.paths.find((path) => path.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * The uniform pack for one path, under a name prefix. The same five vectors
 * describe both path types; which fields are read is decided by `u${P}PathType`
 * (0 = orbit, 1 = bezier).
 *
 *   u{P}PathType   0 orbit / 1 bezier (a "line" rides the bezier branch with its
 *                  control at the midpoint, which is exactly the segment)
 *   u{P}PathA      orbit: center          bezier: from
 *   u{P}PathB      orbit: unused          bezier: control
 *   u{P}PathC      orbit: unused          bezier: to
 *   u{P}PathD      orbit: (radius, height, turns, phase)
 *   u{P}PathW      orbit: (wobble.amplitude, wobble.frequency)
 */
export function pathUniforms(
  prefix: string,
  path: PathV2 | null,
): Record<string, THREE.IUniform> {
  const orbit = path && path.type === "orbit" ? path : null;
  // A "line" travels on the bezier branch with its control point at the
  // midpoint, which IS the straight segment term for term
  // (m²F + 2mu·(F+T)/2 + u²T = mF + uT). So the GLSL only ever needs two
  // branches however many path types the schema grows.
  const bezier =
    path && path.type === "bezier"
      ? { from: path.from, control: path.control, to: path.to }
      : path && path.type === "line"
        ? {
            from: path.from,
            control: path.from.map((v, i) => (v + path.to[i]) * 0.5) as [
              number,
              number,
              number,
            ],
            to: path.to,
          }
        : null;
  return {
    [`u${prefix}PathType`]: { value: bezier ? 1 : 0 },
    [`u${prefix}PathA`]: {
      value: new THREE.Vector3().fromArray(
        bezier ? bezier.from : (orbit?.center ?? [0, 0, 0]),
      ),
    },
    [`u${prefix}PathB`]: {
      value: new THREE.Vector3().fromArray(bezier ? bezier.control : [0, 0, 0]),
    },
    [`u${prefix}PathC`]: {
      value: new THREE.Vector3().fromArray(bezier ? bezier.to : [0, 0, 0]),
    },
    [`u${prefix}PathD`]: {
      value: new THREE.Vector4(
        orbit?.radius ?? 1,
        orbit?.height ?? 0,
        orbit?.turns ?? 1,
        orbit?.phase ?? 0,
      ),
    },
    [`u${prefix}PathW`]: {
      value: new THREE.Vector2(
        orbit?.wobble.amplitude ?? 0,
        orbit?.wobble.frequency ?? 0,
      ),
    },
  };
}

/** Rewrites an existing pack in place, so a live path never reallocates. */
export function writePathUniforms(
  uniforms: Record<string, THREE.IUniform>,
  prefix: string,
  path: PathV2 | null,
) {
  const next = pathUniforms(prefix, path);
  for (const [name, uniform] of Object.entries(next)) {
    const target = uniforms[name];
    if (!target) continue;
    if (typeof uniform.value === "number") target.value = uniform.value;
    else (target.value as THREE.Vector3).copy(uniform.value);
  }
}

/**
 * `pathPoint{P}(u)` / `pathTangent{P}(u)`, matching the TS evaluator above term
 * for term. Emitted once per prefix; a layer that morphs emits two.
 */
export function glslPath(prefix: string, suffix = "") {
  return /* glsl */ `
uniform int u${prefix}PathType;
uniform vec3 u${prefix}PathA,u${prefix}PathB,u${prefix}PathC;
uniform vec4 u${prefix}PathD;
uniform vec2 u${prefix}PathW;
vec3 pathPoint${suffix}(float u){
  if(u${prefix}PathType==1){
    float m=1.-u;
    return m*m*u${prefix}PathA+2.*m*u*u${prefix}PathB+u*u*u${prefix}PathC;
  }
  float th=6.28318530718*u${prefix}PathD.z*u+u${prefix}PathD.w;
  float r=u${prefix}PathD.x+u${prefix}PathW.x*sin(u${prefix}PathW.y*th);
  float y=u${prefix}PathA.y+u${prefix}PathD.y*u
        +u${prefix}PathW.x*.5*sin(u${prefix}PathW.y*th*2.+1.3);
  return vec3(u${prefix}PathA.x+cos(th)*r, y, u${prefix}PathA.z+sin(th)*r);
}
vec3 pathTangent${suffix}(float u){
  vec3 d=pathPoint${suffix}(u+${TANGENT_STEP.toExponential()})-pathPoint${suffix}(u-${TANGENT_STEP.toExponential()});
  float l=length(d);
  return l>1e-6 ? d/l : vec3(0.,0.,1.);
}
/* Frame at u: side is horizontal (tangent x world up), up completes it. */
void pathFrame${suffix}(float u, out vec3 tangent, out vec3 side, out vec3 up){
  tangent=pathTangent${suffix}(u);
  side=normalize(cross(tangent, vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
  up=normalize(cross(side,tangent));
}
`;
}

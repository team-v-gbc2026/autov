import * as THREE from "three";
import { z } from "zod";

const point = z.tuple([
  z.number().finite().min(-100).max(100),
  z.number().finite().min(-100).max(100),
  z.number().finite().min(-100).max(100),
]);
export const EffectPathSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    /** Connected cubic segments: first anchor, then handle/handle/anchor triples. */
    points: z
      .array(point)
      .min(4)
      .max(49)
      .refine(
        (p) => (p.length - 1) % 3 === 0,
        "Expected 1 + 3n control points",
      ),
  })
  .strict();
export const PathAttachmentSchema = z
  .object({
    pathId: z.string(),
    mode: z.enum(["shape", "emit", "follow"]),
    range: z
      .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
      .refine(([a, b]) => b > a, "Path range must increase"),
    offset: z.tuple([
      z.number().finite().min(-10).max(10),
      z.number().finite().min(-10).max(10),
    ]),
    roll: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
  })
  .strict();
export type EffectPath = z.infer<typeof EffectPathSchema>;
export type PathAttachment = z.infer<typeof PathAttachmentSchema>;
export const PATH_SAMPLES = 65;
export type PathFrame = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
};
export type SampledPath = { length: number; frames: PathFrame[] };

/** Arc-length resampling with parallel-transport frames. Static tables are the
 * single CPU/GPU contract; no separate analytic evaluator in the shaders. */
export function sampleEffectPath(path: EffectPath): SampledPath {
  const points = path.points.map((p) => new THREE.Vector3(...p));
  const dense = [points[0].clone()];
  for (let i = 0; i < points.length - 1; i += 3) {
    const curve = new THREE.CubicBezierCurve3(
      points[i],
      points[i + 1],
      points[i + 2],
      points[i + 3],
    );
    for (let j = 1; j <= 128; j++) dense.push(curve.getPoint(j / 128));
  }
  const distances = [0];
  for (let i = 1; i < dense.length; i++)
    distances.push(distances[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const length = distances[distances.length - 1];
  if (length < 1e-5)
    throw new Error(`Path ${path.id} has no measurable length`);
  const positions: THREE.Vector3[] = [];
  let cursor = 1;
  for (let i = 0; i < PATH_SAMPLES; i++) {
    const d = (length * i) / (PATH_SAMPLES - 1);
    while (cursor < distances.length - 1 && distances[cursor] < d) cursor++;
    const span = distances[cursor] - distances[cursor - 1];
    positions.push(
      dense[cursor - 1]
        .clone()
        .lerp(
          dense[cursor],
          span > 1e-10 ? (d - distances[cursor - 1]) / span : 0,
        ),
    );
  }
  let previous = new THREE.Vector3(0, 0, 1),
    normal = new THREE.Vector3(1, 0, 0);
  const frames = positions.map((position, i) => {
    const tangent = positions[Math.min(i + 1, positions.length - 1)]
      .clone()
      .sub(positions[Math.max(0, i - 1)]);
    if (tangent.lengthSq() < 1e-12) tangent.copy(previous);
    else tangent.normalize();
    if (i === 0) {
      const up =
        Math.abs(tangent.y) < 0.95
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
      normal.crossVectors(up, tangent).normalize();
    } else {
      if (previous.dot(tangent) < -0.95)
        throw new Error(
          `Path ${path.id} reverses at a cusp; separate or smooth the segments`,
        );
      normal.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(previous, tangent),
      );
    }
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    previous = tangent;
    return { position, normal: normal.clone(), tangent };
  });
  return { length, frames };
}

/** Linear table interpolation and endpoint extrapolation, mirrored in GLSL. */
export function pathFrameAt(path: SampledPath, distance: number): PathFrame {
  const x =
    THREE.MathUtils.clamp(distance / path.length, 0, 1) * (PATH_SAMPLES - 1);
  const i = Math.min(PATH_SAMPLES - 2, Math.floor(x)),
    f = x - i;
  const a = path.frames[i],
    b = path.frames[i + 1];
  const tangent = a.tangent.clone().lerp(b.tangent, f).normalize();
  const normal = a.normal.clone().lerp(b.normal, f);
  normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
  const position = a.position
    .clone()
    .lerp(b.position, f)
    .addScaledVector(
      tangent,
      distance - THREE.MathUtils.clamp(distance, 0, path.length),
    );
  return { position, normal, tangent };
}
export function pathVector(frame: PathFrame, v: THREE.Vector3): THREE.Vector3 {
  return frame.normal
    .clone()
    .multiplyScalar(v.x)
    .addScaledVector(
      new THREE.Vector3().crossVectors(frame.tangent, frame.normal),
      v.y,
    )
    .addScaledVector(frame.tangent, v.z);
}

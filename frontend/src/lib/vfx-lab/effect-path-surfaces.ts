import * as THREE from "three";
import type { GeometryV2 } from "./schema-v2";
import type { LayerPath } from "./effect-path-adapter";
import { PATH_SAMPLES, pathFrameAt, pathVector } from "./effect-path";
import { buildLightningGeometry } from "./lightning-v2";

/** Preserve the existing deterministic bolt (including branches and pinned
 * endpoints), then map its authored Y-axis domain through transported frames.
 * Reference +Z points from impact toward the bolt; strike travel is toward 0. */
export function buildCurvedLightningGeometry(
  g: GeometryV2,
  seed: number,
  strike: number,
  binding: LayerPath,
): THREE.BufferGeometry {
  const result = buildLightningGeometry(g, seed, strike);
  const vertices = result.getAttribute("position");
  const point = new THREE.Vector3();
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i);
    const distance =
      ((point.y + g.length * 0.5) / Math.max(binding.baseLength, 1e-5)) *
      binding.path.length;
    const frame = pathFrameAt(binding.path, distance);
    const mapped = frame.position
      .clone()
      .add(pathVector(frame, new THREE.Vector3(point.x, point.z, 0)));
    vertices.setXYZ(i, mapped.x, mapped.y, mapped.z);
  }
  // The deformation changes the surface differential, especially on branches.
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

/** Conservative counterpart of the analytic shell shader, including its
 * radial displacement, axial noise, and biased lift/lobes. Tail closure only
 * reduces this envelope. Rigid layer transforms are applied by the caller. */
export function curvedShellBounds(
  g: GeometryV2,
  binding: LayerPath,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const amp = g.vertexNoise?.amplitude ?? 0;
  const envelope = Math.max(
    1,
    ...(g.vertexNoise?.alongCurve.keys.map((k) => Math.abs(k[1])) ?? [1]),
  );
  for (let i = 0; i < PATH_SAMPLES; i++) {
    const along = i / (PATH_SAMPLES - 1),
      taper = along * 2 - 1;
    const len =
      g.length * (along < 0.5 ? along * 0.9 : 0.45 + (along - 0.5) * 1.1);
    const frame = pathFrameAt(
      binding.path,
      (len / Math.max(binding.baseLength, 1e-5)) * binding.path.length,
    );
    const radial =
      g.radius *
      (1.05 * Math.sqrt(Math.max(0, 1 - taper * taper)) * (1 - along * 0.45) +
        0.06);
    const displacement = amp * envelope * g.radius * 2.4;
    const lift = g.length * 0.236 * along ** 2.3 + g.radius * amp * 6.2;
    const radius = radial + displacement + lift + 0.25 * along;
    for (const x of [-radius, radius])
      for (const y of [-radius, radius])
        for (const z of [-radius, radius])
          points.push(frame.position.clone().add(new THREE.Vector3(x, y, z)));
  }
  return points;
}

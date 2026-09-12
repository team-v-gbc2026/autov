import * as THREE from "three";
import type { Layer } from "./schema";
import { random } from "./evaluate";

// Bounded, deterministic meshes. No model download, arbitrary code, or frame-dependent simulation.
export function buildGeometry(
  layer: Layer,
  seed: number,
): THREE.BufferGeometry {
  switch (layer.geometry) {
    case "plane":
      return new THREE.PlaneGeometry(2, 2);
    case "teardrop":
      return new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, -1),
          new THREE.Vector2(0.22, -0.85),
          new THREE.Vector2(0.68, -0.45),
          new THREE.Vector2(0.95, 0),
          new THREE.Vector2(0.85, 0.4),
          new THREE.Vector2(0.52, 0.8),
          new THREE.Vector2(0, 1),
        ],
        40,
      );
    case "cone":
      return new THREE.ConeGeometry(1, 2, 24, 4, true);
    case "crystal":
      return new THREE.CylinderGeometry(0, 0.45, 2, 5, 1, false);
    case "torus":
      return new THREE.TorusGeometry(
        0.78,
        Math.min(0.35, layer.params.width / layer.params.radius),
        8,
        64,
      );
    case "ribbon": {
      const positions: number[] = [],
        uvs: number[] = [],
        indices: number[] = [];
      const segments = 64,
        arc = layer.params.arc;
      for (let i = 0; i <= segments; i++) {
        const u = i / segments,
          a = u * arc,
          taper = Math.pow(Math.sin(Math.PI * u), 0.6);
        const width = Math.max(
          0.003,
          (layer.params.width / layer.params.radius) * taper,
        );
        for (const side of [-1, 1]) {
          const radius = 0.72 + side * width;
          positions.push(
            Math.cos(a) * radius,
            Math.sin(a) * radius,
            0.12 * Math.sin(a * 2),
          );
          uvs.push(u, (side + 1) / 2);
        }
        if (i < segments) {
          const j = i * 2;
          indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    }
    case "lightning": {
      const paths: THREE.BufferGeometry[] = [];
      // Co-located colored sheath and white core share the same centerline.
      const key = `bolt:${layer.params.position.map((v) => v.toFixed(3)).join(":")}`;
      const count = layer.params.turbulence < 0.3 ? 7 : 13;
      const points = Array.from(
        { length: count },
        (_, i) =>
          new THREE.Vector3(
            i === 0 || i === count - 1
              ? 0
              : (i % 2 ? 1 : -1) *
                  (0.45 + random(seed, key, i, "bend") * 0.55) *
                  Math.max(0.2, layer.params.radius * 0.45),
            1 - (i * 2) / (count - 1),
            (random(seed, key, i, "depth") - 0.5) * 0.08,
          ),
      );
      const make = (points: THREE.Vector3[], radius: number) => {
        const vertices: number[] = [],
          uvs: number[] = [],
          indices: number[] = [];
        const sides = 6;
        for (let i = 0; i < points.length; i++) {
          const tangent = points[Math.min(points.length - 1, i + 1)]
            .clone()
            .sub(points[Math.max(0, i - 1)])
            .normalize();
          const normal = new THREE.Vector3()
            .crossVectors(tangent, new THREE.Vector3(0, 0, 1))
            .normalize();
          const binormal = new THREE.Vector3()
            .crossVectors(tangent, normal)
            .normalize();
          const thickness =
            radius *
            (0.6 + random(seed, key, i, "thickness") * 0.65) *
            (i === points.length - 1 ? 0.5 : 1);
          for (let j = 0; j <= sides; j++) {
            const angle = (j / sides) * Math.PI * 2;
            const v = points[i]
              .clone()
              .addScaledVector(normal, Math.cos(angle) * thickness)
              .addScaledVector(binormal, Math.sin(angle) * thickness);
            vertices.push(v.x, v.y, v.z);
            uvs.push(j / sides, i / (points.length - 1));
            if (i < points.length - 1 && j < sides) {
              const k = i * (sides + 1) + j;
              indices.push(
                k,
                k + 1,
                k + sides + 1,
                k + 1,
                k + sides + 2,
                k + sides + 1,
              );
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(vertices, 3),
        );
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const result = geometry.toNonIndexed();
        geometry.dispose();
        return result;
      };
      const width = Math.max(0.003, Math.min(0.6, layer.params.width));
      paths.push(make(points, width));
      for (const index of layer.params.turbulence < 0.3 ? [] : [3, 7]) {
        const base = points[index];
        const side = index === 3 ? -1 : 1;
        paths.push(
          make(
            [
              base,
              base.clone().add(new THREE.Vector3(0.3 * side, -0.2, 0)),
              base.clone().add(new THREE.Vector3(0.55 * side, -0.6, 0.1)),
            ],
            width * 0.4,
          ),
        );
      }
      const result = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const arrays = paths.map((g) => g.getAttribute(name));
        const merged = new Float32Array(
          arrays.reduce((n, a) => n + a.array.length, 0),
        );
        let cursor = 0;
        for (const a of arrays) {
          merged.set(a.array, cursor);
          cursor += a.array.length;
        }
        result.setAttribute(
          name,
          new THREE.BufferAttribute(merged, arrays[0].itemSize),
        );
      }
      paths.forEach((g) => g.dispose());
      return result;
    }
    default:
      return layer.kind === "shell"
        ? new THREE.SphereGeometry(1, 48, 28)
        : new THREE.PlaneGeometry(2, 2);
  }
}

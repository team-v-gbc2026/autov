import {
  buildCurvedLightningGeometry,
  curvedShellBounds,
} from "../src/lib/vfx-lab/effect-path-surfaces";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { sampleEffectPath, pathFrameAt } from "../src/lib/vfx-lab/effect-path";
import {
  layerPath,
  pathParticlePosition,
} from "../src/lib/vfx-lab/effect-path-adapter";
import { validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
import { readFileSync } from "node:fs";
const load = () =>
  validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/curved-beam/document.json", "utf8")),
  );
test("straight path preserves distances and extrapolates without endpoint accumulation", () => {
  const p = sampleEffectPath({
    id: "line",
    points: [
      [0, 0, 0],
      [0, 0, 2],
      [0, 0, 4],
      [0, 0, 6],
    ],
  });
  for (const d of [-1, 0, 0.35, 3, 6, 8])
    assert.ok(
      pathFrameAt(p, d).position.distanceTo(new THREE.Vector3(0, 0, d)) < 1e-6,
    );
});
test("connected curves and repeated handles produce finite orthonormal frames", () => {
  const p = sampleEffectPath({
    id: "s",
    points: [
      [0, 0, 0],
      [0, 0, 0],
      [2, 1, 2],
      [0, 1, 3],
      [-2, 1, 4],
      [0, 0, 6],
      [0, 0, 6],
    ],
  });
  for (let i = 0; i <= 200; i++) {
    const f = pathFrameAt(p, (p.length * i) / 200);
    assert.ok(Math.abs(f.normal.dot(f.tangent)) < 1e-6);
    assert.ok(Math.abs(f.normal.length() - 1) < 1e-6);
    assert.ok(f.position.toArray().every(Number.isFinite));
  }
  assert.throws(
    () =>
      sampleEffectPath({
        id: "zero",
        points: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
    /no measurable length/,
  );
});
test("reference path maps through nonidentity authoring and layer frames", () => {
  const d = load(),
    l = d.layers.find((l) => l.path?.mode === "shape")!;
  const p = layerPath(d, l)!;
  const transform = new THREE.Matrix4().compose(
    new THREE.Vector3(...l.transform.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...l.transform.rotation),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  const anchor = new THREE.Matrix4().compose(
    new THREE.Vector3(...d.authoringFrame!.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...d.authoringFrame!.rotation),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  const point = p.path.frames[0].position
    .clone()
    .applyMatrix4(transform)
    .applyMatrix4(anchor.invert());
  assert.ok(point.length() < 1e-6);
});
test("follow moves on the path while emit retains its launch direction", () => {
  const d = load(),
    l = d.layers.find((l) => l.path?.mode === "follow")!,
    b = layerPath(d, l)!;
  const origin = new THREE.Vector3(),
    direction = new THREE.Vector3(0, 0, 1),
    out = new THREE.Vector3();
  pathParticlePosition(b, 0, origin, direction, 2, out);
  assert.ok(out.distanceTo(pathFrameAt(b.path, 2).position) < 1e-6);
  pathParticlePosition({ ...b, mode: "emit" }, 0, origin, direction, 2, out);
  const birth = pathFrameAt(b.path, 0);
  assert.ok(
    out.distanceTo(birth.position.addScaledVector(birth.tangent, 2)) < 1e-6,
  );
});
test("unsupported combinations fail explicitly rather than disconnecting particles", () => {
  const d = load(),
    l = d.layers.find((l) => l.path?.mode === "follow")!;
  l.emitter!.forces.floor = { y: 0, softness: 0 };
  assert.throws(() => validateDocumentV2(d), /gravity, wind and drag/);
});

test("curved lightning remains deterministic with preserved branch topology", () => {
  const d = validateDocumentV2(
    JSON.parse(
      readFileSync("fixtures/v2/curved-lightning/document.json", "utf8"),
    ),
  );
  const l = d.layers.find((l) => l.path)!;
  const binding = layerPath(d, l)!;
  const a = buildCurvedLightningGeometry(l.geometry!, 123, 4, binding);
  const b = buildCurvedLightningGeometry(l.geometry!, 123, 4, binding);
  const c = buildCurvedLightningGeometry(l.geometry!, 123, 5, binding);
  assert.deepEqual(
    a.getAttribute("position").array,
    b.getAttribute("position").array,
  );
  assert.notDeepEqual(
    a.getAttribute("position").array,
    c.getAttribute("position").array,
  );
  assert.ok(
    a.getAttribute("position").count > l.geometry!.lightning!.points * 4,
  );
  assert.ok(Array.from(a.getAttribute("normal").array).every(Number.isFinite));
  for (const g of [a, b, c]) g.dispose();
});
test("curved lightning pins its impact endpoint to path origin", () => {
  const d = validateDocumentV2(
    JSON.parse(
      readFileSync("fixtures/v2/curved-lightning/document.json", "utf8"),
    ),
  );
  const l = d.layers.find((l) => l.path)!,
    g = structuredClone(l.geometry!);
  g.lightning!.branches = 0;
  g.lightning!.branchDepth = 0;
  const binding = layerPath(d, l)!;
  const mesh = buildCurvedLightningGeometry(g, 123, 0, binding);
  const pos = mesh.getAttribute("position"),
    sides = Math.min(8, Math.max(3, Math.round(g.radialSegments / 3)));
  const center = new THREE.Vector3();
  for (let i = 0; i < sides; i++)
    center.add(
      new THREE.Vector3().fromBufferAttribute(
        pos,
        (g.lightning!.points - 1) * (sides + 1) + i,
      ),
    );
  center.divideScalar(sides);
  assert.ok(center.distanceTo(binding.path.frames[0].position) < 0.01);
  mesh.dispose();
});
test("curved fire bounds include the bent centerline and displacement envelope", () => {
  const d = validateDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/curved-fire/document.json", "utf8")),
  );
  const l = d.layers.find((l) => l.kind === "shell")!,
    binding = layerPath(d, l)!;
  const bounds = curvedShellBounds(l.geometry!, binding),
    box = new THREE.Box3().setFromPoints(bounds);
  for (const frame of binding.path.frames)
    assert.ok(box.containsPoint(frame.position));
  assert.ok(bounds.every((p) => p.toArray().every(Number.isFinite)));
  const smaller = structuredClone(l.geometry!);
  smaller.radius *= 0.5;
  const smallBox = new THREE.Box3().setFromPoints(
    curvedShellBounds(smaller, binding),
  );
  assert.ok(box.containsBox(smallBox));
});

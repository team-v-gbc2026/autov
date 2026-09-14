import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { VfxRuntimeV2 } from "../src/lib/vfx-lab/runtime-v2";

for (const area of [
  { left: 304, top: 130, width: 784, height: 710 },
  { left: 0, top: 130, width: 1088, height: 710 },
  { left: 304, top: 130, width: 1136, height: 710 },
  { left: 0, top: 130, width: 1440, height: 710 },
  { left: 0, top: 0, width: 1440, height: 1000 },
]) test(`focus projects effect bounds inside ${JSON.stringify(area)}`, () => {
  const camera = new THREE.PerspectiveCamera(32, 1.44, 0.1, 100);
  camera.position.set(4, 3, 6);
  const target = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  for (const x of [-2, 2]) for (const y of [-1, 3]) for (const z of [-2, 2])
    points.push(new THREE.Vector3(x, y, z));
  const runtime = {
    doc: { camera: { fov: 32, azimuth: 0, elevation: 0 } },
    camera, width: 1440, height: 1000,
    // Bounds are effect-local; focus() maps them through placement.
    placementMatrix: new THREE.Matrix4(),
    controls: { target, enableDamping: true, maxDistance: 60, update() { camera.lookAt(target); } },
    objects: [{ source: { enabled: true, kind: "mesh", start: 0, end: 3 },
      bounds(_time: number, push: (point: THREE.Vector3) => void) { points.forEach(push); } }],
  };
  VfxRuntimeV2.prototype.focus.call(runtime as unknown as VfxRuntimeV2, area);
  camera.updateMatrixWorld();
  for (const point of points) {
    const ndc = point.clone().project(camera);
    const x = (ndc.x + 1) * 720, y = (1 - ndc.y) * 500;
    assert.ok(x >= area.left && x <= area.left + area.width);
    assert.ok(y >= area.top && y <= area.top + area.height);
    assert.ok(ndc.z >= 0 && ndc.z <= 1);
  }
});

/** Placement moves the effect, so focus must frame where it actually renders —
 * bounds are reported in the effect's own frame and never pass through the
 * group's matrix. */
test("focus follows a placed effect", () => {
  const camera = new THREE.PerspectiveCamera(32, 1.44, 0.1, 100);
  camera.position.set(4, 3, 6);
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3(12, 0, -7);
  const points: THREE.Vector3[] = [];
  for (const x of [-2, 2]) for (const y of [-1, 3]) for (const z of [-2, 2])
    points.push(new THREE.Vector3(x, y, z));
  const runtime = {
    doc: { camera: { fov: 32, azimuth: 0, elevation: 0 } },
    camera, width: 1440, height: 1000,
    placementMatrix: new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z),
    controls: { target, enableDamping: true, maxDistance: 60, update() { camera.lookAt(target); } },
    objects: [{ source: { enabled: true, kind: "mesh", start: 0, end: 3 },
      bounds(_time: number, push: (point: THREE.Vector3) => void) { points.forEach(push); } }],
  };
  VfxRuntimeV2.prototype.focus.call(runtime as unknown as VfxRuntimeV2, { left: 0, top: 0, width: 1440, height: 1000 });
  camera.updateMatrixWorld();
  // Every placed point projects inside the viewport, and orbit re-centres on
  // the placed effect rather than the authored origin.
  for (const point of points) {
    const ndc = point.clone().add(offset).project(camera);
    const x = (ndc.x + 1) * 720, y = (1 - ndc.y) * 500;
    assert.ok(x >= 0 && x <= 1440);
    assert.ok(y >= 0 && y <= 1000);
    assert.ok(ndc.z >= 0 && ndc.z <= 1);
  }
  assert.ok(target.distanceTo(offset) < 2);
});

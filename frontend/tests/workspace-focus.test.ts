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

/**
 * A project opens on an empty placeholder document and receives its own one a
 * moment later. Installing that first real document has to frame it: keeping
 * the pose that framed the placeholder leaves the camera inside the effect,
 * which is what a project created from the "Sustained beam" preset showed.
 */
test("the first loaded document is framed instead of keeping the placeholder pose", () => {
  const internals = VfxRuntimeV2.prototype as unknown as {
    computeFraming(this: VfxRuntimeV2): void;
    resetCamera(this: VfxRuntimeV2): void;
  };
  const width = 1395, height = 716;
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
  const target = new THREE.Vector3();
  // A sustained beam: twelve metres of body along +X with its muzzle at the end.
  const points: THREE.Vector3[] = [];
  for (const x of [0, 12]) for (const y of [0.85, 1.55]) for (const z of [-0.35, 0.35])
    points.push(new THREE.Vector3(x, y, z));
  const runtime = {
    doc: {
      duration: 5,
      camera: { fov: 30, azimuth: 0, elevation: 0.209, framing: 0.95 },
    },
    camera, width, height, interactive: true, previewSample: null,
    // What computeFraming() produces for the empty workspace placeholder.
    frame: { center: new THREE.Vector3(0, 0.75, 0), distance: 6 },
    controls: { target, enableDamping: true, maxDistance: 60, update() { camera.lookAt(target); } },
    objects: [{
      source: { enabled: true, kind: "beam", start: 1, end: 4 },
      bounds(_time: number, push: (point: THREE.Vector3) => void) { points.forEach(push); },
    }],
  } as unknown as VfxRuntimeV2;

  const box = new THREE.Box3().setFromPoints(points);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const visible = () => {
    camera.updateMatrixWorld();
    return points.every(point => {
      const ndc = point.clone().project(camera);
      return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= 0 && ndc.z <= 1;
    });
  };

  // Preserving the placeholder camera: the beam runs straight past the viewport.
  internals.resetCamera.call(runtime);
  assert.equal(visible(), false);
  const placeholder = camera.position.distanceTo(sphere.center);

  // Framing the document the way the exemplars and the Focus button do.
  internals.computeFraming.call(runtime);
  internals.resetCamera.call(runtime);
  assert.equal(visible(), true);
  assert.ok(camera.position.distanceTo(sphere.center) > placeholder);
  assert.equal(box.containsPoint(camera.position), false);
});

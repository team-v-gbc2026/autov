import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { MeshSnapshots } from "../src/lib/avfx/mesh-snapshots";
import { meshGlb } from "../src/lib/avfx/binary";

test("baked snapshots preserve in-place edits, deduplicate copies and support rewind", () => {
  const files = new Map<string, Uint8Array>();
  const snapshots = new MeshSnapshots((path, bytes) => { files.set(path, bytes); });
  const geometry = new THREE.PlaneGeometry();
  const first = snapshots.capture(geometry);
  const originalBytes = files.get(first)!.slice();
  assert.equal(snapshots.capture(geometry.clone()), first);
  const position = geometry.getAttribute("position");
  const old = position.getX(0);
  position.setX(0, old + 1); // No needsUpdate: export reads CPU state, not GPU versions.
  const second = snapshots.capture(geometry);
  assert.notEqual(second, first);
  assert.deepEqual(files.get(first), originalBytes);
  position.setX(0, old);
  assert.equal(snapshots.capture(geometry), first);
  geometry.getAttribute("uv").setX(0, 0.25);
  assert.notEqual(snapshots.capture(geometry), first);
  assert.equal(files.size, 3);
});

test("line topology is preserved and not deduplicated against triangles", () => {
  const files = new Map<string, Uint8Array>();
  const snapshots = new MeshSnapshots((path, bytes) => { files.set(path, bytes); });
  const geometry = new THREE.PlaneGeometry();
  const triangles = snapshots.capture(geometry);
  const lines = snapshots.capture(geometry, 1);
  assert.notEqual(lines, triangles);
  const bytes = files.get(lines)!;
  const length = new DataView(bytes.buffer).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  assert.equal(gltf.meshes[0].primitives[0].mode, 1);
});

test("mesh baking rejects malformed data before writing an archive", () => {
  const attributes = { position: { itemSize: 3, count: 3, values: [0,0,0, 1,0,0, 0,1,0] } };
  assert.throws(() => meshGlb({ attributes, indices: [0,1,3] }), /out of bounds/);
  assert.throws(() => meshGlb({ attributes, indices: [0,1] }), /Incomplete/);
  assert.throws(() => meshGlb({ attributes, indices: null, mode: 1 }), /Incomplete/);
  assert.throws(() => meshGlb({ attributes: { position: { ...attributes.position, values: [Infinity] } }, indices: null }), /Invalid mesh attribute/);
});

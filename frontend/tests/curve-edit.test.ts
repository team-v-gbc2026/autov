import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { CurveEditModel } from "../src/lib/vfx-lab/curve-edit-model";
import { worldToCurvePoint } from "../src/lib/vfx-lab/curve-edit-controller";
import { validateWorkspaceDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
const load = () =>
  validateWorkspaceDocumentV2(
    JSON.parse(readFileSync("fixtures/v2/curved-beam/document.json", "utf8")),
  );
test("many draft moves leave applied document unchanged and create one undo entry", () => {
  const doc = load(),
    before = JSON.stringify(doc),
    model = new CurveEditModel(doc),
    point = { pathId: doc.paths![0].id, index: 1 };
  for (let i = 0; i < 30; i++) model.move(point, [i * 0.01, 0.5, 2]);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(model.canUndo, false);
  const applied = model.apply()!;
  assert.notEqual(JSON.stringify(applied), before);
  model.replaceDocument(applied);
  assert.equal(model.canUndo, true);
  assert.equal(model.undo(), doc);
  assert.equal(model.undo(), null);
});
test("cancel and external replacement discard drafts without overwriting incoming edits", () => {
  const doc = load(),
    model = new CurveEditModel(doc),
    point = { pathId: doc.paths![0].id, index: 1 };
  model.move(point, [0.2, 0.5, 2]);
  model.cancel();
  assert.deepEqual(model.paths, doc.paths);
  model.move(point, [0.3, 0.5, 2]);
  model.apply();
  const incoming = load();
  incoming.name = "Replaced fixture";
  model.replaceDocument(incoming);
  assert.deepEqual(model.paths, incoming.paths);
  assert.equal(model.canUndo, false);
  assert.equal(model.dirty, false);
});
test("invalid drafts remain unapplied and can be cancelled", () => {
  const doc = load(),
    model = new CurveEditModel(doc);
  for (let index = 0; index < 4; index++)
    model.move({ pathId: doc.paths![0].id, index }, [0, 0, 0]);
  assert.throws(() => model.apply(), /no measurable length/);
  assert.equal(model.canUndo, false);
  model.cancel();
  assert.deepEqual(model.paths, doc.paths);
});
test("multiple paths and repeated Apply operations undo independently", () => {
  const doc = load();
  doc.paths!.push({ ...structuredClone(doc.paths![0]), id: "second" });
  const model = new CurveEditModel(doc);
  model.move({ pathId: "second", index: 1 }, [0.3, 0.2, 2]);
  const first = model.apply()!;
  assert.deepEqual(first.paths![0], doc.paths![0]);
  model.move({ pathId: "second", index: 2 }, [1, 0.2, 3]);
  model.apply();
  assert.equal(model.undo(), first);
  assert.equal(model.undo(), doc);
});
test("world drag converts using placement alone under translation and rotation", () => {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(3, 5, -2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.7, -0.2)),
    new THREE.Vector3(1, 1, 1),
  );
  const local = new THREE.Vector3(0.5, 1, 2),
    world = local.clone().applyMatrix4(matrix);
  assert.ok(
    new THREE.Vector3(...worldToCurvePoint(world, matrix)).distanceTo(local) <
      1e-10,
  );
});

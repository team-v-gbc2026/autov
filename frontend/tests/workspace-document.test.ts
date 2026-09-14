import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceDocument, addLayer, applyEnvironment, applyLayerPatch } from "../src/lib/vfx-lab/ui-bridge";
import { validateDocumentV2, validateWorkspaceDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

test("empty workspace retains environment through add, hide, and remove", () => {
  const empty = createWorkspaceDocument("Workspace");
  assert.equal(empty.layers.length, 0);
  assert.equal(empty.environment.ground, "grid");
  const edited = applyEnvironment(empty, { bloom: 30, exposure: 60 });
  assert.notEqual(edited, empty);
  const added = addLayer(edited, 0);
  assert.deepEqual(added.environment, edited.environment);
  assert.deepEqual(added.post, edited.post);
  const hidden = applyLayerPatch(added, added.layers[0].id, { enabled: false });
  assert.equal(hidden.layers[0].enabled, false);
  const removed = validateWorkspaceDocumentV2({ ...hidden, layers: [] });
  assert.deepEqual(removed.post, edited.post);
  assert.throws(() => validateDocumentV2(empty));
  assert.throws(() => validateDocumentV2(hidden));
});

test("processing and renderer snapshots cannot mutate the workspace document", () => {
  const workspace = addLayer(createWorkspaceDocument("Workspace"), 0);
  const snapshot = validateWorkspaceDocumentV2(workspace);
  snapshot.environment.ground = "none";
  snapshot.layers[0].transform.position[0] = 99;
  assert.equal(workspace.environment.ground, "grid");
  assert.equal(workspace.layers[0].transform.position[0], 0);
});

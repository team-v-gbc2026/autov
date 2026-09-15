import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GPU_BUDGET_V2,
  gpuCostV2,
  instanceCountOf,
} from "../src/lib/vfx-lab/gpu-budget-v2";
import { lintDocumentV2, validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
import { repairCandidateV2 } from "../src/lib/vfx-lab/candidate-v2";
import { describeGpuCostV2 } from "../src/lib/vfx-lab/protocol-v2";

const root = path.join(process.cwd(), "fixtures", "v2");
const exemplars = fs
  .readdirSync(root)
  .filter((id) => fs.existsSync(path.join(root, id, "document.json")))
  .sort()
  .map((id) => ({
    id,
    doc: validateDocumentV2(
      JSON.parse(fs.readFileSync(path.join(root, id, "document.json"), "utf8")),
    ),
  }));

test("every exemplar sits inside the GPU budget with headroom", () => {
  for (const { id, doc } of exemplars) {
    const cost = gpuCostV2(doc);
    for (const key of ["draws", "pipelines", "instances"] as const)
      assert.ok(
        cost[key] <= GPU_BUDGET_V2[key],
        `${id}: ${cost[key]} ${key} exceeds ${GPU_BUDGET_V2[key]}`,
      );
    assert.ok(
      lintDocumentV2(doc).every((warning) => !warning.includes("GPU budget")),
      `${id} is reported over budget`,
    );
  }
  // The ceilings are meant to be roughly twice the busiest exemplar. If one
  // ever creeps up to the ceiling the budget stops being headroom.
  for (const key of ["draws", "pipelines", "instances"] as const) {
    const worst = Math.max(...exemplars.map(({ doc }) => gpuCostV2(doc)[key]));
    assert.ok(
      worst * 1.5 <= GPU_BUDGET_V2[key],
      `${key}: busiest exemplar is ${worst} against a ceiling of ${GPU_BUDGET_V2[key]}`,
    );
  }
});

test("the repair brings a costly candidate under budget without losing a layer", () => {
  const source = exemplars.find((entry) => entry.id === "ice-blast")!;
  const doc = structuredClone(source.doc);
  // Ten times the instances an exemplar asks for, which is what an unbounded
  // generated document looks like.
  for (const layer of doc.layers) {
    const count = instanceCountOf(layer);
    if (count) count.set(Math.min(2000, count.get * 10));
  }
  assert.ok(gpuCostV2(doc).instances > GPU_BUDGET_V2.instances);
  const before = doc.layers.map((layer) => layer.id);
  const { document, warnings } = repairCandidateV2(doc, "ice-blast");
  const cost = gpuCostV2(document);
  assert.ok(
    cost.instances <= GPU_BUDGET_V2.instances,
    `still ${cost.instances} instances`,
  );
  assert.ok(cost.draws <= GPU_BUDGET_V2.draws);
  assert.deepEqual(
    document.layers.map((layer) => layer.id),
    before,
    "the repair dropped a layer",
  );
  assert.ok(
    warnings.some((warning) => warning.startsWith("GPU budget:")),
    "the repair did not say what it changed",
  );
  for (const layer of document.layers) {
    const count = instanceCountOf(layer);
    if (count) assert.ok(count.get >= 1, `${layer.id} lost every instance`);
  }
});

test("the repair leaves an exemplar untouched", () => {
  for (const { id, doc } of exemplars.slice(0, 4)) {
    const { warnings } = repairCandidateV2(structuredClone(doc), id as never);
    assert.ok(
      warnings.every((warning) => !warning.startsWith("GPU budget:")),
      `${id} was repaired: ${warnings.join(", ")}`,
    );
  }
});

test("the model is told what the document costs", () => {
  const described = describeGpuCostV2(exemplars[0].doc);
  assert.equal(described.withinBudget, true);
  assert.deepEqual(described.budget, GPU_BUDGET_V2);
  assert.ok(described.draws > 0 && described.pipelines > 0);
});

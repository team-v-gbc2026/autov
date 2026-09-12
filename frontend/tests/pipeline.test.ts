import test from "node:test";
import assert from "node:assert/strict";
import { generatePipeline, type Transport } from "../src/lib/vfx-lab/pipeline";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import type { Review } from "../src/lib/vfx-lab/protocol";
const doc = createPreset("shockwave");
const review = (score: number): Review => ({
  sufficientEvidence: true,
  semantic: score,
  motion: score,
  hierarchy: score,
  finish: score,
  verdict: "Observed",
  observations: [
    { criterion: "visible ring", result: "pass", evidence: ".7 s" },
  ],
  diagnoses: [
    {
      layerId: "shock-0",
      symptom: "washed-out",
      hypothesis: "too bright",
      correction: "lower intensity",
    },
  ],
});
const capture = () => ({
  sheet: "data:image/jpeg;base64,TEST",
  times: [0.5, 0.6, 1, 2.9],
  width: 320,
  height: 180,
  runtime: "test",
  renderer: "test",
  camera: [5, 3, 7],
  layers: [],
  observations: [],
});
test("worse refinement rolls back to immutable best checkpoint", async () => {
  let reviewCount = 0;
  const calls: string[] = [];
  const request: Transport = async (body) => {
    calls.push(body.action as string);
    if (body.action === "plan") return { runId: "test", plan: {} };
    if (body.action === "candidate")
      return { document: { ...doc, name: `candidate-${body.index}` } };
    if (body.action === "review")
      return { review: review(++reviewCount === 4 ? 1 : 3) };
    if (body.action === "refine")
      return { document: { ...doc, name: "worse" } };
    throw Error("unexpected");
  };
  const result = await generatePipeline({
    prompt: "shockwave",
    references: [],
    mode: "quality",
    signal: new AbortController().signal,
    request,
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.equal(result.selected.document.name, "candidate-0");
  assert.equal(result.candidates.length, 4);
  assert.equal(calls.length, 9);
  assert.equal(result.candidates[0].document.name, "candidate-0");
});
test("failed candidate and critic preserve a valid candidate", async () => {
  const request: Transport = async (body) => {
    if (body.action === "plan") return { runId: "test", plan: {} };
    if (body.action === "candidate") {
      if (body.index === 0) throw Error("timeout");
      return { document: doc };
    }
    throw Error("critic unavailable");
  };
  const result = await generatePipeline({
    prompt: "shockwave",
    references: [],
    mode: "quality",
    signal: new AbortController().signal,
    request,
    capture,
    progress: () => {},
    candidate: () => {},
  });
  assert.deepEqual(result.selected.document, doc);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates[0].error);
});
test("all-invalid candidates never install a replacement", async () => {
  let installed = 0;
  await assert.rejects(
    () =>
      generatePipeline({
        prompt: "x",
        references: [],
        mode: "fast",
        signal: new AbortController().signal,
        request: async (body) =>
          body.action === "plan" ? { runId: "x", plan: {} } : { document: {} },
        capture,
        progress: () => {},
        candidate: () => installed++,
      }),
    /No valid candidate/,
  );
  assert.equal(installed, 0);
});
test("abort prevents subsequent paid calls", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(() =>
    generatePipeline({
      prompt: "x",
      references: [],
      mode: "quality",
      signal: controller.signal,
      request: async () => {
        calls++;
        controller.abort();
        return { runId: "x", plan: {} };
      },
      capture,
      progress: () => {},
      candidate: () => {},
    }),
  );
  assert.equal(calls, 1);
});

test("one structural repair can improve shape/timing after scalar refinement stalls", async () => {
  let reviews = 0,
    structural = 0;
  const result = await generatePipeline({
    prompt: "beam",
    references: [],
    mode: "quality",
    signal: new AbortController().signal,
    capture,
    progress: () => {},
    candidate: () => {},
    request: async (body) => {
      if (body.action === "plan") return { runId: "test", plan: {} };
      if (body.action === "candidate")
        return { document: { ...doc, name: `candidate-${body.index}` } };
      if (body.action === "refine")
        return { document: { ...doc, name: "scalar" } };
      if (body.action === "restructure") {
        structural++;
        return { document: { ...doc, name: "structural" } };
      }
      const value = review(++reviews === 5 ? 4 : 2.5);
      value.diagnoses[0].symptom = "timing";
      return { review: value };
    },
  });
  assert.equal(structural, 1);
  assert.equal(result.selected.document.name, "structural");
  assert.equal(result.candidates.length, 5);
  assert.equal(result.candidates[0].document.name, "candidate-0");
});

test("a rendered refinement stays archived even when its reviewer fails", async () => {
  let reviews = 0;
  const result = await generatePipeline({
    prompt: "ring",
    references: [],
    mode: "quality",
    signal: new AbortController().signal,
    capture,
    progress: () => {},
    candidate: () => {},
    request: async (body) => {
      if (body.action === "plan") return { runId: "test", plan: {} };
      if (body.action === "candidate") return { document: doc };
      if (body.action === "refine")
        return { document: { ...doc, name: "unreviewed-refinement" } };
      if (++reviews === 4) throw Error("critic unavailable");
      return { review: review(3) };
    },
  });
  assert.equal(result.candidates.length, 4);
  assert.equal(result.candidates[3].document.name, "unreviewed-refinement");
  assert.equal(result.candidates[3].review, undefined);
  assert.equal(result.selected.document.name, doc.name);
});

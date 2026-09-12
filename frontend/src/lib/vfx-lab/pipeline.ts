import { validateDocument, type VfxDocument } from "./schema";
import { score, type Review, type Plan, type Usage } from "./protocol";
import type { Evidence } from "./runtime";
export type Candidate = {
  id: string;
  document: VfxDocument;
  evidence: Evidence;
  review?: Review;
  origin: "generated" | "refined";
  error?: string;
};
export type PipelineResult = {
  runId: string;
  plan: Plan;
  candidates: Candidate[];
  selected: Candidate;
  trace: string[];
  usages: Usage[];
};
export type Transport = (
  body: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;
function improves(next: Review | undefined, baseline: Review) {
  if (!next?.sufficientEvidence) return false;
  const noRegression =
    baseline.observations.every(
      (old) =>
        old.result !== "pass" ||
        next.observations.some(
          (item) => item.criterion === old.criterion && item.result === "pass",
        ),
    ) &&
    (["semantic", "motion", "hierarchy", "finish"] as const).every(
      (axis) => next[axis] >= Math.min(3, baseline[axis]),
    );
  return (
    score(next) > score(baseline) + 0.15 &&
    noRegression &&
    next.observations.filter((x) => x.result === "fail").length <=
      baseline.observations.filter((x) => x.result === "fail").length
  );
}
export async function generatePipeline(options: {
  prompt: string;
  references: string[];
  mode: "fast" | "quality";
  textures?: boolean;
  signal: AbortSignal;
  request: Transport;
  capture: (
    doc: VfxDocument,
    solo?: string,
    diagnostic?: boolean,
  ) => Evidence | Promise<Evidence>;
  progress: (message: string) => void;
  candidate: (candidate: Candidate) => void | Promise<void>;
}): Promise<PipelineResult> {
  const { signal, request, capture } = options,
    trace: string[] = [],
    usages: Usage[] = [],
    candidates: Candidate[] = [];
  const step = (message: string) => {
    signal.throwIfAborted();
    trace.push(message);
    options.progress(message);
  };
  const call = async (body: Record<string, unknown>) => {
    signal.throwIfAborted();
    const r = await request(body, signal);
    if (r.usage) usages.push(r.usage as Usage);
    if (r.repairedUsage) {
      usages.push(r.repairedUsage as Usage);
      trace.push(
        "A mechanically invalid candidate was repaired and revalidated.",
      );
    }
    return r;
  };
  step("Designing composition, timing and motion…");
  const planned = await call({
    action: "plan",
    prompt: options.prompt,
    references: options.references,
    mode: options.mode,
    textures: options.textures ?? false,
  });
  const runId = planned.runId as string,
    plan = planned.plan as Plan;
  for (const texture of options.textures ? plan.textures || [] : []) {
    try {
      step(`Creating reusable texture: ${texture.id}…`);
      await call({ action: "texture", runId, id: texture.id });
    } catch (error) {
      if (signal.aborted) throw error;
      trace.push(
        `Texture unavailable; procedural materials retained: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  const count = options.mode === "quality" ? 3 : 1;
  for (let i = 0; i < count; i++) {
    try {
      step(`Building candidate ${i + 1} of ${count}…`);
      const result = await call({ action: "candidate", runId, index: i });
      const document = validateDocument(result.document);
      step(`Rendering candidate ${i + 1} at twelve event-timed moments…`);
      const evidence = await capture(document),
        candidate: Candidate = {
          id: `${runId}-${i}`,
          document,
          evidence,
          origin: "generated",
        };
      if (evidence.renderedPixels !== undefined && evidence.renderedPixels < 8)
        throw new Error("Rendered candidate has no visible effect pixels.");
      candidates.push(candidate);
      await options.candidate({ ...candidate });
      if (options.mode === "quality") {
        step(
          `Reviewing candidate ${i + 1}: intent, motion, hierarchy, finish…`,
        );
        try {
          const reviewed = await call({
            action: "review",
            runId,
            document,
            sheet: evidence.sheet,
            times: evidence.times,
          });
          candidate.review = reviewed.review as Review;
        } catch (error) {
          if (signal.aborted) throw error;
          candidate.error =
            error instanceof Error
              ? error.message
              : "Visual review unavailable.";
          trace.push(candidate.error);
        }
        await options.candidate({ ...candidate });
      }
    } catch (error) {
      if (signal.aborted) throw error;
      trace.push(
        `Candidate ${i + 1} rejected: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      options.progress(trace[trace.length - 1]);
    }
  }
  if (!candidates.length)
    throw new Error(
      `No valid candidate. Previous effect preserved. ${trace[trace.length - 1]}`,
    );
  let selected = candidates.reduce((a, b) =>
    score(b.review) > score(a.review) ? b : a,
  );
  if (
    options.mode === "quality" &&
    selected.review?.sufficientEvidence &&
    selected.review.diagnoses.length &&
    score(selected.review) < 4.5
  ) {
    try {
      const baseline = selected;
      step("Diagnosing the best candidate with an isolated render, bloom off…");
      const layerId = baseline.review!.diagnoses.find((d) =>
        baseline.document.layers.some((l) => l.id === d.layerId),
      )?.layerId;
      if (layerId) {
        const diagnostic = await capture(baseline.document, layerId, true);
        step("Applying one bounded refinement…");
        const result = await call({
          action: "refine",
          runId,
          document: baseline.document,
          review: baseline.review,
          diagnostic: diagnostic.sheet,
        });
        const document = validateDocument(result.document),
          evidence = await capture(document);
        if (
          evidence.renderedPixels !== undefined &&
          evidence.renderedPixels < 8
        )
          throw Error("Refinement has no visible effect pixels.");
        const refined: Candidate = {
          id: `${runId}-refined`,
          document,
          evidence,
          origin: "refined",
        };
        candidates.push(refined);
        await options.candidate({ ...refined });
        step("Re-rendering and checking the refinement…");
        const reviewed = await call({
          action: "review",
          runId,
          document,
          sheet: evidence.sheet,
          times: evidence.times,
        });
        refined.review = reviewed.review as Review;
        await options.candidate({ ...refined });
        if (improves(refined.review, baseline.review!)) {
          selected = refined;
          step("Refinement improved the review. Best valid state retained.");
        } else
          step(
            "Refinement did not clearly improve the review. Original best state retained.",
          );
      }
    } catch (error) {
      if (signal.aborted) throw error;
      trace.push(
        `Refinement rejected; best state retained: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  if (
    options.mode === "quality" &&
    selected.review?.sufficientEvidence &&
    (score(selected.review) < 3.5 ||
      selected.review.observations.some((item) => item.result === "fail")) &&
    selected.review.diagnoses.some((d) =>
      ["other", "timing", "misaligned"].includes(d.symptom),
    )
  ) {
    const baseline = selected;
    try {
      step("Repairing the shape or timing of diagnosed layers, once…");
      const result = await call({
        action: "restructure",
        runId,
        document: baseline.document,
        review: baseline.review,
        sheet: baseline.evidence.sheet,
      });
      const document = validateDocument(result.document),
        evidence = await capture(document);
      if (evidence.renderedPixels !== undefined && evidence.renderedPixels < 8)
        throw Error("Structural repair has no visible effect pixels.");
      const repaired: Candidate = {
        id: `${runId}-structural`,
        document,
        evidence,
        origin: "refined",
      };
      candidates.push(repaired);
      await options.candidate({ ...repaired });
      step("Checking the structural repair against the original references…");
      const reviewed = await call({
        action: "review",
        runId,
        document,
        sheet: evidence.sheet,
        times: evidence.times,
      });
      repaired.review = reviewed.review as Review;
      await options.candidate({ ...repaired });
      if (improves(repaired.review, baseline.review!)) {
        selected = repaired;
        step(
          "Structural repair improved the review. Best valid state retained.",
        );
      } else
        step(
          "Structural repair did not clearly improve the review. Previous best retained.",
        );
    } catch (error) {
      if (signal.aborted) throw error;
      trace.push(
        `Structural repair unavailable; best retained: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  step(
    options.mode === "fast"
      ? "Ready. Rendered and validated; visual review was not requested."
      : "Ready. Compare the candidates and choose your preferred direction.",
  );
  return { runId, plan, candidates, selected, trace, usages };
}

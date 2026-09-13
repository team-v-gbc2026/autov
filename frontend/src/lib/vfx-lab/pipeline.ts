import { validateDocument, type VfxDocument } from "./schema";
import {
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "./schema-v2";
import { score, type Review, type Plan, type Usage } from "./protocol";
import {
  acceptanceV2,
  defectCountV2,
  improvesV2,
  REVIEW_V2_DEFECTS,
  scoreV2,
  type ReviewV2,
} from "./protocol-v2";
import type { Evidence } from "./runtime";

/** Which document contract this run generates against. */
export type SchemaVersion = "v1" | "v2";
export type PipelineDocument = VfxDocument | VfxDocumentV2;

export type Candidate<D extends PipelineDocument = VfxDocument> = {
  id: string;
  document: D;
  evidence: Evidence;
  review?: Review;
  /** v2 runs answer the six-axis checklist review instead of v1's four axes. */
  reviewV2?: ReviewV2;
  /** v2 only: the temporal spike measure this candidate was reviewed with. */
  jitterScore?: number;
  origin: "generated" | "refined";
  error?: string;
};
export type PipelineResult<D extends PipelineDocument = VfxDocument> = {
  runId: string;
  plan: Plan;
  candidates: Candidate<D>[];
  selected: Candidate<D>;
  trace: string[];
  usages: Usage[];
  schema: SchemaVersion;
};
export type Transport = (
  body: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;
export type PipelineOptions<D extends PipelineDocument = VfxDocument> = {
  prompt: string;
  references: string[];
  mode: "fast" | "quality";
  textures?: boolean;
  candidateCount?: 1 | 2 | 3;
  signal: AbortSignal;
  request: Transport;
  // Method syntax on purpose: bivariant parameters let a v1-only caller satisfy
  // the union-typed implementation signature without casting.
  capture(
    doc: D,
    solo?: string,
    diagnostic?: boolean,
  ): Evidence | Promise<Evidence>;
  progress(message: string): void;
  candidate(candidate: Candidate<D>): void | Promise<void>;
};
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
/**
 * v2's scalar round has no `diagnoses` list to solo-render. Pick the layer the
 * director notes actually name, then fall back to the layer carrying the frame.
 */
function diagnosticLayerV2(
  doc: { layers: readonly { id: string; role: string; enabled: boolean }[] },
  review: ReviewV2,
): string | undefined {
  const named = doc.layers.find((layer) =>
    review.directorNotes.some((note) =>
      note.toLowerCase().includes(layer.id.toLowerCase()),
    ),
  );
  return (
    named?.id ??
    doc.layers.find((l) => l.role === "primary" && l.enabled)?.id ??
    doc.layers.find((l) => l.enabled)?.id
  );
}
export function generatePipeline(
  options: PipelineOptions<VfxDocument> & { schema?: "v1" },
): Promise<PipelineResult<VfxDocument>>;
export function generatePipeline(
  options: PipelineOptions<VfxDocumentV2> & { schema: "v2" },
): Promise<PipelineResult<VfxDocumentV2>>;
export function generatePipeline(
  options: PipelineOptions<PipelineDocument> & { schema?: SchemaVersion },
): Promise<PipelineResult<PipelineDocument>>;
export async function generatePipeline(
  options: PipelineOptions<PipelineDocument> & { schema?: SchemaVersion },
): Promise<PipelineResult<PipelineDocument>> {
  if (
    options.candidateCount !== undefined &&
    (![1, 2, 3].includes(options.candidateCount) ||
      (options.mode === "fast" && options.candidateCount !== 1))
  )
    throw new Error("Candidate count must be 1..3 for quality, or 1 for fast.");
  const { signal, request, capture } = options,
    trace: string[] = [],
    usages: Usage[] = [],
    candidates: Candidate<PipelineDocument>[] = [];
  // The requested contract. When the caller does not state one, the server may
  // (via AUTOV_SCHEMA) answer the plan with the contract it actually used.
  let schema: SchemaVersion = options.schema ?? "v1";
  const step = (message: string) => {
    signal.throwIfAborted();
    trace.push(message);
    options.progress(message);
  };
  const call = async (body: Record<string, unknown>) => {
    signal.throwIfAborted();
    const r = await request(body, signal);
    if (r.usage) usages.push(r.usage as Usage);
    // Model latency is the scarce resource in a v2 benchmark run; surface it
    // per call so the log shows where a schedule went.
    if (schema === "v2" && typeof r.elapsedSeconds === "number")
      step(`${String(body.action)} call took ${r.elapsedSeconds} s.`);
    if (r.repairedUsage) {
      usages.push(r.repairedUsage as Usage);
      trace.push(
        "A mechanically invalid candidate was repaired and revalidated.",
      );
    }
    return r;
  };
  // Validation is the only place the two contracts diverge inside the pipeline;
  // everything downstream treats a document as opaque, reviewed evidence.
  const accept = (input: unknown): PipelineDocument => {
    if (schema === "v1") return validateDocument(input);
    const doc = validateDocumentV2(input);
    for (const warning of lintDocumentV2(doc))
      trace.push(`Schema v2 lint: ${warning}`);
    return doc;
  };
  // The two contracts answer different review shapes. These three closures are
  // the only places in the pipeline that need to know which one is in play.
  const reviewScore = (candidate?: Candidate<PipelineDocument>) =>
    schema === "v2" ? scoreV2(candidate?.reviewV2) : score(candidate?.review);
  const reviewRequest = (
    document: PipelineDocument,
    evidence: Evidence,
  ): Record<string, unknown> => ({
    action: "review",
    runId,
    document,
    sheet: evidence.sheet,
    times: evidence.times,
    temporal: evidence.temporal,
    ...(schema === "v2" && evidence.strip
      ? { strip: evidence.strip, jitter: evidence.jitterScore }
      : {}),
  });
  const storeReview = (
    candidate: Candidate<PipelineDocument>,
    answer: Record<string, unknown>,
  ) => {
    if (schema === "v2") candidate.reviewV2 = answer.review as ReviewV2;
    else candidate.review = answer.review as Review;
  };
  step("Designing composition, timing and motion…");
  const planned = await call({
    action: "plan",
    prompt: options.prompt,
    references: options.references,
    mode: options.mode,
    textures: options.textures ?? false,
    ...(options.schema ? { schema: options.schema } : {}),
  });
  if (
    options.schema === undefined &&
    (planned.schema === "v1" || planned.schema === "v2")
  )
    schema = planned.schema;
  if (schema === "v2")
    step(
      "Schema v2 (autov.lab/2): v2 vocabulary, texture library and runtime.",
    );
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
  const count = options.mode === "quality" ? (options.candidateCount ?? 3) : 1;
  for (let i = 0; i < count; i++) {
    try {
      step(`Building candidate ${i + 1} of ${count}…`);
      const result = await call({ action: "candidate", runId, index: i });
      const document = accept(result.document);
      step(
        schema === "v2"
          ? `Rendering candidate ${i + 1}: eight event-timed frames and a twelve-frame motion strip…`
          : `Rendering candidate ${i + 1} at sixteen event-timed moments…`,
      );
      const evidence = await capture(document),
        candidate: Candidate<PipelineDocument> = {
          id: `${runId}-${i}`,
          document,
          evidence,
          origin: "generated",
        };
      if (evidence.jitterScore !== undefined)
        candidate.jitterScore = evidence.jitterScore;
      if (evidence.renderedPixels !== undefined && evidence.renderedPixels < 8)
        throw new Error("Rendered candidate has no visible effect pixels.");
      candidates.push(candidate);
      await options.candidate({ ...candidate });
      if (options.mode === "quality") {
        step(
          schema === "v2"
            ? `Reviewing candidate ${i + 1}: six axes and the defect checklist…`
            : `Reviewing candidate ${i + 1}: intent, motion, hierarchy, finish…`,
        );
        try {
          const reviewed = await call(reviewRequest(document, evidence));
          storeReview(candidate, reviewed);
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
    reviewScore(b) > reviewScore(a) ? b : a,
  );
  if (
    options.mode === "quality" &&
    (schema === "v2"
      ? selected.reviewV2?.sufficientEvidence &&
        (selected.reviewV2.directorNotes.length ||
          defectCountV2(selected.reviewV2))
      : selected.review?.sufficientEvidence &&
        selected.review.diagnoses.length) &&
    reviewScore(selected) < 4.5
  ) {
    try {
      const baseline = selected;
      step("Diagnosing the best candidate with an isolated render, bloom off…");
      const layerId =
        schema === "v2"
          ? diagnosticLayerV2(baseline.document, baseline.reviewV2!)
          : baseline.review!.diagnoses.find((d) =>
              baseline.document.layers.some((l) => l.id === d.layerId),
            )?.layerId;
      if (layerId) {
        const diagnostic = await capture(baseline.document, layerId, true);
        step("Applying one bounded refinement…");
        const result = await call({
          action: "refine",
          runId,
          document: baseline.document,
          review: schema === "v2" ? baseline.reviewV2 : baseline.review,
          diagnostic: diagnostic.sheet,
        });
        const document = accept(result.document),
          evidence = await capture(document);
        if (
          evidence.renderedPixels !== undefined &&
          evidence.renderedPixels < 8
        )
          throw Error("Refinement has no visible effect pixels.");
        const refined: Candidate<PipelineDocument> = {
          id: `${runId}-refined`,
          document,
          evidence,
          origin: "refined",
        };
        if (evidence.jitterScore !== undefined)
          refined.jitterScore = evidence.jitterScore;
        candidates.push(refined);
        await options.candidate({ ...refined });
        step("Re-rendering and checking the refinement…");
        const reviewed = await call(reviewRequest(document, evidence));
        storeReview(refined, reviewed);
        await options.candidate({ ...refined });
        if (
          schema === "v2"
            ? improvesV2(refined.reviewV2, baseline.reviewV2!)
            : improves(refined.review, baseline.review!)
        ) {
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
  // A scalar proposal may improve the overall result but regress one criterion.
  // Keep it as a repair starting point without adopting it; the final comparison
  // still uses the immutable accepted candidate and its complete criteria.
  const structuralSource = candidates.reduce(
    (best, candidate) =>
      reviewScore(candidate) > reviewScore(best) ? candidate : best,
    selected,
  );
  // v2 has no symptom vocabulary: the defect checklist is what says whether a
  // repair needs new structure, and a structural defect is one the scalar round
  // cannot reach — a missing ground contact, a shape too small, a flat palette.
  const STRUCTURAL_DEFECTS_V2 = REVIEW_V2_DEFECTS.filter((defect) =>
    ["floating", "smallInFrame", "flatColor", "visibleCards"].includes(defect),
  );
  const needsStructure =
    schema === "v2"
      ? selected.reviewV2?.sufficientEvidence &&
        (scoreV2(selected.reviewV2) < 3.5 ||
          selected.reviewV2.observations.some(
            (item) => item.result === "fail",
          )) &&
        Boolean(
          structuralSource.reviewV2 &&
          (STRUCTURAL_DEFECTS_V2.some(
            (defect) => structuralSource.reviewV2!.defects[defect],
          ) ||
            structuralSource !== selected),
        )
      : selected.review?.sufficientEvidence &&
        (score(selected.review) < 3.5 ||
          selected.review.observations.some(
            (item) => item.result === "fail",
          )) &&
        structuralSource.review?.diagnoses.some(
          (d) =>
            ["other", "timing", "misaligned"].includes(d.symptom) ||
            structuralSource !== selected,
        );
  if (options.mode === "quality" && needsStructure) {
    const baseline = selected;
    try {
      step("Repairing the shape or timing of diagnosed layers, once…");
      const result = await call({
        action: "restructure",
        runId,
        document: structuralSource.document,
        review:
          schema === "v2" ? structuralSource.reviewV2 : structuralSource.review,
        sheet: structuralSource.evidence.sheet,
      });
      const document = accept(result.document),
        evidence = await capture(document);
      if (evidence.renderedPixels !== undefined && evidence.renderedPixels < 8)
        throw Error("Structural repair has no visible effect pixels.");
      const repaired: Candidate<PipelineDocument> = {
        id: `${runId}-structural`,
        document,
        evidence,
        origin: "refined",
      };
      if (evidence.jitterScore !== undefined)
        repaired.jitterScore = evidence.jitterScore;
      candidates.push(repaired);
      await options.candidate({ ...repaired });
      step("Checking the structural repair against the original references…");
      const reviewed = await call(reviewRequest(document, evidence));
      storeReview(repaired, reviewed);
      await options.candidate({ ...repaired });
      if (
        schema === "v2"
          ? improvesV2(repaired.reviewV2, baseline.reviewV2!)
          : improves(repaired.review, baseline.review!)
      ) {
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
  if (schema === "v2" && selected.reviewV2)
    step(
      acceptanceV2(selected.reviewV2) === "proposed"
        ? `Review v2: proposed at ${scoreV2(selected.reviewV2).toFixed(2)} / 5, ${defectCountV2(selected.reviewV2)} defects admitted.`
        : `Review v2: needs rework at ${scoreV2(selected.reviewV2).toFixed(2)} / 5, ${defectCountV2(selected.reviewV2)} defects admitted.`,
    );
  step(
    options.mode === "fast"
      ? "Ready. Rendered and validated; visual review was not requested."
      : "Ready. Compare the candidates and choose your preferred direction.",
  );
  return { runId, plan, candidates, selected, trace, usages, schema };
}

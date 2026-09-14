import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { prepareRefinement } from "../lib/refinement";
import {
  finishGeneration,
  reviewCandidate,
  repairCandidate,
  failGeneration,
} from "../lib/generation";
import {
  generationAccepted,
  selectReviewedCandidate,
} from "../../src/lib/studio-tools/generation-context";
import type { ReviewV2 } from "../../src/lib/vfx-lab/protocol-v2";
import type { Operation } from "../../src/lib/studio-tools/server";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Review and iterate on the displayed effect only after the user clicks Continue in chat. Requires the approved current revision. Keeps the first pass visible while reviewing and runs at most two repairs, then applies the best reviewed result. Never invoke automatically after generation.",
  inputSchema: z
    .object({ expectedRevision: z.number().int().nonnegative() })
    .strict(),
  async execute(input, ctx) {
    "use workflow";
    const prepared = await prepareRefinement(ctx, input.expectedRevision);
    const { identity, operation } = prepared;
    if (operation.status === "completed") return operation.result;
    if (!prepared.context || !prepared.capture)
      throw new Error("Iteration context unavailable.");
    const built = { context: prepared.context, capture: prepared.capture };
    try {
      let pending = built.capture;
      let best: { capture: Operation; review: ReviewV2 } | null = null;
      for (let round = 0; round <= 2; round++) {
        const capture = await waitBrowser(identity, pending.id);
        const review = await reviewCandidate(
          ctx,
          identity,
          operation,
          built.context,
          capture,
          round,
        );
        best = selectReviewedCandidate(best, { capture, review });
        if (best && generationAccepted(best.review)) break;
        if (round === 2) break;
        if (!best) throw new Error("Candidate images could not be judged.");
        pending = await repairCandidate(
          ctx,
          identity,
          operation,
          built.context,
          best.capture,
          best.review,
          round + 1,
        );
      }
      if (!best)
        throw new Error("No visually reviewable candidate was produced.");
      return await finishGeneration(
        identity,
        operation,
        best.capture,
        best.review,
        built.context.textureReferences,
      );
    } catch (error) {
      await failGeneration(
        identity,
        operation,
        error instanceof Error ? error.message : "Generation failed.",
      );
      throw error;
    }
  },
});

import type { WorkflowToolContext } from "eve/tools";
import type { z } from "zod";
import { toolIdentity } from "./studio";
import {
  GenerationSchema,
  OperationError,
} from "../../src/lib/studio-tools/operations";
import {
  createOperation,
  readState,
  transition,
  commit,
  type Identity,
  type Operation,
} from "../../src/lib/studio-tools/server";
import {
  generateCandidate,
  resolveGenerationContext,
  reviewGeneration,
  repairGeneration,
} from "../../src/lib/studio-tools/generation";
import type { GenerationContext } from "../../src/lib/studio-tools/generation-context";
import { generationAccepted } from "../../src/lib/studio-tools/generation-context";
import { registerUsedLibraryTextures } from "../../src/lib/studio-tools/library-board";
import type { ReviewV2 } from "../../src/lib/vfx-lab/protocol-v2";
export async function prepareGeneration(
  ctx: WorkflowToolContext,
  input: z.infer<typeof GenerationSchema>,
) {
  "use step";
  ctx.abortSignal?.throwIfAborted();
  const identity = await toolIdentity(ctx);
  const operation = await createOperation(
    identity,
    ctx.session.id,
    ctx.callId,
    "generate",
    input.expectedRevision,
    input,
    false,
    ctx.session.turn.id,
  );
  return { identity, operation };
}
export async function prepareContext(
  identity: Identity,
  input: z.infer<typeof GenerationSchema>,
) {
  "use step";
  return resolveGenerationContext(identity, input);
}

export async function buildCandidate(
  ctx: WorkflowToolContext,
  identity: Identity,
  operation: Operation,
  input: z.infer<typeof GenerationSchema>,
  context: GenerationContext,
) {
  "use step";
  try {
    const document = await generateCandidate(
      identity,
      operation,
      input,
      ctx.abortSignal || new AbortController().signal,
      context,
    );
    const capture = await createOperation(
      identity,
      operation.session_id,
      `${operation.call_id}:capture`,
      "capture_candidate",
      operation.expected_revision,
      { document },
      true,
      ctx.session.turn.id,
      operation.id,
    );
    return { context, capture };
  } catch (error) {
    const code = error instanceof OperationError ? error.code : "UNAVAILABLE";
    const message =
      error instanceof OperationError
        ? error.message
        : "Generation failed. Previous effect preserved; check generation configuration and budget.";
    await transition(identity, "fail", {
      id: operation.id,
      result: { code, message },
    });
    // The operation is terminal now. Retrying this step can only hide its cause.
    throw Object.assign(new OperationError(code, message), { fatal: true });
  }
}
export async function finishGeneration(
  identity: Identity,
  operation: Operation,
  capture: Operation,
  review: ReviewV2,
  textureReferences: GenerationContext["textureReferences"] = [],
) {
  "use step";
  if (!review.sufficientEvidence)
    throw new OperationError(
      "UNAVAILABLE",
      "No reviewable candidate. Previous effect preserved.",
    );
  if (
    capture.status !== "completed" ||
    Number(capture.result?.renderedPixels) < 8
  ) {
    await transition(identity, "fail", {
      id: operation.id,
      result: {
        code: "UNAVAILABLE",
        message: "Candidate could not be rendered. Previous effect preserved.",
      },
    });
    throw new Error(
      "Candidate could not be rendered. Previous effect preserved.",
    );
  }
  await readState(identity);
  const reused = await registerUsedLibraryTextures(
    identity,
    operation,
    capture.input.document as Parameters<typeof commit>[2],
  );
  textureReferences = [
    ...textureReferences,
    ...reused.filter(
      (asset) =>
        !textureReferences.some(
          (existing) => existing.textureId === asset.textureId,
        ),
    ),
  ];
  const quality = generationAccepted(review) ? "accepted" : "needs-refinement";
  const summary = `Generated, rendered and visually reviewed effect (${quality}). ${review.verdict} Remaining findings: ${review.directorNotes.join("; ")} Preview: @[Preview](reference:${capture.result?.referenceId})${textureReferences.length ? ` Effect textures: ${textureReferences.map((asset) => `${asset.textureId}: ${asset.tag}`).join("; ")}` : ""}`;
  const result = await commit(
    identity,
    operation,
    capture.input.document as Parameters<typeof commit>[2],
    summary,
  );
  return {
    ...result,
    quality,
    review,
    previewReferenceId: capture.result?.referenceId,
    textureReferences,
  };
}

export async function finishFirstPass(
  identity: Identity,
  operation: Operation,
  capture: Operation,
  textureReferences: GenerationContext["textureReferences"] = [],
) {
  "use step";
  if (
    capture.status !== "completed" ||
    Number(capture.result?.renderedPixels) < 8
  )
    throw Object.assign(
      new OperationError(
        "UNAVAILABLE",
        "Candidate could not be rendered. Previous effect preserved.",
      ),
      { fatal: true },
    );
  const result = await commit(
    identity,
    operation,
    capture.input.document as Parameters<typeof commit>[2],
    `First pass applied to the scene. Not yet visually reviewed. Use Continue in chat to approve review and iteration.${textureReferences.length ? ` Effect textures: ${textureReferences.map((asset) => `${asset.textureId}: ${asset.tag}`).join("; ")}` : ""}`,
  );
  return { ...result, quality: "unreviewed", textureReferences };
}

export async function reviewCandidate(
  ctx: WorkflowToolContext,
  identity: Identity,
  operation: Operation,
  context: GenerationContext,
  capture: Operation,
  round: number,
) {
  "use step";
  return reviewGeneration(
    identity,
    operation,
    context,
    capture,
    round,
    ctx.abortSignal || new AbortController().signal,
  );
}

export async function repairCandidate(
  ctx: WorkflowToolContext,
  identity: Identity,
  operation: Operation,
  context: GenerationContext,
  capture: Operation,
  review: ReviewV2,
  round: number,
) {
  "use step";
  const current = await readState(identity);
  if (current.revision !== operation.expected_revision)
    throw new OperationError(
      "CONFLICT",
      "The effect changed during generation.",
    );
  const document = await repairGeneration(
    identity,
    operation,
    context,
    capture,
    review,
    round,
    ctx.abortSignal || new AbortController().signal,
  );
  return createOperation(
    identity,
    operation.session_id,
    `${operation.call_id}:capture-${round}`,
    "capture_candidate",
    operation.expected_revision,
    { document },
    true,
    ctx.session.turn.id,
    operation.id,
  );
}

export async function failGeneration(
  identity: Identity,
  operation: Operation,
  message: string,
) {
  "use step";
  await transition(identity, "fail", {
    id: operation.id,
    result: {
      code: "UNAVAILABLE",
      message: `${message} Previous effect preserved.`,
    },
  });
}

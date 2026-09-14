import type { WorkflowToolContext } from "eve/tools";
import type { z } from "zod";
import { toolIdentity } from "./studio";
import { GenerationSchema, OperationError } from "../../src/lib/studio-tools/operations";
import {
  createOperation,
  readState,
  transition,
  commit,
  type Identity,
  type Operation,
} from "../../src/lib/studio-tools/server";
import { generateCandidate } from "../../src/lib/studio-tools/generation";
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
export async function buildCandidate(
  ctx: WorkflowToolContext,
  identity: Identity,
  operation: Operation,
  input: z.infer<typeof GenerationSchema>,
) {
  "use step";
  try {
    const document = await generateCandidate(
      identity,
      operation,
      input,
      ctx.abortSignal || new AbortController().signal,
    );
    return createOperation(
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
  } catch (error) {
    const code = error instanceof OperationError ? error.code : "UNAVAILABLE";
    const message = error instanceof OperationError ? error.message : "Generation failed. Previous effect preserved; check generation configuration and budget.";
    await transition(identity, "fail", { id: operation.id, result: { code, message } });
    throw new OperationError(code, message);
  }
}
export async function finishGeneration(
  identity: Identity,
  operation: Operation,
  capture: Operation,
) {
  "use step";
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
  return commit(
    identity,
    operation,
    capture.input.document as Parameters<typeof commit>[2],
    "Generated and rendered effect.",
  );
}

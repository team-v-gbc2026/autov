import type { WorkflowToolContext } from "eve/tools";
import { sleep } from "workflow";
import { toolIdentity } from "./studio";
import {
  createOperation,
  transition,
  readState,
  outcome,
  type Identity,
  type Operation,
} from "../../src/lib/studio-tools/server";
import {
  inspectReferences,
  listReferences,
} from "../../src/lib/studio-tools/references";
import { OperationError } from "../../src/lib/studio-tools/operations";
export async function startBrowser(
  ctx: WorkflowToolContext,
  kind: string,
  input: Record<string, unknown>,
  revision?: number,
) {
  "use step";
  ctx.abortSignal?.throwIfAborted();
  const identity = await toolIdentity(ctx);
  const state = await readState(identity);
  if (revision !== undefined && revision !== state.revision)
    throw new OperationError("CONFLICT", "The effect changed. Read it again.");
  if (
    input.layerId &&
    !state.document.layers.some((layer) => layer.id === input.layerId)
  )
    throw new OperationError("NOT_FOUND", "Layer unavailable.");
  if (
    kind === "reference_view" &&
    !(await listReferences(identity)).some(
      (ref) => ref.id === input.referenceId,
    )
  )
    throw new OperationError("NOT_FOUND", "Reference unavailable.");
  if (typeof input.time === "number" && input.time > state.document.duration)
    throw new OperationError("INVALID_INPUT", "Seek exceeds effect duration.");
  const operation = await createOperation(
    identity,
    ctx.session.id,
    ctx.callId,
    kind,
    state.revision,
    input,
    true,
    ctx.session.turn.id,
  );
  return { identity, operation };
}
export async function pollBrowser(
  identity: Identity,
  id: string,
): Promise<Operation> {
  "use step";
  return transition(identity, "poll", { id });
}
export async function browserResult(
  identity: Identity,
  operation: Operation,
  image = false,
) {
  "use step";
  const result = outcome(operation);
  return {
    result,
    ...(image && typeof result.referenceId === "string"
      ? { images: await inspectReferences(identity, [result.referenceId]) }
      : {}),
  };
}
export async function waitBrowser(identity: Identity, id: string) {
  "use workflow";
  let op = await pollBrowser(identity, id);
  while (["pending", "running"].includes(op.status)) {
    await sleep("1s");
    op = await pollBrowser(identity, id);
  }
  return op;
}

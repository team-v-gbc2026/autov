import type { WorkflowToolContext } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "./studio";
import {
  authorCandidate,
  AuthorCandidateSchema,
  type AuthorCandidateInput,
} from "../../src/lib/studio-tools/author-candidate";
import {
  createOperation,
  readState,
  verifyIdentity,
  transition,
  commit,
  type Identity,
  type Operation,
} from "../../src/lib/studio-tools/server";
import {
  editDocument,
  EditSchema,
  GenerationSchema,
  OperationError,
  summarize,
} from "../../src/lib/studio-tools/operations";
import { gpuCostV2, GPU_BUDGET_V2 } from "../../src/lib/vfx-lab/gpu-budget-v2";
import {
  lintDocumentV2,
  validateWorkspaceDocumentV2,
} from "../../src/lib/vfx-lab/schema-v2";
import { registerUsedLibraryTextures } from "../../src/lib/studio-tools/library-board";
import { resolveGenerationContext } from "../../src/lib/studio-tools/generation";
import { generationBrief } from "../../src/lib/studio-tools/generation-context";

export type CandidateHandle = { operationId: string; captureId: string };

async function ownedOperation(
  identity: Identity,
  sessionId: string,
  id: string,
) {
  "use step";
  const client = await verifyIdentity(identity);
  const { data, error } = await client
    .from("studio_operations")
    .select("*")
    .eq("project_id", identity.projectId)
    .eq("session_id", sessionId)
    .eq("id", id)
    .single();
  if (error || !data)
    throw new OperationError(
      "NOT_FOUND",
      "Candidate unavailable in this conversation.",
    );
  return data as Operation;
}

async function ownedCandidate(
  ctx: WorkflowToolContext,
  handle: CandidateHandle,
) {
  "use step";
  const identity = await toolIdentity(ctx);
  const operation = await ownedOperation(
    identity,
    ctx.session.id,
    handle.operationId,
  );
  const capture = await ownedOperation(
    identity,
    ctx.session.id,
    handle.captureId,
  );
  if (
    operation.kind !== "generate" ||
    capture.kind !== "capture_candidate" ||
    capture.input.candidateOperationId !== operation.id ||
    capture.expected_revision !== operation.expected_revision
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Capture does not belong to this candidate.",
    );
  if (
    capture.status !== "completed" ||
    !Number.isFinite(Number(capture.result?.renderedPixels)) ||
    Number(capture.result?.renderedPixels) < 8 ||
    typeof capture.result?.referenceId !== "string"
  )
    throw new OperationError(
      "UNAVAILABLE",
      "Candidate must have a completed, nonblank capture.",
    );
  return { identity, operation, capture };
}

export async function draftCandidate(
  ctx: WorkflowToolContext,
  raw: AuthorCandidateInput,
) {
  "use step";
  const input = AuthorCandidateSchema.parse(raw);
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
  if (!["pending", "running"].includes(operation.status))
    throw new OperationError(
      "CONFLICT",
      "This generation is no longer pending.",
    );
  try {
    const result = await authorCandidate(
      identity,
      operation,
      input,
      ctx.abortSignal ?? new AbortController().signal,
    );
    const capture = await createOperation(
      identity,
      ctx.session.id,
      `${ctx.callId}:capture`,
      "capture_candidate",
      input.expectedRevision,
      { document: result.document, candidateOperationId: operation.id },
      true,
      ctx.session.turn.id,
      operation.id,
    );
    return { identity, operation, capture };
  } catch (error) {
    await transition(identity, "fail", {
      id: operation.id,
      result: {
        code: "UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Candidate authoring failed.",
      },
    });
    throw Object.assign(
      error instanceof Error ? error : new Error("Candidate authoring failed."),
      { fatal: true },
    );
  }
}

export async function candidateReceipt(
  operationId: string,
  capture: Operation,
) {
  "use step";
  if (
    capture.status !== "completed" ||
    !Number.isFinite(Number(capture.result?.renderedPixels)) ||
    Number(capture.result?.renderedPixels) < 8 ||
    typeof capture.result?.referenceId !== "string"
  )
    return {
      operationId,
      captureId: capture.id,
      committed: false,
      captureStatus: capture.status,
      error:
        typeof capture.result?.message === "string"
          ? capture.result.message
          : "Capture completed without nonblank renderer evidence.",
      next: "Previous effect preserved. Do not regenerate. On user request, use recover_vfx_candidate with this captureId to re-capture the saved document, then inspect and commit it.",
    };
  const document = validateWorkspaceDocumentV2(capture.input.document);
  return {
    operationId,
    captureId: capture.id,
    revision: capture.expected_revision,
    committed: false,
    referenceId: capture.result?.referenceId,
    times: capture.result?.times,
    warnings: lintDocumentV2(document),
    gpuCost: gpuCostV2(document),
    document: summarize(
      document,
      document.layers.map((layer) => layer.id),
    ),
    next: "Inspect reference pixels, then edit_vfx_candidate or commit_vfx_candidate.",
  };
}

export async function recoverCandidate(
  ctx: WorkflowToolContext,
  captureId: string,
) {
  "use step";
  const identity = await toolIdentity(ctx);
  const source = await ownedOperation(identity, ctx.session.id, captureId);
  if (
    source.kind !== "capture_candidate" ||
    !["failed", "expired", "completed"].includes(source.status) ||
    typeof source.input.candidateOperationId !== "string"
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Only a finished candidate capture can be recovered.",
    );
  const operation = await ownedOperation(
    identity,
    ctx.session.id,
    source.input.candidateOperationId,
  );
  const state = await readState(identity);
  if (
    operation.kind !== "generate" ||
    !["pending", "running"].includes(operation.status) ||
    state.revision !== operation.expected_revision ||
    source.expected_revision !== operation.expected_revision
  )
    throw new OperationError(
      "CONFLICT",
      "The scene changed or generation was closed. Recovery cannot overwrite it.",
    );
  const document = validateWorkspaceDocumentV2(source.input.document);
  const capture = await createOperation(
    identity,
    ctx.session.id,
    `${ctx.callId}:recovery`,
    "capture_candidate",
    state.revision,
    { document, candidateOperationId: operation.id, recoveredFrom: source.id },
    true,
    ctx.session.turn.id,
    operation.id,
  );
  return { identity, operation, capture };
}

export async function editCandidate(
  ctx: WorkflowToolContext,
  input: CandidateHandle & {
    operations: z.infer<typeof EditSchema>["operations"];
  },
) {
  "use step";
  const { identity, operation, capture } = await ownedCandidate(ctx, input);
  const state = await readState(identity);
  if (
    state.revision !== operation.expected_revision ||
    !["pending", "running"].includes(operation.status)
  )
    throw new OperationError(
      "CONFLICT",
      "The effect changed or candidate is closed.",
    );
  if (operation.input.mode === "add") {
    const base = validateWorkspaceDocumentV2(
      operation.input.addBase ?? state.document,
    );
    const original = new Set(base.layers.map((layer) => layer.id));
    if (
      input.operations.some(
        (edit) =>
          edit.type === "update_effect" ||
          ("layerId" in edit && original.has(edit.layerId)),
      )
    )
      throw new OperationError(
        "INVALID_INPUT",
        "Add-mode candidate edits must preserve original layers and global settings.",
      );
  }
  const document = editDocument(
    validateWorkspaceDocumentV2(capture.input.document),
    {
      expectedRevision: state.revision,
      operations: input.operations,
    },
  );
  const cost = gpuCostV2(document);
  if (
    cost.draws > GPU_BUDGET_V2.draws ||
    cost.pipelines > GPU_BUDGET_V2.pipelines ||
    cost.instances > GPU_BUDGET_V2.instances
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Candidate exceeds the GPU budget.",
    );
  const next = await createOperation(
    identity,
    ctx.session.id,
    `${ctx.callId}:capture`,
    "capture_candidate",
    state.revision,
    { document, candidateOperationId: operation.id },
    true,
    ctx.session.turn.id,
    operation.id,
  );
  return { identity, operation, capture: next };
}

export async function commitCandidate(
  ctx: WorkflowToolContext,
  input: CandidateHandle & { inspectedReferenceId: string; review: string },
) {
  "use step";
  const { identity, operation, capture } = await ownedCandidate(ctx, input);
  if (input.inspectedReferenceId !== capture.result?.referenceId)
    throw new OperationError(
      "INVALID_INPUT",
      "Review must identify the selected candidate's reference.",
    );
  if (operation.status === "completed") return operation.result;
  const client = await verifyIdentity(identity);
  const { data: inspections, error: inspectionError } = await client
    .from("studio_operations")
    .select("id")
    .eq("project_id", identity.projectId)
    .eq("session_id", ctx.session.id)
    .eq("kind", "reference_inspection")
    .contains("input", { referenceIds: [input.inspectedReferenceId] })
    .limit(1);
  if (inspectionError || !inspections?.length)
    throw new OperationError(
      "INVALID_INPUT",
      "Inspect the selected candidate reference pixels before committing.",
    );
  const state = await readState(identity);
  if (
    state.revision !== operation.expected_revision ||
    !["pending", "running"].includes(operation.status)
  )
    throw new OperationError(
      "CONFLICT",
      "The effect changed or candidate is closed.",
    );
  const document = validateWorkspaceDocumentV2(capture.input.document);
  const textures = await registerUsedLibraryTextures(
    identity,
    operation,
    document,
  );
  return commit(
    identity,
    operation,
    document,
    `Eve reviewed candidate: ${input.review} Preview: @[Preview](reference:${input.inspectedReferenceId}). ${textures.map((asset) => asset.tag).join(" ")}`,
  );
}

export async function refineCandidate(
  ctx: WorkflowToolContext,
  feedback: string,
  expectedRevision: number,
) {
  "use step";
  const identity = await toolIdentity(ctx);
  const consent = z
    .string()
    .uuid()
    .safeParse(ctx.session.auth.current?.attributes?.refineOperationId);
  if (!consent.success)
    throw new OperationError(
      "INVALID_INPUT",
      "Choose Continue in chat to approve paid refinement.",
    );
  const source = await ownedOperation(identity, ctx.session.id, consent.data);
  const state = await readState(identity);
  if (
    source.kind !== "generate" ||
    source.status !== "completed" ||
    source.after_revision !== expectedRevision ||
    state.revision !== expectedRevision
  )
    throw new OperationError(
      "CONFLICT",
      "Continue applies only to the displayed generation.",
    );
  const { addBase: previousBase, ...sourceInput } = source.input;
  const original = AuthorCandidateSchema.parse(sourceInput);
  const input = {
    ...original,
    expectedRevision,
    prompt: `${original.prompt}\nRefinement findings: ${feedback}`,
  };
  const addBase =
    input.mode === "add" ? (previousBase ?? source.before_document) : undefined;
  if (input.mode === "add" && !addBase)
    throw new OperationError(
      "UNAVAILABLE",
      "Original scene unavailable for safe refinement.",
    );
  const operation = await createOperation(
    identity,
    ctx.session.id,
    ctx.callId,
    "generate",
    expectedRevision,
    { ...input, ...(addBase ? { addBase } : {}) },
    false,
    ctx.session.turn.id,
  );
  const contextInput = GenerationSchema.parse(
    Object.fromEntries(
      Object.entries(input).filter(
        ([key]) =>
          ![
            "direction",
            "textures",
            "techniqueIds",
            "family",
            "effectTextureOperationIds",
          ].includes(key),
      ),
    ),
  );
  const context = await resolveGenerationContext(identity, contextInput);
  if (addBase) {
    context.base = validateWorkspaceDocumentV2(addBase);
    context.brief = generationBrief(contextInput, context.base);
  }
  context.effectTextures = state.document.textures ?? [];
  context.brief += `\nCurrent candidate for refinement: ${JSON.stringify(
    summarize(
      state.document,
      state.document.layers.map((layer) => layer.id),
    ),
  )}`;
  const result = await authorCandidate(
    identity,
    operation,
    input,
    ctx.abortSignal ?? new AbortController().signal,
    context,
  );
  const capture = await createOperation(
    identity,
    ctx.session.id,
    `${ctx.callId}:capture`,
    "capture_candidate",
    expectedRevision,
    { document: result.document, candidateOperationId: operation.id },
    true,
    ctx.session.turn.id,
    operation.id,
  );
  return { identity, operation, capture };
}

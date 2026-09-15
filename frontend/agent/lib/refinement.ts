import type { WorkflowToolContext } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "./studio";
import {
  createOperation,
  readState,
  verifyIdentity,
  type Operation,
} from "../../src/lib/studio-tools/server";
import {
  GenerationSchema,
  OperationError,
} from "../../src/lib/studio-tools/operations";
import { resolveGenerationContext } from "../../src/lib/studio-tools/generation";
import { generationBrief } from "../../src/lib/studio-tools/generation-context";
import {
  ArtDirectionSchema,
  TextureDirectionSchema,
} from "../../src/lib/studio-tools/art-direction";

export async function prepareRefinement(
  ctx: WorkflowToolContext,
  expectedRevision: number,
) {
  "use step";
  const consent = z
    .string()
    .uuid()
    .safeParse(ctx.session.auth.current?.attributes?.refineOperationId);
  if (!consent.success)
    throw Object.assign(
      new OperationError(
        "INVALID_INPUT",
        "Choose Continue in chat to approve iteration.",
      ),
      { fatal: true },
    );
  const identity = await toolIdentity(ctx);
  const client = await verifyIdentity(identity);
  const { data: source, error } = await client
    .from("studio_operations")
    .select("*")
    .eq("id", consent.data)
    .eq("project_id", identity.projectId)
    .eq("session_id", ctx.session.id)
    .eq("kind", "generate")
    .single();
  if (error || source?.status !== "completed")
    throw new OperationError("NOT_FOUND", "This generation is unavailable.");
  const state = await readState(identity);
  if (
    source.after_revision !== expectedRevision ||
    state.revision !== expectedRevision
  )
    throw Object.assign(
      new OperationError(
        "CONFLICT",
        "The effect changed. Continue is only valid for the displayed generation.",
      ),
      { fatal: true },
    );
  let root = source;
  if (source.input.refinementOf) {
    const { data, error: rootError } = await client
      .from("studio_operations")
      .select("*")
      .eq("id", source.input.refinementOf)
      .eq("project_id", identity.projectId)
      .eq("session_id", ctx.session.id)
      .eq("kind", "generate")
      .single();
    if (rootError || data?.status !== "completed")
      throw new OperationError("NOT_FOUND", "Original generation unavailable.");
    root = data;
  }
  const input = GenerationSchema.parse({ ...root.input, expectedRevision });
  const operation = await createOperation(
    identity,
    ctx.session.id,
    ctx.callId,
    "generate",
    expectedRevision,
    { ...input, refinementOf: root.id },
    false,
    ctx.session.turn.id,
  );
  if (operation.status === "completed")
    return { identity, operation, context: null, capture: null };
  const context = await resolveGenerationContext(identity, input);
  context.brief += `\nOriginal generated asset board links: ${root.result?.summary ?? ""}`;
  if (input.mode === "add") {
    if (!root.before_document)
      throw new OperationError(
        "UNAVAILABLE",
        "Original layers are unavailable for safe iteration.",
      );
    context.base = root.before_document;
    context.brief =
      generationBrief(input, context.base) +
      `\nFirst ${input.referenceIds.length} images are original board references, followed by library images in textureIds order.`;
    context.brief += `\nOriginal generated asset board links: ${root.result?.summary ?? ""}`;
  }
  context.effectTextures = state.document.textures ?? [];
  context.images.push(...context.effectTextures.map((asset) => asset.data));
  context.brief += `\nAdditional images are existing effect masks in this ID order: ${JSON.stringify(context.effectTextures.map((asset) => asset.id))}. Refine the current candidate against the original request.`;
  const { data: stages, error: stagesError } = await client
    .from("studio_provider_calls")
    .select("stage,result")
    .eq("project_id", identity.projectId)
    .eq("operation_id", root.id)
    .in("stage", ["art-direction", "texture-direction"]);
  if (stagesError)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not load original art direction.",
    );
  const art = stages?.find((stage) => stage.stage === "art-direction")?.result;
  const textures = stages?.find(
    (stage) => stage.stage === "texture-direction",
  )?.result;
  if (art && textures)
    context.authoring = {
      art: ArtDirectionSchema.parse(art),
      textures: TextureDirectionSchema.parse(textures),
    };
  const capture = await createOperation(
    identity,
    ctx.session.id,
    `${ctx.callId}:capture`,
    "capture_candidate",
    expectedRevision,
    { document: state.document },
    true,
    ctx.session.turn.id,
    operation.id,
  );
  return { identity, operation, context, capture: capture as Operation };
}

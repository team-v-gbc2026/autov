import { z } from "zod";
import { GenerationSchema, OperationError } from "./operations";
import { ArtDirectionSchema, TextureDirectionSchema } from "./art-direction";
import { modelStage, resolveGenerationContext } from "./generation";
import {
  composeGeneration,
  documentForModel,
  type GenerationContext,
} from "./generation-context";
import { verifyIdentity, type Identity, type Operation } from "./server";
import { TextureAssetSchema } from "../vfx-lab/schema";
import { TECHNICAL_GUIDE_V2 } from "../vfx-lab/protocol-v2";
import {
  DocumentV2WireSchema,
  fromWireV2,
  lintDocumentV2,
} from "../vfx-lab/schema-v2";
import { TECHNIQUE_IDS, TECHNIQUES_V2 } from "../vfx-lab/techniques-v2";
import { createPresetV2, recipeV2For } from "../vfx-lab/recipes-v2";
import { fitGpuBudget } from "../vfx-lab/candidate-v2";
import { gpuCostV2, GPU_BUDGET_V2 } from "../vfx-lab/gpu-budget-v2";

// Eve supplies the artistic decisions; the service performs one bounded JSON
// authoring call. No hidden planner, art director, texture chooser or reviewer.
export const AuthorCandidateSchema = GenerationSchema.extend({
  direction: ArtDirectionSchema,
  textures: TextureDirectionSchema,
  techniqueIds: z.array(z.enum(TECHNIQUE_IDS)).max(6),
  family: z.string().min(1).max(64),
  effectTextureOperationIds: z.array(z.string().uuid()).max(2).default([]),
}).strict();
export type AuthorCandidateInput = z.infer<typeof AuthorCandidateSchema>;
export const CandidateHandleSchema = z
  .object({ operationId: z.string().uuid(), captureId: z.string().uuid() })
  .strict();

export async function authorCandidate(
  identity: Identity,
  operation: Operation,
  raw: AuthorCandidateInput,
  signal: AbortSignal,
  suppliedContext?: GenerationContext,
  stage: typeof modelStage = modelStage,
) {
  const input = AuthorCandidateSchema.parse(raw);
  const generationInput = GenerationSchema.parse(
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
  const context =
    suppliedContext ??
    (await resolveGenerationContext(identity, generationInput));
  const assets = [
    ...(context.effectTextures ??
      (input.mode === "add" ? context.base.textures : []) ??
      []),
  ];
  if (input.effectTextureOperationIds.length) {
    const client = await verifyIdentity(identity);
    for (const id of input.effectTextureOperationIds) {
      const { data: owner, error } = await client
        .from("studio_operations")
        .select("id")
        .eq("id", id)
        .eq("project_id", identity.projectId)
        .eq("session_id", operation.session_id)
        .eq("kind", "effect_texture")
        .single();
      if (error || !owner)
        throw new OperationError(
          "NOT_FOUND",
          "Effect texture unavailable in this conversation.",
        );
      const { data: call, error: callError } = await client
        .from("studio_provider_calls")
        .select("result")
        .eq("operation_id", id)
        .eq("project_id", identity.projectId)
        .eq("stage", "effect-texture-0")
        .single();
      if (callError || !call?.result)
        throw new OperationError(
          "UNAVAILABLE",
          "Texture generation has no known result.",
        );
      const asset = TextureAssetSchema.parse(call.result);
      if (!assets.some((existing) => existing.id === asset.id))
        assets.push(asset);
    }
  }
  if (assets.length > 4)
    throw new OperationError(
      "INVALID_INPUT",
      "At most four embedded effect textures are supported.",
    );
  context.effectTextures = assets;
  context.images.push(...assets.map((asset) => asset.data));
  if (
    input.direction.textureNeeds.some((need) => need.generationPrompt !== null)
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Prepare and inspect effect textures separately before authoring a candidate.",
    );
  const allowed = new Set([
    ...input.textureIds,
    ...(context.effectTextures ?? []).map((asset) => asset.id),
  ]);
  if (
    input.textures.bindings.length !== input.direction.textureNeeds.length ||
    input.textures.bindings.some(
      (binding, index) =>
        binding.role !== input.direction.textureNeeds[index]?.role ||
        (binding.textureId !== null && !allowed.has(binding.textureId)),
    )
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Texture bindings must refer to inspected supplied assets.",
    );
  const family = recipeV2For(input.family, input.prompt);
  const wire = await stage(
    identity,
    operation,
    "candidate",
    DocumentV2WireSchema,
    `${TECHNICAL_GUIDE_V2}\nAuthor the supplied direction into a complete document. Explicit requirements and host constraints take precedence over reference interpretations, techniques and exemplar defaults. Preserve authored camera, scale and timing. Use only supplied texture IDs. Return only additional layers in add mode.`,
    JSON.stringify({
      brief: context.brief,
      direction: input.direction,
      textures: input.textures,
      techniques: input.techniqueIds.map((id) => TECHNIQUES_V2[id]),
      example: documentForModel(createPresetV2(family)),
    }),
    context.images,
    signal,
    32000,
  );
  const candidate = fromWireV2(
    wire,
    context.effectTextures ??
      (input.mode === "add" ? context.base.textures : []) ??
      [],
  );
  const usedTextures = candidate.layers.flatMap((layer) => [
    layer.material?.mask.textureId,
    layer.material?.noise?.textureId,
    layer.emitter?.trail?.textureId,
  ]);
  if (usedTextures.some((id) => id && !allowed.has(id)))
    throw new OperationError(
      "INVALID_INPUT",
      "Candidate used a texture outside the inspected supplied set.",
    );
  const warnings = fitGpuBudget(candidate);
  const document = composeGeneration(context.base, candidate, input.mode);
  const cost = gpuCostV2(document);
  if (
    cost.draws > GPU_BUDGET_V2.draws ||
    cost.instances > GPU_BUDGET_V2.instances ||
    cost.pipelines > GPU_BUDGET_V2.pipelines
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Combined candidate exceeds the GPU budget. Reduce added complexity; existing layers were preserved.",
    );
  return {
    document,
    warnings: [...warnings, ...lintDocumentV2(document)],
    cost,
  };
}

// Compatibility harness for offline regression scripts. Eve tools use author-candidate.ts.
import { z } from "zod";
import { PlanSchema } from "../vfx-lab/protocol";
import { TECHNICAL_GUIDE_V2 } from "../vfx-lab/protocol-v2";
import { recipeV2For, RECIPES_V2, createPresetV2 } from "../vfx-lab/recipes-v2";
import {
  DocumentV2WireSchema,
  fromWireV2,
  type VfxDocumentV2,
} from "../vfx-lab/schema-v2";
import { GenerationSchema, OperationError } from "./operations";
import { type Identity, type Operation } from "./server";
import { inspectReferences, registerEffectTexture } from "./references";
import { generateEffectTexture } from "./effect-textures";
import { registerUsedLibraryTextures } from "./library-board";
import { inspectLibraryTextures } from "../vfx-lab/inspect-library-textures";
import { ArtDirectionSchema, TextureDirectionSchema } from "./art-direction";
import { TEXTURE_MANIFEST_PROMPT } from "../vfx-lab/protocol-v2";
import {
  documentForModel,
  composeGeneration,
  type GenerationContext,
} from "./generation-context";

import { modelStage, resolveGenerationContext } from "./generation";
export { modelStage, resolveGenerationContext } from "./generation";

export async function generateCandidate(
  identity: Identity,
  operation: Operation,
  rawInput: z.input<typeof GenerationSchema>,
  signal: AbortSignal,
  suppliedContext?: GenerationContext,
  stage: typeof modelStage = modelStage,
  inspectTextures: typeof inspectLibraryTextures = inspectLibraryTextures,
  textureDependencies = { generateEffectTexture, registerEffectTexture },
): Promise<VfxDocumentV2> {
  const input = GenerationSchema.parse(rawInput);
  const context =
    suppliedContext ?? (await resolveGenerationContext(identity, input));
  const { images, brief: prompt } = context;
  const art = ArtDirectionSchema.parse(
    await stage(
      identity,
      operation,
      "art-direction",
      ArtDirectionSchema,
      "Extract effect art direction before choosing any recipe. Establish silhouette, layering, palette, timing, and motion direction from the request and supplied reference pixels. Separate observations from inferred choices in uncertainties; a still image does not prove timing or motion. Respect explicit requirements over references. Specify up to four texture needs. For each choose a catalog candidate, a generationPrompt, or neither for procedural construction. Generate only textures needed by the effect: isolated tintable grayscale alpha masks with transparent edges, one static image, never scenes, moodboards, color textures, seamless noise, or flipbook sheets. Request at most maxNewTextures new assets when library assets cannot match the required silhouette/detail; otherwise reuse. Do not invent asset IDs or select a recipe. Catalog candidates have not yet been visually inspected.",
      JSON.stringify({
        brief: prompt,
        catalog: TEXTURE_MANIFEST_PROMPT,
        maxNewTextures: Math.min(
          2,
          4 - (input.mode === "add" ? (context.base.textures?.length ?? 0) : 0),
        ),
      }),
      images,
      signal,
      6000,
    ),
  );
  const requests = art.textureNeeds.filter(
    (need) => need.generationPrompt !== null,
  );
  if (
    requests.length >
      Math.min(
        2,
        4 - (input.mode === "add" ? (context.base.textures?.length ?? 0) : 0),
      ) ||
    requests.some(
      (need) =>
        need.candidateTextureId !== null ||
        need.channel !== "alpha" ||
        need.animation === "flipbook",
    )
  )
    throw new OperationError(
      "INVALID_INPUT",
      "Generated effect textures must be bounded static alpha masks with no library selection.",
    );
  const effectTextures = [];
  const textureReferences = [];
  for (const [index, need] of requests.entries()) {
    const asset = await textureDependencies.generateEffectTexture(
      identity,
      operation,
      index,
      need.generationPrompt!,
      images.slice(0, input.referenceIds.length),
      signal,
    );
    const reference = await textureDependencies.registerEffectTexture(
      identity,
      operation,
      asset,
      need.role,
    );
    effectTextures.push(asset);
    textureReferences.push(reference);
  }
  context.effectTextures = [
    ...(input.mode === "add" ? (context.base.textures ?? []) : []),
    ...effectTextures,
  ];
  context.textureReferences = textureReferences;
  const selectedIds = [
    ...new Set(
      art.textureNeeds.flatMap((need) =>
        need.candidateTextureId ? [need.candidateTextureId] : [],
      ),
    ),
  ];
  const newIds = selectedIds.filter((id) => !input.textureIds.includes(id));
  const inspected = newIds.length
    ? await inspectTextures({ textureIds: newIds })
    : [];
  const textureImages = inspected.map(
    (item) => `data:image/png;base64,${item.image}`,
  );
  textureImages.push(...effectTextures.map((asset) => asset.data));
  const availableIds = [
    ...selectedIds,
    ...effectTextures.map((asset) => asset.id),
  ];
  const textures = TextureDirectionSchema.parse(
    await stage(
      identity,
      operation,
      "texture-direction",
      TextureDirectionSchema.extend({
        bindings: TextureDirectionSchema.shape.bindings.length(
          art.textureNeeds.length,
        ),
      }),
      `${TECHNICAL_GUIDE_V2}\nRefine the texture brief against actual pixels: appended images are shortlisted library atlases followed by generated effect masks, in metadata order. Return exactly one binding per need, copying its role. Select only supplied texture IDs or null for procedural construction. Generated masks are single-frame luminance-times-alpha assets, not flipbooks or color maps. Describe UV treatment, erosion and tint needed. Inspect generated assets critically; reject unsuitable masks with null and record the unmet need. Reference IDs identify board images; use texture IDs in document materials.`,
      JSON.stringify({
        brief: prompt,
        art,
        inspected: TEXTURE_MANIFEST_PROMPT.filter((item) =>
          selectedIds.includes(item.id),
        ),
        generated: textureReferences,
      }),
      [...images, ...textureImages],
      signal,
      6000,
    ),
  );
  if (
    textures.bindings.length !== art.textureNeeds.length ||
    textures.bindings.some(
      (binding, index) =>
        binding.role !== art.textureNeeds[index].role ||
        (binding.textureId !== null &&
          !availableIds.includes(binding.textureId)),
    )
  ) {
    throw new OperationError(
      "INVALID_INPUT",
      "Texture direction did not bind the inspected art-direction needs.",
    );
  }
  context.authoring = { art, textures };
  const authoredPrompt = JSON.stringify({
    brief: prompt,
    authoring: context.authoring,
    textureReferences,
  });
  // Returned through the durable build step for review and repair as well.
  context.images = [...images, ...textureImages];
  context.brief = `${prompt}\nAppended texture images: library IDs ${JSON.stringify(newIds)}, then generated board assets ${JSON.stringify(textureReferences)}.`;
  const plan = await stage(
    identity,
    operation,
    "plan",
    PlanSchema,
    `${TECHNICAL_GUIDE_V2}\nChoose a recipe only now, guided by the extracted art direction and refined texture bindings. Preserve their silhouette, layer roles, palette, timing, motion direction and texture treatments. A recipe is construction guidance, not a replacement for the brief. Use library or supplied generated texture IDs. Texture creation is already complete; plan.textures must be [].`,
    authoredPrompt,
    context.images,
    signal,
    12000,
  );
  const family = recipeV2For(plan.recipe);
  const wire = await stage(
    identity,
    operation,
    "candidate",
    DocumentV2WireSchema,
    `${TECHNICAL_GUIDE_V2}\nParameterize the plan into a complete v2 document. Use the example to understand valid construction and units; choose scale, timing, palette and layers for the user request. The recipe does not limit the effect family.`,
    JSON.stringify({
      prompt,
      authoring: context.authoring,
      textureReferences,
      plan: { ...plan, textures: [] },
      recipe: RECIPES_V2[family].knowledge,
      example: createPresetV2(family),
    }),
    context.images,
    signal,
    32000,
  );
  const generated = fromWireV2(wire, context.effectTextures);
  const libraryReferences = await registerUsedLibraryTextures(
    identity,
    operation,
    generated,
    {
      inspectLibraryTextures: inspectTextures,
      registerEffectTexture: textureDependencies.registerEffectTexture,
    },
  );
  context.textureReferences.push(...libraryReferences);
  context.brief += `\nUsed library texture board references: ${JSON.stringify(libraryReferences)}.`;
  return composeGeneration(context.base, generated, input.mode);
}

import {
  ReviewV2Schema,
  REVIEW_V2_SYSTEM,
  TECHNICAL_GUIDE_V2 as REPAIR_GUIDE,
  validateReviewV2Criteria,
  type ReviewV2,
} from "../vfx-lab/protocol-v2";

export async function reviewGeneration(
  identity: Identity,
  operation: Operation,
  context: GenerationContext,
  capture: Operation,
  round: number,
  signal: AbortSignal,
  dependencies = { inspectReferences, modelStage },
): Promise<ReviewV2> {
  if (
    capture.status !== "completed" ||
    !Number.isFinite(Number(capture.result?.renderedPixels)) ||
    Number(capture.result?.renderedPixels) < 8 ||
    typeof capture.result?.referenceId !== "string"
  ) {
    throw new OperationError(
      "UNAVAILABLE",
      "Candidate capture unavailable. Previous effect preserved.",
    );
  }
  const parts = await dependencies.inspectReferences(identity, [
    capture.result.referenceId,
  ]);
  const sheets = parts.flatMap((p) =>
    p.type === "file" && typeof p.data === "string" ? [p.data] : [],
  );
  if (sheets.length !== 1)
    throw new OperationError(
      "UNAVAILABLE",
      "Candidate image could not be inspected.",
    );
  const system = REVIEW_V2_SYSTEM.replace(
    /The last two images[\s\S]*?Judge only/,
    "The final image is the OUTPUT: a timestamped contact sheet of the candidate. Earlier images are input board references and library atlases, as labeled in the brief. No consecutive motion strip or temporal measurements are supplied; judge only motion visible across the supplied times and do not infer frame-rate smoothness. Judge only",
  );
  const review = await dependencies.modelStage(
    identity,
    operation,
    `review-${round}`,
    ReviewV2Schema.extend({
      observations: ReviewV2Schema.shape.observations.length(
        context.criteria.length,
      ),
    }),
    system,
    JSON.stringify({
      brief: context.brief,
      authoring: context.authoring,
      criteria: context.criteria,
      times: capture.result.times,
      document: documentForModel(capture.input.document as VfxDocumentV2),
    }),
    [...context.images, ...sheets],
    signal,
    5000,
  );
  return validateReviewV2Criteria(review, context.criteria);
}

export async function repairGeneration(
  identity: Identity,
  operation: Operation,
  context: GenerationContext,
  capture: Operation,
  review: ReviewV2,
  round: number,
  signal: AbortSignal,
  dependencies = { inspectReferences, modelStage },
) {
  const parts = await dependencies.inspectReferences(identity, [
    String(capture.result?.referenceId),
  ]);
  const sheets = parts.flatMap((p) =>
    p.type === "file" && typeof p.data === "string" ? [p.data] : [],
  );
  const wire = await dependencies.modelStage(
    identity,
    operation,
    `repair-${round}`,
    DocumentV2WireSchema,
    `${REPAIR_GUIDE}\nRepair the candidate against the original brief and visual findings. The final image is candidate output; earlier images follow the brief's image order. Preserve successful aspects. In add mode return ONLY the additional layers, never copies or edits of original existing layers.`,
    JSON.stringify({
      brief: context.brief,
      authoring: context.authoring,
      document: documentForModel(capture.input.document as VfxDocumentV2),
      review,
    }),
    [...context.images, ...sheets],
    signal,
    32000,
  );
  const generated = fromWireV2(wire, context.effectTextures ?? []);
  if (
    context.input.mode === "add" &&
    generated.layers.some((layer) =>
      context.base.layers.some((old) => old.id === layer.id),
    )
  ) {
    throw new OperationError(
      "INVALID_INPUT",
      "Repair attempted to replace existing layers. Previous effect preserved.",
    );
  }
  return composeGeneration(context.base, generated, context.input.mode);
}

import { applyExemplarCameraV2 } from "./refine";
import { TECHNICAL_GUIDE_V2 } from "./protocol-v2";
import {
  createPresetV2,
  exampleScaleSummary,
  RECIPES_V2,
  type RecipeV2Id,
} from "./recipes-v2";
import { techniqueBrief } from "./techniques-v2";
import { lintDocumentV2, type VfxDocumentV2 } from "./schema-v2";

/**
 * The candidate stage is shared by the dev pipeline (`/api/local-vfx`) and the
 * product path (`studio-tools/generation`). Both send the same instruction and
 * the same payload keys, so an improvement to one cannot silently miss the
 * other; only the per-candidate variation sentence differs, and only the dev
 * path has three candidates to vary.
 */
export const CANDIDATE_V2_SYSTEM = `${TECHNICAL_GUIDE_V2}\nParameterize the plan into a complete autov.lab/2 document. The example is the scale reference: match its particle counts, sizes, light intensity and silhouette extent, and change the shapes, colors and timing to fit the plan.`;

/**
 * What the model is given to parameterize a plan: the routed family, that
 * family's construction knowledge, the technique cards the family and the
 * prompt select, and the exemplar document as the scale reference.
 *
 * `intent` is the user's own words when the prompt sent to the model carries
 * extra context (the "add" mode appends the existing document), so keyword
 * routing never reads a serialized document as if it were the request.
 */
export function candidatePayloadV2(input: {
  prompt: string;
  intent?: string;
  plan: unknown;
  family: RecipeV2Id;
  /** Add the measured exemplar scale beside the exemplar document itself. */
  scale?: boolean;
}) {
  return {
    prompt: input.prompt,
    plan: input.plan,
    family: input.family,
    recipe: RECIPES_V2[input.family].knowledge,
    technique: techniqueBrief(input.family, input.intent ?? input.prompt),
    ...(input.scale ? { scale: exampleScaleSummary(input.family) } : {}),
    example: createPresetV2(input.family),
  };
}

/**
 * The repairs a candidate gets without asking the model again. The one lint
 * warning no prompt reliably fixes is a mesh-hero document framed in the
 * particle band: it is a two-number correction against a measured reference,
 * so it is applied here rather than paid for a second time.
 */
export function repairCandidateV2(
  doc: VfxDocumentV2,
  family: RecipeV2Id,
): { document: VfxDocumentV2; warnings: string[] } {
  const document = applyExemplarCameraV2(doc, createPresetV2(family));
  return { document, warnings: lintDocumentV2(document) };
}

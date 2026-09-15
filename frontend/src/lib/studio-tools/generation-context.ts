import type { z } from "zod";
import type { AuthoringDirection } from "./art-direction";
import { GenerationSchema, appendGenerated } from "./operations";
import { validateDocumentV2, type VfxDocumentV2 } from "../vfx-lab/schema-v2";
import {
  acceptanceV2,
  improvesV2,
  type ReviewV2,
} from "../vfx-lab/protocol-v2";

export type GenerationContext = {
  input: z.infer<typeof GenerationSchema>;
  base: VfxDocumentV2;
  brief: string;
  images: string[];
  criteria: string[];
  authoring?: AuthoringDirection;
  effectTextures?: NonNullable<VfxDocumentV2["textures"]>;
  textureReferences?: {
    referenceId: string;
    textureId: string;
    role: string;
    sha256: string;
    tag: string;
  }[];
};

/** Pixels travel as image inputs, not megabytes of base64 inside model text. */
export function documentForModel(document: VfxDocumentV2) {
  return {
    ...document,
    textures: document.textures?.map(
      ({ data: _data, ...metadata }) => metadata,
    ),
  };
}

/** Host constraints come from the revisioned document, never from model claims. */
export function generationBrief(
  input: z.infer<typeof GenerationSchema>,
  base: VfxDocumentV2,
) {
  return JSON.stringify({
    request: input.prompt,
    requirements: input.requirements,
    avoid: input.avoid,
    mode: input.mode,
    referenceIds: input.referenceIds,
    textureIds: input.textureIds,
    preservedEnvironment: base.environment,
    ...(input.mode === "add"
      ? {
          existingDocument: documentForModel(base),
          instruction:
            "Generate ONLY additional layers. Existing layers and all global settings are preserved; match the existing duration, camera and post settings.",
        }
      : {
          instruction:
            "Replace effect layers. The existing environment is preserved; design the effect for it. Camera/post may be authored for the new effect.",
        }),
  });
}

/** Reapply constraints after every generation/repair; never trust a model to preserve them. */
export function composeGeneration(
  base: VfxDocumentV2,
  generated: VfxDocumentV2,
  mode: "add" | "replace",
) {
  return mode === "add"
    ? appendGenerated(base, generated)
    : validateDocumentV2({
        ...generated,
        environment: structuredClone(base.environment),
      });
}

export function generationAccepted(review: ReviewV2) {
  return (
    acceptanceV2(review) === "proposed" &&
    review.observations.every((o) => o.result === "pass")
  );
}

export function selectReviewedCandidate<T extends { review: ReviewV2 }>(
  best: T | null,
  next: T,
): T | null {
  if (!next.review.sufficientEvidence) return best;
  if (!best) return next;
  return improvesV2(next.review, best.review) ? next : best;
}

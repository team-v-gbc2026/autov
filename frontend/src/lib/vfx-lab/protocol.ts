import { z } from "zod";
import { KINDS, NUMERIC, LayerWireSchema } from "./schema";
export const TextureRequestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    prompt: z.string().min(10).max(1500),
    layerIds: z.array(z.string().max(48)).min(1).max(8),
    libraryAssetId: z
      .enum(["sigil", "smoke-lobe", "smoke-curl", "fire-plume"])
      .nullable(),
  })
  .strict();
export const PlanSchema = z
  .object({
    name: z.string().max(100),
    recipe: z.enum([
      "slash",
      "magic",
      "shockwave",
      "lightning",
      "projectile",
      "water",
      "smoke",
      "beam",
      "portal",
    ]),
    intent: z.string().max(1400),
    palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3),
    duration: z.number().min(0.5).max(12),
    textures: z.array(TextureRequestSchema).max(2),
    impact: z.number().min(0).max(12),
    motion: z
      .object({
        emissionShape: z.string().max(300),
        trajectory: z.string().max(300),
        timing: z.string().max(500),
      })
      .strict(),
    layers: z
      .array(
        z
          .object({
            id: z.string().max(48),
            kind: z.enum(KINDS),
            responsibility: z.string().max(300),
          })
          .strict(),
      )
      .min(1)
      .max(18),
    criteria: z.array(z.string().max(200)).min(3).max(6),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;
export const ReviewSchema = z
  .object({
    sufficientEvidence: z.boolean(),
    semantic: z.number().min(0).max(5),
    motion: z.number().min(0).max(5),
    hierarchy: z.number().min(0).max(5),
    finish: z.number().min(0).max(5),
    verdict: z.string().max(1000),
    observations: z
      .array(
        z
          .object({
            criterion: z.string().max(200),
            result: z.enum(["pass", "fail", "uncertain"]),
            evidence: z.string().max(400),
          })
          .strict(),
      )
      .max(6),
    diagnoses: z
      .array(
        z
          .object({
            layerId: z.string().max(48),
            symptom: z.enum([
              "invisible",
              "washed-out",
              "misaligned",
              "timing",
              "other",
            ]),
            hypothesis: z.string().max(400),
            correction: z.string().max(400),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type Review = z.infer<typeof ReviewSchema>;
export function validateReviewCriteria(
  input: unknown,
  criteria: string[],
): Review {
  const review = ReviewSchema.parse(input);
  if (
    review.observations.length !== criteria.length ||
    review.observations.some((item, i) => item.criterion !== criteria[i])
  )
    throw Error(
      "Visual review did not evaluate the complete original criteria in order.",
    );
  return review;
}

export const RefinementSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            layerId: z.string().max(48),
            target: z.enum([...NUMERIC, "color"]),
            value: z.union([z.number(), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
            reason: z.string().max(300),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export const EditSchema = z
  .object({
    target: z.enum([
      "color",
      "intensity",
      "opacity",
      "radius",
      "width",
      "length",
      "erosion",
    ]),
    value: z.union([z.number(), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
    explanation: z.string().max(500),
  })
  .strict();
export const StructuralRefinementSchema = z
  .object({
    layers: z.array(LayerWireSchema).min(1).max(3),
    post: z
      .object({
        bloom: z.number().min(0).max(2),
        exposure: z.number().min(0.3).max(2),
      })
      .strict()
      .nullable(),
    explanation: z.string().max(700),
  })
  .strict();
export const score = (r?: Review) =>
  r?.sufficientEvidence
    ? r.semantic * 0.35 + r.motion * 0.25 + r.hierarchy * 0.25 + r.finish * 0.15
    : -1;
export type Usage = {
  input: number;
  output: number;
  usd: number;
  model: string;
  responseId: string;
};

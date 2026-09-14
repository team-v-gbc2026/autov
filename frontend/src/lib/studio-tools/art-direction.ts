import { z } from "zod";
import { TEXTURE_MANIFEST_V2 } from "../vfx-lab/texture-manifest-v2";

const description = z.string().min(1).max(600);
const textureId = z.enum(
  TEXTURE_MANIFEST_V2.map((texture) => texture.id) as [string, ...string[]],
);

/** Effect intent is established before exposing any recipe exemplar. */
export const ArtDirectionSchema = z
  .object({
    silhouette: description,
    layering: z
      .array(z.object({ role: description, appearance: description }).strict())
      .min(1)
      .max(8),
    palette: description,
    timing: description,
    motionDirection: description,
    uncertainties: z.array(description).max(6),
    textureNeeds: z
      .array(
        z
          .object({
            role: description,
            appearance: description,
            channel: z.enum(["alpha", "color", "noise"]),
            animation: z.enum(["static", "flipbook", "uv-motion"]),
            candidateTextureId: textureId.nullable(),
            generationPrompt: z.string().min(10).max(1500).nullable(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export const TextureDirectionSchema = z
  .object({
    bindings: z
      .array(
        z
          .object({
            role: description,
            textureId: z.string().max(48).nullable(),
            treatment: description,
            rationale: description,
            unmetNeed: z.string().max(600).nullable(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export type AuthoringDirection = {
  art: z.infer<typeof ArtDirectionSchema>;
  textures: z.infer<typeof TextureDirectionSchema>;
};

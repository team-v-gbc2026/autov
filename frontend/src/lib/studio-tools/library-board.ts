import { createHash } from "node:crypto";
import { inspectLibraryTextures } from "../vfx-lab/inspect-library-textures";
import { TEXTURE_MANIFEST_V2 } from "../vfx-lab/texture-manifest-v2";
import type { VfxDocumentV2 } from "../vfx-lab/schema-v2";
import { registerEffectTexture } from "./references";
import type { Identity, Operation } from "./server";

/** Publish only assets actually bound to drawable layers, once per operation. */
export async function registerUsedLibraryTextures(
  identity: Identity,
  operation: Operation,
  document: VfxDocumentV2,
  dependencies = { inspectLibraryTextures, registerEffectTexture },
) {
  const library = new Set(TEXTURE_MANIFEST_V2.map((asset) => asset.id));
  const embedded = new Set(document.textures?.map((asset) => asset.id));
  const ids = [
    ...new Set(
      document.layers.flatMap((layer) => [
        layer.material?.mask.textureId,
        layer.material?.noise?.textureId,
        layer.emitter?.trail?.textureId,
      ]),
    ),
  ].filter((id): id is string => !!id && library.has(id) && !embedded.has(id));
  const references = [];
  for (let offset = 0; offset < ids.length; offset += 4) {
    const images = await dependencies.inspectLibraryTextures({
      textureIds: ids.slice(offset, offset + 4),
    });
    for (const { texture, image } of images) {
      const bytes = Buffer.from(image, "base64");
      references.push(
        await dependencies.registerEffectTexture(
          identity,
          operation,
          {
            id: texture.id,
            data: `data:image/png;base64,${image}`,
            prompt: `Library texture preview: ${texture.id}. ${texture.suggestedUse}`,
            model: "reusable-v2-library",
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          `Library · ${texture.id}`,
        ),
      );
    }
  }
  return references;
}

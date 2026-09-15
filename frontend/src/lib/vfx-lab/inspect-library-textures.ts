import sharp from "sharp";
import { z } from "zod";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";
import { TEXTURE_MANIFEST_PROMPT } from "./protocol-v2";
import { textureUrl } from "./asset-urls";

export const InspectLibraryTexturesSchema = z
  .object({
    textureIds: z.array(z.string().max(48)).min(1).max(4),
  })
  .strict();

/** Public library only. Never accepts user-provided URLs or sends credentials. */
export async function inspectLibraryTextures(
  input: unknown,
  fetcher: typeof fetch = fetch,
) {
  const { textureIds } = InspectLibraryTexturesSchema.parse(input);
  const entries = [...new Set(textureIds)].map((id) => {
    const entry = TEXTURE_MANIFEST_V2.find((item) => item.id === id);
    if (!entry) throw new Error(`Unknown library texture: ${id}`);
    return entry;
  });
  return Promise.all(
    entries.map(async (entry) => {
      const response = await fetcher(textureUrl(entry.file), {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Could not load library texture: ${entry.id}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8 * 1024 * 1024)
            throw new Error(`Library texture too large: ${entry.id}`);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const png = await sharp(Buffer.concat(chunks), {
        limitInputPixels: 16_777_216,
      })
        .resize({
          width: 768,
          height: 768,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      return {
        texture: TEXTURE_MANIFEST_PROMPT.find((item) => item.id === entry.id)!,
        image: png.toString("base64"),
      };
    }),
  );
}

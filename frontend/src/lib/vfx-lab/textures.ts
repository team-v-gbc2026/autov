import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getKey } from "./server";
import { DATA_DIR, reserveUsd, settleUsd } from "./budget";
import { TextureAssetSchema, type TextureAsset } from "./schema";
import { TextureRequestSchema, type Usage } from "./protocol";
import { libraryTexture } from "./texture-library";

export const IMAGE_MODEL = "gpt-image-2.5-sunburst";
// A conservative reservation, not a provider-enforced price cap. Unknown usage stays reserved.
export const IMAGE_RESERVATION_USD = 2;
export function texturePrompt(request: z.infer<typeof TextureRequestSchema>) {
  return `Create ONE production VFX texture mask, not a finished scene or screenshot. White and grayscale luminous detail on transparent background, square 1024x1024, orthographic flat asset, no perspective, no colored lighting, no text, no logos, no checkerboard, no ground, no borders. Leave 8% clear padding around isolated shapes. The engine uses luminance times alpha as a tintable mask. Reference images describe material appearance only; do not reproduce their scene. Asset requirement: ${request.prompt}`;
}
export async function generateTexture(
  input: z.infer<typeof TextureRequestSchema>,
  references: string[],
  signal: AbortSignal,
  runtime?: {
    apiKey: string | undefined;
    cacheScope: string;
    reserve: typeof reserveUsd;
    settle: typeof settleUsd;
  },
): Promise<{ asset: TextureAsset; usage?: Usage; cached: boolean }> {
  const request = TextureRequestSchema.parse(input);
  if (request.libraryAssetId)
    return {
      asset: await libraryTexture(request.libraryAssetId, request.id),
      cached: true,
    };
  if (process.env.OPENAI_IMAGE_MODE === "library")
    throw new Error(
      "Image API is disabled locally; choose a compatible reusable texture or procedural material.",
    );
  const model = process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL;
  if (![IMAGE_MODEL, "gpt-image-2.5-flare"].includes(model))
    throw new Error("Unsupported image model. Revalidate pricing first.");
  const prompt = texturePrompt(request);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        model,
        prompt,
        references,
        size: 1024,
        quality: "medium",
        revision: 1,
        scope: runtime?.cacheScope,
      }),
    )
    .digest("hex");
  const directory = path.join(DATA_DIR, "textures"),
    filename = path.join(directory, `${digest}.json`);
  try {
    const asset = TextureAssetSchema.parse(
      JSON.parse(await readFile(filename, "utf8")),
    );
    if (
      createHash("sha256")
        .update(Buffer.from(asset.data.split(",")[1], "base64"))
        .digest("hex") !== asset.sha256
    )
      throw new Error("Texture digest mismatch.");
    return { asset: { ...asset, id: request.id }, cached: true };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Texture cache invalid; generation stopped.");
  }
  const apiKey = runtime ? runtime.apiKey : await getKey();
  if (!apiKey) throw new Error("OpenAI API key is not configured.");
  signal.throwIfAborted();
  const reservation = await (runtime?.reserve ?? reserveUsd)(
    IMAGE_RESERVATION_USD,
  );
  const settle = runtime?.settle ?? settleUsd;
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180000 });
  const params = {
    model,
    prompt,
    n: 1,
    quality: "medium" as const,
    size: "1024x1024" as const,
    background: "transparent" as const,
    output_format: "png" as const,
  };
  const response = await (async () => {
    try {
      return references.length
        ? await client.images.edit(
            {
              ...params,
              image: await Promise.all(
                references.slice(0, 3).map(async (data, i) => {
                  const match =
                    /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(data);
                  if (!match) throw new Error("Invalid texture reference.");
                  return toFile(
                    Buffer.from(match[2], "base64"),
                    `reference-${i}.${match[1]}`,
                    { type: `image/${match[1]}` },
                  );
                }),
              ),
            },
            { signal },
          )
        : await client.images.generate(params, { signal });
    } catch (error) {
      // A definitive authorization/validation rejection did not generate an image.
      // Network/timeout/server failures remain reserved because billing is uncertain.
      if (
        error instanceof OpenAI.APIError &&
        [400, 401, 403, 404, 422].includes(error.status || 0)
      )
        await settle(reservation, 0);
      throw error;
    }
  })();
  let usage: Usage | undefined;
  if (response.usage) {
    const u = response.usage;
    // Official token rates: text input $5/M, image input $8/M, output $30/M. No cache discount assumed.
    const usd =
      (u.input_tokens_details.text_tokens * 5 +
        u.input_tokens_details.image_tokens * 8 +
        u.output_tokens * 30) /
      1e6;
    await settle(reservation, usd, u.input_tokens, u.output_tokens);
    usage = {
      input: u.input_tokens,
      output: u.output_tokens,
      usd,
      model,
      responseId: `image-${response.created}-${digest.slice(0, 12)}`,
    };
  }
  const b64 = response.data?.[0]?.b64_json;
  if (!b64 || b64.length > 28_000_000)
    throw new Error("Image generation returned no usable texture.");
  const png = await sharp(Buffer.from(b64, "base64"), {
    limitInputPixels: 2_000_000,
  })
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bright = 0,
    edgeAlpha = 0,
    edges = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 20 && Math.max(data[i], data[i + 1], data[i + 2]) > 30)
        bright++;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        edgeAlpha += data[i + 3];
        edges++;
      }
    }
  if (bright < 128 || edgeAlpha / edges > 20)
    throw new Error(
      "Texture failed visible-detail or transparent-edge checks. Procedural effect remains available.",
    );
  const asset: TextureAsset = {
    id: request.id,
    data: `data:image/png;base64,${png.toString("base64")}`,
    prompt,
    model,
    sha256: createHash("sha256").update(png).digest("hex"),
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tmp = `${filename}.tmp`;
  await writeFile(tmp, JSON.stringify(asset), { mode: 0o600 });
  await rename(tmp, filename);
  return { asset, usage, cached: false };
}

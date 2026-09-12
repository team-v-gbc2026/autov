import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextureAssetSchema } from "./schema";
export const TEXTURE_LIBRARY = {
  sigil: {
    file: "generated-sigil.png",
    description:
      "Fine white concentric magical sigil, ornamental circular lines, transparent square mask. Use on a decal.",
  },
  "smoke-lobe": {
    file: "generated-smoke-lobe.png",
    description:
      "One tall, connected, sculpted smoke lobe with rounded bulges and broad grayscale shading. Use several overlapping camera-facing sprite planes, normal blend, purple or pink tint. Width=2*radius, height=length.",
  },
  "fire-plume": {
    file: "generated-fire-plume.png",
    description:
      "One connected horizontal flame body, rounded head at left and three tapered curling tongues at right. Full texture occupies 75% width and 32% height. Use camera-facing sprite plane with surface flame for animated tail distortion, tint yellow/orange/red; animate opacity, erosion and layered motion.",
  },
} as const;
export async function libraryTexture(
  key: keyof typeof TEXTURE_LIBRARY,
  id: string,
) {
  const item = TEXTURE_LIBRARY[key],
    data = await readFile(
      path.join(process.cwd(), "public", "textures", item.file),
    );
  return TextureAssetSchema.parse({
    id,
    data: `data:image/png;base64,${data.toString("base64")}`,
    prompt: item.description,
    model: "Codex imagegen (model not exposed), reusable library",
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}

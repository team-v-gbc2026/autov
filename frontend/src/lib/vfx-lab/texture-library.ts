import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextureAssetSchema } from "./schema";
export const TEXTURE_LIBRARY = {
  "energy-ribbons": {
    file: "generated-energy-ribbons.png",
    description:
      "Two separate VERTICAL white torn energy strips with a transparent central channel. Sharp asymmetric slivers, not a complete beam/core. Use one camera-facing sprite with geometry plane, surface solid, and this texture; color and secondaryColor both saturated magenta (or the desired edge hue). Rotate Z=pi/2 for a horizontal beam. Mask spans about50% of plane width and80% of plane height; plane length about1.25 times the desired beam length. Keep a separate continuous white core aligned to the same center/rotation and extension motion; a core roughly.2m thick pairs with edge-plane radius around.4m. Animate length/opacity/intensity and keep the emission endpoint anchored. For linear beams only, not circular sigils or smoke.",
  },
  sigil: {
    file: "generated-sigil.png",
    description:
      "Fine white concentric magical sigil, ornamental circular lines, transparent square mask. Use on a decal.",
  },
  "smoke-column": {
    file: "generated-smoke-column.png",
    description:
      "ONE continuous rising smoke column with three large merged billows and an upper curl, broad grayscale shading, transparent background. Prefer one main camera-facing sprite plane, surface smoke, normal blend, purple tint; animate its height, opacity, low turbulence and late erosion. This replaces a stack of repeated small round puffs. Add separate small smoke-curl wisps and a restrained pink foot accent. The visible mask occupies about50% of plane width and76% of plane height; width=2*radius and height=length. Its root is near centerY-.38*length: coordinate position/motion with height growth to keep the foot anchored. Do not reuse the whole column as each small wisp.",
  },
  "smoke-lobe": {
    file: "generated-smoke-lobe.png",
    description:
      "One tall, connected, sculpted smoke lobe with rounded bulges and broad grayscale shading. Use several overlapping camera-facing sprite planes, normal blend, purple or pink tint. Width=2*radius, height=length.",
  },
  "smoke-curl": {
    file: "generated-smoke-curl.png",
    description:
      "An open C-shaped smoke curl: a thick rounded lower-left root, lobed outer rim, a taper curling clockwise to the upper-right and a large empty center. Broad grayscale shading, transparent background. Use small camera-facing sprite planes with surface smoke and normal blend for curling detached wisps. Rotate Z and drift gently; do not reuse the round main lobe for every wisp.",
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

import { defineTool } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { VFX_AUTHORING_GUIDE_V2 } from "../../src/lib/vfx-lab/protocol-v2";
import { readEffect } from "../../src/lib/studio-tools/server";
export default defineTool({
  description:
    "Read the current effect revision and layer summary. Supply layerIds for full settings before editing. Use returned IDs, not guessed names.",
  inputSchema: z
    .object({ layerIds: z.array(z.string()).max(24).default([]) })
    .strict(),
  async execute(input, ctx) {
    return {
      ...(await readEffect(await toolIdentity(ctx), input.layerIds)),
      selectedEmitterId:
        ctx.session.auth.current?.attributes?.selectedEmitterId ?? null,
      ...(input.layerIds.length
        ? { authoringGuide: VFX_AUTHORING_GUIDE_V2 }
        : {}),
    };
  },
});

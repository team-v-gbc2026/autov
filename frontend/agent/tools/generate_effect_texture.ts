import { defineTool } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { createOperation, readState } from "../../src/lib/studio-tools/server";
import { generateEffectTexture } from "../../src/lib/studio-tools/effect-textures";
import {
  inspectReferences,
  registerEffectTexture,
} from "../../src/lib/studio-tools/references";

export default defineTool({
  description:
    "Generate one isolated grayscale alpha effect mask when inspected library assets cannot meet the requested silhouette. Saves pixels on the board. Inspect the returned reference before binding its texture ID; supply operationId in generate_vfx.effectTextureOperationIds. No flipbook sheets, scenes or color maps.",
  inputSchema: z
    .object({
      prompt: z.string().trim().min(10).max(1500),
      role: z.string().min(1).max(100),
      referenceIds: z.array(z.string().uuid()).max(8),
    })
    .strict(),
  async execute(input, ctx) {
    const identity = await toolIdentity(ctx);
    const state = await readState(identity);
    const operation = await createOperation(
      identity,
      ctx.session.id,
      ctx.callId,
      "effect_texture",
      state.revision,
      input,
      false,
      ctx.session.turn.id,
    );
    const parts = await inspectReferences(identity, input.referenceIds);
    const images = parts.flatMap((part) =>
      part.type === "file" && typeof part.data === "string" ? [part.data] : [],
    );
    const asset = await generateEffectTexture(
      identity,
      operation,
      0,
      `Isolated static tintable grayscale alpha mask with transparent edges. Never a scene, color texture or flipbook. ${input.prompt}`,
      images,
      ctx.abortSignal ?? new AbortController().signal,
    );
    const reference = await registerEffectTexture(
      identity,
      operation,
      asset,
      input.role,
    );
    return { operationId: operation.id, ...reference };
  },
});

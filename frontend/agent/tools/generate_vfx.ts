import { defineWorkflowTool } from "eve/tools";
import { GenerationSchema } from "../../src/lib/studio-tools/operations";
import {
  prepareGeneration,
  prepareContext,
  buildCandidate,
  finishFirstPass,
  failGeneration,
} from "../lib/generation";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Generate a first-pass VFX effect, capture it for render validation, and immediately apply it to the scene. Does not run visual review or repair. The chat offers Continue for user-approved iteration. Never automatically review, repair or invoke refine_vfx after this tool. Include accumulated requirements, avoid, textureIds and referenceIds. replace replaces the effect; add preserves existing layers. Extracts art direction and prepares effect textures before recipe selection.",
  inputSchema: GenerationSchema,
  async execute(input, ctx) {
    "use workflow";
    const { identity, operation } = await prepareGeneration(ctx, input);
    if (operation.status === "completed") return operation.result;
    try {
      const context = await prepareContext(identity, input);
      const built = await buildCandidate(
        ctx,
        identity,
        operation,
        input,
        context,
      );
      const capture = await waitBrowser(identity, built.capture.id);
      return await finishFirstPass(
        identity,
        operation,
        capture,
        built.context.textureReferences,
      );
    } catch (error) {
      await failGeneration(
        identity,
        operation,
        error instanceof Error ? error.message : "Generation failed.",
      );
      throw error;
    }
  },
});

import { defineWorkflowTool } from "eve/tools";
import { GenerationSchema } from "../../src/lib/studio-tools/operations";
import {
  prepareGeneration,
  buildCandidate,
  finishGeneration,
} from "../lib/generation";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Generate one v2 effect using existing texture assets and board reference IDs. replace replaces the whole effect; add preserves current layers/global settings and adds generated layers. Requires expectedRevision and an open studio to render before committing. No new images or custom textures are generated.",
  inputSchema: GenerationSchema,
  async execute(input, ctx) {
    "use workflow";
    const { identity, operation } = await prepareGeneration(ctx, input);
    if (operation.status === "completed") return operation.result;
    const capture = await buildCandidate(ctx, identity, operation, input);
    return finishGeneration(
      identity,
      operation,
      await waitBrowser(identity, capture.id),
    );
  },
});

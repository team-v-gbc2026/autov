import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { recoverCandidate, candidateReceipt } from "../lib/candidates";
import { waitBrowser } from "../lib/browser";

export default defineWorkflowTool({
  description:
    "On user request, recover a saved VFX candidate after capture failure. Re-captures the exact saved document with no generation/provider call. Does not commit; inspect the returned reference and then commit_vfx_candidate. Requires the original conversation, unchanged scene, and an open Studio.",
  inputSchema: z.object({ captureId: z.string().uuid() }).strict(),
  async execute(input, ctx) {
    "use workflow";
    const draft = await recoverCandidate(ctx, input.captureId);
    return candidateReceipt(
      draft.operation.id,
      await waitBrowser(draft.identity, draft.capture.id),
    );
  },
});

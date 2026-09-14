import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { refineCandidate, candidateReceipt } from "../lib/candidates";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Author one revised candidate for the current committed generation using the user's requested corrections and Eve's visual findings. Does not commit or run hidden review loops. Inspect and select the result explicitly.",
  inputSchema: z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      feedback: z.string().trim().min(10).max(2000),
    })
    .strict(),
  async execute(input, ctx) {
    "use workflow";
    const draft = await refineCandidate(
      ctx,
      input.feedback,
      input.expectedRevision,
    );
    return candidateReceipt(
      draft.operation.id,
      await waitBrowser(draft.identity, draft.capture.id),
    );
  },
});

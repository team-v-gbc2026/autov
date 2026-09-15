import { defineWorkflowTool } from "eve/tools";
import { AuthorCandidateSchema } from "../../src/lib/studio-tools/author-candidate";
import { draftCandidate, candidateReceipt } from "../lib/candidates";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Author and capture an uncommitted VFX candidate using Eve's explicit direction, inspected texture bindings and technique IDs. One bounded document-authoring call. Inspect the returned reference, edit if needed, then commit_vfx_candidate.",
  inputSchema: AuthorCandidateSchema,
  async execute(input, ctx) {
    "use workflow";
    const draft = await draftCandidate(ctx, input);
    return candidateReceipt(
      draft.operation.id,
      await waitBrowser(draft.identity, draft.capture.id),
    );
  },
});

import { defineWorkflowTool } from "eve/tools";
import { EditSchema } from "../../src/lib/studio-tools/operations";
import { editCandidate, candidateReceipt } from "../lib/candidates";
import { CandidateHandleSchema } from "../../src/lib/studio-tools/author-candidate";
import { waitBrowser } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Apply targeted typed edits to an uncommitted candidate and capture a new version. Preserves previous candidates and the current scene.",
  inputSchema: CandidateHandleSchema.extend({
    operations: EditSchema.shape.operations,
  }).strict(),
  async execute(input, ctx) {
    "use workflow";
    const draft = await editCandidate(ctx, input);
    return candidateReceipt(
      draft.operation.id,
      await waitBrowser(draft.identity, draft.capture.id),
    );
  },
});

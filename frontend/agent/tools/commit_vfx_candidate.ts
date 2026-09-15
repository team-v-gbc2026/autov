import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { commitCandidate } from "../lib/candidates";
import { CandidateHandleSchema } from "../../src/lib/studio-tools/author-candidate";
export default defineWorkflowTool({
  description:
    "Commit a captured VFX candidate after inspecting its reference pixels. Include its exact reference ID and honest visual findings. Enforces ownership and revision checks.",
  inputSchema: CandidateHandleSchema.extend({
    inspectedReferenceId: z.string().uuid(),
    review: z.string().trim().min(10).max(2000),
  }).strict(),
  async execute(input, ctx) {
    "use workflow";
    return commitCandidate(ctx, input);
  },
});

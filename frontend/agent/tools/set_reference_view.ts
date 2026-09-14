import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { startBrowser, waitBrowser, browserResult } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Focus an existing image on the project's reference board. Completes after an open browser acknowledges it.",
  inputSchema: z.object({ referenceId: z.string().uuid() }).strict(),
  async execute(input, ctx) {
    "use workflow";
    const { identity, operation } = await startBrowser(
      ctx,
      "reference_view",
      input,
    );
    return browserResult(identity, await waitBrowser(identity, operation.id));
  },
});

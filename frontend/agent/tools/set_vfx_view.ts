import { defineWorkflowTool } from "eve/tools";
import { ViewSchema } from "../../src/lib/studio-tools/operations";
import { startBrowser, waitBrowser, browserResult } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Select a layer and open its editor, solo it, play/pause or seek. Requires an open studio; does not modify the effect document.",
  inputSchema: ViewSchema,
  async execute(input, ctx) {
    "use workflow";
    const { identity, operation } = await startBrowser(ctx, "view", input);
    return browserResult(identity, await waitBrowser(identity, operation.id));
  },
});

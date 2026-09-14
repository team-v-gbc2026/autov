import { defineWorkflowTool, toolOutput, toolOutputPart } from "eve/tools";
import { PreviewSchema } from "../../src/lib/studio-tools/operations";
import { startBrowser, waitBrowser, browserResult } from "../lib/browser";
export default defineWorkflowTool({
  description:
    "Capture real timestamped renderer frames at the requested revision, optionally soloing a layer. Saves the sheet to the board before returning pixels. Requires an open WebGPU studio.",
  inputSchema: PreviewSchema,
  async execute(input, ctx) {
    "use workflow";
    const { identity, operation } = await startBrowser(
      ctx,
      "preview",
      input,
      input.expectedRevision,
    );
    return browserResult(
      identity,
      await waitBrowser(identity, operation.id),
      true,
    );
  },
  toModelOutput(result) {
    const parts = result.images || [];
    return toolOutput.content([
      toolOutputPart.text(
        JSON.stringify({
          referenceId: result.result.referenceId,
          times: result.result.times,
        }),
      ),
      ...parts.flatMap((part) =>
        part.type === "file" && typeof part.data === "string"
          ? [
              toolOutputPart.file(part.data.replace(/^data:[^,]*,/, ""), {
                mediaType: part.mediaType,
              }),
            ]
          : [],
      ),
    ]);
  },
});

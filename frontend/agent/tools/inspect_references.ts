import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { inspectReferences } from "../../src/lib/studio-tools/references";
export default defineTool({
  description:
    "Inspect actual image pixels for up to eight existing board references. Animated files provide their first frame only. IDs must come from this project.",
  inputSchema: z
    .object({ referenceIds: z.array(z.string().uuid()).min(1).max(8) })
    .strict(),
  async execute(input, ctx) {
    return inspectReferences(await toolIdentity(ctx), input.referenceIds);
  },
  toModelOutput(parts) {
    return toolOutput.content(
      parts.flatMap((part) =>
        part.type === "text"
          ? [toolOutputPart.text(part.text)]
          : part.type === "file" && typeof part.data === "string"
            ? [
                toolOutputPart.file(part.data.replace(/^data:[^,]*,/, ""), {
                  mediaType: part.mediaType,
                }),
              ]
            : [],
      ),
    );
  },
});

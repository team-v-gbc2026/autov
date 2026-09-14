import { defineTool } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { listReferences } from "../../src/lib/studio-tools/references";
export default defineTool({
  description:
    "List available images on this project's reference board with IDs and mention tags. Inspect an image before making visual claims.",
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) {
    const ids = ctx.session.auth.current?.attributes?.referenceIds;
    return listReferences(
      await toolIdentity(ctx),
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [],
    );
  },
});

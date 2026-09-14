import { defineTool } from "eve/tools";
import { z } from "zod";
import { toolIdentity } from "../lib/studio";
import { undo } from "../../src/lib/studio-tools/server";
export default defineTool({
  description:
    "Undo a recorded agent change only at its resulting revision. Later manual/agent work is never overwritten.",
  inputSchema: z
    .object({
      operationId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  async execute(input, ctx) {
    return undo(
      await toolIdentity(ctx),
      ctx.session.id,
      ctx.callId,
      input.operationId,
      input.expectedRevision,
      ctx.session.turn.id,
    );
  },
});

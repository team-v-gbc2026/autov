import { defineTool } from "eve/tools";
import { toolIdentity } from "../lib/studio";
import { applyEdit } from "../../src/lib/studio-tools/server";
import { EditSchema } from "../../src/lib/studio-tools/operations";
export default defineTool({
  description:
    "Atomically edit existing v2 properties at expectedRevision. Nested objects merge; arrays replace. Read full layer details first. update_effect cannot change layers/schemaVersion. IDs are immutable; use duplicate_layer for copies. Units are seconds, meters and radians. Example: update_layer changes {emitter:{velocity:{speed:[0.2,0.5]}}}. A conflict requires a fresh read, not blind retry.",
  inputSchema: EditSchema,
  async execute(input, ctx) {
    return applyEdit(
      await toolIdentity(ctx),
      ctx.session.id,
      ctx.callId,
      input,
      ctx.session.turn.id,
    );
  },
});

import type { ToolContext } from "eve/tools";
import { z } from "zod";
import {
  type Identity,
  verifyIdentity,
} from "../../src/lib/studio-tools/server";
import { OperationError } from "../../src/lib/studio-tools/operations";
export async function toolIdentity(
  ctx: Pick<ToolContext, "session">,
): Promise<Identity> {
  const auth = ctx.session.auth.current;
  const userId = z.string().uuid().safeParse(auth?.principalId);
  const projectId = z.string().uuid().safeParse(auth?.attributes?.projectId);
  if (
    auth?.authenticator !== "supabase" ||
    auth.principalType !== "user" ||
    !userId.success ||
    !projectId.success
  )
    throw new OperationError(
      "UNAVAILABLE",
      "An authenticated project is required.",
    );
  const identity = { userId: userId.data, projectId: projectId.data };
  await verifyIdentity(identity);
  return identity;
}

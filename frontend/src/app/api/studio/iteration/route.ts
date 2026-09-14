import {
  authorizeProject,
  conversation,
} from "../../../../../agent/lib/database";
import { responseError } from "../../../../../agent/lib/contracts";

/** Only offer iteration for the current committed generation in this conversation. */
export async function GET(request: Request) {
  try {
    const { client, project } = await authorizeProject(request);
    const binding = await conversation(client, project.id);
    if (!binding.session_id) return Response.json(null);
    const [generation, state] = await Promise.all([
      client
        .from("studio_operations")
        .select("id,status,after_revision")
        .eq("project_id", project.id)
        .eq("session_id", binding.session_id)
        .eq("kind", "generate")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("studio_documents")
        .select("revision")
        .eq("project_id", project.id)
        .maybeSingle(),
    ]);
    if (generation.error || state.error)
      throw new Error("Iteration status unavailable.");
    const operation = generation.data;
    const offer =
      operation?.status === "completed" &&
      operation.after_revision === state.data?.revision
        ? { operationId: operation.id, revision: operation.after_revision }
        : null;
    return Response.json(offer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(error);
  }
}

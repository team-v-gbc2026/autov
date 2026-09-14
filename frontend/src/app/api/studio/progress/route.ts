import { authorizeProject, conversation } from "../../../../../agent/lib/database";
import { responseError } from "../../../../../agent/lib/contracts";
import { admin } from "@/lib/studio-tools/server";
export async function GET(request: Request) {
  try {
    const { client, project } = await authorizeProject(request);
    const callId = new URL(request.url).searchParams.get("callId");
    if (!callId || callId.length > 200) return Response.json({ error: "Invalid call ID." }, { status: 400 });
    const binding = await conversation(client, project.id);
    if (!binding.session_id) return Response.json(null);
    const { data: operation, error } = await client.from("studio_operations")
      .select("id,status,created_at,result")
      .eq("project_id", project.id).eq("session_id", binding.session_id).eq("call_id", callId).eq("kind", "generate").maybeSingle();
    if (error) throw error;
    if (!operation) return Response.json(null);
    const [calls, capture] = await Promise.all([
      admin().from("studio_provider_calls").select("stage,charged_usd").eq("project_id", project.id).eq("operation_id", operation.id),
      client.from("studio_operations").select("status").eq("project_id", project.id).eq("session_id", binding.session_id).eq("call_id", `${callId}:capture`).maybeSingle(),
    ]);
    if (calls.error || capture.error) throw new Error("Could not read generation progress.");
    const stage = operation.status === "completed" ? 5
      : capture.data?.status === "completed" ? 4
      : capture.data ? 3
      : calls.data.some(call => call.stage === "candidate" || (call.stage === "plan" && call.charged_usd !== null)) ? 2
      : calls.data.some(call => call.stage === "plan") ? 1 : 0;
    return Response.json({ stage, startedAt: operation.created_at, status: operation.status, error: operation.result?.message }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}

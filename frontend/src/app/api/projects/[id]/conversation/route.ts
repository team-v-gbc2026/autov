import { authorizeProject, conversation } from "../../../../../../agent/lib/database";
import { configurationError } from "../../../../../../agent/lib/config";
import { ChatError, responseError } from "../../../../../../agent/lib/contracts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const headers = new Headers(request.headers);
    headers.set("x-autov-project-id", id);
    const { client } = await authorizeProject(new Request(request, { headers }));
    const unavailable = configurationError();
    if (unavailable) throw new ChatError("NOT_CONFIGURED", unavailable, 503);
    const binding = await conversation(client, id);
    return Response.json({ sessionId: binding.session_id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return responseError(error); }
}

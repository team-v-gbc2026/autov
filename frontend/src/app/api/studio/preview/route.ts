import { z } from "zod";
import { authorizeProject } from "../../../../../agent/lib/database";
import { responseError } from "../../../../../agent/lib/contracts";
import { capturePreview } from "@/lib/studio-tools/capture-preview";
import { OperationError } from "@/lib/studio-tools/operations";

export async function GET(request: Request) {
  try {
    const access = await authorizeProject(request);
    const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("referenceId"));
    if (!id.success) return Response.json({ error: "Invalid preview ID." }, { status: 400 });
    return Response.json(await capturePreview({ userId: access.userId, projectId: access.project.id }, id.data),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OperationError) return Response.json({ error: error.message },
      { status: error.code === "NOT_FOUND" ? 404 : 503 });
    return responseError(error);
  }
}

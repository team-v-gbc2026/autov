import { z } from "zod";
import { authorizeProject } from "../../../../agent/lib/database";
import { ChatError, responseError } from "../../../../agent/lib/contracts";
import {
  admin,
  transition,
  readState,
  createOperation,
  commit,
  type Operation,
} from "@/lib/studio-tools/server";
import { OperationError } from "@/lib/studio-tools/operations";
import { registerCapture } from "@/lib/studio-tools/references";
import { validateWorkspaceDocumentV2 } from "@/lib/vfx-lab/schema-v2";
export const runtime = "nodejs";
const uuid = z.string().uuid();
const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("initialize"), document: z.unknown() }).strict(),
  z
    .object({
      action: z.literal("save"),
      document: z.unknown(),
      expectedRevision: z.number().int().nonnegative(),
      callId: uuid,
    })
    .strict(),
  z.object({ action: z.literal("claim"), id: uuid, leaseId: uuid }).strict(),
  z
    .object({
      action: z.literal("ack"),
      id: uuid,
      leaseId: uuid,
      error: z.string().max(500).optional(),
      sheet: z.string().max(12_000_000).optional(),
      times: z.array(z.number().min(0).max(12)).max(8).optional(),
      renderedPixels: z.number().nonnegative().optional(),
    })
    .strict(),
]);
function failure(error: unknown) {
  if (error instanceof OperationError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.code === "CONFLICT" ? 409 : 400 },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: z.prettifyError(error), code: "INVALID_INPUT" },
      { status: 400 },
    );
  return responseError(error);
}
export async function GET(request: Request) {
  try {
    const access = await authorizeProject(request),
      identity = { userId: access.userId, projectId: access.project.id };
    const state = await readState(identity);
    const client = admin();
    const { data: operations, error } = await client
      .from("studio_operations")
      .select("id,kind,status,expected_revision,input,expires_at")
      .eq("project_id", identity.projectId)
      .in("kind", ["view", "reference_view", "preview", "capture_candidate"])
      .in("status", ["pending", "running"])
      .gt("expires_at", new Date().toISOString())
      .order("created_at");
    if (error) throw new Error("Operation storage unavailable");
    const { data: assets, error: assetError } = await access.client
      .from("assets")
      .select("id,name,storage_path,mime_type")
      .eq("project_id", identity.projectId)
      .eq("archived", false)
      .order("created_at");
    if (assetError) throw new Error("Reference storage unavailable");
    return Response.json(
      { ...state, operations, assets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const access = await authorizeProject(request),
      identity = { userId: access.userId, projectId: access.project.id };
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new ChatError("INVALID_BODY", "Use JSON.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 14_000_000) {
        await reader.cancel();
        throw new ChatError("BODY_TOO_LARGE", "Studio request too large.", 413);
      }
      chunks.push(part.value);
    }
    const body = RequestSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (body.action === "initialize")
      return Response.json(
        await transition(identity, "initialize", {
          document: validateWorkspaceDocumentV2(body.document),
        }),
      );
    if (body.action === "save") {
      const document = validateWorkspaceDocumentV2(body.document);
      const operation = await createOperation(
        identity,
        "manual",
        body.callId,
        "edit",
        body.expectedRevision,
        {},
      );
      return Response.json(
        await commit(identity, operation, document, "Saved studio edits."),
      );
    }
    if (body.action === "claim")
      return Response.json(
        await transition(identity, "claim", {
          id: body.id,
          leaseId: body.leaseId,
        }),
      );
    const op = (await transition(identity, "poll", {
      id: body.id,
    })) as Operation;
    if (!op || op.lease_id !== body.leaseId || !["running"].includes(op.status))
      throw new OperationError("CONFLICT", "Browser request expired.");
    const state = await readState(identity);
    if (state.revision !== op.expected_revision)
      throw new OperationError(
        "CONFLICT",
        "Effect changed during browser action.",
      );
    let result: Record<string, unknown> = { applied: true };
    if (["preview", "capture_candidate"].includes(op.kind) && !body.error) {
      if (
        !body.sheet ||
        !body.times?.length ||
        body.renderedPixels === undefined
      )
        throw new OperationError("INVALID_INPUT", "Missing renderer evidence.");
      result = {
        ...(await registerCapture(identity, op, body.sheet, body.times)),
        times: body.times,
        renderedPixels: body.renderedPixels,
      };
    }
    return Response.json(
      await transition(identity, "ack", {
        id: body.id,
        leaseId: body.leaseId,
        error: body.error,
        result,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  OperationError,
  editDocument,
  EditSchema,
  summarize,
} from "./operations";
import {
  validateWorkspaceDocumentV2,
  type VfxDocumentV2,
} from "../vfx-lab/schema-v2";
export type Identity = { userId: string; projectId: string };
export type Operation = {
  id: string;
  project_id: string;
  session_id: string;
  call_id: string;
  kind: string;
  expected_revision: number;
  status: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  before_document: VfxDocumentV2 | null;
  after_revision: number | null;
  expires_at: string | null;
  lease_id: string | null;
};
export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new OperationError(
      "UNAVAILABLE",
      "Studio tools are unavailable. Set NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SECRET_KEY.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function verifyIdentity(identity: Identity) {
  const client = admin();
  const { data, error } = await client
    .from("projects")
    .select("id")
    .eq("id", identity.projectId)
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (error || !data)
    throw new OperationError("NOT_FOUND", "Project unavailable.");
  return client;
}
export async function transition(
  identity: Identity,
  action: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await admin().rpc("studio_transition", {
    p_user: identity.userId,
    p_project: identity.projectId,
    p_action: action,
    p_args: args,
  });
  if (error)
    throw new OperationError(
      "UNAVAILABLE",
      error.message.includes("budget")
        ? "Generation budget exceeded."
        : "Studio operation unavailable. Check migrations and reconnect.",
    );
  return data;
}
export async function readState(
  identity: Identity,
): Promise<{ revision: number; document: VfxDocumentV2 }> {
  const client = await verifyIdentity(identity);
  const { data, error } = await client
    .from("studio_documents")
    .select("revision,document")
    .eq("project_id", identity.projectId)
    .single();
  if (error || !data)
    throw new OperationError(
      "UNAVAILABLE",
      "Open the studio to initialize this effect.",
    );
  return {
    revision: Number(data.revision),
    document: validateWorkspaceDocumentV2(data.document),
  };
}
export async function createOperation(
  identity: Identity,
  sessionId: string,
  callId: string,
  kind: string,
  revision: number,
  input: unknown,
  browser = false,
  turnId?: string,
  parentId?: string,
): Promise<Operation> {
  return transition(identity, "create", {
    sessionId,
    callId,
    kind,
    revision,
    input,
    browser,
    turnId,
    parentId,
  });
}
export function outcome(operation: Operation) {
  if (operation.status !== "completed") {
    const code = operation.result?.code;
    throw new OperationError(
      code === "CONFLICT"
        ? "CONFLICT"
        : code === "CANCELLED"
          ? "CANCELLED"
          : "UNAVAILABLE",
      String(operation.result?.message || `Operation ${operation.status}.`),
    );
  }
  return operation.result!;
}
export async function commit(
  identity: Identity,
  operation: Operation,
  document: VfxDocumentV2,
  summary: string,
) {
  validateWorkspaceDocumentV2(document);
  return outcome(
    await transition(identity, "commit", {
      id: operation.id,
      document,
      summary,
    }),
  );
}
export async function applyEdit(
  identity: Identity,
  sessionId: string,
  callId: string,
  input: z.infer<typeof EditSchema>,
  turnId?: string,
) {
  const parsed = EditSchema.parse(input);
  const op = await createOperation(
    identity,
    sessionId,
    callId,
    "edit",
    parsed.expectedRevision,
    parsed,
    false,
    turnId,
  );
  if (op.status !== "pending") return outcome(op);
  try {
    const state = await readState(identity);
    if (state.revision !== parsed.expectedRevision) throw new OperationError("CONFLICT", "The effect changed. Read it again.");
    return await commit(identity, op, editDocument(state.document, parsed), `Applied ${parsed.operations.length} edit(s).`);
  } catch (error) {
    const code = error instanceof OperationError ? error.code : "INVALID_INPUT";
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof OperationError ? error.message : "The edit could not be validated.";
    await transition(identity, "fail", { id: op.id, result: { code, message } });
    throw new OperationError(code, message);
  }
}
export async function undo(
  identity: Identity,
  sessionId: string,
  callId: string,
  operationId: string,
  expectedRevision: number,
  turnId?: string,
) {
  const client = await verifyIdentity(identity);
  const { data } = await client
    .from("studio_operations")
    .select("*")
    .eq("project_id", identity.projectId)
    .eq("id", operationId)
    .single();
  if (
    !data?.before_document ||
    data.after_revision !== expectedRevision ||
    data.session_id === "manual"
  )
    throw new OperationError(
      "CONFLICT",
      "Undo requires the latest agent edit revision.",
    );
  const op = await createOperation(
    identity,
    sessionId,
    callId,
    "undo",
    expectedRevision,
    { operationId },
    false,
    turnId,
  );
  return commit(
    identity,
    op,
    validateWorkspaceDocumentV2(data.before_document),
    "Reverted agent change.",
  );
}
export async function readEffect(identity: Identity, layerIds: string[]) {
  const state = await readState(identity);
  return {
    revision: state.revision,
    document: summarize(state.document, layerIds),
  };
}

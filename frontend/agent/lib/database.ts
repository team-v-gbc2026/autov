import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ChatError, projectIdFrom } from "./contracts";

export async function authorizeProject(request: Request) {
  const projectId = projectIdFrom(request);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new ChatError("UNAUTHENTICATED", "Sign in to use the assistant.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ChatError("NOT_CONFIGURED", "Supabase is not configured.", 503);
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) throw new ChatError("UNAUTHENTICATED", "Your session expired. Sign in again.", 401);
  const { data: project, error: projectError } = await client.from("projects").select("id,name").eq("id", projectId).eq("user_id", user.id).maybeSingle();
  if (projectError) throw new ChatError("PROJECT_UNAVAILABLE", "Could not load this project.", 503);
  if (!project) throw new ChatError("NOT_FOUND", "Project not found.", 404);
  return { client, project, userId: user.id };
}
export type Conversation = { project_id: string; session_id: string | null; initial_prompt_hash: string | null; lease_id: string | null; lease_until: string | null };
export async function conversation(client: SupabaseClient, projectId: string): Promise<Conversation> {
  const { error } = await client.from("project_conversations").upsert({ project_id: projectId }, { onConflict: "project_id", ignoreDuplicates: true });
  if (error) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not open the conversation. Check the conversation migration and retry.", 503);
  const { data, error: readError } = await client.from("project_conversations").select("project_id,session_id,initial_prompt_hash,lease_id,lease_until").eq("project_id", projectId).single();
  if (readError) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not load the conversation.", 503);
  return data as Conversation;
}
export function assertSession(binding: Conversation, sessionId: string) {
  if (binding.session_id !== sessionId) throw new ChatError("NOT_FOUND", "Conversation not found in this project.", 404);
}
export async function acquireLease(client: SupabaseClient, projectId: string) {
  const lease = crypto.randomUUID();
  const { data, error } = await client.rpc("claim_project_conversation", { p_project_id: projectId, p_lease_id: lease });
  if (error) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not submit to the conversation.", 503);
  if (!data) throw new ChatError("CONVERSATION_BUSY", "Another request is being accepted. Reconnect in a moment before retrying.", 409);
  return lease;
}
export async function releaseLease(client: SupabaseClient, projectId: string, lease: string) {
  await client.from("project_conversations").update({ lease_id: null, lease_until: null }).eq("project_id", projectId).eq("lease_id", lease);
}

// Framework-owned continuation identity; never accept an address from the browser.
export function conversationAddress(userId: string, projectId: string) {
  return `studio:${userId}:${projectId}`;
}

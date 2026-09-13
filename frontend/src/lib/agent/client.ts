"use client";
import { createClient } from "@/lib/supabase/client";

export async function agentHeaders(projectId: string) {
  const client = createClient();
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session) throw new Error("Your session expired. Sign in again.");
  // getSession refreshes an expired session through supabase-js; refresh early for streams.
  const token = session.expires_at && session.expires_at * 1000 < Date.now() + 60_000
    ? (await client.auth.refreshSession()).data.session?.access_token
    : session.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return { Authorization: `Bearer ${token}`, "x-autov-project-id": projectId };
}

export async function loadConversation(projectId: string, signal: AbortSignal) {
  const response = await fetch(`/api/projects/${projectId}/conversation`, { headers: await agentHeaders(projectId), cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not open the conversation.");
  return result as { sessionId: string | null };
}

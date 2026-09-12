"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/session";

export async function deleteProject(projectId: string) {
  const { supabase, user } = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { error: "Invalid project." };
  // RLS and the explicit ownership filter both restrict deletion to the owner.
  const { data, error } = await supabase.from("projects").delete().eq("id", projectId).eq("user_id", user.id).select("id").single();
  if (error || !data) return { error: "Could not delete this project. Please try again." };
  // Child records cascade in Postgres. Storage cleanup is allowed only after
  // those asset records are gone; failures do not undo a successful deletion.
  const folder = `${user.id}/${projectId}`;
  let cleanupFailed = false;
  for (;;) {
    const { data: files, error: listError } = await supabase.storage.from("references").list(folder, { limit: 100 });
    if (listError) { cleanupFailed = true; break; }
    if (!files?.length) break;
    const { error: removeError } = await supabase.storage.from("references").remove(files.map(file => `${folder}/${file.name}`));
    if (removeError) { cleanupFailed = true; break; }
  }
  revalidatePath("/workspace");
  revalidatePath(`/workspace/${projectId}`);
  return { success: true, warning: cleanupFailed ? "Project deleted. Some uploaded files could not be cleaned up." : undefined };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/session";

export async function createProject(form: FormData) {
  const { supabase } = await requireUser();
  const name = String(form.get("name") || "").trim();
  if (!name || name.length > 120) return { error: "Use a project name between 1 and 120 characters." };
  const { data, error } = await supabase.from("projects").insert({ name }).select("id").single();
  if (error) return { error: "Could not create your project. Please try again." };
  revalidatePath("/workspace");
  redirect(`/workspace/${data.id}`);
}

export async function renameProject(projectId: string, name: string) {
  const { supabase } = await requireUser();
  if (!name.trim() || name.trim().length > 120) return { error: "Use a name between 1 and 120 characters." };
  const { error, data } = await supabase.from("projects").update({ name: name.trim() }).eq("id", projectId).select("id").single();
  if (error || !data) return { error: "Could not rename this project." };
  revalidatePath("/workspace");
  return { success: true };
}

export async function savePrompt(projectId: string, prompt: string, assetIds: string[]) {
  const { supabase } = await requireUser();
  if (!prompt.trim() || prompt.length > 10000 || assetIds.length > 8) return { error: "Use a prompt up to 10,000 characters and at most 8 images." };
  const { data: id, error } = await supabase.rpc("save_generation", { p_project_id: projectId, p_prompt: prompt.trim(), p_asset_ids: assetIds });
  if (error) return { error: "Could not save your prompt. Your text is still here; please try again." };
  const { data: generation, error: readError } = await supabase.from("generations").select("id,prompt,status,created_at,error").eq("id", id).single();
  if (readError) return { error: "Prompt saved, but history could not refresh. Reload the project before retrying." };
  return { generation };
}

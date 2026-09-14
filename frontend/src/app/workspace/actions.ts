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

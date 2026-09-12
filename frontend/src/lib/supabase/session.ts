import { redirect } from "next/navigation";
import { createClient } from "./server";
import { isSupabaseConfigured } from "./config";

export async function requireUser() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  return { supabase, user };
}

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";

function validUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params;
  const projectId = resolvedParams.id;
  if (!validUuid(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { url, key } = supabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = serviceRoleKey ? createAdminClient(url, serviceRoleKey) : null;

  const db = admin ?? supabase;
  const useServiceRole = !!admin;

  if (useServiceRole) {
    const { data: ownership, error: ownershipError } = await admin
      .from("projects")
      .select("id,user_id")
      .eq("id", projectId)
      .single();

    if (ownershipError || !ownership) {
      console.error("[delete-project] Ownership check failed", {
        projectId,
        code: ownershipError?.code,
        message: ownershipError?.message,
      });
      return NextResponse.json({ error: "Project not found or deletion is not permitted." }, { status: 404 });
    }
    if (ownership.user_id !== user.id) {
      return NextResponse.json({ error: "Project not found or deletion is not permitted." }, { status: 404 });
    }
  }

  const { data, error } = await db.from("projects").delete().eq("id", projectId).eq("user_id", user.id).select("id").maybeSingle();
  if (error) {
    console.error("[delete-project] Database deletion failed", {
      projectId, code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    return NextResponse.json({ error: "Could not delete this project. Please try again.", code: error.code }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Project not found or deletion is not permitted." }, { status: 404 });

  const folder = `${user.id}/${projectId}`;
  let cleanupFailed = false;
  for (;;) {
    const { data: files, error: listError } = await supabase.storage.from("references").list(folder, { limit: 100 });
    if (listError) { cleanupFailed = true; break; }
    if (!files?.length) break;
    const { error: removeError } = await supabase.storage.from("references").remove(files.map(file => `${folder}/${file.name}`));
    if (removeError) { cleanupFailed = true; break; }
  }

  return NextResponse.json({
    success: true,
    warning: cleanupFailed ? "Project deleted. Some uploaded files could not be cleaned up." : undefined,
  });
}

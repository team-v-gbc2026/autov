"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/session";
import { admin, transition } from "@/lib/studio-tools/server";
import { upgradeDocument } from "@/lib/vfx-lab/migrate";
import { validateWorkspaceDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import { presetDocumentUrl, presetThumbnailUrl } from "@/lib/vfx-lab/asset-urls";

const PRESET_ID = /^[0-9a-f-]{36}(?:-(?:[0-2]|refined|structural))?$/i;

export async function createProject(form: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(form.get("name") || "").trim();
  const presetId = String(form.get("presetId") || "").trim();
  if (!name || name.length > 120) return { error: "Use a project name between 1 and 120 characters." };
  let preset: unknown;
  if (presetId) {
    if (!PRESET_ID.test(presetId)) return { error: "That preset is unavailable." };
    try {
      const response = await fetch(presetDocumentUrl(presetId), { cache: "no-store" });
      if (!response.ok) throw new Error("Preset unavailable");
      preset = validateWorkspaceDocumentV2(upgradeDocument(await response.json()));
    } catch {
      return { error: "That preset could not be loaded. Please try another one." };
    }
  }
  const { data, error } = await supabase.from("projects").insert({ name }).select("id").single();
  if (error) return { error: "Could not create your project. Please try again." };
  if (preset) {
    try {
      await transition({ userId: user.id, projectId: data.id }, "initialize", { document: preset });
      try {
        const thumbnail = await fetch(presetThumbnailUrl(presetId));
        if (thumbnail.ok) await admin().storage.from("project-thumbnails").upload(
          `${data.id}/cover.webp`,
          Buffer.from(await thumbnail.arrayBuffer()),
          { contentType: "image/webp", upsert: true, cacheControl: "300" },
        );
      } catch { /* A cover must never prevent the editable project copy. */ }
    } catch {
      return { error: "The project was created, but its preset could not be added. Open it from your workspace." };
    }
  }
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

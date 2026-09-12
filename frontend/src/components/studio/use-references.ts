"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Reference } from "@/lib/project-types";

export function useReferences(
  projectId: string,
  userId: string,
  initialReferences: Reference[],
) {
  const router = useRouter();
  const [references, setReferences] = useState(initialReferences);
  const [loaded, setLoaded] = useState(initialReferences);
  if (loaded !== initialReferences) {
    setLoaded(initialReferences);
    setReferences(initialReferences);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploading = useRef(false);
  async function addFiles(files: FileList | null) {
    if (!files || uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setError("");
    const supabase = createClient();
    let count = references.length;
    try {
      for (const file of Array.from(files)) {
        if (count >= 8) throw new Error("Use at most 8 reference images.");
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            file.type,
          ) ||
          file.size === 0 ||
          file.size > 20 * 1024 * 1024
        )
          throw new Error("Use PNG, JPEG, WebP, or GIF images up to 20 MB.");
        const id = crypto.randomUUID();
        const path = `${userId}/${projectId}/${id}`;
        const { error: uploadError } = await supabase.storage
          .from("references")
          .upload(path, file, { contentType: file.type });
        if (uploadError)
          throw new Error("Image upload failed. Please try again.");
        const { error: assetError } = await supabase
          .from("assets")
          .insert({
            id,
            project_id: projectId,
            name: file.name.slice(0, 255),
            storage_path: path,
            mime_type: file.type,
            size_bytes: file.size,
          });
        if (assetError) {
          await supabase.storage.from("references").remove([path]);
          throw new Error("Could not save the image. Please try again.");
        }
        const { data, error: urlError } = await supabase.storage
          .from("references")
          .createSignedUrl(path, 3600);
        if (urlError || !data) {
          router.refresh();
          throw new Error("Image saved. Reload to view it.");
        }
        setReferences((current) => [
          ...current,
          { id, name: file.name, url: data.signedUrl, type: file.type },
        ]);
        count++;
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not upload references.",
      );
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }
  async function removeReference(id: string) {
    if (uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setError("");
    try {
      const { error, data } = await createClient()
        .from("assets")
        .update({ archived: true })
        .eq("id", id)
        .eq("project_id", projectId)
        .select("id")
        .single();
      if (error || !data)
        throw new Error("Could not remove the reference. Please retry.");
      setReferences((items) => items.filter((item) => item.id !== id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not remove reference.",
      );
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  return { references, busy, error, setError, addFiles, removeReference };
}
export type ReferenceState = ReturnType<typeof useReferences>;

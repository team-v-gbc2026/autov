"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Reference } from "@/lib/project-types";
import { agentHeaders } from "@/lib/agent/client";
import { referenceName } from "./board/board-store";

export function useReferences(projectId: string, userId: string, initialReferences: Reference[]) {
  const router = useRouter();
  const [references, setReferences] = useState(initialReferences);
  const [loaded, setLoaded] = useState(initialReferences);
  if (loaded !== initialReferences) { setLoaded(initialReferences); setReferences(initialReferences); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const latest = useRef(references);
  // Updated by mutation handlers as well, so sequential uploads see each other.
  useEffect(() => { latest.current = references; }, [references]);

  async function reconcileAssets(assets: { id: string; name: string; storage_path: string; mime_type: string }[]) {
    const client = createClient();
    const next: Reference[] = [];
    for (const asset of assets) {
      const existing = latest.current.find(item => item.id === asset.id);
      if (existing) { next.push(existing); continue; }
      const { data, error } = await client.storage.from("references").createSignedUrl(asset.storage_path, 3600);
      if (error || !data) continue;
      next.push({ id: asset.id, name: asset.name, url: data.signedUrl, type: asset.mime_type });
    }
    if (lock.current) return;
    if (next.map(item => item.id).join() !== latest.current.map(item => item.id).join()) { latest.current = next; setReferences(next); }
  }
  async function requestImage(prompt: string, referenceId?: string) {
    if (lock.current) throw new Error("Wait for the current image operation to finish.");
    lock.current = true;
    try {
      const response = await fetch(`/api/references/${referenceId ? "edit" : "generate"}`, { method: "POST", headers: { ...await agentHeaders(projectId), "Content-Type": "application/json" }, body: JSON.stringify({ referenceId, prompt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not edit this image.");
      if (result.url) {
        latest.current = [...latest.current, result as Reference];
        setReferences(latest.current);
      } else router.refresh();
    } finally { lock.current = false; }
  }
  const editImage = (referenceId: string, prompt: string) => requestImage(prompt, referenceId);
  const generateImage = (prompt: string) => requestImage(prompt);
  async function uploadFile(file: File): Promise<Reference> {
    if (lock.current) throw new Error("Wait for the current upload to finish.");
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("Use PNG, JPEG, WebP or GIF images up to 20 MB.");
    lock.current = true; setBusy(true); setError("");
    const supabase = createClient();
    const id = crypto.randomUUID();
    const path = `${userId}/${projectId}/${id}`;
    try {
      const base = referenceName(file.name);
      let name = base; let suffix = 2;
      while (latest.current.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} ${suffix++}`;
      const { error: uploadError } = await supabase.storage.from("references").upload(path, file, { contentType: file.type });
      if (uploadError) throw new Error("Upload failed. Please retry.");
      const { data: signed, error: signedError } = await supabase.storage.from("references").createSignedUrl(path, 3600);
      if (signedError || !signed) {
        await supabase.storage.from("references").remove([path]);
        throw new Error("Could not prepare the image. Please retry.");
      }
      const { error: assetError } = await supabase.from("assets").insert({ id, project_id: projectId, name, storage_path: path, mime_type: file.type, size_bytes: file.size });
      if (assetError) {
        await supabase.storage.from("references").remove([path]);
        throw new Error("Could not save the image. Please retry.");
      }
      const reference = { id, name, url: signed.signedUrl, type: file.type };
      latest.current = [...latest.current, reference];
      setReferences(latest.current);
      return reference;
    } finally { lock.current = false; setBusy(false); }
  }
  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try { await uploadFile(file); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); }
    }
  }
  async function removeReference(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const { error, data } = await createClient().from("assets").update({ archived: true }).eq("id", id).eq("project_id", projectId).select("id").single();
      if (error || !data) throw new Error("Could not remove the reference.");
      latest.current = latest.current.filter(item => item.id !== id);
      setReferences(latest.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove reference."); }
    finally { lock.current = false; setBusy(false); }
  }
  return { generateImage, editImage, reconcileAssets, references, busy, error, setError, addFiles, uploadFile, removeReference, refresh: () => router.refresh() };
}
export type ReferenceState = Omit<ReturnType<typeof useReferences>, "reconcileAssets" | "editImage" | "generateImage"> & { generateImage?: ReturnType<typeof useReferences>["generateImage"]; editImage?: ReturnType<typeof useReferences>["editImage"]; reconcileAssets?: ReturnType<typeof useReferences>["reconcileAssets"] };

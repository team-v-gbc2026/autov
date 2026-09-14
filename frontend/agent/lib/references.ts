import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContent } from "ai";
import sharp from "sharp";
import { encodeMention } from "../../src/components/studio/composer/prompt-format";
import { ChatError } from "./contracts";
import { ReferenceImageCache } from "./reference-image-cache";

const imageCache = new ReferenceImageCache();

export async function referenceParts(client: SupabaseClient, projectId: string, ids: string[]): Promise<Exclude<UserContent, string>> {
  if (!ids.length) return [];
  const { data, error } = await client.from("assets").select("id,name,storage_path,mime_type,size_bytes").eq("project_id", projectId).eq("archived", false).in("id", ids);
  if (error) throw new ChatError("REFERENCES_UNAVAILABLE", "Could not load reference images.", 503);
  if (data.length !== ids.length) throw new ChatError("INVALID_REFERENCES", "One or more references are no longer available in this project.");
  const parts: Exclude<UserContent, string> = [];
  // Sequential decoding bounds peak memory for eight large uploads.
  for (const id of ids) {
    const asset = data.find(item => item.id === id)!;
    // Board uploads have unique paths. Metadata is rechecked above even on cache hits.
    const cacheKey = JSON.stringify([process.env.NEXT_PUBLIC_SUPABASE_URL, projectId, asset.id, asset.storage_path, asset.mime_type, asset.size_bytes]);
    let bytes = imageCache.get(cacheKey);
    if (!bytes) {
      const { data: blob, error } = await client.storage.from("references").download(asset.storage_path);
      if (error || !blob || blob.size > 20 * 1024 * 1024) throw new ChatError("REFERENCES_UNAVAILABLE", "Could not read a reference image. Try attaching it again.");
      try {
        bytes = await sharp(Buffer.from(await blob.arrayBuffer()), { limitInputPixels: 40_000_000, pages: 1 }).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      } catch { throw new ChatError("INVALID_IMAGE", `Could not decode reference “${asset.name}”. Try a smaller PNG or JPEG.`); }
      imageCache.set(cacheKey, bytes);
    }
    parts.push({ type: "text", text: `Reference: ${encodeMention(asset.id, asset.name)}${asset.mime_type === "image/gif" ? " (first frame only)" : ""}` });
    // Durable bytes rather than expiring signed URLs; later turns can reuse the image.
    parts.push({ type: "file", mediaType: "image/jpeg", filename: `${asset.name}.jpg`, data: `data:image/jpeg;base64,${bytes.toString("base64")}` });
  }
  return parts;
}

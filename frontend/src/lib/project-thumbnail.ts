import { createClient } from "@/lib/supabase/client";

/** Crop a clean effect frame from the already-rendered v2 contact sheet. */
export async function saveProjectThumbnail(projectId: string, sheet: string) {
  const image = new Image();
  image.src = sheet;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 270;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Thumbnail capture unavailable.");
  // First tile on the second row: post-impact, without the timestamp strip.
  context.drawImage(image, 0, 382, 640, 360, 0, 0, 480, 270);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(value => value ? resolve(value) : reject(new Error("Thumbnail encoding failed.")), "image/webp", .84),
  );
  const { error } = await createClient().storage
    .from("project-thumbnails")
    .upload(`${projectId}/cover.webp`, blob, { contentType: "image/webp", upsert: true, cacheControl: "300" });
  if (error) throw error;
}

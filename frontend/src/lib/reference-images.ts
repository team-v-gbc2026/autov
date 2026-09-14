import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { z } from "zod";
import { authorizeProject } from "../../agent/lib/database";
import { ChatError, responseError } from "../../agent/lib/contracts";

const inputSchema = z.object({ referenceId: z.string().uuid().optional(), prompt: z.string().trim().min(1).max(2000) }).strict();

export async function handleReferenceImage(request: Request, editing: boolean) {
  try {
    const { client, project, userId } = await authorizeProject(request);
    const body = await request.text();
    if (body.length > 12000) throw new ChatError("INVALID_BODY", "Image prompt is too long.", 400);
    const parsed = inputSchema.safeParse(JSON.parse(body));
    if (!parsed.success) throw new ChatError("INVALID_BODY", "Describe your image in 1–2000 characters.", 400);
    const { referenceId } = parsed.data;
    if (editing !== Boolean(referenceId)) throw new ChatError("INVALID_BODY", editing ? "Choose a reference to edit." : "New images require only a prompt.", 400);
    const result = await createReferenceImage(client, project.id, userId, parsed.data, request.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid image edit request." }, { status: 400 });
    if (error instanceof OpenAI.APIError) return Response.json({ error: error.status === 429 ? "Image generation is busy or your API quota is exhausted. Try again later." : "Image generation failed. Check that your OpenAI project has image-model access." }, { status: 502 });
    return responseError(error);
  }
}

/** Shared board-image operation used by HTTP and Eve; caller supplies verified identity. */
export async function createReferenceImage(client: SupabaseClient, projectId: string, userId: string,
  input: z.infer<typeof inputSchema>, signal: AbortSignal) {
  const { prompt, referenceId } = inputSchema.parse(input);
  signal.throwIfAborted();
    let asset: { name: string; storage_path: string } | null = null;
    let bytes: Buffer | undefined;
    if (referenceId) {
    const { data: sourceAsset, error } = await client.from("assets").select("id,name,storage_path")
      .eq("project_id", projectId).eq("id", referenceId).eq("archived", false).single();
    if (error || !sourceAsset) throw new ChatError("INVALID_REFERENCE", "This reference is no longer available in your project.", 404);
    asset = sourceAsset;
    if (!process.env.OPENAI_API_KEY) throw new ChatError("NOT_CONFIGURED", "Set OPENAI_API_KEY on the server to edit images.", 503);
    const { data: source, error: downloadError } = await client.storage.from("references").download(asset.storage_path);
    if (downloadError || !source || source.size > 20 * 1024 * 1024) throw new ChatError("INVALID_IMAGE", "Could not read the reference image.", 400);
    bytes = await sharp(Buffer.from(await source.arrayBuffer()), { limitInputPixels: 40_000_000, pages: 1 }).rotate().png().toBuffer();
    }
    if (!process.env.OPENAI_API_KEY) throw new ChatError("NOT_CONFIGURED", "Set OPENAI_API_KEY on the server to generate images.", 503);
    const provider = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 150_000 });
    const result = bytes ? await provider.images.edit({
      model: "gpt-image-1.5", image: await toFile(bytes, "reference.png", { type: "image/png" }),
      prompt, n: 1, size: "1024x1024", quality: "medium", output_format: "png",
    }, { signal: signal }) : await provider.images.generate({
      model: "gpt-image-1.5", prompt, n: 1, size: "1024x1024", quality: "medium", output_format: "png",
    }, { signal: signal });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new ChatError("IMAGE_EDIT_FAILED", "The image provider did not return an image.", 502);
    signal.throwIfAborted();
    const png = await sharp(Buffer.from(encoded, "base64"), { limitInputPixels: 16_000_000 }).png().toBuffer();
    const id = crypto.randomUUID(), path = `${userId}/${projectId}/${id}`;
    const name = asset ? `${asset.name.slice(0, 40)} · edited` : prompt.replace(/\s+/g, " ").slice(0, 50);
    const { error: uploadError } = await client.storage.from("references").upload(path, png, { contentType: "image/png" });
    if (uploadError) throw new ChatError("SAVE_FAILED", "Could not save the image.", 503);
    const { error: insertError } = await client.from("assets").insert({ id, project_id: projectId, name, storage_path: path, mime_type: "image/png", size_bytes: png.length });
    if (insertError) {
      await client.storage.from("references").remove([path]);
      throw new ChatError("SAVE_FAILED", "Could not add the image to your board.", 503);
    }
    const { data: signed } = await client.storage.from("references").createSignedUrl(path, 3600);
    return { id, name, type: "image/png", url: signed?.signedUrl ?? null };
}

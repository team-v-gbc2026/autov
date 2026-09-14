import sharp from "sharp";
import workflowTemplate from "@/lib/vfx-lab/workflows/triposplat_image_to_splat.json";
import OpenAI, { toFile } from "openai";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR, reserveUsd, settleUsd } from "@/lib/vfx-lab/budget";
import { getKey, isLocalRequest } from "@/lib/vfx-lab/server";

export const runtime = "nodejs";
export const maxDuration = 900;

const RequestSchema = z.object({
  reference: z.string().max(28_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/).optional(),
  cleanImage: z.string().max(28_000_000).optional(),
  cleanId: z.string().uuid().optional(),
  adjustment: z.string().max(2000).optional(),
  stage: z.enum(["clean", "import", "splat"]).default("clean"),
  comfyUrl: z.string().url().default(process.env.COMFYUI_URL || "http://127.0.0.1:8188"),
}).strict().refine(body => {
  if (body.stage === "import") return !!body.cleanImage && !body.reference && !body.cleanId && !body.adjustment;
  if (body.stage === "splat") return !!body.cleanId && !body.reference && !body.cleanImage;
  return !!body.reference && !body.cleanId && !body.cleanImage;
}, "Provide a reference for cleanup, a cleanImage for import, or a cleanId for reconstruction.");

class InvalidImageError extends Error {}

async function decodeCleanUpload(data: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new InvalidImageError("Choose a valid PNG, JPEG, or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.toString("base64") !== match[2])
    throw new InvalidImageError("Image must contain valid base64 data and be at most 20 MB.");
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== match[1] || (metadata.pages || 1) > 1)
      throw new Error("Unexpected format or animated image.");
    // Decode fully, normalize orientation, and remove metadata without resizing.
    return await image.rotate().png().toBuffer();
  } catch {
    throw new InvalidImageError("Image could not be decoded. Use a still PNG, JPEG, or WebP up to 40 megapixels.");
  }
}

const cleanPrompt = `Edit this reference image into a clean reconstruction for single-image 3D reconstruction. Remove the visible VFX/effect, glow, sparks, smoke, streaks, particles, overlays, and post-processing that obscure the underlying subject or environment. Preserve the camera viewpoint, framing, geometry, proportions, materials, colors, lighting direction, shadows, and background as faithfully as possible. Fill removed regions plausibly and seamlessly. Preserve the original visual style and medium, including illustration, stylized rendering, brushwork, and texture. Preserve the original aspect ratio without cropping or reframing. Do not convert stylized artwork into a photograph. Output one clean image, no added text, no watermark, no extra objects.`;

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

function imageFile(data: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(data);
  if (!match) throw new Error("Invalid reference image.");
  return toFile(Buffer.from(match[2], "base64"), `reference.${match[1]}`, {
    type: `image/${match[1]}`,
  });
}

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const splatDir = path.join(DATA_DIR, "splats");
const cleanUrl = (id: string) => `/api/local-splat?id=${id}&kind=clean`;
const expectedTurntableFrames = 48;
const frameName = (index: number) => `frame-${String(index + 1).padStart(3, "0")}.png`;

async function preflight(comfyUrl: string, signal: AbortSignal): Promise<Workflow> {
  // A static import bundles the workflow with the route, including deployments.
  const workflow: Workflow = structuredClone(workflowTemplate);
  if (workflow["1"]?.class_type !== "LoadImage" || !workflow["1"].inputs)
    throw new Error("TripoSplat workflow is missing its image input node.");
  let nodes: Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>;
  try {
    const response = await fetch(`${comfyUrl}/object_info`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (!response.ok) throw new Error(`ComfyUI prerequisite check failed (${response.status}).`);
    nodes = await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw new Error("ComfyUI setup check timed out. No image cleanup or reconstruction was started. Check the GPU connection and retry.");
    throw error;
  }
  for (const node of Object.values(workflow)) {
    const definition = nodes[node.class_type];
    if (!definition) throw new Error(`ComfyUI is missing required node: ${node.class_type}.`);
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) || (node.class_type === "LoadImage" && key === "image")) continue; // graph link or request-populated input
      // Comfy advertises installed model filenames and supported enum values.
      const choices = (definition.input?.required?.[key] ?? definition.input?.optional?.[key])?.[0];
      if (Array.isArray(choices) && !choices.includes(value))
        throw new Error(`ComfyUI prerequisite unavailable: ${node.class_type}.${key} = ${value}.`);
      if (["clip_name", "vae_name", "unet_name"].includes(key) && !Array.isArray(choices))
        throw new Error(`ComfyUI did not advertise installed models for ${node.class_type}.${key}.`);
    }
  }
  await mkdir(splatDir, { recursive: true, mode: 0o700 });
  return workflow;
}

async function queueSplat(cleanPng: Buffer, comfyUrl: string, signal: AbortSignal, workflow: Workflow) {
  // Square preparation belongs only to reconstruction. Letterbox without
  // stretching/cropping; the saved clean image retains its original framing.
  const square = await sharp(cleanPng).resize(1024, 1024, {
    fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  const upload = new FormData();
  upload.append("image", new Blob([new Uint8Array(square)], { type: "image/png" }), `autov-clean-${randomUUID()}.png`);
  upload.append("overwrite", "false");
  const uploaded = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: upload, signal });
  if (!uploaded.ok) throw new Error(`ComfyUI image upload failed (${uploaded.status}).`);
  const uploadedBody = (await uploaded.json()) as { name?: string; subfolder?: string };
  if (!uploadedBody.name) throw new Error("ComfyUI did not return an uploaded image name.");
  workflow["1"].inputs.image = uploadedBody.subfolder
    ? `${uploadedBody.subfolder}/${uploadedBody.name}` : uploadedBody.name;

  const prompt = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
    signal,
  });
  if (!prompt.ok) {
    const detail = await prompt.text();
    throw new Error(`ComfyUI rejected the workflow (${prompt.status}): ${detail.slice(0, 500)}`);
  }
  const queued = (await prompt.json()) as { prompt_id?: string };
  if (!queued.prompt_id) throw new Error("ComfyUI did not return a prompt id.");

  const deadline = Date.now() + 12 * 60 * 1000;
  let history: Record<string, { outputs?: Record<string, unknown> }> | null = null;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await fetch(`${comfyUrl}/history/${encodeURIComponent(queued.prompt_id)}`, { signal });
    if (result.ok) {
      const body = (await result.json()) as Record<string, { outputs?: Record<string, unknown> }>;
      if (body[queued.prompt_id]) { history = body; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!history) throw new Error("Timed out waiting for ComfyUI to finish the TripoSplat workflow.");

  const files: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if ("filename" in value && typeof (value as { filename?: unknown }).filename === "string")
      files.push(value as { filename: string; subfolder?: string; type?: string });
    for (const child of Object.values(value as Record<string, unknown>)) walk(child);
  };
  walk(history[queued.prompt_id]);
  const file = files.find((item) => /\.ply$/i.test(item.filename));
  if (!file) throw new Error("ComfyUI completed, but the workflow did not emit a .ply Gaussian splat.");
  const view = async (item: { filename: string; subfolder?: string; type?: string }) => {
    const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" });
    const asset = await fetch(`${comfyUrl}/view?${params}`, { signal });
    if (!asset.ok) throw new Error(`ComfyUI asset download failed (${asset.status}).`);
    return Buffer.from(await asset.arrayBuffer());
  };
  const ply = await view(file);
  // SaveImage receives only RenderSplat's output in this workflow. Restrict by
  // its fixed prefix so input images and the PLY are never treated as frames.
  const frames = files
    .filter((item) => /^triposplat_turntable(?:_|\.)/i.test(path.basename(item.filename)) && /\.png$/i.test(item.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
  const snapshots: Array<{ data?: Buffer; source: typeof frames[number]; error?: string }> = [];
  for (const snapshot of frames) {
    try { snapshots.push({ source: snapshot, data: await view(snapshot) }); }
    catch (error) { snapshots.push({ source: snapshot, error: error instanceof Error ? error.message : "Download failed." }); }
  }
  return { ply, snapshots };
}

async function saveSnapshots(id: string, snapshots: Array<{ data?: Buffer; error?: string }>) {
  const frameDir = path.join(splatDir, id, "frames");
  const paths: string[] = [];
  const failures: string[] = [];
  try { await mkdir(frameDir, { recursive: true, mode: 0o700 }); }
  catch (error) { return { paths, failures: [`Could not create turntable frame directory: ${error instanceof Error ? error.message : "storage failed."}`] }; }
  for (const [index, snapshot] of snapshots.entries()) {
    const name = frameName(index);
    if (!snapshot.data) { failures.push(`${name}: ${snapshot.error || "download failed."}`); continue; }
    try {
      await writeFile(path.join(frameDir, name), snapshot.data, { mode: 0o600, flag: "wx" });
      paths.push(`/api/local-splat?id=${id}&kind=frame&frame=${name}`);
    } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : "storage failed."}`); }
  }
  return { paths, failures };
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return json({ error: "Local same-origin access only." }, 403);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14 * 60 * 1000);
  let cleanId: string | undefined;
  try {
    const body = RequestSchema.parse(await request.json());
    if (body.stage === "import") {
      // Import is entirely local and does not require OpenAI or ComfyUI.
      const png = await decodeCleanUpload(body.cleanImage!);
      await mkdir(splatDir, { recursive: true, mode: 0o700 });
      const id = randomUUID();
      await writeFile(path.join(splatDir, `${id}.png`), png, { mode: 0o600, flag: "wx" });
      return json({ cleanId: id, cleanImage: cleanUrl(id) });
    }
    const comfy = new URL(body.comfyUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(comfy.hostname))
      return json({ error: "ComfyUI must be running on localhost." }, 400);
    const comfyUrl = body.comfyUrl.replace(/\/$/, "");
    // All known reconstruction prerequisites must pass before spending on edits.
    const workflow = await preflight(comfyUrl, controller.signal);
    let cleanPng: Buffer;
    if (body.cleanId) {
      cleanPng = await readFile(path.join(splatDir, `${body.cleanId}.png`));
      cleanId = body.cleanId;
    } else {
      const reference = Buffer.from(body.reference!.split(",")[1], "base64");
      const oriented = await sharp(reference).rotate().toBuffer();
      const dimensions = await sharp(oriented).metadata();
      if (!dimensions.width || !dimensions.height) throw new Error("Could not read reference dimensions.");
      const apiKey = await getKey();
      if (!apiKey) return json({ error: "OpenAI API key is not configured." }, 503);
      const reservation = await reserveUsd(2, 20_000, 1_000);
      const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
      const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 });
      let response;
      try {
        response = await client.images.edit({ model,
          prompt: `${cleanPrompt} The reference framing is ${dimensions.width} by ${dimensions.height}; retain that aspect ratio.${body.adjustment ? ` Additional cleanup request: ${body.adjustment}` : ""}`,
          image: await imageFile(body.reference!), size: "auto", quality: "medium", output_format: "png",
        }, { signal: controller.signal });
      } catch (error) {
        if (error instanceof OpenAI.APIError && [400, 401, 403, 404, 422].includes(error.status || 0)) await settleUsd(reservation, 0);
        throw error;
      }
      try {
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) throw new Error("OpenAI image generation returned no clean image.");
        cleanPng = await sharp(Buffer.from(b64, "base64")).resize(dimensions.width, dimensions.height, {
          fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 },
        }).png().toBuffer();
        const id = randomUUID();
        await writeFile(path.join(splatDir, `${id}.png`), cleanPng, { mode: 0o600 });
        cleanId = id; // only advertise an artifact that was durably written
      } finally {
        // Settle the successful paid stage even if decoding/storage fails.
        // Persist first so an accounting failure cannot discard a valid image.
        await settleUsd(reservation, response.usage ? ((response.usage.input_tokens_details.image_tokens * 8 + response.usage.output_tokens * 30) / 1e6) : 2, response.usage?.input_tokens, response.usage?.output_tokens);
      }
    }
    if (body.stage === "clean") return json({ cleanId, cleanImage: cleanUrl(cleanId) });
    const splat = await queueSplat(cleanPng, comfyUrl, controller.signal, workflow);
    const id = randomUUID();
    await writeFile(path.join(splatDir, `${id}.ply`), splat.ply, { mode: 0o600 });
    const savedFrames = await saveSnapshots(id, splat.snapshots);
    const expected = expectedTurntableFrames;
    const complete = savedFrames.failures.length === 0 && savedFrames.paths.length === expected;
    const turntable = {
      expected, downloaded: savedFrames.paths.length, complete,
      paths: savedFrames.paths,
      ...(complete ? {} : { warning: `Turntable snapshots are incomplete: downloaded ${savedFrames.paths.length} of ${expected} frames.`, failures: savedFrames.failures }),
    };
    return json({ id, cleanId, splatUrl: `/api/local-splat?id=${id}`, cleanImage: cleanUrl(cleanId), turntable });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Splat generation failed.",
      ...(cleanId ? { cleanId, cleanImage: cleanUrl(cleanId) } : {}),
    }, error instanceof z.ZodError || error instanceof InvalidImageError || error instanceof SyntaxError ? 400 : 500);
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return new Response("Local access only.", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return new Response("Not found.", { status: 404 });
  const kind = url.searchParams.get("kind");
  const clean = kind === "clean";
  if (kind === "frame") {
    const frame = url.searchParams.get("frame");
    if (!frame || !/^frame-\d{3}\.png$/.test(frame)) return new Response("Not found.", { status: 404 });
    try {
      const file = await readFile(path.join(splatDir, id, "frames", frame));
      return new Response(file, { headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename="${frame}"`, "Cache-Control": "no-store" } });
    } catch { return new Response("Not found.", { status: 404 }); }
  }
  const extension = clean ? "png" : "ply";
  try {
    const file = await readFile(path.join(splatDir, `${id}.${extension}`));
    return new Response(file, { headers: { "Content-Type": clean ? "image/png" : "application/octet-stream", "Content-Disposition": `inline; filename="${id}.${extension}"`, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}

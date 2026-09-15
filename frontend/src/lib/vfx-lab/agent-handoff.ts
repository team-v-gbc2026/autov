import { VfxRuntimeV2 } from "./runtime-v2";
import { VFX_AUTHORING_GUIDE_V2 } from "./protocol-v2";
import { captureTimesV2 } from "./capture-v2";
import type { VfxDocumentV2 } from "./schema-v2";

export type HandoffOptions = {
  clipFps?: number;
  clipWidth?: number;
  clipHeight?: number;
  /** Board reference images mentioned while building this effect. */
  references?: { id: string; name: string; url: string }[];
  onProgress?: (status: string, pct: number) => void;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
function extensionFor(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType.split(";")[0].trim()] ?? null;
}
function nameExtension(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

export type HandoffBundle = {
  files: { name: string; blob: Blob }[];
  readme: string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal store-only (uncompressed) ZIP writer — enough structure for any
 * standard unzip tool to open it, no external dependency. The bundle's own
 * files (JPEG/WebM/JSON/text) don't compress meaningfully anyway. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const dosTime = 0,
    dosDate = 0x21; // arbitrary fixed timestamp (2000-01-01) — not meaningful for a one-off export

  for (const { name, blob } of files) {
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, data);

    const centralEntry = new DataView(new ArrayBuffer(46));
    centralEntry.setUint32(0, 0x02014b50, true);
    centralEntry.setUint16(4, 20, true);
    centralEntry.setUint16(6, 20, true);
    centralEntry.setUint16(8, 0, true);
    centralEntry.setUint16(10, 0, true);
    centralEntry.setUint16(12, dosTime, true);
    centralEntry.setUint16(14, dosDate, true);
    centralEntry.setUint32(16, crc, true);
    centralEntry.setUint32(20, data.length, true);
    centralEntry.setUint32(24, data.length, true);
    centralEntry.setUint16(28, nameBytes.length, true);
    centralEntry.setUint16(30, 0, true);
    centralEntry.setUint16(32, 0, true);
    centralEntry.setUint16(34, 0, true);
    centralEntry.setUint16(36, 0, true);
    centralEntry.setUint32(38, 0, true);
    centralEntry.setUint32(42, offset, true);
    central.push(centralEntry.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce(
    (sum, part) => sum + (part instanceof ArrayBuffer ? part.byteLength : (part as Uint8Array).byteLength),
    0,
  );
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...parts, ...central, eocd.buffer], { type: "application/zip" });
}

/**
 * Packages an autov.lab/2 document for handoff to a DIFFERENT agent (in
 * another tool, another engine) to rebuild natively — rather than us baking
 * or converting the effect ourselves. The bundle gives that agent everything
 * a human VFX artist would want before starting: the exact parameters (the
 * document itself), what the schema's vocabulary means (the existing
 * authoring guide, already written for exactly this kind of consumption),
 * why it looks the way it does (the document's own `description`, already
 * populated with rich art-direction prose), and what it actually looks like
 * in motion and at rest (a short clip + a still).
 */
export async function buildAgentHandoffBundle(
  doc: VfxDocumentV2,
  options: HandoffOptions = {},
): Promise<HandoffBundle> {
  const report = (status: string, pct: number) => options.onProgress?.(status, pct);
  const fps = options.clipFps ?? 24;
  const width = options.clipWidth ?? 640;
  const height = options.clipHeight ?? 360;

  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:1px;height:1px;pointer-events:none";
  document.body.appendChild(host);
  const runtime = new VfxRuntimeV2(host);
  runtime.setInteractive(false);

  const files: HandoffBundle["files"] = [];
  try {
    report("Preparing renderer", 0.02);
    await runtime.whenReady();
    runtime.setDocument(doc);
    runtime.resize(width, height);
    runtime.render(0);

    files.push({
      name: "document.json",
      blob: new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
    });
    files.push({
      name: "schema-guide.txt",
      blob: new Blob([VFX_AUTHORING_GUIDE_V2], { type: "text/plain" }),
    });

    if (options.references?.length) {
      report("Collecting board references", 0.06);
      for (const [i, reference] of options.references.entries()) {
        try {
          const response = await fetch(reference.url);
          if (!response.ok) continue;
          const blob = await response.blob();
          const extension = extensionFor(blob.type) ?? nameExtension(reference.name) ?? "bin";
          const safeName =
            reference.name
              .toLowerCase()
              .replaceAll(" ", "-")
              .replace(/[^a-z0-9-]+/g, "-")
              .replace(/^-+|-+$/g, "") || "reference";
          files.push({ name: `reference-${String(i).padStart(2, "0")}-${safeName}.${extension}`, blob });
        } catch {
          // A single unreachable reference should not block the rest of the export.
        }
      }
    }

    report("Capturing reference stills", 0.1);
    const stillTimes = captureTimesV2(doc, 6);
    for (const [i, time] of stillTimes.entries()) {
      runtime.render(time);
      const canvas = runtime.renderer.domElement;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (blob)
        files.push({ name: `still-${String(i).padStart(2, "0")}-t${time.toFixed(2)}s.jpg`, blob });
      report(`Capturing reference stills (${i + 1}/${stillTimes.length})`, 0.1 + 0.2 * ((i + 1) / stillTimes.length));
    }

    report("Recording motion clip", 0.35);
    const clipBlob = await recordClip(runtime, doc, fps, (pct) =>
      report("Recording motion clip", 0.35 + 0.5 * pct),
    );
    if (clipBlob) files.push({ name: "clip.webm", blob: clipBlob });

    const readme = buildReadme(doc, files.map((f) => f.name));
    files.push({ name: "README.md", blob: new Blob([readme], { type: "text/markdown" }) });

    report("Done", 1);
    return { files, readme };
  } finally {
    await runtime.dispose();
    host.remove();
  }
}

/** Records one loop of the document via MediaRecorder on the runtime's own
 * canvas stream — real rendered frames, not a re-derived approximation, same
 * as how a screen recording would capture the live preview. WebM/VP9 is the
 * broadly-supported target; falls back to whatever codec the browser offers,
 * or skips the clip (still + JSON + guide remain) if canvas capture streams
 * or MediaRecorder are unavailable in this environment. */
async function recordClip(
  runtime: VfxRuntimeV2,
  doc: VfxDocumentV2,
  fps: number,
  onProgress: (pct: number) => void,
): Promise<Blob | null> {
  const canvas = runtime.renderer.domElement as HTMLCanvasElement & {
    captureStream?: (fps?: number) => MediaStream;
  };
  if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined")
    return null;

  const stream = canvas.captureStream(fps);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported?.(type),
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start();

  const frameCount = Math.max(1, Math.ceil(doc.duration * fps));
  const frameMs = 1000 / fps;
  for (let f = 0; f < frameCount; f++) {
    runtime.render(Math.min(doc.duration, f / fps));
    onProgress(f / frameCount);
    await new Promise((resolve) => setTimeout(resolve, frameMs));
  }
  recorder.stop();
  await stopped;

  return chunks.length ? new Blob(chunks, { type: mimeType ?? "video/webm" }) : null;
}

function buildReadme(doc: VfxDocumentV2, fileNames: string[]): string {
  return `# ${doc.name} — agent handoff bundle

This effect was authored in autoV as a declarative \`autov.lab/2\` document and rendered by a fixed Three.js/WebGPU runtime — \`state = f(document, time, seed)\`. It is not baked geometry or a video; it's parameters.

If you are an AI agent asked to rebuild this effect in a different tool or engine (Unity, Godot, Blender, a game's own particle system, etc.), use the files here in this order:

1. **document.json** — the exact, complete parameters: every layer, emitter, material, curve, camera and post-processing setting. This is ground truth for numbers (positions, counts, colors, timing).
2. **schema-guide.txt** — explains what those parameters MEAN (layer kinds, curve formulas, material fields, ramp spaces, etc.) so you can read document.json correctly rather than guessing at field semantics.
3. **reference-*** (if present) — the original board images the artist referenced while directing this effect. These are source inspiration, not renders of the effect itself.
4. **still-*.jpg** — rendered reference frames at key moments (see filename for the timestamp in seconds), showing what the effect actually looks like, not just its numbers.
5. **clip.webm** (if present) — a short recorded loop of the effect in motion. Motion, timing and choreography are often the point of a VFX effect and don't show in stills — use this to judge pacing, easing and the overall "feel," not just individual poses.

The document's own \`description\` field (inside document.json) is a human-written art-direction brief for this specific effect — read it first, it explains intent that the raw parameters alone won't convey.

Rebuild for your target using your own judgment and your own tools — this bundle is context, not a literal format to import. Files in this bundle: ${fileNames.join(", ")}.
`;
}

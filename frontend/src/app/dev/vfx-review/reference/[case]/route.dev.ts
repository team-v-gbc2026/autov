import fs from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { FAMILY_REFERENCES } from "../../families";

// Streams a benchmark reference asset for one vfx-review family:
//   GET /dev/vfx-review/reference/<familyId>
// where <familyId> is a key of FAMILY_REFERENCES (e.g. "fire-projectile").
// Serves the mapped video (references/videos/<file>.mp4) or, for the one
// image-only family (shield), the mapped jpg from inputs/cases/<caseId>/.
//
// Path-safe by construction: the route only ever reads a path built from a
// hard-coded lookup table in families.ts, never from the request directly —
// an unknown segment 404s before touching the filesystem.
//
// Range requests are supported for video so the <video> element can seek.

const BENCHMARK_ROOT = path.join(
  process.cwd(),
  "..",
  "..",
  "benchmark-verified-2026-09-13",
);

function assetPath(familyId: string): { filePath: string; contentType: string } | null {
  const ref = FAMILY_REFERENCES[familyId];
  if (!ref) return null;
  if (ref.kind === "video") {
    return {
      filePath: path.join(BENCHMARK_ROOT, "references", "videos", `${ref.file}.mp4`),
      contentType: "video/mp4",
    };
  }
  return {
    filePath: path.join(BENCHMARK_ROOT, "inputs", "cases", ref.caseId, `${ref.file}.jpg`),
    contentType: "image/jpeg",
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ case: string }> },
) {
  const { case: familyId } = await context.params;
  const asset = assetPath(familyId);
  if (!asset) return new Response("not found", { status: 404 });

  let size: number;
  try {
    size = (await stat(asset.filePath)).size;
  } catch {
    return new Response("not found", { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    "content-type": asset.contentType,
    "accept-ranges": "bytes",
  };

  const range = request.headers.get("range");
  if (!range) {
    const nodeStream = fs.createReadStream(asset.filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: { ...baseHeaders, "content-length": String(size) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    return new Response("invalid range", {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${size}` },
    });
  }
  const [, startStr, endStr] = match;
  let start = startStr ? Number(startStr) : 0;
  let end = endStr ? Number(endStr) : size - 1;
  if (!startStr && endStr) {
    // Suffix range: "bytes=-500" means the last 500 bytes.
    start = Math.max(0, size - Number(endStr));
    end = size - 1;
  }
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    start < 0 ||
    end >= size
  ) {
    return new Response("invalid range", {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${size}` },
    });
  }

  const nodeStream = fs.createReadStream(asset.filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(webStream, {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${size}`,
    },
  });
}

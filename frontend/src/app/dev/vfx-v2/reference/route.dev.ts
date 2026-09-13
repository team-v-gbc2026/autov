import { readFile } from "node:fs/promises";
import path from "node:path";

// Streams a benchmark case's reference image for the vfx-v2 dev gallery:
//   GET /dev/vfx-v2/reference?case=<id>&n=1
// serving <frontend>/../../benchmark-verified-2026-09-13/inputs/cases/<case>/reference-0<n>.jpg
//
// Path-safe by construction: case must match [a-z0-9-]+ and n must be 1, 2
// or 3 — anything else (including any path-traversal attempt) 404s before
// touching the filesystem.

const CASE_RE = /^[a-z0-9-]+$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case") ?? "";
  const n = url.searchParams.get("n") ?? "";

  if (!CASE_RE.test(caseId) || !["1", "2", "3"].includes(n)) {
    return new Response("not found", { status: 404 });
  }

  const filePath = path.join(
    process.cwd(),
    "..",
    "..",
    "benchmark-verified-2026-09-13",
    "inputs",
    "cases",
    caseId,
    `reference-0${n}.jpg`,
  );

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return new Response("not found", { status: 404 });
  }

  // Buffer satisfies BodyInit at runtime (Node's Response accepts it); the
  // exact BodyInit union picked up here doesn't structurally match it, same
  // as it wouldn't for any Buffer under this lib config.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

import fs from "node:fs";
import path from "node:path";

// Streams a benchmark case's prompt text for the vfx-v2 dev gallery:
//   GET /dev/vfx-v2/reference/prompt?case=<id>
// serving <frontend>/../../benchmark-verified-2026-09-13/inputs/cases/<case>/prompt.txt
//
// Path-safe by construction: case must match [a-z0-9-]+ — anything else
// (including any path-traversal attempt) 404s before touching the
// filesystem.

const CASE_RE = /^[a-z0-9-]+$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case") ?? "";

  if (!CASE_RE.test(caseId)) {
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
    "prompt.txt",
  );

  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return new Response("not found", { status: 404 });
  }

  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

import { readFile } from "node:fs/promises";
import path from "node:path";

// Streams a generated benchmark run's contact sheet for the vfx-review page:
//   GET /dev/vfx-review/contact-sheet/<run>/<case>
// serving <dataDir>/benchmarks/<run>/<case>/contact-sheet.jpg
//
// Path-safe by construction, same allow-list pattern as ../../reference/[case]/
// route.dev.ts: both segments must match [a-z0-9-]+ — anything else
// (including any path-traversal attempt) 404s before touching the
// filesystem — and the resulting path only ever resolves under
// .autov-local/benchmarks/ (or AUTOV_DATA_DIR/benchmarks/), never outside it.

const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

function resolveDataDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.AUTOV_DATA_DIR ||
      path.join(process.cwd(), ".autov-local"),
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ run: string; case: string }> },
) {
  const { run, case: caseId } = await context.params;

  if (!SEGMENT_RE.test(run) || !SEGMENT_RE.test(caseId)) {
    return new Response("not found", { status: 404 });
  }

  const filePath = path.join(resolveDataDir(), "benchmarks", run, caseId, "contact-sheet.jpg");

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

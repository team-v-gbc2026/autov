import fs from "node:fs";
import path from "node:path";

// Lists fixtures/v2/<id>/document.json for the vfx-v2 dev gallery.
// A fixture may also carry a sibling fixtures/v2/<id>/v1.json — the same
// effect authored in the v1 (autov.lab/1) schema, used to render a
// side-by-side v1 comparison. When it's absent, v1Document is null and the
// gallery shows "no v1 counterpart" instead of a second viewport.
//
// Fixtures don't exist yet in this checkout; that's expected. This route
// returns an empty list rather than failing so the gallery page can render
// its "no fixtures yet" state.

type FixtureEntry = {
  id: string;
  name: string;
  document: unknown;
  v1Document: unknown | null;
};

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function GET() {
  const fixturesRoot = path.join(process.cwd(), "fixtures", "v2");

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  } catch {
    return Response.json({ fixtures: [] satisfies FixtureEntry[] });
  }

  const fixtures: FixtureEntry[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(fixturesRoot, entry.name);
    const document = readJson(path.join(dir, "document.json"));
    if (document === null) continue;
    const v1Document = readJson(path.join(dir, "v1.json"));
    const name =
      typeof document === "object" &&
      document !== null &&
      "name" in document &&
      typeof (document as { name?: unknown }).name === "string"
        ? (document as { name: string }).name
        : entry.name;
    fixtures.push({ id: entry.name, name, document, v1Document });
  }

  return Response.json({ fixtures });
}

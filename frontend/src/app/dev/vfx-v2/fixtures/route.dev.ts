import fs from "node:fs";
import path from "node:path";
import {
  knownFixtureIds,
  loadFixtureDocument,
  readLocalFixtureJson,
} from "@/lib/vfx-lab/fixtures-server";

// Lists the v2 exemplar fixtures for the vfx-v2 dev gallery, plus
// every live-generated v2 result found under
// <AUTOV_DATA_DIR or .autov-local>/benchmarks/<runDir>/<case>/effect.json.
//
// A fixture may also carry a sibling fixtures/v2/<id>/v1.json — the same
// effect authored in the v1 (autov.lab/1) schema, used to render a
// side-by-side v1 comparison. When it's absent, v1Document is null and the
// gallery shows "no v1 counterpart" instead of a second viewport.
//
// Exemplar documents are read from the public vfx-fixtures bucket
// (v2/<id>/document.json) and fall back to the local fixtures/v2 copy when the
// fetch fails; v1.json counterparts are always read locally.
//
// Fixtures and generated runs may not exist yet in a given checkout; that's
// expected. This route tolerates either root being absent rather than
// failing, so the gallery page can render its "no fixtures yet" state.

type FixtureEntry = {
  id: string;
  name: string;
  document: unknown;
  v1Document: unknown | null;
  group: "exemplar" | "generated";
};

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function docName(document: unknown, fallback: string): string {
  return typeof document === "object" &&
    document !== null &&
    "name" in document &&
    typeof (document as { name?: unknown }).name === "string"
    ? (document as { name: string }).name
    : fallback;
}

// Same resolution as src/lib/vfx-lab/budget.ts: AUTOV_DATA_DIR overrides,
// otherwise <cwd>/.autov-local.
function resolveDataDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.AUTOV_DATA_DIR ||
      path.join(process.cwd(), ".autov-local"),
  );
}

async function listExemplarFixtures(): Promise<FixtureEntry[]> {
  const fixtures: FixtureEntry[] = [];
  for (const id of knownFixtureIds()) {
    const document = await loadFixtureDocument(id);
    if (document === null) continue;
    fixtures.push({
      id,
      name: docName(document, id),
      document,
      v1Document: readLocalFixtureJson(id, "v1.json"),
      group: "exemplar",
    });
  }
  return fixtures;
}

function mtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function listGeneratedFixtures(): FixtureEntry[] {
  const benchmarksRoot = path.join(resolveDataDir(), "benchmarks");

  let runDirs: fs.Dirent[] = [];
  try {
    runDirs = fs.readdirSync(benchmarksRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs = runDirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // Newest run first.
    .sort(
      (a, b) =>
        mtimeMs(path.join(benchmarksRoot, b)) -
        mtimeMs(path.join(benchmarksRoot, a)),
    );

  const fixtures: FixtureEntry[] = [];
  for (const runDir of runs) {
    const runPath = path.join(benchmarksRoot, runDir);
    let caseDirs: fs.Dirent[] = [];
    try {
      caseDirs = fs.readdirSync(runPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const caseDir of caseDirs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!caseDir.isDirectory()) continue;
      const caseId = caseDir.name;
      const document = readJson(path.join(runPath, caseId, "effect.json"));
      if (document === null) continue;
      const schemaVersion =
        typeof document === "object" &&
        document !== null &&
        "schemaVersion" in document
          ? (document as { schemaVersion?: unknown }).schemaVersion
          : undefined;
      if (schemaVersion !== "autov.lab/2") continue;
      const name = `${caseId} — ${docName(document, caseId)} (${runDir})`;
      fixtures.push({
        id: `${runDir}/${caseId}`,
        name,
        document,
        v1Document: null,
        group: "generated",
      });
    }
  }
  return fixtures;
}

export async function GET() {
  const fixtures = [
    ...(await listExemplarFixtures()),
    ...listGeneratedFixtures(),
  ];
  return Response.json({ fixtures });
}

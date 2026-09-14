import fs from "node:fs";
import path from "node:path";

// Lists locally generated v2 benchmark runs for the vfx-review "Generated"
// section, newest run first:
//   GET /dev/vfx-review/runs
// -> { runs: [{ run, commit, dirty, created, cases: [...] }] }
//
// This is metadata only (score, commit, contact-sheet presence) — the actual
// effect document for a generated entry is already served by the existing
// /dev/vfx-v2/fixtures route (which lists the same
// <dataDir>/benchmarks/<run>/<case>/effect.json files under
// id: "<run>/<case>", group: "generated"). The review page fetches both and
// merges them client-side rather than duplicating document loading here.
//
// Same tolerant-of-absence shape as fixtures/route.dev.ts: a run or case
// missing report.json / pipeline.json / contact-sheet.jpg just gets a null
// field instead of failing the whole listing.

type CaseEntry = {
  caseId: string;
  effectName: string | null;
  score: { average: number; breakdown: Record<string, number> } | null;
  hasContactSheet: boolean;
};

type RunEntry = {
  run: string;
  commit: string | null;
  dirty: boolean | null;
  created: string | null;
  cases: CaseEntry[];
};

// Same resolution as src/lib/vfx-lab/budget.ts and the vfx-v2 fixtures route:
// AUTOV_DATA_DIR overrides, otherwise <cwd>/.autov-local.
function resolveDataDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.AUTOV_DATA_DIR ||
      path.join(process.cwd(), ".autov-local"),
  );
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function docName(document: unknown): string | null {
  return typeof document === "object" &&
    document !== null &&
    "name" in document &&
    typeof (document as { name?: unknown }).name === "string"
    ? (document as { name: string }).name
    : null;
}

/**
 * Averages every numeric top-level field of a pipeline.json review object
 * (reviewV2's semantic/motion/hierarchy/detail/smoothness/beauty, or the
 * older review's semantic/motion/hierarchy/finish) — generic on purpose so
 * this doesn't need updating if the review schema grows another dimension.
 */
function scoreFromReview(review: unknown): { average: number; breakdown: Record<string, number> } | null {
  if (typeof review !== "object" || review === null) return null;
  const breakdown: Record<string, number> = {};
  for (const [key, value] of Object.entries(review as Record<string, unknown>)) {
    if (typeof value === "number") breakdown[key] = value;
  }
  const values = Object.values(breakdown);
  if (values.length === 0) return null;
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return { average, breakdown };
}

function readCommit(runPath: string): { commit: string | null; dirty: boolean | null; created: string | null } {
  const report = readJson(path.join(runPath, "report.json")) as
    | { commit?: unknown; dirty?: unknown; created?: unknown }
    | null;
  return {
    commit: typeof report?.commit === "string" ? report.commit : null,
    dirty: typeof report?.dirty === "boolean" ? report.dirty : null,
    created: typeof report?.created === "string" ? report.created : null,
  };
}

function readCaseEntry(runPath: string, caseId: string): CaseEntry | null {
  const casePath = path.join(runPath, caseId);
  const effect = readJson(path.join(casePath, "effect.json"));
  if (effect === null) return null;
  const schemaVersion =
    typeof effect === "object" && effect !== null && "schemaVersion" in effect
      ? (effect as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (schemaVersion !== "autov.lab/2") return null;

  const pipeline = readJson(path.join(casePath, "pipeline.json")) as
    | { selected?: { reviewV2?: unknown; review?: unknown } }
    | null;
  const review = pipeline?.selected?.reviewV2 ?? pipeline?.selected?.review ?? null;

  const hasContactSheet = fs.existsSync(path.join(casePath, "contact-sheet.jpg"));

  return {
    caseId,
    effectName: docName(effect),
    score: scoreFromReview(review),
    hasContactSheet,
  };
}

export async function GET() {
  const benchmarksRoot = path.join(resolveDataDir(), "benchmarks");

  let runDirs: fs.Dirent[] = [];
  try {
    runDirs = fs.readdirSync(benchmarksRoot, { withFileTypes: true });
  } catch {
    return Response.json({ runs: [] });
  }

  const runNames = runDirs
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => mtimeMs(path.join(benchmarksRoot, b)) - mtimeMs(path.join(benchmarksRoot, a)));

  const runs: RunEntry[] = [];
  for (const run of runNames) {
    const runPath = path.join(benchmarksRoot, run);
    let caseDirs: fs.Dirent[] = [];
    try {
      caseDirs = fs.readdirSync(runPath, { withFileTypes: true });
    } catch {
      continue;
    }
    const cases: CaseEntry[] = [];
    for (const caseDir of caseDirs.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!caseDir.isDirectory()) continue;
      const entry = readCaseEntry(runPath, caseDir.name);
      if (entry) cases.push(entry);
    }
    if (cases.length === 0) continue; // e.g. "latest" (manifest/runtime only, no case dirs)
    runs.push({ run, ...readCommit(runPath), cases });
  }

  return Response.json({ runs });
}

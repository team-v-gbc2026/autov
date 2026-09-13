import { browserOptions } from "./browser-options.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { recordVideo } from "./deterministic-video.mjs";
const args = process.argv.slice(2),
  arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
  };
const live = args.includes("--live"),
  root = await realpath(
    arg("--dataset", "../../benchmark-verified-2026-09-13"),
  ),
  output = path.resolve(arg("--out", ".autov-local/benchmarks/latest"));
const split = arg("--split", "dev"),
  mode = arg("--mode", "fast"),
  inputMode = arg("--input-mode", "text_image"),
  // Document contract for this run. The server also honors AUTOV_SCHEMA, but an
  // explicit flag here is what the report records.
  schema = arg("--schema", process.env.AUTOV_SCHEMA === "v2" ? "v2" : "v1");
if (
  !["dev", "validation", "holdout", "all"].includes(split) ||
  !["fast", "quality"].includes(mode) ||
  !["text_image", "text_only"].includes(inputMode) ||
  !["v1", "v2"].includes(schema)
)
  throw Error("Invalid benchmark options");
if (
  live &&
  ["holdout", "all"].includes(split) &&
  !args.includes("--final-evaluation")
)
  throw Error("Holdout requires --final-evaluation on a frozen implementation");
const candidateCount = Number(
  arg("--candidate-count", mode === "quality" ? "3" : "1"),
);
if (
  ![1, 2, 3].includes(candidateCount) ||
  (mode === "fast" && candidateCount !== 1)
)
  throw Error("Invalid candidate count");
const ids = arg("--cases", "").split(",").filter(Boolean),
  max = Number(arg("--max-cases", "2")),
  base = arg("--url", "http://127.0.0.1:3031");
if (!Number.isInteger(max) || max < 1 || max > 100)
  throw Error("--max-cases must be 1..100");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Target must be localhost");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const safeRead = async (relative) => {
  const f = await realpath(path.resolve(root, relative));
  if (!f.startsWith(root + path.sep)) throw Error("Dataset path escapes root");
  return readFile(f);
};
// Only generator inputs: no scoring specs, expected results or source videos.
const cases = [];
for (const id of (await readdir(path.join(root, "inputs/cases"))).sort()) {
  const data = JSON.parse(
    await safeRead(`inputs/cases/${id}/${inputMode}.json`),
  );
  if (
    (split !== "all" && data.split !== split) ||
    (ids.length && !ids.includes(id))
  )
    continue;
  if (
    data.schema_version !== "effect-benchmark-input/1.0" ||
    data.case_id !== id ||
    typeof data.prompt !== "string" ||
    data.prompt.length > 10000 ||
    !Array.isArray(data.reference_images) ||
    data.reference_images.length > 3
  )
    throw Error(`Invalid input ${id}`);
  const references = [],
    referenceHashes = [];
  for (const filename of data.reference_images) {
    const bytes = await safeRead(filename);
    if (bytes.length > 1_500_000) throw Error("Reference too large");
    const ext = path.extname(filename).toLowerCase(),
      mime = ext === ".png" ? "png" : ext === ".webp" ? "webp" : "jpeg";
    references.push(`data:image/${mime};base64,${bytes.toString("base64")}`);
    referenceHashes.push({ path: filename, sha256: sha(bytes) });
  }
  if ((inputMode === "text_image") !== references.length > 0)
    throw Error("Reference mode mismatch");
  cases.push({
    data,
    references,
    manifest: {
      caseId: id,
      split: data.split,
      trialId: data.trial_id,
      inputMode,
      promptHash: sha(data.prompt),
      referenceHashes,
    },
  });
}
// --- reference clips --------------------------------------------------------
//
// A v2 run measures each candidate against the case's reference CLIP, not only
// against the three stills: the clip is what carries timing. The clips live in
// <dataset>/references/videos/<sourceId>-*.mp4, and the case -> sourceId
// mapping is read, in order, from
//   1. <dataset>/sources.json, whatever shape it takes (a list of records, or a
//      plain caseId -> sourceId / filename map),
//   2. the source id embedded in the case's own reference_images paths, which
//      are cut from the same clip,
//   3. the table below.
// The table is the last resort and holds only what is knowable without the
// dataset: the case id itself and its fx number, which is how the verified
// dataset names both its frames and its clips. A case with no match is not an
// error — the measure stage falls back to the stills and says so.
const REFERENCE_CLIP_PREFIXES = Object.fromEntries(
  [
    "fx01-lightning-impact",
    "fx02-fire-projectile",
    "fx03-water-projectile",
    "fx04-glitch-magic",
    "fx05-shield",
    "fx06-playful-impact",
    "fx07-fire-slash",
    "fx08-ice-blast",
    "fx09-meteor-rain",
    "fx10-stylized-lightning",
    "fx11-staggered-lightning",
    "fx12-smoke-burst",
    "fx13-sustained-beam",
    "fx14-rectangular-portal",
    "fx15-healing-aura",
    "fx16-energy-overload",
    "fx17-sky-vortex",
  ].map((id) => [id, [id, id.split("-")[0]]]),
);
let sourceRecords = null;
try {
  sourceRecords = JSON.parse(await readFile(path.join(root, "sources.json")));
} catch {
  sourceRecords = null;
}
let clipFiles = [];
try {
  clipFiles = (await readdir(path.join(root, "references/videos"))).filter((f) =>
    /\.(mp4|webm|mov|m4v)$/i.test(f),
  );
} catch {
  clipFiles = [];
}
/** Every token this case could be filed under in references/videos. */
function clipKeysFor(caseId, data) {
  const keys = [];
  const push = (value) => {
    if (typeof value === "string" && value && !keys.includes(value))
      keys.push(value);
  };
  const fromRecord = (record) => {
    if (!record || typeof record !== "object") return;
    if (record.case_id && record.case_id !== caseId) return;
    for (const key of ["source_id", "sourceId", "clip", "video", "source"])
      push(
        typeof record[key] === "string"
          ? path.basename(record[key]).replace(/\.[^.]+$/, "")
          : undefined,
      );
  };
  const records = Array.isArray(sourceRecords)
    ? sourceRecords
    : Array.isArray(sourceRecords?.sources)
      ? sourceRecords.sources
      : null;
  if (records) for (const record of records) fromRecord(record);
  else if (sourceRecords && typeof sourceRecords === "object") {
    const entry = sourceRecords[caseId];
    if (typeof entry === "string")
      push(path.basename(entry).replace(/\.[^.]+$/, ""));
    else fromRecord(entry);
  }
  // reference-image paths: references/frames/<sourceId>/<sourceId>-03.jpg and
  // friends all put the source id in a path segment.
  for (const filename of data.reference_images || [])
    for (const segment of filename.split(/[\\/]/))
      push(segment.replace(/\.[^.]+$/, "").replace(/[-_]\d+$/, ""));
  for (const key of REFERENCE_CLIP_PREFIXES[caseId] || []) push(key);
  return keys;
}
function referenceClipFor(caseId, data) {
  for (const key of clipKeysFor(caseId, data)) {
    const match = clipFiles.find(
      (file) => file === key || file.startsWith(`${key}-`) || file.startsWith(`${key}.`),
    );
    if (match) return path.join(root, "references/videos", match);
  }
  return null;
}

// Explicit case lists also define execution priority.
if (ids.length)
  cases.sort(
    (a, b) => ids.indexOf(a.data.case_id) - ids.indexOf(b.data.case_id),
  );
const selected = cases.slice(0, max);
if (!selected.length) throw Error("No cases selected");
await mkdir(output, { recursive: true });
const report = {
  schemaVersion: "autov.benchmark/1",
  created: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  ),
  mode,
  schema,
  candidateCount,
  textures: args.includes("--textures"),
  live,
  cases: [],
};
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    selected.map((c) => c.manifest),
    null,
    2,
  ),
);
await writeFile(
  path.join(output, "runtime.js"),
  await readFile("public/vfx-runtime.js"),
);
// The v2 player bundle travels with a v2 run so the gallery can replay it.
if (schema === "v2")
  await writeFile(
    path.join(output, "runtime-v2.js"),
    await readFile("public/vfx-runtime-v2.js"),
  );
if (!live) {
  console.log(
    JSON.stringify({
      status: "inputs_verified_only",
      count: selected.length,
      cases: selected.map((c) => c.manifest.caseId),
      output,
      notice: "No API called. Use --live only with authorized budget.",
    }),
  );
  process.exit(0);
}
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const built = await build({
  entryPoints: ["scripts/benchmark-browser.ts"],
  bundle: true,
  format: "iife",
  globalName: "AutoVBenchmark",
  write: false,
  platform: "browser",
  minify: true,
});
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("console", (msg) => {
    if (msg.text().startsWith("BENCHMARK:")) console.log(msg.text());
  });
  // Same origin and API, without a second animated studio canvas competing for GPU time.
  execFileSync(process.env.AUTOV_FFMPEG_PATH || "ffmpeg", ["-version"], {
    stdio: "ignore",
  });
  execFileSync(process.env.AUTOV_FFPROBE_PATH || "ffprobe", ["-version"], {
    stdio: "ignore",
  });
  await page.goto(`${base}/api/local-vfx`);
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/local-vfx");
    if (!r.ok) throw Error("Local API unavailable");
    return r.json();
  });
  if (!status.configured)
    throw Error("API key not configured. No paid call made.");
  report.startBudget = status.budget;
  await page.addScriptTag({ content: built.outputFiles[0].text });
  for (const c of selected) {
    const dir = path.join(output, c.data.case_id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "input.json"),
      JSON.stringify(
        { prompt: c.data.prompt, references: c.references },
        null,
        2,
      ),
    );
    console.log(`Starting ${c.data.case_id}`);
    // The clip is only useful to the v2 measure stage; a v1 run never asks.
    const referenceVideo =
      schema === "v2" ? referenceClipFor(c.data.case_id, c.data) : null;
    if (schema === "v2")
      console.log(
        referenceVideo
          ? `Reference clip: ${path.relative(root, referenceVideo)}`
          : `No reference clip for ${c.data.case_id}; measuring against the stills.`,
      );
    try {
      const result = await page.evaluate(
        async ({ input, options }) => window.AutoVBenchmark.run(input, options),
        {
          input: {
            prompt: c.data.prompt,
            references: c.references,
            caseId: c.data.case_id,
          },
          options: {
            mode,
            textures: report.textures,
            candidateCount,
            schema,
            ...(referenceVideo ? { referenceVideo } : {}),
          },
        },
      );
      await writeFile(
        path.join(dir, "pipeline.json"),
        JSON.stringify(result, null, 2),
      );
      await writeFile(
        path.join(dir, "effect.json"),
        JSON.stringify(result.selected.document, null, 2),
      );
      const rendered = await page.evaluate(
          async (doc) => window.AutoVBenchmark.render(doc, false),
          result.selected.document,
        ),
        decode = (data) =>
          Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
      await writeFile(
        path.join(dir, "contact-sheet.jpg"),
        decode(rendered.evidence.sheet),
      );
      const videoCapture = await recordVideo(
        page,
        result.selected.document,
        path.join(dir, "output.webm"),
        await readFile(
          path.join(output, schema === "v2" ? "runtime-v2.js" : "runtime.js"),
          "utf8",
        ),
      );
      for (let i = 0; i < rendered.frames.length; i++)
        await writeFile(
          path.join(dir, `frame-${i}.png`),
          decode(rendered.frames[i].png),
        );
      const record = {
        ...c.manifest,
        status: "pending_visual_review",
        source: "openai_live",
        gates: rendered.gates,
        renderer: rendered.evidence.renderer,
        performance: rendered.performance,
        review: result.selected.review,
        usageUsd: result.usages.reduce((n, u) => n + u.usd, 0),
        frames: rendered.frames.map((f, i) => ({
          time: f.time,
          file: `frame-${i}.png`,
        })),
        video: "output.webm",
        videoCapture,
        reviewer: null,
        acceptance: "not_claimed",
      };
      report.cases.push(record);
      await writeFile(
        path.join(dir, "result.json"),
        JSON.stringify(record, null, 2),
      );
    } catch (e) {
      report.cases.push({ ...c.manifest, status: "failed", error: e.message });
      console.error(`${c.data.case_id}: ${e.message}`);
    }
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  report.endBudget = await page.evaluate(
    async () => (await (await fetch("/api/local-vfx")).json()).budget,
  );
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
console.log(`Benchmark evidence: ${output}`);
if (report.cases.some((c) => c.status === "failed")) process.exitCode = 1;
try {
  execFileSync(process.execPath, ["scripts/build-trial-gallery.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AUTOV_BENCHMARK_DATASET: root,
      AUTOV_TEST_URL: `${base}/local`,
    },
  });
  execFileSync(process.execPath, ["scripts/build-morning-review.mjs"], {
    stdio: "inherit",
    env: { ...process.env, AUTOV_BENCHMARK_DATASET: root },
  });
} catch {
  console.error(
    "Gallery export needs retry; the generated pipeline and evidence remain saved.",
  );
  process.exitCode = 1;
}

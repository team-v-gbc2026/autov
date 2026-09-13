#!/usr/bin/env node
// Measure -> align -> explain -> act, end to end, with no model call.
//
// Runs the real v2 pipeline in a real browser against a live document and a
// real reference clip, with a fake transport standing in for the model: the
// plan, the candidate and the reviews are canned, and the "refiner" picks its
// knob subspace by reading the measurement the measure stage actually produced
// (the worst few deltas, and the knobs whose measured slopes move them).
// Everything else — the phase
// measurement, the aligned sheet, the influence pass, the damped least-squares
// solve and its guards — is the production code path.
//
// Usage:
//   node scripts/dry-run-measure-v2.mjs \
//     [--doc .autov-local/live-docs/fx01-lightning-impact.json] \
//     [--video .autov-local/refs/fx01-lightning-impact/reference.mp4] \
//     [--out .autov-local/dry-run-measure-v2]
//
// Writes aligned-before.png, aligned-after.png, measurement.json, calls.json,
// solves.json, solved.json and trace.txt under --out.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const FALLBACK_MODULES =
  process.env.AUTOV_VERIFY_MODULES || "/home/claude/spike/node_modules";
function load(name, preferFallback = false) {
  const candidates = preferFallback
    ? [path.join(FALLBACK_MODULES, name), path.join(root, "node_modules", name)]
    : [path.join(root, "node_modules", name), path.join(FALLBACK_MODULES, name)];
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return require(candidate);
  return require(name);
}
const esbuild = load("esbuild");
const { chromium } = load("playwright", fs.existsSync(FALLBACK_MODULES));

const args = { };
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const docPath = path.resolve(
  process.cwd(),
  args.doc ?? ".autov-local/live-docs/fx01-lightning-impact.json",
);
const videoPath = path.resolve(
  process.cwd(),
  args.video ?? ".autov-local/refs/fx01-lightning-impact/reference.mp4",
);
const outDir = path.resolve(
  process.cwd(),
  args.out ?? ".autov-local/dry-run-measure-v2",
);
fs.mkdirSync(outDir, { recursive: true });

const scratch = path.join(root, ".autov-local", "dry-run-build", String(process.pid));
fs.mkdirSync(scratch, { recursive: true });
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

// --- node bundle: the reference decoder the local API uses ------------------

const nodeEntry = path.join(scratch, "node-entry.mjs");
fs.writeFileSync(
  nodeEntry,
  `export { decodeReferenceVideo } from "../../../src/lib/vfx-lab/reference-video-node";\n`,
);
const nodeBundle = path.join(scratch, "node.mjs");
await esbuild.build({
  entryPoints: [nodeEntry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: nodeBundle,
  absWorkingDir: root,
  logLevel: "warning",
});
const lib = await import(pathToFileURL(nodeBundle).href);

// --- browser bundle: the real pipeline, a fake model ------------------------

const BROWSER_ENTRY = `
import { generatePipeline } from "../../../src/lib/vfx-lab/pipeline";
import { captureV2 } from "../../../src/lib/vfx-lab/capture-v2";
import { measureV2 } from "../../../src/lib/vfx-lab/measure-browser-v2";
import { REVIEW_V2_DEFECTS } from "../../../src/lib/vfx-lab/protocol-v2";
import { KNOB_NAMES } from "../../../src/lib/vfx-lab/knobs-v2";

const review = (score, defects = {}) => ({
  sufficientEvidence: true,
  semantic: score, motion: score, hierarchy: score,
  detail: score, smoothness: score, beauty: score,
  defects: Object.fromEntries(REVIEW_V2_DEFECTS.map((d) => [d, defects[d] ?? false])),
  observations: [{ criterion: "visible strike", result: "pass", evidence: "0.7 s" }],
  verdict: "Observed",
  directorNotes: ["denser ground contact, longer residue"],
});

/**
 * The stand-in refiner. It reads the measurement exactly as the prompt asks the
 * model to: take the worst weighted delta, find the knob whose measured slope on
 * that row is largest, and move it in the direction that lowers the row.
 */
function planFromMeasurement(measurement) {
  // Up to three distinct features, worst first — a single profile bin is not a
  // brief, and the prompt asks for the features the sheet and the table agree on.
  const targets = [];
  for (const row of measurement.deltas)
    if (!targets.includes(row.feature) && targets.length < 3)
      targets.push(row.feature);
  const worst = measurement.deltas[0];
  const knobs = [];
  for (const row of measurement.influences) {
    if (!targets.includes(row.feature)) continue;
    if (!KNOB_NAMES.includes(row.knob)) continue;
    if (knobs.some((knob) => knob.name === row.knob)) continue;
    const delta = measurement.deltas.find(
      (d) => d.feature === row.feature && d.phase === row.phase,
    );
    const sign = (delta ? delta.delta : worst.delta) >= 0 ? 1 : -1;
    knobs.push({
      name: row.knob,
      direction: row.slope * sign > 0 ? "down" : "up",
      reason:
        row.phase + "." + row.feature + " is " +
        (delta ? delta.delta : worst.delta) + " and " + row.knob +
        " has slope " + row.slope + " on it",
    });
    if (knobs.length === 2) break;
  }
  return { knobs, targets };
}

window.__dryRun = async ({ doc, reference, prompt }) => {
  const calls = [];
  const solves = [];
  let reviews = 0;
  const answers = [review(3, { smallInFrame: true }), review(4.6)];
  const trace = [];
  const result = await generatePipeline({
    prompt,
    references: [],
    mode: "quality",
    candidateCount: 1,
    schema: "v2",
    referenceVideo: "(local path, decoded by the API)",
    signal: AbortSignal.timeout(60 * 60 * 1000),
    request: async (body) => {
      const text = JSON.stringify(body);
      calls.push({
        action: body.action,
        bytes: text.length,
        imageBytes: ["sheet", "strip", "diagnostic", "alignedSheet"]
          .filter((key) => typeof body[key] === "string")
          .map((key) => ({ key, bytes: body[key].length })),
        textBytes:
          text.length -
          ["sheet", "strip", "diagnostic", "alignedSheet"]
            .filter((key) => typeof body[key] === "string")
            .reduce((n, key) => n + body[key].length, 0),
      });
      if (body.action === "plan")
        return {
          runId: "dry-run",
          plan: { criteria: ["visible strike"], recipe: "lightning" },
          schema: "v2",
          reference,
        };
      if (body.action === "candidate") return { document: doc };
      if (body.action === "review")
        return { review: answers[Math.min(reviews++, answers.length - 1)] };
      if (body.action === "refine") {
        const plan = planFromMeasurement(body.measurement);
        calls[calls.length - 1].plan = plan;
        calls[calls.length - 1].measurement = body.measurement;
        return { plan };
      }
      return { document: doc };
    },
    capture: (d, solo, diagnostic) => captureV2(d, { solo, diagnostic }),
    measure: async (d, ref) => {
      const session = await measureV2(d, { reference: ref, prompt });
      return {
        ...session,
        solve: async (plan) => {
          const outcome = await session.solve(plan);
          solves.push({
            accepted: outcome.accepted,
            knobs: outcome.knobs,
            improvement: outcome.improvement,
            residual: outcome.residual,
            baselineResidual: outcome.baselineResidual,
            evaluations: outcome.evaluations,
            guards: outcome.guards,
            notes: outcome.notes,
            // The solve's own aligned sheet, kept even when the pipeline later
            // refuses the candidate: it is the picture of what was solved.
            sheet: outcome.measurement && outcome.measurement.sheet,
            document: outcome.document,
          });
          return outcome;
        },
      };
    },
    progress: (message) => {
      trace.push(message);
      console.log("DRY: " + message);
    },
    candidate: () => {},
  });
  const generated = result.candidates.find((c) => c.origin === "generated");
  const refined = result.candidates.find((c) => c.origin === "refined");
  const strip = (m) => (m ? { ...m, sheet: undefined } : undefined);
  return {
    trace: result.trace,
    calls,
    solves,
    selected: result.selected.id,
    before: strip(generated && generated.measurement),
    after: strip(refined && refined.measurement),
    beforeSheet: generated && generated.measurement && generated.measurement.sheet,
    afterSheet: refined && refined.measurement && refined.measurement.sheet,
  };
};
window.__dryReady = true;
`;
const browserEntry = path.join(scratch, "browser-entry.mjs");
fs.writeFileSync(browserEntry, BROWSER_ENTRY);
const bundled = await esbuild.build({
  entryPoints: [browserEntry],
  bundle: true,
  format: "iife",
  write: false,
  target: "es2020",
  loader: { ".json": "json" },
  absWorkingDir: root,
  logLevel: "warning",
});
const html = `<!doctype html><html><head><meta charset="utf-8"><title>dry run</title>
<style>html,body{margin:0;background:#000}</style></head><body>
<script>${bundled.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>
</body></html>`;

// --- static server (public/ carries the v2 texture library) ----------------

const publicDir = path.join(root, "public");
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  const file = path.join(publicDir, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      "content-type": file.endsWith(".png") ? "image/png" : "application/octet-stream",
    });
    res.end(fs.readFileSync(file));
    return;
  }
  res.writeHead(404).end("not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// The reference clip is decoded here, exactly as the local API decodes it.
process.env.AUTOV_LOCAL_MODE = "1";
const reference = await lib.decodeReferenceVideo(videoPath);
console.log(
  `reference : ${reference.frames.length} frames at ${reference.fps} fps,` +
    ` ${(reference.frames.reduce((n, f) => n + f.length, 0) / 1e6).toFixed(2)} MB`,
);

const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const problems = [];
const started = Date.now();
let out;
try {
  const page = await browser.newPage({
    viewport: { width: 700, height: 420 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`);
    else if (m.text().startsWith("DRY: ")) console.log(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction("window.__dryReady === true", null, { timeout: 90000 });
  out = await page.evaluate(
    (payload) => window.__dryRun(payload),
    { doc, reference, prompt: "A lightning bolt strikes the ground." },
  );
} finally {
  await browser.close();
  server.close();
}

const write = (name, dataUrl) => {
  if (!dataUrl) return null;
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  return file;
};
write("aligned-before.png", out.beforeSheet);
write(
  "aligned-after.png",
  out.afterSheet || (out.solves[0] && out.solves[0].sheet),
);
if (out.solves[0] && out.solves[0].document)
  fs.writeFileSync(
    path.join(outDir, "solved.json"),
    JSON.stringify(out.solves[0].document, null, 2),
  );
fs.writeFileSync(
  path.join(outDir, "measurement.json"),
  JSON.stringify({ before: out.before, after: out.after }, null, 2),
);
fs.writeFileSync(path.join(outDir, "calls.json"), JSON.stringify(out.calls, null, 2));
fs.writeFileSync(
  path.join(outDir, "solves.json"),
  JSON.stringify(
    out.solves.map((solve) => ({ ...solve, sheet: undefined, document: undefined })),
    null,
    2,
  ),
);
fs.writeFileSync(path.join(outDir, "trace.txt"), out.trace.join("\n"));

const refine = out.calls.find((c) => c.action === "refine");
console.log(`selected  : ${out.selected}`);
console.log(
  `refine    : ${(refine.bytes / 1024).toFixed(1)} KB total, text` +
    ` ${(refine.textBytes / 1024).toFixed(1)} KB, images ` +
    refine.imageBytes.map((i) => `${i.key} ${(i.bytes / 1024).toFixed(1)} KB`).join(", "),
);
console.log(`plan      : ${JSON.stringify(refine.plan)}`);
for (const solve of out.solves)
  console.log(
    `solve     : ${solve.accepted ? "accepted" : "rejected"}` +
      ` ${solve.baselineResidual} -> ${solve.residual}` +
      ` (${(solve.improvement * 100).toFixed(1)}%) in ${solve.evaluations} evaluations,` +
      ` knobs ${Object.entries(solve.knobs)
        .filter(([, v]) => Math.abs(v - 1) > 1e-3)
        .map(([k, v]) => `${k}=${v.toFixed(3)}`)
        .join(" ")}`,
  );
if (out.before)
  console.log(
    `before    : residual ${out.before.residualNorm}, envelope` +
      ` ${out.before.envelope.distance}, worst ${out.before.deltas[0].phase}.` +
      `${out.before.deltas[0].feature} ${out.before.deltas[0].delta}`,
  );
if (out.after)
  console.log(
    `after     : residual ${out.after.residualNorm}, envelope ${out.after.envelope.distance}`,
  );
console.log(`elapsed   : ${Math.round((Date.now() - started) / 100) / 10}s`);
if (problems.length) console.log(`problems  : ${problems.slice(0, 3).join(" | ")}`);
console.log(`out       : ${outDir}`);

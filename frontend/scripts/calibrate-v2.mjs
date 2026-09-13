#!/usr/bin/env node
import { webgpuBrowserOptions } from "./browser-options.mjs";
// Reference-conditioned renderer response calibration — headless driver.
//
// Bundles the v2 runtime plus features-v2 into a browser page, renders one
// background plate (every effect layer disabled, same camera) and then, per
// evaluation, renders the reference sheet's phase times at 640x360 and computes
// the feature vectors IN THE BROWSER. Only feature objects cross back to node,
// where the optimizer (calibrate-v2.ts, bundled for node from the same source)
// decides the next knob vector.
//
// The camera is frozen: the pose auto-framing picks for the *base* document is
// captured once and re-applied after every setDocument, so knobs move the
// effect and never the shot.
//
// Usage:
//   node scripts/calibrate-v2.mjs --doc <path> --refs <dir> \
//     [--method response|random|coordinate] [--budget N] [--iterations N] \
//     [--seed N] [--out dir] [--stills] [--fps N] [--maxFrames N] [--curveFrames N]
//
// --refs prefers <dir>/reference.mp4 when it exists (measured phases plus a
// temporal envelope target) and falls back to reference-01..03.jpg; --stills
// forces the still path. ffmpeg must be on PATH for the video path.
//   node scripts/calibrate-v2.mjs --doc <path> --self   (exemplar sanity check)
//
// Outputs sheet.json, report.json, before.json, after.json, before-sheet.png,
// after-sheet.png and reference-strip.png under --out.

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assetBaseScript,
  resolveTextureSource,
  serveLocalTexture,
} from "./vfx-assets.mjs";

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
const sharp = load("sharp");
const { chromium } = load("playwright", fs.existsSync(FALLBACK_MODULES));

// --- arguments -------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    method: "response",
    budget: 45,
    iterations: 2,
    seed: 1,
    samples: 2,
    // Reference decode rate, decode cap (fx01's clip replays its strike for
    // 20 s; only the first is the effect the document renders) and the cap on
    // renders spent on the activity curve per evaluation.
    fps: 10,
    maxFrames: 150,
    curveFrames: 24,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}`);
    const key = token.slice(2);
    if (key === "self" || key === "stills") {
      args[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    args[key] = /^(budget|iterations|seed|samples|fps|maxFrames|curveFrames)$/.test(key)
      ? Number(value)
      : value;
  }
  if (!args.doc) throw new Error("--doc <path to document json> is required");
  if (!args.refs && !args.self)
    throw new Error("--refs <dir> is required (or --self)");
  if (!["response", "random", "coordinate"].includes(args.method))
    throw new Error(`Unknown --method ${args.method}`);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const docPath = path.resolve(process.cwd(), args.doc);
// fixtures/v2/<id>/document.json names the case by its directory; a live
// document names it by its own file.
const baseName = path.basename(docPath).replace(/\.json$/, "");
const caseId =
  baseName === "document" ? path.basename(path.dirname(docPath)) : baseName;
const outDir = path.resolve(
  process.cwd(),
  args.out ?? path.join(root, ".autov-local", "calibrate-v2", caseId, args.method),
);
fs.mkdirSync(outDir, { recursive: true });

// --- bundles ---------------------------------------------------------------

// Per-process build directory: two calibration runs in parallel must not write
// each other's bundles half-finished.
const scratch = path.join(
  root,
  ".autov-local",
  "calibrate-v2-build",
  String(process.pid),
);
fs.mkdirSync(scratch, { recursive: true });
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));

const NODE_ENTRY = `
export * from "../../../src/lib/vfx-lab/features-v2";
export * from "../../../src/lib/vfx-lab/reference-features";
export * from "../../../src/lib/vfx-lab/knobs-v2";
export * from "../../../src/lib/vfx-lab/calibrate-v2";
export { validateDocumentV2 } from "../../../src/lib/vfx-lab/schema-v2";
`;
const nodeEntryPath = path.join(scratch, "node-entry.mjs");
fs.writeFileSync(nodeEntryPath, NODE_ENTRY);
const nodeBundlePath = path.join(scratch, "calibrate-node.mjs");
await esbuild.build({
  entryPoints: [nodeEntryPath],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: nodeBundlePath,
  absWorkingDir: root,
  logLevel: "warning",
});
const lib = await import(pathToFileURL(nodeBundlePath).href);

const BROWSER_ENTRY = `
import { VfxRuntimeV2 } from "../../../src/lib/vfx-lab/runtime-v2";
import {
  maskAgainstBackground,
  renderedFrameFeatures,
} from "../../../src/lib/vfx-lab/features-v2";

// Phase features are measured at 640x360 (detail matters for edge density and
// the silhouette profiles); the temporal envelope only needs foreground area,
// so it is measured at 320x180, which is four times cheaper on SwiftShader and
// is what makes a 10 fps activity curve affordable inside one evaluation.
const FEATURE_SIZE = [640, 360];
const CURVE_SIZE = [320, 180];

const host = document.getElementById("host");
const runtime = new VfxRuntimeV2(host);
// Deterministic: orbit/pan/zoom must never perturb the camera between frames.
runtime.setInteractive(false);

const scratch = document.createElement("canvas");
const context = scratch.getContext("2d", { willReadFrequently: true });

let pose = null;
const plates = new Map();

const readFrame = (size) => {
  scratch.width = size[0];
  scratch.height = size[1];
  context.clearRect(0, 0, size[0], size[1]);
  context.drawImage(runtime.renderer.domElement, 0, 0, size[0], size[1]);
  const image = context.getImageData(0, 0, size[0], size[1]);
  return { width: size[0], height: size[1], data: image.data };
};

const applyPose = () => {
  if (!pose) return;
  runtime.camera.fov = pose.fov;
  runtime.camera.position.fromArray(pose.position);
  runtime.controls.target.fromArray(pose.target);
  runtime.camera.lookAt(runtime.controls.target);
  runtime.camera.updateProjectionMatrix();
  runtime.camera.updateMatrixWorld();
};

const load = async (doc, size) => {
  runtime.setDocument(doc);
  runtime.resize(size[0], size[1]);
  await runtime.whenReady();
  // Warm-up frame: every shader compiled before the first measured frame.
  runtime.render(0);
  applyPose();
};

const resizeTo = (size) => {
  runtime.resize(size[0], size[1]);
  applyPose();
};

window.__api = {
  /** Load the base document and freeze the pose auto-framing chose for it. */
  async prime(doc) {
    await load(doc, FEATURE_SIZE);
    pose = {
      fov: runtime.camera.fov,
      position: runtime.camera.position.toArray(),
      target: runtime.controls.target.toArray(),
    };
    return pose;
  },
  /**
   * Background plates: the same camera with every effect layer disabled, one
   * per resolution the evaluation measures at.
   */
  async background(doc) {
    const means = {};
    for (const size of [FEATURE_SIZE, CURVE_SIZE]) {
      await load(doc, size);
      runtime.render(0);
      const plate = readFrame(size);
      plates.set(size.join("x"), plate);
      let sum = 0;
      for (let i = 0; i < plate.data.length; i += 4) sum += plate.data[i];
      means[size.join("x")] = sum / (plate.data.length / 4);
    }
    return means;
  },
  /** Foreground-area curve only, at the cheap resolution. */
  async curve(doc, curveTimes) {
    await load(doc, CURVE_SIZE);
    const plate = plates.get(CURVE_SIZE.join("x"));
    const areas = [];
    for (const time of curveTimes) {
      runtime.render(time);
      const frame = readFrame(CURVE_SIZE);
      areas.push(
        maskAgainstBackground(frame, plate).count / (frame.width * frame.height),
      );
    }
    return areas;
  },
  /**
   * One evaluation: the area curve first (cheap, 320x180), so the document's
   * own activity peak and phase windows can be measured from it, then the
   * phase frames at whichever times node asks for.
   */
  async evaluate(doc, curveTimes, phaseTimes) {
    const areas = await this.curve(doc, curveTimes);
    if (!phaseTimes || !phaseTimes.length) return { phase: [], areas };
    return { phase: await this.frames(doc, phaseTimes), areas };
  },
  /** Features of the loaded document at the given times, 640x360. */
  async frames(doc, times) {
    resizeTo(FEATURE_SIZE);
    const plate = plates.get(FEATURE_SIZE.join("x"));
    const out = [];
    for (const time of times) {
      runtime.render(time);
      out.push(renderedFrameFeatures(readFrame(FEATURE_SIZE), plate).features);
    }
    return out;
  },
  /** One labelled tile per time, each as its own JPEG data URL. */
  async tiles(doc, times, labels) {
    await load(doc, FEATURE_SIZE);
    const labelHeight = 22;
    const out = [];
    for (let index = 0; index < times.length; index++) {
      runtime.render(times[index]);
      const canvas = document.createElement("canvas");
      canvas.width = FEATURE_SIZE[0];
      canvas.height = FEATURE_SIZE[1] + labelHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#101112";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(runtime.renderer.domElement, 0, 0, FEATURE_SIZE[0], FEATURE_SIZE[1]);
      ctx.fillStyle = "#bdc5cc";
      ctx.font = "14px monospace";
      ctx.fillText(
        "render  " + (labels[index] || "") + "  " + times[index].toFixed(3) + " s",
        12,
        canvas.height - 7,
      );
      out.push(canvas.toDataURL("image/jpeg", 0.9));
    }
    return out;
  },
};
window.__apiReady = true;
`;
const browserEntryPath = path.join(scratch, "browser-entry.mjs");
fs.writeFileSync(browserEntryPath, BROWSER_ENTRY);
const browserBundle = await esbuild.build({
  entryPoints: [browserEntryPath],
  bundle: true,
  format: "iife",
  write: false,
  target: "es2020",
  loader: { ".json": "json" },
  absWorkingDir: root,
  logLevel: "warning",
});
const js = browserBundle.outputFiles[0].text;
const textures = resolveTextureSource(root);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>calibrate v2</title>
<style>html,body{margin:0;background:#000}#host{width:640px;height:360px}canvas{display:block}</style>
</head><body><div id="host"></div>${assetBaseScript(textures.base)}<script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;

// --- static server ---------------------------------------------------------
// The v2 texture library lives in the vfx-textures bucket; serveLocalTexture
// mirrors it from a local directory when one is available (VFX_ASSET_DIR).

const publicDir = path.join(root, "public");
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (serveLocalTexture(url, res, textures.dir)) return;
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

// --- references ------------------------------------------------------------

async function decodeStill(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

const baseDoc = lib.validateDocumentV2(
  JSON.parse(fs.readFileSync(docPath, "utf8")),
);
// The background plate: the document's environment, camera and post stack with
// every effect layer gone. The schema insists on one enabled layer, so a black
// light of zero intensity stands in — it draws nothing and lights nothing.
const backgroundDoc = {
  ...structuredClone(baseDoc),
  layers: [
    ...structuredClone(baseDoc).layers.map((layer) => ({
      ...layer,
      enabled: false,
    })),
    {
      id: "calibration-plate",
      name: "background plate",
      role: "residue",
      kind: "light",
      start: 0,
      end: baseDoc.duration,
      enabled: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      motion: null,
      light: {
        color: "#000000",
        intensity: { keys: [[0, 0], [1, 0]], ease: "linear" },
        radius: 0.5,
        decay: 2,
      },
      tracks: [],
      overrides: [],
    },
  ],
};

const REFERENCE_SIZE = [640, 360];

/** Decode a clip to RGBA frames at `fps`, newest ffmpeg on PATH. */
function decodeVideo(file, fps, maxFrames) {
  const dir = path.join(scratch, "frames");
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-v", "error",
      "-i", file,
      "-vf", `fps=${fps},scale=${REFERENCE_SIZE[0]}:${REFERENCE_SIZE[1]}`,
      "-frames:v", String(maxFrames),
      "-y", path.join(dir, "f%05d.png"),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f, index) => ({ time: index / fps, file: path.join(dir, f) }));
}

/** One frame of a clip at `time`, as a PNG buffer at REFERENCE_SIZE. */
function grabFrame(file, time) {
  return execFileSync(
    "ffmpeg",
    [
      "-v", "error",
      "-ss", String(Math.max(0, time)),
      "-i", file,
      "-frames:v", "1",
      "-vf", `scale=${REFERENCE_SIZE[0]}:${REFERENCE_SIZE[1]}`,
      "-f", "image2pipe", "-vcodec", "png", "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

let prompt = "";
let referenceFiles = [];
let referenceVideo = null;
if (!args.self) {
  const refDir = path.resolve(process.cwd(), args.refs);
  const promptFile = path.join(refDir, "prompt.txt");
  prompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8") : "";
  referenceFiles = fs
    .readdirSync(refDir)
    .filter((f) => /^reference-\d+\.(jpe?g|png)$/i.test(f))
    .sort()
    .slice(0, 3)
    .map((f) => path.join(refDir, f));
  const video = path.join(refDir, "reference.mp4");
  if (!args.stills && fs.existsSync(video)) referenceVideo = video;
  if (!referenceVideo && referenceFiles.length !== 3)
    throw new Error(`Expected reference.mp4 or 3 stills in ${refDir}`);
}

// --- browser ---------------------------------------------------------------

process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const browser = await chromium.launch(webgpuBrowserOptions());
const problems = [];
const started = Date.now();
let report;
try {
  const page = await browser.newPage({
    viewport: { width: 700, height: 420 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction("window.__apiReady === true", null, { timeout: 90000 });

  const pose = await page.evaluate((doc) => window.__api.prime(doc), baseDoc);
  const plate = await page.evaluate(
    (doc) => window.__api.background(doc),
    backgroundDoc,
  );

  // --- the sheet -----------------------------------------------------------

  let sheet;
  let analysis = null;
  let analysisCurve = null;
  let baseMeasured = null;
  if (args.self) {
    // Sanity target: the exemplar's own rendered features. A correct optimizer
    // must find that identity knobs are already optimal.
    const provisional = lib.buildReferenceSheet({
      case: caseId,
      doc: baseDoc,
      prompt: "",
      references: [zeroFeatures(), zeroFeatures(), zeroFeatures()],
      samplesPerPhase: args.samples,
    });
    const times = provisional.phases.flatMap((p) => p.sampleTimes);
    const measured = await page.evaluate(
      ({ doc, t }) => window.__api.evaluate(doc, [], t),
      { doc: baseDoc, t: times },
    );
    let cursor = 0;
    const own = provisional.phases.map((phase) =>
      lib.meanFeatures(
        phase.sampleTimes.map(() => measured.phase[cursor++]),
      ),
    );
    sheet = lib.buildReferenceSheet({
      case: caseId,
      doc: baseDoc,
      prompt: "",
      references: own,
      samplesPerPhase: args.samples,
    });
    sheet.notes.push(
      "self-calibration: targets are this document's own rendered features",
    );
  } else if (referenceVideo) {
    // The clip is the better target: a real background plate (per-pixel
    // temporal median of a locked-off camera), measured phases, and an
    // activity envelope the stills cannot provide.
    const decoded = decodeVideo(referenceVideo, args.fps, args.maxFrames);
    const frames = [];
    for (const { time, file } of decoded)
      frames.push({ time, frame: await decodeStill(file) });
    analysis = lib.analyzeReferenceVideo(frames);
    // Measure the base document the same way the clip is measured: render its
    // own area curve once and read the peak and the active span off it. That
    // measurement anchors the phase windows, the envelope's time mapping and
    // K11's pivot for the whole run.
    const baseCurveTimes = curveTimesFor(baseDoc);
    const baseAreas = await page.evaluate(
      ({ d, t }) => window.__api.curve(d, t),
      { d: baseDoc, t: baseCurveTimes },
    );
    baseMeasured = lib.documentWindowsFromCurve(
      baseCurveTimes,
      baseAreas,
      baseDoc.duration,
    );
    sheet = lib.buildVideoReferenceSheet({
      case: caseId,
      doc: baseDoc,
      analysis,
      measured: baseMeasured,
      samplesPerPhase: args.samples,
      maxEnvelopeSamples: args.curveFrames,
    });
    // The per-frame features are large and already summarized; keep the curve.
    analysisCurve = analysis.samples.map((s) => [
      Number(s.time.toFixed(3)),
      Number(s.area.toFixed(5)),
      Number(s.diff.toFixed(5)),
    ]);
  } else {
    const referenceFeatures = [];
    for (const file of referenceFiles) {
      const frame = await decodeStill(file);
      referenceFeatures.push(lib.stillFeatures(frame).features);
    }
    sheet = lib.buildReferenceSheet({
      case: caseId,
      doc: baseDoc,
      prompt,
      references: referenceFeatures,
      samplesPerPhase: args.samples,
    });
  }
  fs.writeFileSync(
    path.join(outDir, "sheet.json"),
    JSON.stringify(sheet, null, 2),
  );

  const baselineVisible = lib.visibleLayerCount(baseDoc);

  // --- the search ----------------------------------------------------------

  // K11 scales time about this point, and it never moves during a run.
  const pivot = baseMeasured ? baseMeasured.peakTime : baseDoc.impact;

  const evaluate = async (knobs) => {
    const doc = lib.applyKnobs(baseDoc, knobs, { pivot });
    // Two passes over one loaded document: the cheap area curve decides where
    // this candidate's own phases are, then the phase frames are measured
    // there. Sampling a candidate at the *base* document's phase times would
    // score a time-stretched document on frames it no longer plays.
    const curveTimes = curveTimesFor(doc);
    const areas = await page.evaluate(
      ({ d, t }) => window.__api.curve(d, t),
      { d: doc, t: curveTimes },
    );
    const measured = lib.documentWindowsFromCurve(curveTimes, areas, doc.duration);
    const windowTimes = lib.documentPhaseTimes(measured, doc.duration, args.samples);
    const flat = lib.PHASE_NAMES.flatMap((name) => windowTimes[name]);
    const phase = await page.evaluate(
      ({ d, t }) => window.__api.frames(d, t),
      { d: doc, t: flat },
    );
    let cursor = 0;
    const features = {};
    const frames = {};
    for (const name of lib.PHASE_NAMES) {
      const slice = windowTimes[name].map(() => phase[cursor++]);
      frames[name] = slice;
      features[name] = lib.meanFeatures(slice);
    }
    return {
      features,
      frames,
      windows: measured.windows,
      peakPosition: measured.peakPosition,
      envelope: sheet.envelope
        ? lib.envelopeFromAreaCurve(sheet, curveTimes, areas)
        : undefined,
      areaCurve: areas,
      visibleLayers: lib.visibleLayerCount(doc),
    };
  };

  const result = await lib.calibrate({
    sheet,
    evaluate,
    method: args.method,
    budget: args.budget,
    iterations: args.iterations,
    seed: args.seed,
    samplesPerPhase: args.samples,
  });

  // --- artefacts -----------------------------------------------------------

  const bestKnobs = lib.KNOB_NAMES.map((name) => result.best.knobs[name]);
  const afterDoc = lib.applyKnobs(baseDoc, bestKnobs, { pivot });
  fs.writeFileSync(path.join(outDir, "before.json"), JSON.stringify(baseDoc, null, 2));
  fs.writeFileSync(path.join(outDir, "after.json"), JSON.stringify(afterDoc, null, 2));

  const tileLabels = ["anticipation", "peak", "peak+", "dissipation"];
  const [TW, TH] = [640, 382];

  /**
   * Each document is shown at its *own* measured phases. A time-stretched
   * candidate does not play the base document's phases any more, and showing
   * it at them would misrepresent both the render and the comparison.
   */
  const tileTimesFor = async (doc) => {
    const curve = curveTimesFor(doc);
    const areas = await page.evaluate(
      ({ d, t }) => window.__api.curve(d, t),
      { d: doc, t: curve },
    );
    const m = lib.documentWindowsFromCurve(curve, areas, doc.duration);
    const times = lib.documentPhaseTimes(m, doc.duration, args.samples);
    return {
      measured: m,
      times: [
        times.anticipation[0],
        m.peakTime,
        times.peak[times.peak.length - 1],
        times.dissipation[0],
      ],
    };
  };

  const renderTiles = async (doc, tileTimes) =>
    (await page.evaluate(
      ({ d, t, l }) => window.__api.tiles(d, t, l),
      { d: doc, t: tileTimes, l: tileLabels },
    )).map((url) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));

  // The reference frames that correspond to the four tiles, in reference time.
  const referenceTileTimes = analysis
    ? [
        (analysis.windows.anticipation.start + analysis.windows.anticipation.end) / 2,
        analysis.peakTime,
        analysis.windows.peak.end,
        (analysis.windows.dissipation.start + analysis.windows.dissipation.end) / 2,
      ]
    : null;

  const grid = async (file, tiles, columns) => {
    const rows = Math.ceil(tiles.length / columns);
    await sharp({
      create: {
        width: columns * TW,
        height: rows * TH,
        channels: 3,
        background: { r: 16, g: 17, b: 18 },
      },
    })
      .composite(
        await Promise.all(
          tiles.map(async (input, i) => ({
            input: await sharp(input).resize(TW, TH, { fit: "contain",
              background: { r: 16, g: 17, b: 18 } }).toBuffer(),
            left: (i % columns) * TW,
            top: Math.floor(i / columns) * TH,
          })),
        ),
      )
      .png()
      .toFile(path.join(outDir, file));
  };

  const beforeTiles = await tileTimesFor(baseDoc);
  await grid("before-sheet.png", await renderTiles(baseDoc, beforeTiles.times), 2);

  const afterTiles_ = await tileTimesFor(afterDoc);
  const afterTiles = await renderTiles(afterDoc, afterTiles_.times);
  if (referenceVideo && referenceTileTimes) {
    // Render beside reference, one phase per row, so the comparison the report
    // talks about is the one the image actually shows.
    const paired = [];
    for (let i = 0; i < afterTiles.length; i++) {
      paired.push(afterTiles[i]);
      paired.push(grabFrame(referenceVideo, referenceTileTimes[i]));
    }
    await grid("after-sheet.png", paired, 2);
  } else {
    await grid("after-sheet.png", afterTiles, 2);
  }

  if (referenceVideo && referenceTileTimes) {
    await grid(
      "reference-strip.png",
      referenceTileTimes.map((t) => grabFrame(referenceVideo, t)),
      4,
    );
  } else if (referenceFiles.length) {
    await grid("reference-strip.png", referenceFiles.map((f) => fs.readFileSync(f)), 3);
  }

  report = {
    case: caseId,
    document: docPath,
    references: referenceFiles,
    method: args.method,
    budget: args.budget,
    iterations: args.iterations,
    seed: args.seed,
    samplesPerPhase: args.samples,
    resolution: { features: [640, 360], areaCurve: [320, 180] },
    referenceVideo,
    referenceActivity: analysisCurve,
    referenceAnalysis: analysis
      ? {
          frames: analysis.frames,
          fps: analysis.fps,
          peakTime: analysis.peakTime,
          peakArea: analysis.peakArea,
          floorArea: analysis.floorArea,
          peakCount: analysis.peakCount,
          confidence: analysis.confidence,
          windows: analysis.windows,
          span: analysis.span,
          envelope: analysis.envelope,
          notes: analysis.notes,
        }
      : null,
    camera: pose,
    backgroundPlate: plate,
    baselineVisibleLayers: baselineVisible,
    pivot,
    baseMeasured,
    afterMeasured: afterTiles_.measured,
    tileTimes: { before: beforeTiles.times, after: afterTiles_.times },
    phaseTimes: sheet.phases.map((p) => ({ name: p.name, times: p.sampleTimes })),
    sheet,
    result,
    elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
    problems,
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.close();
}

/** Evenly spaced render times for a document's area curve, 10 fps, capped. */
function curveTimesFor(doc) {
  const wanted = Math.max(2, Math.round(doc.duration * args.fps) + 1);
  const count = Math.min(args.curveFrames, wanted);
  return Array.from({ length: count }, (_, i) =>
    Math.round(
      Math.min((doc.duration * i) / (count - 1), doc.duration - 0.001) * 1000,
    ) / 1000,
  );
}

function zeroFeatures() {
  return Object.fromEntries(lib.FEATURE_NAMES.map((name) => [name, 0]));
}

const { result } = report;
console.log(`case      : ${report.case}  (${args.method})`);
console.log(`budget    : ${result.used}/${result.budget} evaluations in ${report.elapsedSeconds}s`);
console.log(
  `residual  : ${result.baseline.residualNorm.toFixed(4)} -> ${result.best.residualNorm.toFixed(4)}` +
    `  (${(result.improvement * 100).toFixed(1)}% better)`,
);
console.log(
  `knobs     : ${lib.KNOB_NAMES.map((n) => `${n}=${result.best.knobs[n].toFixed(3)}`).join("  ")}`,
);
if (result.jacobian)
  for (const row of result.jacobian.influence.slice(0, 4))
    console.log(
      `  ${row.knob.padEnd(19)} |J|=${row.norm.toFixed(2)}  ${row.top
        .map((t) => `${t.row}:${t.slope}`)
        .join("  ")}`,
    );
for (const note of result.notes) console.log(`note      : ${note}`);
if (problems.length) console.log(`problems  : ${problems.slice(0, 3).join(" | ")}`);
console.log(`out       : ${outDir}`);

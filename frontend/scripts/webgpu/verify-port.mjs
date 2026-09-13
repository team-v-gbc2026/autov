import { webgpuBrowserOptions } from "../browser-options.mjs";
/** WebGPU acceptance: real initialized backend, immediate canvas readback,
 * deterministic seek, all seven document fixtures, and optional WebGL comparison.
 * Linux software rendering: run under xvfb-run with AUTOV_WEBGPU_SOFTWARE=1.
 */
import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const output = path.resolve(
  process.env.AUTOV_EVIDENCE_DIR || ".autov-local/webgpu-verification",
);
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2"; export {createDocument, applyLayerPatch} from "./src/lib/vfx-lab/ui-bridge"; export {captureV2, impactTimeV2} from "./src/lib/vfx-lab/capture-v2";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
});
const baseline = process.env.AUTOV_WEBGL_BASELINE
  ? await readFile(process.env.AUTOV_WEBGL_BASELINE)
  : null;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<style>body{margin:0;background:#101112}</style><div id="host" style="width:320px;height:180px"></div>',
      );
      return;
    }
    if (req.url === "/probe.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (req.url === "/baseline.js" && baseline) {
      res.setHeader("Content-Type", "text/javascript");
      res.end(baseline);
      return;
    }
    res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const software = process.env.AUTOV_WEBGPU_SOFTWARE === "1";
const browser = await chromium.launch(webgpuBrowserOptions());
const timeout = setTimeout(() => browser.close(), 600000);
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    else if (m.text().startsWith("CHECK")) console.log(m.text());
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.addScriptTag({ url: "/probe.js" });
  if (baseline) await page.addScriptTag({ url: "/baseline.js" });
  const ids = process.env.AUTOV_FIXTURES?.split(",") || [
    "workspace",
    "fire-projectile",
    "beam",
    "fire-slash",
    "ice-blast",
    "lightning-impact",
    "shield",
    "smoke-burst",
  ];
  for (const id of ids) {
    console.log("Checking", id);
    const doc = JSON.parse(
      await readFile(
        `fixtures/v2/${["subemitters", "workspace"].includes(id) ? "fire-projectile" : id}/document.json`,
        "utf8",
      ),
    );
    if (id === "subemitters") {
      const parent = structuredClone(
        doc.layers.find((l) => l.kind === "particles"),
      );
      parent.id = "parent";
      parent.emitter.count = 8;
      parent.overrides = [];
      parent.material.mask.textureId = null;
      parent.material.ramp.stops = [
        { t: 0, color: "#ff8800", intensity: 2 },
        { t: 1, color: "#ff2200", intensity: 1 },
      ];
      const children = ["alongPath", "onDeath", "continuous"].map(
        (mode, index) => {
          const child = structuredClone(parent);
          child.id = `child-${index}`;
          child.emitter.sub = {
            parentLayerId: "parent",
            offset: [0, 0.1],
            mode,
            inheritVelocity: 0.5,
          };
          child.emitter.trail = {
            segments: 4,
            spacing: 0.03,
            widthCurve: {
              keys: [
                [0, 1],
                [1, 0],
              ],
              ease: "linear",
            },
            textureId: null,
          };
          child.material.ramp.stops = [
            { t: 0, color: "#22bbff", intensity: 2 },
            { t: 1, color: "#ffffff", intensity: 1 },
          ];
          return child;
        },
      );
      doc.layers = [parent, ...children];
    }
    const result = await page.evaluate(
      async ({ doc, compare, checkAA, checkCapture, sampleTime, workspace }) => {
        if (workspace) doc = Probe.createDocument("Workspace emitter");
        const host = document.getElementById("host");
        const runtime = new Probe.VfxRuntimeV2(host);
        try {
          runtime.setInteractive(false);
          runtime.setDocument(doc);
          runtime.renderer.setPixelRatio(1);
          runtime.resize(320, 180);
          await runtime.whenReady();
          const device = runtime.renderer.backend.device;
          device.addEventListener("uncapturederror", (e) =>
            console.error(e.error.message),
          );
          const scratch = document.createElement("canvas");
          scratch.width = 320;
          scratch.height = 180;
          const ctx = scratch.getContext("2d", { willReadFrequently: true });
          const read = (r, t, solo, diagnostic = false) => {
            r.render(t, solo, diagnostic);
            // Must happen in this task, before the WebGPU canvas is presented/cleared.
            ctx.clearRect(0, 0, 320, 180);
            ctx.drawImage(r.renderer.domElement, 0, 0, 320, 180);
            const pixels = ctx.getImageData(0, 0, 320, 180).data;
            return { pixels, png: scratch.toDataURL("image/png") };
          };
          if (workspace) {
            // Match a timeline left-edge drag in the workspace before sampling.
            read(runtime, 0.8);
            const eye = runtime.camera.position.clone();
            const target = runtime.controls.target.clone();
            doc = Probe.applyLayerPatch(doc, doc.layers[0].id, {start: 0.46, end: 1.35});
            runtime.setDocument(doc);
            runtime.camera.position.copy(eye);
            runtime.controls.target.copy(target);
            runtime.camera.lookAt(target);
            runtime.controls.update();
            await runtime.whenReady();
          }
          const t = workspace ? 0.51 : sampleTime;
          read(runtime, 0);
          console.log("CHECK first frame");
          const first = read(runtime, t);
          // Live previews render on separate animation frames, unlike captures.
          const live = await new Promise((resolve, reject) =>
            requestAnimationFrame(() => {
              try { resolve(read(runtime, t)); } catch (error) { reject(error); }
            }),
          );
          if (!first.pixels.every((v, i) => v === live.pixels[i]))
            throw new Error("Live animation-frame output differs from capture");
          const later = read(runtime, doc.duration);
          const timeChanges = first.pixels.some(
            (v, i) => v !== later.pixels[i],
          );
          const repeat = read(runtime, t);
          const deterministic = first.pixels.every(
            (v, i) => v === repeat.pixels[i],
          );
          const energy = first.pixels.reduce(
            (n, v, i) => n + (i % 4 !== 3 ? v : 0),
            0,
          );
          const distinct = new Set(
            Array.from(first.pixels).filter((_, i) => i % 4 !== 3),
          ).size;
          const diagnostic = read(runtime, t, undefined, true);
          const postChanges = first.pixels.some(
            (v, i) => v !== diagnostic.pixels[i],
          );
          const layer = doc.layers.find((l) => l.kind !== "light");
          const solo = read(runtime, t, layer.id);
          const soloChanges = first.pixels.some((v, i) => v !== solo.pixels[i]);
          let boundaryEnergy;
          if (workspace) {
            boundaryEnergy = [];
            for (const time of [0, 0.459, 0.46, 0.461, 0.51, 0.8, 1.35, 1.6, 2.99, 0]) {
              const sample = await new Promise((resolve, reject) =>
                requestAnimationFrame(() => {
                  try { resolve(read(runtime, time)); } catch (error) { reject(error); }
                }),
              );
              const energy = sample.pixels.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : v), 0);
              if (energy < 1000000) throw new Error(`Workspace ground vanished at ${time}s`);
              boundaryEnergy.push({ time, energy });
            }
          }
          let comparison;
          console.log("CHECK compare");
          if (compare) {
            const legacy = new AutoVV2.VfxRuntimeV2(host);
            try {
              legacy.setInteractive(false);
              legacy.setDocument(doc);
              legacy.renderer.setPixelRatio(1);
              legacy.resize(320, 180);
              await legacy.whenReady();
              const old = read(legacy, t);
              let sum = 0;
              for (let i = 0; i < old.pixels.length; i++)
                if (i % 4 !== 3)
                  sum += Math.abs(first.pixels[i] - old.pixels[i]);
              comparison = {
                meanAbsoluteChannelError: sum / (320 * 180 * 3),
                png: old.png,
              };
            } finally {
              legacy.dispose();
            }
          }
          // Exercise all AA modes without changing the document schema.
          console.log("CHECK AA");
          for (const aa of checkAA ? ["none", "msaa", "msaa+smaa"] : []) {
            runtime.setDocument({ ...doc, quality: { ...doc.quality, aa } });
            await runtime.whenReady();
            read(runtime, t);
          }
          let editChanges;
          if (checkAA) {
            const edited = structuredClone(doc);
            for (const layer of edited.layers)
              if (layer.material)
                for (const stop of layer.material.ramp.stops)
                  stop.color = "#00ff66";
            runtime.setDocument(edited);
            await runtime.whenReady();
            const changed = read(runtime, t);
            editChanges = first.pixels.some(
              (value, index) => value !== changed.pixels[index],
            );
          }
          let previewChecks;
          if (workspace) {
            const queue = device.queue;
            const submit = queue.submit.bind(queue);
            let submissions = 0;
            queue.submit = commands => { submissions++; return submit(commands); };
            try {
              runtime.renderPreview(0.8);
              submissions = 0;
              for (let i = 0; i < 60; i++) runtime.renderPreview(0.8);
              if (submissions !== 0) throw Error("Paused preview submitted redundant GPU work");
              runtime.resize(320, 180);
              runtime.renderPreview(0.8);
              if (submissions === 0) throw Error("Resize did not redraw paused preview");
              runtime.renderPreview(2);
              submissions = 0;
              runtime.renderPreview(2.5);
              if (submissions !== 0) throw Error("Inactive interval submitted redundant GPU work");
              runtime.renderPreview(0.51);
              if (submissions === 0) throw Error("Seeking into an emitter did not redraw");
              previewChecks = { pausedSubmissions: 0, inactiveSubmissions: 0, resizeAndSeekRedraw: true };
            } finally { queue.submit = submit; }
          }
          let capture;
          if (checkCapture) {
            const evidence = await Probe.captureV2(doc);
            capture = {
              runtime: evidence.runtime,
              renderer: evidence.renderer,
              renderedPixels: evidence.renderedPixels,
              temporal: Boolean(evidence.temporal),
              jitter: evidence.jitterScore,
              times: evidence.times,
              sheet: evidence.sheet,
            };
          }
          return {
            capture,
            boundaryEnergy,
            previewChecks,
            editChanges,
            backend: runtime.renderer.backend.isWebGPUBackend,
            adapter:
              device.adapterInfo?.description ||
              device.adapterInfo?.device ||
              "unknown",
            sampledTime: t,
            deterministic,
            timeChanges,
            energy,
            distinct,
            postChanges,
            soloChanges,
            png: first.png,
            diagnostic: diagnostic.png,
            comparison,
          };
        } finally {
          runtime.dispose();
        }
      },
      {
        doc,
        compare: Boolean(baseline),
        checkAA: id === "fire-projectile",
        workspace: id === "workspace",
        checkCapture: id === "subemitters",
        sampleTime: {
          "fire-projectile": 0.8,
          beam: 2,
          "fire-slash": 0.4,
          "ice-blast": 0.8,
          "lightning-impact": 0.22,
          shield: 1.4,
          "smoke-burst": 0.8,
          subemitters: 0.8,
          workspace: 0.8,
        }[id],
      },
    );
    const save = async (name, data) =>
      writeFile(
        path.join(output, name),
        Buffer.from(data.split(",")[1], "base64"),
      );
    await save(`${id}-webgpu.png`, result.png);
    await save(`${id}-diagnostic.png`, result.diagnostic);
    if (result.comparison) await save(`${id}-webgl.png`, result.comparison.png);
    if (result.capture) {
      await save(`${id}-capture.jpg`, result.capture.sheet);
      delete result.capture.sheet;
      assert.ok(
        result.capture.renderedPixels > 0,
        "Offscreen capture must contain pixels",
      );
      assert.match(result.capture.renderer, /WebGPU/);
      assert.ok(
        result.capture.temporal,
        "Full evaluation must include temporal diagnostics",
      );
      assert.ok(
        Number.isFinite(result.capture.jitter),
        "Jitter metric must be finite",
      );
    }
    delete result.png;
    delete result.diagnostic;
    if (result.comparison) delete result.comparison.png;
    results.push({ id, ...result });
    console.log(JSON.stringify(results.at(-1)));
    if (result.comparison)
      assert.ok(
        result.comparison.meanAbsoluteChannelError <= 8,
        `${id}: WebGL/WebGPU mean channel difference exceeds the 8/255 migration gate`,
      );
    if (result.editChanges !== undefined)
      assert.ok(
        result.editChanges,
        "Document ramp edits must reach GPU uniforms",
      );
    assert.equal(result.backend, true, "Must initialize WebGPU");
    assert.equal(
      result.deterministic,
      true,
      `${id}: seek must reproduce identical pixels`,
    );
    assert.ok(
      result.energy > 0 && result.distinct > 20,
      `${id}: expected visible rendered content`,
    );
    assert.ok(result.timeChanges, `${id}: changing time must change pixels`);
    if (id !== "workspace") assert.ok(result.soloChanges, `${id}: solo must change pixels`);
    assert.ok(result.postChanges, `${id}: post toggle must change pixels`);
    assert.equal(errors.length, 0, errors.join("\n").slice(0, 10000));
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      { three: "186", browser: browser.version(), software, results, errors },
      null,
      2,
    ),
  );
  console.log(`Verified ${results.length} fixtures. Evidence: ${output}`);
} finally {
  clearTimeout(timeout);
  await browser.close();
  server.close();
}

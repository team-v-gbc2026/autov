/** Reproducible same-size cold-load/edit/playback probe, optionally against a
 * bundle built from the base commit. Counts sync AND async GPU pipelines. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { webgpuBrowserOptions } from "../browser-options.mjs";
const out = process.env.AUTOV_EVIDENCE_DIR || ".autov-local/issue-41";
await mkdir(out, { recursive: true });
const buildOptions = {
  stdin: {
    contents: 'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
};
const bundle = await build(buildOptions);
// For this runtime-only change all imported modules are unchanged. A full
// separately built baseline can instead be supplied with BASELINE_BUNDLE.
const baselineSource = process.env.AUTOV_BASELINE_REF
  ? execFileSync(
      "git",
      [
        "show",
        `${process.env.AUTOV_BASELINE_REF}:frontend/src/lib/vfx-lab/runtime-v2.ts`,
      ],
      { encoding: "utf8" },
    )
  : null;
const baseline = process.env.AUTOV_BASELINE_BUNDLE
  ? await readFile(process.env.AUTOV_BASELINE_BUNDLE)
  : baselineSource
    ? (
        await build({
          ...buildOptions,
          plugins: [
            {
              name: "base-runtime",
              setup(builder) {
                builder.onLoad({ filter: /[/\\]runtime-v2\.ts$/ }, () => ({
                  contents: baselineSource,
                  loader: "ts",
                  resolveDir: path.resolve("src/lib/vfx-lab"),
                }));
              },
            },
          ],
        })
      ).outputFiles[0].text
    : null;
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url.endsWith(".js") ? "text/javascript" : "text/html",
  );
  res.end(
    req.url === "/probe.js"
      ? bundle.outputFiles[0].text
      : req.url === "/baseline.js"
        ? baseline
        : '<style>body{margin:0}#host{position:relative;width:960px;height:540px}canvas{width:100%;height:100%}</style><div id="host"></div>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(webgpuBrowserOptions());
const results = [];
try {
  for (const id of (
    process.env.AUTOV_FIXTURES || "ice-blast,smoke-burst,fire-projectile"
  ).split(",")) {
    const doc = JSON.parse(
      await readFile(`fixtures/v2/${id}/document.json`, "utf8"),
    );
    for (const mode of baseline ? ["baseline", "candidate"] : ["candidate"]) {
      const page = await browser.newPage({
        viewport: { width: 960, height: 540 },
        deviceScaleFactor: 1,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.addScriptTag({
        url: mode === "baseline" ? "/baseline.js" : "/probe.js",
      });
      const result = await page.evaluate(
        async ({ doc, preview, lifecycle }) => {
          let pipelines = 0;
          for (const name of [
            "createRenderPipeline",
            "createRenderPipelineAsync",
          ]) {
            const original = GPUDevice.prototype[name];
            GPUDevice.prototype[name] = function (...args) {
              pipelines++;
              return original.apply(this, args);
            };
          }
          const rt = new Probe.VfxRuntimeV2(document.getElementById("host"), {
            preview,
          });
          rt.setInteractive(false);
          const tasks = [];
          const observer = new PerformanceObserver((list) =>
            tasks.push(...list.getEntries().map((e) => e.duration)),
          );
          observer.observe({ type: "longtask" });
          const start = performance.now();
          rt.setDocument(doc);
          rt.resize(960, 540);
          await rt.whenReady();
          await rt.renderer.backend.device.queue.onSubmittedWorkDone();
          const readyMs = performance.now() - start;
          await new Promise((r) => setTimeout(r, 30));
          const prepareMaxTask = Math.max(0, ...tasks);
          tasks.length = 0;
          const readyPipelines = pipelines;
          const frames = [];
          const images = [];
          for (let i = 0; i < 12; i++) {
            const t = performance.now();
            rt.render((doc.duration * i) / 12);
            // Capture in the same task; WebGPU canvas contents are transient.
            if ([3, 6, 9].includes(i))
              images.push(rt.renderer.domElement.toDataURL());
            await rt.renderer.backend.device.queue.onSubmittedWorkDone();
            frames.push(performance.now() - t);
          }
          const latePipelines = pipelines - readyPipelines;
          const before = rt.objects.slice();
          const edit = structuredClone(doc);
          const layer = edit.layers.find((l) => l.material);
          layer.material.opacity *= 0.9;
          const t = performance.now();
          rt.setDocument(edit, { preserveCamera: true });
          await rt.whenReady();
          const editMs = performance.now() - t;
          const editPipelines = pipelines - readyPipelines - latePipelines;
          const retained = before.filter((o) => rt.objects.includes(o)).length;
          if (lifecycle) {
            // A structural edit queued during a yield must supersede preparation;
            // simultaneous callers wait for the same latest revision.
            const structural = structuredClone(edit);
            structural.layers.find((l) => l.emitter).emitter.count += 1;
            rt.setDocument(structural, { preserveCamera: true });
            const first = rt.whenReady();
            if (first !== rt.whenReady())
              throw Error("preparation was not coalesced");
            const latest = structuredClone(structural);
            latest.layers.find((l) => l.material).material.opacity = 0.37;
            setTimeout(
              () => rt.setDocument(latest, { preserveCamera: true }),
              0,
            );
            await first;
            if (rt.preparedDocument !== rt.doc || rt.warming)
              throw Error("latest revision was not prepared");
            if (rt.doc.layers.find((l) => l.material).material.opacity !== 0.37)
              throw Error("superseded edit won");
            const compiled = pipelines;
            await rt.whenReady();
            if (pipelines !== compiled)
              throw Error("repeated readiness compiled again");
            if (preview) {
              rt.setDocument(
                { ...latest, layers: [] },
                { preserveCamera: true },
              );
              await rt.whenReady();
              rt.render(0);
            }
            rt.setDocument(structural, { preserveCamera: true });
            const closing = rt.whenReady();
            setTimeout(() => rt.dispose(), 0);
            await closing;
            await rt.dispose();
            if (document.getElementById("host").children.length)
              throw Error("preparation leaked a canvas on dispose");
          }
          await rt.dispose();
          observer.disconnect();
          return {
            readyMs,
            prepareMaxTask,
            readyPipelines,
            latePipelines,
            frameMax: Math.max(...frames),
            editMs,
            editPipelines,
            retained,
            layers: before.length,
            images,
          };
        },
        {
          doc,
          preview: process.env.AUTOV_PLAYER !== "1",
          lifecycle:
            mode === "candidate" && process.env.AUTOV_LIFECYCLE === "1",
        },
      );
      for (let i = 0; i < result.images.length; i++)
        await writeFile(
          `${out}/${id}-${mode}-${i}.png`,
          Buffer.from(result.images[i].split(",")[1], "base64"),
        );
      delete result.images;
      results.push({ id, mode, ...result, errors });
      console.log(JSON.stringify(results.at(-1)));
      await page.close();
    }
  }
  const pixels = [];
  if (baseline) {
    for (const id of new Set(results.map((result) => result.id))) {
      for (let frame = 0; frame < 3; frame++) {
        const before = await sharp(`${out}/${id}-baseline-${frame}.png`)
          .raw()
          .toBuffer();
        const after = await sharp(`${out}/${id}-candidate-${frame}.png`)
          .raw()
          .toBuffer();
        assert.equal(before.length, after.length, "capture resolution changed");
        let maximumDelta = 0,
          changedChannels = 0;
        for (let i = 0; i < before.length; i++) {
          const delta = Math.abs(before[i] - after[i]);
          maximumDelta = Math.max(maximumDelta, delta);
          if (delta) changedChannels++;
        }
        // Independent GPU runs can round a final 8-bit channel by one unit.
        // Keep the tolerance explicit and tiny; do not accept image-wide drift.
        const consistent = maximumDelta <= 1 && changedChannels <= 16;
        pixels.push({
          id,
          frame,
          equal: before.equals(after),
          maximumDelta,
          changedChannels,
          consistent,
        });
      }
    }
    await writeFile(`${out}/pixels.json`, JSON.stringify(pixels, null, 2));
  }
  await writeFile(`${out}/hitch.json`, JSON.stringify(results, null, 2));
  assert.ok(
    pixels.every((frame) => frame.consistent),
    "visual regression; see pixels.json",
  );
  if (
    results.some(
      (r) =>
        r.errors.length ||
        r.editPipelines ||
        r.retained !== r.layers ||
        (r.mode === "candidate" &&
          r.latePipelines > Number(process.env.AUTOV_LATE_PIPELINES || 0)),
    )
  )
    throw Error("GPU errors or live-edit rebuild; see hitch.json");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

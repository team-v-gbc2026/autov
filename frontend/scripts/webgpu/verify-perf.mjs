import { webgpuBrowserOptions } from "../browser-options.mjs";
/** The performance contract.
 *
 * Every exemplar plus a synthetic document that holds every layer kind at the
 * lint ceiling, drawn through a PREVIEW runtime at the studio's size. It fails
 * on a warm frame over the budget, on more programs than the budget allows, and
 * on two layers of one kind whose generated WGSL differs — the last of these is
 * what let a single document ask the device for six hundred pipelines.
 */
import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

/** Pipelines a document may still build on its first frames. */
const LATE_PIPELINES = Number(process.env.AUTOV_LATE_PIPELINES || 3);
/** Warm frame budget at studio size, in milliseconds. */
const FRAME_MS = Number(process.env.AUTOV_FRAME_BUDGET || 20);
/** Longest of a document first frames, in milliseconds. A pipeline built here
 * is a visible hitch on the first play. */
const COLD_FRAME_MS = Number(process.env.AUTOV_COLD_FRAME_BUDGET || 100);
const output = path.resolve(
  process.env.AUTOV_EVIDENCE_DIR || ".autov-local/perf-verification",
);
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2"; export {validateDocumentV2} from "./src/lib/vfx-lab/schema-v2"; export {gpuCostV2, GPU_BUDGET_V2, instanceCountOf} from "./src/lib/vfx-lab/gpu-budget-v2";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
});
const server = createServer((req, res) => {
  if (req.url === "/probe.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<style>body{margin:0;background:#101112}</style><div id="host" style="width:1264px;height:790px"></div>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const ids = (await readdir("fixtures/v2")).sort();
const documents = Object.fromEntries(
  await Promise.all(
    ids.map(async (id) => [
      id,
      JSON.parse(await readFile(`fixtures/v2/${id}/document.json`, "utf8")),
    ]),
  ),
);
// One layer of every kind the exemplars use, at the budget's instance ceiling:
// the document no author would write and a model might.
const byKind = new Map();
for (const id of ids)
  for (const layer of documents[id].layers)
    if (!byKind.has(layer.kind)) byKind.set(layer.kind, { id, layer });
const worstCase = structuredClone(documents["smoke-burst"]);
worstCase.name = "Every kind at the ceiling";
// Long enough to hold every borrowed layer's own window, and the layers keep
// their authored spans so their tracks stay inside them.
worstCase.duration = Math.max(
  ...[...byKind.values()].map(({ id }) => documents[id].duration),
);
worstCase.layers = [...byKind.values()].map(({ layer }, index) => {
  const copy = structuredClone(layer);
  copy.id = `worst-${index}-${layer.kind.toLowerCase()}`;
  copy.enabled = true;
  // Tracks and overrides are the layer's own animation, not its draw cost, and
  // their keyframes belong to the document they came from.
  copy.tracks = [];
  copy.overrides = [];
  return copy;
});
// A borrowed layer's curve travels with it: a ribbon and a path-arranged blob
// are nothing without theirs. The document holds at most PATH_BUDGET_V2 of
// them and the exemplars between them reference two, so none has to be cut.
const wantedPaths = new Map();
for (const { id, layer } of byKind.values())
  for (const match of JSON.stringify(layer).matchAll(/"pathId":"([^"]+)"/g)) {
    const found = (documents[id].paths ?? []).find((p) => p.id === match[1]);
    if (found) wantedPaths.set(found.id, found);
  }
assert.ok(
  wantedPaths.size <= 6,
  `the worst case wants ${wantedPaths.size} paths, over the document budget`,
);
worstCase.paths = [...wantedPaths.values()];
// Cross-layer references are by id, so they are re-pointed at this document's
// own copies: licks follow a crescent and a reflection needs a mesh layer.
// References to a layer that did not come along are dropped instead.
const idOf = (kind) => worstCase.layers.find((layer) => layer.kind === kind).id;
for (const layer of worstCase.layers) {
  if (layer.licks) layer.licks.anchor.sourceLayerId = idOf("crescent");
  if (layer.reflection) layer.reflection.sourceLayerId = idOf("shell");
  if (layer.emitter?.sub) layer.emitter.sub = null;
  if (layer.emitter?.shape?.sourceLayerId) {
    layer.emitter.shape.sourceLayerId = null;
    if (layer.emitter.shape.type === "layerInstances")
      layer.emitter.shape.type = "sphere";
  }
  if (layer.emitter?.spawn?.sourceLayerId) {
    layer.emitter.spawn.sourceLayerId = null;
    if (layer.emitter.spawn.mode === "frontAnchored")
      layer.emitter.spawn.mode = "burst";
  }
}

const browser = await chromium.launch(webgpuBrowserOptions());
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__pipelines = 0;
    window.__pipelineLabels = [];
    const timer = setInterval(() => {
      if (!globalThis.GPUDevice) return;
      clearInterval(timer);
      const create = GPUDevice.prototype.createRenderPipeline;
      GPUDevice.prototype.createRenderPipeline = function (...args) {
        window.__pipelines++;
        window.__pipelineLabels.push(args[0]?.label ?? "(unlabelled)");
        return create.apply(this, args);
      };
    }, 0);
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.addScriptTag({ url: "/probe.js" });

  const measure = async (id, doc, scaleToCeiling) => {
    const result = await page.evaluate(
      async ({ doc, scaleToCeiling }) => {
        const host = document.getElementById("host");
        if (scaleToCeiling) {
          // Every kind at the largest count its own schema allows, then the
          // same repair a candidate gets. This is the most expensive document
          // that can ship, so it is the one the budget has to hold for.
          const ceiling = {
            particles: 24000,
            crystals: 400,
            blob: 40,
            splash: 24,
            sheets: 48,
          };
          for (const layer of doc.layers) {
            const count = Probe.instanceCountOf(layer);
            const cap = ceiling[layer.kind];
            if (count && cap) count.set(cap);
          }
          let cost = Probe.gpuCostV2(doc);
          if (cost.instances > Probe.GPU_BUDGET_V2.instances) {
            const factor = Probe.GPU_BUDGET_V2.instances / cost.instances;
            for (const layer of doc.layers) {
              const count = Probe.instanceCountOf(layer);
              if (count) count.set(Math.max(1, Math.floor(count.get * factor)));
            }
          }
        }
        let validated;
        try {
          validated = Probe.validateDocumentV2(doc);
        } catch (error) {
          return { error: (error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ").slice(0, 900) || String(error).slice(0, 600) };
        }
        const cost = Probe.gpuCostV2(validated);
        const before = window.__pipelines;
        const runtime = new Probe.VfxRuntimeV2(host, { preview: true });
        try {
          runtime.setInteractive(false);
          runtime.setDocument(validated);
          runtime.resize(1264, 790);
          await runtime.whenReady();
          const device = runtime.renderer.backend.device;
          device.addEventListener("uncapturederror", (event) =>
            console.error("GPU " + event.error.message),
          );
          const built = window.__pipelines - before;
          // Cold: the first frames this document ever draws. A program the
          // runtime failed to build in whenReady stalls here, so the longest of
          // them is the number that says whether the first play is clean.
          // Drain whatever whenReady queued, so the first measured frame is not
          // billed for the warm-up pass sitting in front of it.
          await device.queue.onSubmittedWorkDone();
          const cold = [];
          for (let i = 0; i < 6; i++) {
            const at = performance.now();
            runtime.render((validated.duration * i) / 6);
            await device.queue.onSubmittedWorkDone();
            cold.push(performance.now() - at);
          }
          const coldMaxMs = Math.round(Math.max(...cold) * 10) / 10;
          const coldFrames = cold.map((ms) => Math.round(ms * 10) / 10);
          // Warm: everything this document needs is already built.
          const frames = 30;
          for (let i = 0; i < 4; i++) runtime.render(validated.duration * 0.5);
          await device.queue.onSubmittedWorkDone();
          const started = performance.now();
          for (let i = 0; i < frames; i++)
            runtime.render(validated.duration * (0.35 + (0.3 * i) / frames));
          await device.queue.onSubmittedWorkDone();
          const warmMs = (performance.now() - started) / frames;
          const duringPlayback = window.__pipelines - before - built;
          return {
            cost,
            built,
            coldMaxMs,
            coldFrames,
            duringPlayback,
            late: window.__pipelineLabels.slice(before + built),
            warmMs: Math.round(warmMs * 10) / 10,
          };
        } finally {
          await runtime.dispose();
        }
      },
      { doc, scaleToCeiling },
    );
    if (result.error) throw new Error(`${id}: ${result.error}`);
    results.push({ id, ...result });
    console.log(
      `${id.padEnd(24)} cold ${String(result.coldMaxMs).padStart(6)} ms  warm ${String(result.warmMs).padStart(6)} ms  draws ${String(result.cost.draws).padStart(4)}  programs ${String(result.cost.pipelines).padStart(3)}  instances ${String(result.cost.instances).padStart(5)}  pipelines built ${result.built} (+${result.duringPlayback} while playing)`,
    );
    assert.ok(
      result.coldMaxMs < COLD_FRAME_MS,
      `${id}: longest cold frame ${result.coldMaxMs} ms over the ${COLD_FRAME_MS} ms budget (${result.coldFrames.join(", ")})`,
    );
    assert.ok(
      result.warmMs < FRAME_MS,
      `${id}: warm frame ${result.warmMs} ms over the ${FRAME_MS} ms budget`,
    );
    // Playback must not compile. The allowance covers first-use settling that
    // the warm pass cannot reach — on ice-blast the environment's ground
    // material and two draws entering the soft-particle depth pre-pass — and is
    // deliberately small, with the labels printed, so any growth is visible.
    assert.ok(
      result.duringPlayback <= LATE_PIPELINES,
      `${id}: built ${result.duringPlayback} pipelines during playback (${(result.late ?? []).join(", ")})`,
    );
    assert.equal(errors.length, 0, errors.join("\n").slice(0, 3000));
  };

  for (const id of ids) await measure(id, documents[id], false);
  await measure("worst-case", worstCase, true);

  // Two layers of one kind must generate the same shader text, or nothing is
  // ever shared and every layer costs its own program.
  console.log("Checking that a kind generates one program");
  for (const [kind, sample] of byKind) {
    if (kind === "light") continue;
    // The layer is duplicated INSIDE its own document, so every reference it
    // carries — a curve, a crescent to follow, a mesh to reflect — stays valid
    // and the pair is compared in the scene the author wrote for it.
    const doc = structuredClone(documents[sample.id]);
    const second = structuredClone(sample.layer);
    // Layer ids are lower case by schema.
    const secondId = `${kind.toLowerCase()}-b`;
    second.id = secondId;
    doc.layers.push(second);
    const diff = await page.evaluate(async ({ doc, first, secondId }) => {
      const host = document.getElementById("host");
      const runtime = new Probe.VfxRuntimeV2(host, { preview: true });
      try {
        runtime.setInteractive(false);
        runtime.setDocument(Probe.validateDocumentV2(doc));
        runtime.resize(320, 180);
        await runtime.whenReady();
        const pick = (id) => {
          const found = [];
          runtime.scene.traverse((object) => {
            // wireBurst draws as LineSegments, everything else as a Mesh.
            if (!object.isMesh && !object.isLine && !object.isPoints) return;
            if (!object.material?.vertexNode) return;
            if (object.name === id || object.parent?.name === id) found.push(object);
          });
          return found[0];
        };
        const a = pick(first);
        const b = pick(secondId);
        if (!a || !b) return { skipped: true };
        const shaderA = await runtime.renderer.debug.getShaderAsync(runtime.scene, runtime.camera, a);
        const shaderB = await runtime.renderer.debug.getShaderAsync(runtime.scene, runtime.camera, b);
        return {
          vertex: shaderA.vertexShader === shaderB.vertexShader,
          fragment: shaderA.fragmentShader === shaderB.fragmentShader,
          size: shaderA.vertexShader.length + shaderA.fragmentShader.length,
        };
      } finally {
        await runtime.dispose();
      }
    }, { doc, first: sample.layer.id, secondId });
    if (diff.skipped) {
      console.log(`  ${kind.padEnd(14)} no comparable draw`);
      continue;
    }
    console.log(`  ${kind.padEnd(14)} vertex ${diff.vertex ? "same" : "DIFFERS"}  fragment ${diff.fragment ? "same" : "DIFFERS"}  (${diff.size} chars)`);
    assert.ok(diff.vertex, `${kind}: two layers generate different vertex shaders`);
    assert.ok(diff.fragment, `${kind}: two layers generate different fragment shaders`);
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ browser: browser.version(), frameBudgetMs: FRAME_MS, coldFrameBudgetMs: COLD_FRAME_MS, results }, null, 2),
  );
  console.log(`Verified ${results.length} documents against the performance contract.`);
} finally {
  await browser.close();
  server.close();
}

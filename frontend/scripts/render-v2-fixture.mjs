#!/usr/bin/env node
// Headless verification for the v2 renderer.
//
// Bundles a tiny entry that imports runtime-v2 plus a fixture, serves it (with
// frontend/public, plus local textures at /textures/v2/* when a texture
// directory is available — see scripts/vfx-assets.mjs), opens it in Playwright
// chromium
// on SwiftShader and screenshots a few times into .autov-local/v2-verify/.
//
// Usage: node scripts/render-v2-fixture.mjs [fixtureId] [times...]
//   node scripts/render-v2-fixture.mjs fire-projectile 2.0 3.1
//   node scripts/render-v2-fixture.mjs --doc lightning-impact 0.36 0.42
//   node scripts/render-v2-fixture.mjs --doc ./some/document.json 1.0
//
// --doc takes either a recipe-v2 example id (rendered through createPresetV2)
// or a path to a document JSON. Screenshots are written under a per-document
// sub-directory of .autov-local/v2-verify/.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetBaseScript,
  resolveTextureSource,
  serveLocalTexture,
} from "./vfx-assets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const FALLBACK_MODULES = process.env.AUTOV_VERIFY_MODULES || "/home/claude/spike/node_modules";

function load(name, preferFallback = false) {
  const candidates = preferFallback
    ? [path.join(FALLBACK_MODULES, name), path.join(root, "node_modules", name)]
    : [path.join(root, "node_modules", name), path.join(FALLBACK_MODULES, name)];
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return require(candidate);
  return require(name);
}

const esbuild = load("esbuild");
// The sandbox's pre-installed browsers match the pinned playwright next door.
const { chromium } = load("playwright", fs.existsSync(FALLBACK_MODULES));

const argv = process.argv.slice(2);
const docFlag = argv.indexOf("--doc");
let docId = null;
if (docFlag >= 0) {
  docId = argv[docFlag + 1];
  argv.splice(docFlag, 2);
  if (!docId) throw new Error("--doc needs a recipe id or a path");
}
const fixtureId = docId ?? argv.shift() ?? "fire-projectile";
const times = (argv.length ? argv : ["2.0", "3.1"]).map(Number);
const label = fixtureId.replace(/[^a-zA-Z0-9._-]+/g, "_");
const outDir = path.join(root, ".autov-local", "v2-verify", label);
fs.mkdirSync(outDir, { recursive: true });

// --doc: a recipe example id, or a path to a document JSON.
const RECIPE_IDS = new Set([
  "fire-projectile",
  "smoke-burst",
  "lightning-impact",
  "fire-slash",
  "beam",
  "shield",
  "meteor-rain",
  "ice-blast",
  "healing-aura",
  "glitch-projectile",
  "energy-column",
  "portal",
  "sky-vortex",
]);
const docImport = !docId
  ? `import doc from "../fixtures/v2/${fixtureId}/document.json";`
  : RECIPE_IDS.has(docId)
    ? `import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";\nconst doc = createPresetV2(${JSON.stringify(docId)});`
    : `import doc from ${JSON.stringify(path.resolve(process.cwd(), docId))};`;

const entry = `
import { VfxRuntimeV2, RUNTIME_VERSION_V2 } from "../src/lib/vfx-lab/runtime-v2";
${docImport}

const host = document.getElementById("host");
const runtime = new VfxRuntimeV2(host);
// Deterministic capture: never let orbit/pan/zoom controls perturb the camera.
runtime.setInteractive(false);
window.__v2 = { runtime, version: RUNTIME_VERSION_V2, doc };
window.__ready = (async () => {
  runtime.setDocument(doc);
  runtime.resize(1280, 720);
  await runtime.whenReady();
  // One warm-up frame so every shader is compiled before the first capture.
  runtime.render(0);
  return true;
})();
window.__renderAt = (t) => { runtime.render(t, window.__solo || undefined, !!window.__diag); };
window.__setCamera = (p, t, fov) => {
  runtime.camera.fov = fov;
  runtime.camera.position.set(p[0], p[1], p[2]);
  runtime.camera.lookAt(t[0], t[1], t[2]);
  runtime.camera.updateProjectionMatrix();
};
window.__frame = () => ({
  center: runtime.frame.center.toArray(),
  distance: runtime.frame.distance,
  camera: runtime.camera.position.toArray(),
});
`;

const entryPath = path.join(root, ".autov-local", "v2-entry.mjs");
fs.mkdirSync(path.dirname(entryPath), { recursive: true });
fs.writeFileSync(entryPath, entry);

const bundle = await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  format: "iife",
  write: false,
  target: "es2020",
  loader: { ".json": "json" },
  absWorkingDir: root,
  logLevel: "warning",
});
const js = bundle.outputFiles[0].text;

const textures = resolveTextureSource(root);
const html = `<!doctype html><html><head><meta charset="utf-8"><title>v2 verify</title>
<style>html,body{margin:0;background:#000}#host{width:1280px;height:720px}canvas{display:block}</style>
</head><body><div id="host"></div>${assetBaseScript(textures.base)}<script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;

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
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 400)}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 400)}`));

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction("window.__ready !== undefined", null, { timeout: 30000 });
await page.evaluate("window.__ready");
await page.waitForTimeout(300);
if (process.env.CAM) {
  const cam = JSON.parse(process.env.CAM);
  await page.evaluate((c) => window.__setCamera(c.p, c.t, c.fov), cam);
}
if (process.env.DIAG)
  await page.evaluate(() => {
    window.__diag = true;
  });
if (process.env.SOLO)
  await page.evaluate((id) => {
    window.__solo = id;
  }, process.env.SOLO);

const results = [];
for (const t of times) {
  await page.evaluate((time) => window.__renderAt(time), t);
  await page.waitForTimeout(150);
  const file = path.join(outDir, `t${t.toFixed(2)}.png`);
  const buffer = await page.locator("canvas").screenshot({ path: file });
  results.push({ t, file, buffer });
}

// Determinism: the same time rendered twice must be byte-identical.
const probe = times[times.length - 1];
await page.evaluate((time) => window.__renderAt(time), probe);
await page.waitForTimeout(150);
const again = await page.locator("canvas").screenshot({
  path: path.join(outDir, `t${probe.toFixed(2)}-again.png`),
});
const first = results[results.length - 1].buffer;
const identical = Buffer.compare(first, again) === 0;

// Black-frame / NaN guard: a frame must carry real luminance variation.
const stats = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const off = document.createElement("canvas");
  off.width = 320;
  off.height = 180;
  const ctx = off.getContext("2d");
  ctx.drawImage(canvas, 0, 0, 320, 180);
  const data = ctx.getImageData(0, 0, 320, 180).data;
  let sum = 0;
  let max = 0;
  let bright = 0;
  // Same rule as capture-v2's evidence: anything that differs from the corner
  // background by more than 12 counts as drawn.
  const bg = [data[0], data[1], data[2]];
  let renderedPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += l;
    if (l > max) max = l;
    if (l > 40) bright++;
    if (Math.max(...bg.map((v, c) => Math.abs(data[i + c] - v))) > 12)
      renderedPixels++;
  }
  return {
    mean: sum / (data.length / 4),
    max,
    brightFraction: bright / (data.length / 4),
    renderedPixels,
  };
});

const frame = await page.evaluate(() => window.__frame());

await browser.close();
server.close();

const failures = [];
if (problems.length) failures.push(`console/page errors:\n  ${problems.join("\n  ")}`);
if (!identical) failures.push("render(t) twice was not byte-identical");
if (stats.max < 30) failures.push(`frame looks black (max luminance ${stats.max})`);
if (!(stats.mean > 0)) failures.push("frame luminance is NaN");

console.log(`fixture: ${fixtureId}`);
console.log(`frames:  ${results.map((r) => r.file).join("\n         ")}`);
console.log(`stats:   ${JSON.stringify(stats)}`);
console.log(`framing: ${JSON.stringify(frame)}`);
console.log(`determinism: ${identical ? "identical" : "DIFFERS"}`);
if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOK");

// Headless captureV2 harness.
//
// captureV2 needs a DOM, a WebGL context and the texture library served from
// /textures/v2/*, so it cannot run under the node test runner. This module
// bundles it once, serves frontend/public beside it, opens the page in
// Playwright chromium on SwiftShader and returns real Evidence records —
// contact sheet, motion strip, rendered pixels, 30 Hz diagnostics and jitter —
// for whichever documents the caller passes in.
//
// Shared by scripts/verify-review-v2.mjs and the live review self-test.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const FALLBACK_MODULES =
  process.env.AUTOV_VERIFY_MODULES || "/home/codex/spike/node_modules";

function load(name, preferFallback = false) {
  const candidates = preferFallback
    ? [path.join(FALLBACK_MODULES, name), path.join(root, "node_modules", name)]
    : [
        path.join(root, "node_modules", name),
        path.join(FALLBACK_MODULES, name),
      ];
  for (const candidate of candidates)
    if (fs.existsSync(candidate)) return require(candidate);
  return require(name);
}

const ENTRY = `
import { captureV2 } from "../src/lib/vfx-lab/capture-v2";
window.__capture = (doc, options) => captureV2(doc, options || {});
window.__harnessReady = true;
`;

/**
 * Capture every document in `documents` and return `{ id, evidence }` records
 * in the same order. One browser and one bundle serve the whole batch.
 */
export async function captureDocumentsV2(documents, options = {}) {
  const esbuild = load("esbuild");
  const { chromium } = load("playwright", fs.existsSync(FALLBACK_MODULES));

  const entryPath = path.join(root, ".autov-local", "v2-capture-entry.mjs");
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, ENTRY);
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>v2 capture</title>
<style>html,body{margin:0;background:#000}</style></head><body>
<script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;

  const publicDir = path.join(root, "public");
  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    const file = path.join(
      publicDir,
      path.normalize(url).replace(/^(\.\.[/\\])+/, ""),
    );
    if (
      file.startsWith(publicDir) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile()
    ) {
      res.writeHead(200, {
        "content-type": file.endsWith(".png")
          ? "image/png"
          : "application/octet-stream",
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
  const problems = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction("window.__harnessReady === true", null, {
      timeout: 60000,
    });
    const results = [];
    for (const entry of documents) {
      const evidence = await page.evaluate(
        async ({ doc, captureOptions }) =>
          await window.__capture(doc, captureOptions),
        { doc: entry.document, captureOptions: options.capture ?? {} },
      );
      results.push({ id: entry.id, evidence });
    }
    return { results, problems };
  } finally {
    await browser.close();
    server.close();
  }
}

/** Write a data: URL out as a PNG next to the other verification artefacts. */
export async function writeDataUrlAsPng(dataUrl, file) {
  const sharp = load("sharp");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(base64, "base64")).png().toFile(file);
  return file;
}

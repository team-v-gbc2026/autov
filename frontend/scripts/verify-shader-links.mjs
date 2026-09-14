#!/usr/bin/env node
// Shader link/validate verification for the v2 runtime.
//
// Every v2 program is assembled from string fragments at runtime, so a uniform
// used in one variant and declared only in another compiles fine in the file
// and fails to LINK in the browser. Three.js logs that and carries on: the
// draw is silently skipped, a whole pass disappears from the frame, and the
// only trace is a GL_INVALID_OPERATION (1282) left in the error queue by the
// useProgram that followed. That is exactly how splashFragmentV2 shipped
// referencing the blob's uShade — every splash layer drew nothing.
//
// This renders every exemplar once, at a few times spanning its duration, and
// reports (a) any shader compile/link/validate message on the console and (b)
// any non-zero gl.getError() after a render. Used by tests/shader-links.test.ts
// and runnable directly:
//
//   node scripts/verify-shader-links.mjs
//   node scripts/verify-shader-links.mjs ./path/to/effect.json

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

const FALLBACK_MODULES =
  process.env.AUTOV_VERIFY_MODULES || "/home/claude/spike/node_modules";

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

/** Every exemplar shipped in fixtures/v2, by id. */
export function exemplarIds() {
  const dir = path.join(root, "fixtures", "v2");
  return fs
    .readdirSync(dir)
    .filter((id) =>
      fs.existsSync(path.join(dir, id, "document.json")),
    )
    .sort();
}

/** Anything the browser says that means a program did not come up. */
const SHADER_ERROR = /shader|program|glsl|VALIDATE_STATUS|INVALID_OPERATION/i;

const ENTRY = `
import { VfxRuntimeV2 } from "../src/lib/vfx-lab/runtime-v2";
const host = document.getElementById("host");
const runtime = new VfxRuntimeV2(host);
runtime.setInteractive(false);
runtime.resize(640, 360);
window.__harnessReady = true;
/**
 * Render one document at a handful of times and report the WebGL error queue.
 * The queue is drained first so a document is never blamed for the one before
 * it, and read after every render so the failing time is identifiable.
 */
window.__renderDoc = async (doc) => {
  const gl = runtime.renderer.getContext();
  while (gl.getError() !== gl.NO_ERROR) {}
  runtime.setDocument(doc);
  await runtime.whenReady();
  const errors = [];
  const times = [0, 0.25, 0.5, 0.75, 1].map((f) => f * doc.duration);
  for (const t of times) {
    runtime.render(t);
    let code;
    while ((code = gl.getError()) !== gl.NO_ERROR)
      errors.push({ time: t, code });
  }
  return errors;
};
`;

/**
 * Render every supplied `{ id, document }` and return one record per document:
 * `{ id, glErrors, messages }`. `messages` are the console/page errors emitted
 * while that document was on screen and matching SHADER_ERROR.
 */
export async function verifyShaderLinks(documents) {
  const esbuild = load("esbuild");
  const { chromium } = load("playwright", fs.existsSync(FALLBACK_MODULES));

  const entryPath = path.join(root, ".autov-local", "v2-shader-entry.mjs");
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
  const textures = resolveTextureSource(root);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>v2 shaders</title>
<style>html,body{margin:0;background:#000}#host{width:640px;height:360px}canvas{display:block}</style>
</head><body><div id="host"></div>${assetBaseScript(textures.base)}
<script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;

  const publicDir = path.join(root, "public");
  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (serveLocalTexture(url, res, textures.dir)) return;
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
  try {
    const page = await browser.newPage({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
    });
    // The message sink is swapped per document so a link failure is attributed
    // to the exemplar that was on screen when it happened.
    let sink = [];
    page.on("console", (m) => {
      const text = m.text();
      if (
        (m.type() === "error" || m.type() === "warning") &&
        SHADER_ERROR.test(text)
      )
        sink.push(`console.${m.type()}: ${text.slice(0, 600)}`);
    });
    page.on("pageerror", (e) => sink.push(`pageerror: ${e.message.slice(0, 600)}`));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction("window.__harnessReady === true", null, {
      timeout: 60000,
    });
    const results = [];
    for (const entry of documents) {
      sink = [];
      const glErrors = await page.evaluate(
        async (doc) => await window.__renderDoc(doc),
        entry.document,
      );
      results.push({ id: entry.id, glErrors, messages: sink });
    }
    return results;
  } finally {
    await browser.close();
    server.close();
  }
}

/** Every exemplar as `{ id, document }`, ready for `verifyShaderLinks`. */
export function exemplarDocuments() {
  return exemplarIds().map((id) => ({
    id,
    document: JSON.parse(
      fs.readFileSync(
        path.join(root, "fixtures", "v2", id, "document.json"),
        "utf8",
      ),
    ),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const extra = process.argv.slice(2).map((file) => ({
    id: file,
    document: JSON.parse(fs.readFileSync(path.resolve(file), "utf8")),
  }));
  const results = await verifyShaderLinks([
    ...(extra.length ? [] : exemplarDocuments()),
    ...extra,
  ]);
  let failed = 0;
  for (const r of results) {
    const bad = r.glErrors.length || r.messages.length;
    if (bad) failed++;
    console.log(
      `${bad ? "FAIL" : "ok  "} ${r.id}${
        r.glErrors.length
          ? ` — gl.getError ${r.glErrors.map((e) => e.code).join(",")}`
          : ""
      }`,
    );
    for (const m of r.messages) console.log(`      ${m}`);
  }
  process.exitCode = failed ? 1 : 0;
}

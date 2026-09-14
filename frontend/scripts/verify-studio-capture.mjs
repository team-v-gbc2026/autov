import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { webgpuBrowserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: 'export {captureV2} from "./src/lib/vfx-lab/capture-v2"; export {createDocument} from "./src/lib/vfx-lab/ui-bridge";', resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", globalName: "CaptureTest", platform: "browser", define: { "process.env": "{}" } });
const server = createServer((req, res) => { res.setHeader("content-type", req.url === "/capture.js" ? "text/javascript" : "text/html"); res.end(req.url === "/capture.js" ? bundle.outputFiles[0].text : '<html><body><script src="/capture.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(webgpuBrowserOptions());
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const doc = CaptureTest.createDocument("Capture test");
    const evidence = await CaptureTest.captureV2(doc, { times: [.2, .5], solo: doc.layers[0].id });
    let invalidRejected = false;
    try { await CaptureTest.captureV2(doc, { times: [doc.duration + 1] }); } catch { invalidRejected = true; }
    return { times: evidence.times, pixels: evidence.renderedPixels, image: evidence.sheet.startsWith("data:image/jpeg;base64,"), invalidRejected };
  });
  assert.deepEqual(result.times, [.2, .5]);
  assert.ok(result.pixels > 8);
  assert.ok(result.image && result.invalidRejected);
  console.log("PASS: real WebGPU capture, explicit timestamps, solo layer, visible pixels, invalid-time rejection.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

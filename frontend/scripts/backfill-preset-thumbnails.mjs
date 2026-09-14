#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "public/trial-presets/manifest.json"), "utf8"));
const presets = manifest.trials.filter(item => item.latest && item.selected);
const bundle = await readFile(path.join(root, "public/vfx-runtime.js"));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/runtime.js") {
      response.setHeader("content-type", "text/javascript");
      return response.end(bundle);
    }
    const match = /^\/effect\/([-a-zA-Z0-9]+)$/.exec(url.pathname);
    if (match) {
      response.setHeader("content-type", "application/json");
      return response.end(await readFile(path.join(root, "public/trial-presets/effects", match[1], "document.json")));
    }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><style>html,body,#stage{margin:0;width:480px;height:270px;overflow:hidden;background:#0b0e10}</style><div id="stage"></div><script src="/runtime.js"></script><script>(async()=>{const id=new URLSearchParams(location.search).get('id'),doc=await fetch('/effect/'+id).then(r=>r.json()),runtime=new AutoV.VfxRuntime(document.querySelector('#stage'));await runtime.prepare(doc);runtime.setDocument(doc);runtime.resetCamera();window.duration=doc.duration;window.draw=async t=>{runtime.render(t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))};await window.draw(doc.duration/2);document.documentElement.dataset.ready='1'})().catch(e=>document.documentElement.dataset.error=String(e))</script>`);
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const out = path.join(root, "public/trial-presets/thumbnails");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
try {
  for (const preset of presets) {
    await page.goto(`http://127.0.0.1:${port}/?id=${preset.id}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready || document.documentElement.dataset.error);
    const error = await page.locator("html").getAttribute("data-error");
    if (error) throw new Error(`${preset.id}: ${error}`);
    const duration = await page.evaluate(() => window.duration);
    let best, bestScore = -1;
    for (let step = 1; step <= 10; step++) {
      await page.evaluate(time => window.draw(time), duration * step / 11);
      const image = await page.locator("#stage").screenshot({ type: "png" });
      const { channels } = await sharp(image).stats();
      const score = channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0);
      if (score > bestScore) { best = image; bestScore = score; }
    }
    await sharp(best).webp({ quality: 84 }).toFile(path.join(out, `${preset.id}.webp`));
    console.log(`rendered ${preset.id}`);
  }
} finally {
  await browser.close();
  server.close();
}

import { browserOptions } from "./browser-options.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const out = path.resolve(".autov-local/gallery-verification");
await mkdir(out, { recursive: true });
const base = process.env.AUTOV_TEST_URL || "http://127.0.0.1:3031";
const browser = await chromium.launch(browserOptions());
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1050 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("/local/trials", base).href);
  await page.getByRole("button", { name: "Review trial ↗" }).first().waitFor();
  const cards = await page.locator(".trial-grid article").count();
  assert.ok(cards > 0);
  await page.getByLabel("Trial view").selectOption("latest");
  const grouped = await page.locator(".trial-grid article").count();
  assert.ok(grouped > 0 && grouped <= cards);
  await page.getByLabel("Trial view").selectOption("all");
  assert.equal(await page.locator(".trial-grid article").count(), cards);
  await page.screenshot({
    path: path.join(out, "gallery.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review trial ↗" }).first().click();
  const player = page.frameLocator("iframe[title='Interactive VFX player']");
  await player.locator("#clock").filter({ hasText: "s" }).waitFor();
  assert.equal(await player.locator("#error").innerText(), "");
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await player.getByLabel("Playback position").fill("0.65");
  await page.screenshot({ path: path.join(out, "detail.png") });
  const reference = page.getByLabel("Reference video", { exact: true });
  await reference.waitFor();
  await reference.evaluate(async (video) => {
    if (video.readyState < 1)
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        video.addEventListener("error", reject, { once: true });
      });
    if (!(video.duration > 0 && video.videoWidth > 0))
      throw Error("Invalid reference video");
    video.currentTime = Math.min(0.5, video.duration / 2);
  });
  const imageCount = await page.locator(".trial-references img").count();
  assert.ok(imageCount > 0);
  assert.equal(
    await page
      .locator(".trial-references img")
      .evaluateAll((imgs) =>
        imgs.every((i) => i.complete && i.naturalWidth > 0),
      ),
    true,
  );
  const noOrigin = await page.request.post(
    new URL("/api/local-trials", base).href,
    { data: {} },
  );
  assert.equal(noOrigin.status(), 403);
  const traversal = await page.request.get(
    new URL("/api/local-trials?id=..%2F..%2F.env.local&file=document", base)
      .href,
  );
  assert.equal(traversal.status(), 404);
  await page.getByRole("link", { name: "Open in studio ↗" }).click();
  await page.getByLabel("Generated VFX preview").waitFor();
  assert.deepEqual(errors, []);
  const result = {
    cards,
    grouped,
    player: true,
    references: imageCount,
    studioReopen: true,
    referenceVideo: true,
    noOriginPostDenied: true,
    traversalDenied: true,
    errors,
  };
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

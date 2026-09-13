import { browserOptions } from "./browser-options.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const root = path.resolve(".autov-local/morning-review");
const out = path.resolve(".autov-local/morning-verification");
await mkdir(out, { recursive: true });
const browser = await chromium.launch(browserOptions());
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route(/^https?:/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    pathToFileURL(
      path.resolve(
        process.env.AUTOV_REVIEW_ENTRY || path.join(root, "index.html"),
      ),
    ).href,
  );
  await page.locator("article a.pill").first().waitFor();
  const caseLinks = await page
    .locator("article a.pill")
    .evaluateAll((a) => a.map((x) => x.href));
  assert.ok(caseLinks.length > 0);
  assert.equal(
    await page
      .locator("article img")
      .evaluateAll((imgs) =>
        imgs.every((i) => i.complete && i.naturalWidth > 0),
      ),
    true,
  );
  await page.screenshot({
    path: path.join(out, "overview.png"),
    fullPage: true,
  });
  const results = [];
  let pairedPlayback = false;
  for (const href of caseLinks) {
    await page.goto(href);
    const media = await page.locator("video").evaluateAll(async (videos) => {
      await Promise.all(
        videos.map((v) =>
          v.readyState >= 1
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                v.addEventListener("loadedmetadata", resolve, { once: true });
                v.addEventListener(
                  "error",
                  () => reject(Error("Video failed to load")),
                  { once: true },
                );
              }),
        ),
      );
      return videos.map((v) => ({
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      }));
    });
    assert.ok(
      media.length >= 1 && media.every((v) => v.duration > 0 && v.width > 0),
    );
    const links = await page
      .locator("a")
      .evaluateAll((a) =>
        a.map((x) => x.href).filter((h) => h.startsWith("file:")),
      );
    for (const link of links) await readFile(fileURLToPath(link));
    if (media.length === 2 && !pairedPlayback) {
      await page.getByRole("button", { name: "両方を先頭から再生" }).click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("video")].every(
          (v) => v.currentTime > 0 && !v.paused,
        ),
      );
      await page.getByRole("button", { name: "両方を停止" }).click();
      assert.equal(
        await page
          .locator("video")
          .evaluateAll((v) => v.every((x) => x.paused)),
        true,
      );
      pairedPlayback = true;
      await page.screenshot({
        path: path.join(out, "comparison.png"),
        fullPage: true,
      });
    }
    results.push({
      case: path.basename(fileURLToPath(href), ".html"),
      videos: media.length,
      localLinks: links.length,
    });
  }
  assert.deepEqual(errors, []);
  const result = {
    cases: results.length,
    sourceVideos: results.filter((r) => r.videos === 2).length,
    pairedPlayback,
    externalNetworkBlocked: true,
    results,
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

import { browserOptions } from "./browser-options.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { validateDocument } = require("../src/lib/vfx-lab/schema.ts");
const manifest = JSON.parse(
  await readFile("public/trial-presets/manifest.json", "utf8"),
);
for (const t of manifest.trials) {
  const raw = await readFile(
    `public/trial-presets/effects/${t.id}/document.json`,
  );
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    t.documentSha256,
  );
  validateDocument(JSON.parse(raw));
}
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch(browserOptions());
const errors = [],
  paidRequests = [];
const base = process.env.AUTOV_TEST_URL || "http://127.0.0.1:3033";
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/local-vfx"))
      paidRequests.push(r.url());
  });
  await page.route("**/dev/vfx-lab/trials/data**", (r) => r.abort());
  await page.goto(base + "/workspace");
  await page.getByLabel("Generated VFX preview").waitFor();
  const picker = page.getByLabel("Load preset", { exact: true });
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(
        'select[aria-label="Load preset"] option[value^="shared:"]',
      ).length === n,
    manifest.candidates,
  );
  let pause = page.getByRole("button", { name: "Pause", exact: true });
  if (await pause.count()) await pause.click();
  for (const t of manifest.trials.filter((t) => t.latest)) {
    await picker.selectOption("shared:" + t.id);
    await page
      .locator(".lab-header-name")
      .filter({ hasText: t.name })
      .waitFor();
    assert.equal(await page.locator(".lab-emitter-row").count(), t.layers);
    await page
      .getByLabel("Playback position", { exact: true })
      .fill(String(Math.min(t.duration * 0.5, t.duration - 0.01)));
    await page.waitForFunction(
      () =>
        document.querySelector('canvas[aria-label="Generated VFX preview"]')
          ?.width > 0,
    );
  }
  const chosen = manifest.trials.find(
    (t) => t.latest && t.caseId === "fx17-sky-vortex",
  );
  await page.goto(base + "/workspace?sharedTrial=" + chosen.id);
  await page
    .locator(".lab-header-name")
    .filter({ hasText: chosen.name })
    .waitFor();
  await page.getByLabel("Generated VFX preview").waitFor();
  await mkdir(".autov-local/shared-trials-verification", { recursive: true });
  await page.screenshot({
    path: ".autov-local/shared-trials-verification/workspace.png",
  });
  await page.goto(base + "/trial-presets/index.html");
  assert.equal(await page.locator("article:visible").count(), manifest.cases);
  await page.locator("#view").selectOption("all");
  assert.equal(
    await page.locator("article:visible").count(),
    manifest.candidates,
  );
  assert.equal(await page.locator("video").count(), 0);
  await page.screenshot({
    path: ".autov-local/shared-trials-verification/index.png",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(paidRequests, []);
  const result = {
    presets: manifest.candidates,
    casesRendered: manifest.cases,
    directStudioLink: true,
    privateTrialApiBlocked: true,
    paidRequests: 0,
    errors,
  };
  await writeFile(
    ".autov-local/shared-trials-verification/results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}

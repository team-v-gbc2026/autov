// Verification for the viewer-owned backdrop (plan item 6):
// loading, swapping, removal, repeated mounting, persistence, and that
// existing effects are unchanged with no backdrop attached.
import sharp from "sharp";
import { chromium } from "playwright-core";
import { browserOptions } from "./browser-options.mjs";

const BASE = process.env.VERIFY_BASE || "http://localhost:3000";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch(browserOptions());
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const sceneState = () =>
  page.evaluate(() => {
    const rt = window.__vfxV2.runtime;
    return {
      children: rt.scene.children.length,
      ctors: rt.scene.children.map((c) => c.constructor?.name),
      geometries: rt.renderer.info.memory.geometries,
      textures: rt.renderer.info.memory.textures,
    };
  });

const status = () =>
  page
    .locator('[data-testid="backdrop-status"]')
    .textContent()
    .catch(() => "");

const waitSettled = async () =>
  page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="backdrop-status"]');
        const t = el?.textContent ?? "";
        return !!t && !t.includes("loading");
      },
      null,
      { timeout: 180000 },
    )
    .catch(() => {});

await page.addInitScript(() => localStorage.removeItem("autov.vfx-lab.backdrop.v1"));
await page.goto(`${BASE}/dev/vfx-v2`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="backdrop-panel"]', { timeout: 60000 });
await page.waitForTimeout(2500);

await page.waitForFunction(() => !!window.__vfxV2, null, { timeout: 60000 });

// --- baseline: effects render with no backdrop attached --------------------
const pause = page.getByRole("button", { name: "Pause", exact: true });
if (await pause.count()) await pause.click();
const fixedPixels = async () => {
  const data = await page.evaluate(() => {
    const rt = window.__vfxV2.runtime;
    rt.render(1.25); // runtime is closed-form in document/time/seed
    return rt.renderer.domElement.toDataURL("image/png");
  });
  return sharp(Buffer.from(data.split(",")[1], "base64")).raw().toBuffer();
};
const baseline = await sceneState();
const shotBefore = await fixedPixels();
check("baseline: repeat render is deterministic", shotBefore.equals(await fixedPixels()));
check("baseline: no backdrop in scene", !baseline.ctors.includes("_SplatMesh"), JSON.stringify(baseline.ctors));
check("baseline: effects present", baseline.children >= 3, `${baseline.children} children`);

// --- load ------------------------------------------------------------------
await page.selectOption('[data-testid="backdrop-preset"]', "/backdrops/terrain.ply");
await page.locator('[data-testid="backdrop-load"]').click();
await waitSettled();
const loaded = await sceneState();
check(
  "load: splat + spark attached",
  loaded.ctors.includes("_SplatMesh") && loaded.ctors.includes("_SparkRenderer"),
  JSON.stringify(loaded.ctors),
);
check("load: status reports splats", /splats|loaded/.test(await status()), await status());

// --- swap ------------------------------------------------------------------
await page.selectOption('[data-testid="backdrop-preset"]', "/backdrops/figure.ply");
await page.locator('[data-testid="backdrop-load"]').click();
await waitSettled();
const swapped = await sceneState();
const splatCount = swapped.ctors.filter((c) => c === "_SplatMesh").length;
check("swap: exactly one splat remains", splatCount === 1, `${splatCount} splats`);

// Hold A's network response until B has committed: these are truly concurrent
// controller calls, independent of UI controls being disabled during loading.
let releaseFirst;
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
let sawFirst;
const firstSeen = new Promise(resolve => { sawFirst = resolve; });
await page.route("**/backdrops/terrain.ply?race=held", async route => {
  const response = await route.fetch();
  sawFirst();
  await firstGate;
  await route.fulfill({ response });
});
await page.evaluate(() => {
  window.__backdropRace = window.__vfxV2.backdrop.load("/backdrops/terrain.ply?race=held");
});
await firstSeen;
const secondResult = await page.evaluate(() => window.__vfxV2.backdrop.load("/backdrops/figure.ply"));
const firstResult = await page.evaluate(() => window.__backdropRace);
check("race: newer load commits while older response is held", secondResult === "loaded" && firstResult === "superseded");
releaseFirst();
await page.waitForTimeout(1500);
const raced = await sceneState();
check("race: exactly one splat after late completion", raced.ctors.filter(c => c === "_SplatMesh").length === 1);
check("race: newest URL remains selected", await page.evaluate(() => window.__vfxV2.backdrop.snapshot.settings.url === "/backdrops/figure.ply"));
await page.unroute("**/backdrops/terrain.ply?race=held");

// Decode failure must reject promptly and preserve the currently loaded asset.
await page.route("**/backdrops/broken.ply", route => route.fulfill({ status: 500, body: "controlled failure" }));
const failed = await page.evaluate(async () => {
  const start = performance.now();
  try { await window.__vfxV2.backdrop.load("/backdrops/broken.ply"); return false; }
  catch { return performance.now() - start < 10000 && window.__vfxV2.backdrop.snapshot.settings.url === "/backdrops/figure.ply"; }
});
check("failure: rejects promptly and preserves existing asset", failed);
await page.unroute("**/backdrops/broken.ply");

// --- visibility toggle -----------------------------------------------------
await page.locator('[data-testid="backdrop-visible"]').click();
await page.waitForTimeout(600);
const hidden = await page.evaluate(() => {
  const rt = window.__vfxV2.runtime;
  const s = rt.scene.children.find((c) => c.constructor?.name === "_SplatMesh");
  return s?.visible;
});
check("toggle: hides without removing", hidden === false, `visible=${hidden}`);
await page.locator('[data-testid="backdrop-visible"]').click();
await page.waitForTimeout(400);

// --- transform -------------------------------------------------------------
const slider = page.locator('[data-testid="backdrop-slider-rz"]');
await slider.evaluate((el) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "1.2");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(600);
const rot = await page.evaluate(() => {
  const rt = window.__vfxV2.runtime;
  const s = rt.scene.children.find((c) => c.constructor?.name === "_SplatMesh");
  return s ? +s.rotation.z.toFixed(2) : null;
});
check("transform: slider drives the splat", rot !== null && Math.abs(rot - 1.2) < 0.05, `rot.z=${rot}`);

// --- persistence -----------------------------------------------------------
const stored = await page.evaluate(() =>
  localStorage.getItem("autov.vfx-lab.backdrop.v1"),
);
check("persist: settings stored under their own key", !!stored, stored ?? "(null)");
const docTouched = await page.evaluate(() => {
  const keys = Object.keys(localStorage);
  return keys.filter((k) => k.includes("backdrop")).length;
});
check("persist: exactly one backdrop key", docTouched === 1, `${docTouched} keys`);

// Confirm the asset actually changes pixels before comparing removal.
check("loaded backdrop changes pixels", !shotBefore.equals(await fixedPixels()));
// --- remove ----------------------------------------------------------------
await page.locator('[data-testid="backdrop-remove"]').click();
await page.waitForTimeout(1200);
const removed = await sceneState();
const shotRemoved = await fixedPixels();
check("remove: identical effect pixels at fixed time", shotBefore.equals(shotRemoved), `${shotBefore.length} raw pixel bytes compared`);
check(
  "remove: controller objects gone",
  !removed.ctors.includes("_SplatMesh") && !removed.ctors.includes("_SparkRenderer"),
  JSON.stringify(removed.ctors),
);
check(
  "remove: scene back to baseline size",
  removed.children === baseline.children,
  `${removed.children} vs ${baseline.children}`,
);
check(
  "remove: textures released",
  removed.textures <= loaded.textures,
  `${loaded.textures} -> ${removed.textures}`,
);

// --- repeated mounting (unmount the runtime, remount, load again) ----------
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="backdrop-panel"]', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.waitForFunction(() => !!window.__vfxV2, null, { timeout: 60000 });
await page.selectOption('[data-testid="backdrop-preset"]', "/backdrops/terrain.ply");
await page.locator('[data-testid="backdrop-load"]').click();
await waitSettled();
const remounted = await sceneState();
check(
  "remount: loads again after a full page/runtime cycle",
  remounted.ctors.includes("_SplatMesh"),
  JSON.stringify(remounted.ctors),
);

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

console.log(
  `\n${results.filter((r) => r.pass).length}/${results.length} checks passed`,
);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);

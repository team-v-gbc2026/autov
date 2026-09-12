import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const output = path.resolve(
  process.env.AUTOV_EVIDENCE_DIR || ".autov-local/renderer-verification",
);
await mkdir(output, { recursive: true });
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const bundle = await build({
  stdin: {
    contents:
      'export {render} from "./scripts/benchmark-browser"; export {createPreset,RECIPES} from "./src/lib/vfx-lab/recipes"; export {exportHtml} from "./src/lib/vfx-lab/export";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
  platform: "browser",
  minify: true,
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AUTOV_CHROME_PATH
    ? { executablePath: process.env.AUTOV_CHROME_PATH }
    : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
try {
  const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    process.env.AUTOV_TEST_URL || "http://127.0.0.1:3031/workspace",
  );
  await page.getByLabel("Generated VFX preview").waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByLabel("Playback position", { exact: true }).fill("0.85");
  await page.screenshot({ path: path.join(output, "studio.png") });
  const count = await page.locator(".lab-emitter-row").count();
  await page
    .getByRole("button", { name: "+ Add emitter", exact: true })
    .click();
  assert.equal(await page.locator(".lab-emitter-row").count(), count + 1);
  await page
    .getByRole("button", { name: "Effect controls", exact: true })
    .click();
  await page.getByLabel("Layer color", { exact: true }).fill("#44ccff");
  await page.screenshot({ path: path.join(output, "controls.png") });
  await page.goto(new URL("/api/local-vfx", page.url()).href);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const ids = await page.evaluate(() => Object.keys(Probe.RECIPES));
  for (const id of ids) {
    const result = await page.evaluate(async (id) => {
      const doc = Probe.createPreset(id);
      return { doc, ...(await Probe.render(doc, false)) };
    }, id);
    assert.ok(
      Object.values(result.gates).every(Boolean),
      `${id}: ${JSON.stringify(result.gates)}`,
    );
    assert.ok(result.evidence.renderedPixels > 20, `${id}: no visible effect`);
    await writeFile(
      path.join(output, `${id}.jpg`),
      Buffer.from(result.evidence.sheet.split(",")[1], "base64"),
    );
    await writeFile(
      path.join(output, `${id}.json`),
      JSON.stringify(result.doc, null, 2),
    );
    results.push({
      id,
      source: "authored_renderer_fixture",
      gates: result.gates,
      pixels: result.evidence.renderedPixels,
      performance: result.performance,
    });
  }
  const textureDoc = JSON.parse(
    await readFile("public/examples/generated-sigil.json", "utf8"),
  );
  const textured = await page.evaluate(
    async (doc) => Probe.render(doc, true),
    textureDoc,
  );
  assert.ok(Object.values(textured.gates).every(Boolean));
  assert.ok(textured.performance.assetTextures > 0);
  await writeFile(
    path.join(output, "generated-texture.jpg"),
    Buffer.from(textured.evidence.sheet.split(",")[1], "base64"),
  );
  await writeFile(
    path.join(output, "generated-texture.webm"),
    Buffer.from(textured.webm.split(",")[1], "base64"),
  );
  const html = await page.evaluate(
    async (doc) => Probe.exportHtml(doc),
    textureDoc,
  );
  await writeFile(path.join(output, "generated-texture-player.html"), html);
  const offline = await browser.newPage({
    viewport: { width: 960, height: 540 },
  });
  const offlineErrors = [];
  offline.on("pageerror", (e) => offlineErrors.push(e.message));
  await offline.route("http://**/*", (route) => route.abort());
  await offline.route("https://**/*", (route) => route.abort());
  await offline.goto(
    `file://${path.join(output, "generated-texture-player.html")}`,
  );
  await offline.getByLabel("Generated VFX preview").waitFor();
  await offline.waitForFunction(() =>
    document.querySelector("#clock").textContent.includes("s"),
  );
  assert.equal(await offline.locator("#error").innerText(), "");
  assert.deepEqual(offlineErrors, []);
  await offline.screenshot({ path: path.join(output, "offline-player.png") });
  assert.deepEqual(errors, []);
  results.push({
    id: "generated-texture",
    source: "authored_effect_with_codex_generated_texture",
    gates: textured.gates,
    offlineExport: true,
    performance: textured.performance,
  });
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        results,
        errors,
        benchmarkGeneration: false,
        renderer:
          "Chrome SwiftShader: correctness only, not hardware performance",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ fixtures: results.length, output, passed: true }),
  );
} finally {
  await browser.close();
}

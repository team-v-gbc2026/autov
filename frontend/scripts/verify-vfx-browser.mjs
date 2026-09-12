import { createHash } from "node:crypto";
import { browserOptions } from "./browser-options.mjs";
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
const browser = await chromium.launch(browserOptions());
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
  await page
    .getByLabel("Load preset", { exact: true })
    .selectOption("smoke-trial");
  await page
    .getByText(
      "Saved API-generated smoke example. Replay it or edit its layers.",
    )
    .waitFor();
  assert.equal(await page.locator(".lab-emitter-row").count(), 10);
  await page.getByLabel("Playback position", { exact: true }).fill("1.2");
  await page.screenshot({
    path: path.join(output, "generated-smoke-example.png"),
  });
  await page
    .getByLabel("Layer mesh", { exact: true })
    .selectOption("crystal-cluster");
  await page.getByLabel("Crystal count", { exact: true }).fill("12");
  assert.equal(
    await page.getByLabel("Crystal count", { exact: true }).inputValue(),
    "12",
  );
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
    assert.equal(
      result.evidence.temporal.frames,
      Math.ceil(result.doc.duration * 30) + 1,
    );
    assert.equal(result.evidence.temporal.activityCurve.at(-1)[1], 0);
    assert.ok(
      result.evidence.temporal.activityCurve.some(([, value]) => value > 0),
    );
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
      renderer: result.evidence.renderer,
      performance: result.performance,
    });
  }
  const erosionDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("lightning"),
      ring = doc.layers.find((l) => l.kind === "ring");
    doc.duration = 2;
    doc.impact = 0.5;
    doc.name = "Segmented ring erosion — authored renderer fixture";
    doc.post.bloom = 0;
    ring.start = 0;
    ring.end = 2;
    ring.params.opacity = 1;
    ring.params.radius = 1;
    ring.params.spin = 0;
    ring.params.turbulence = 0;
    ring.tracks = [
      {
        target: "erosion",
        keys: [
          [0, 0],
          [0.6, 0],
          [1.2, 0.7],
          [2, 1],
        ],
        ease: "linear",
      },
    ];
    doc.layers = [ring];
    return doc;
  });
  const erosionResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    erosionDoc,
  );
  assert.ok(Object.values(erosionResult.gates).every(Boolean));
  assert.notEqual(
    erosionResult.frames[2].png,
    erosionResult.frames[4].png,
    "Ring erosion must change rendered pixels with every other animated parameter fixed",
  );
  await writeFile(
    path.join(output, "ring-erosion.jpg"),
    Buffer.from(erosionResult.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "ring-erosion",
    source: "authored_renderer_fixture",
    gates: erosionResult.gates,
    erosionChangesPixels: true,
    renderer: erosionResult.evidence.renderer,
  });
  const portalDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("portal");
    doc.name = "Portal rim width — authored renderer fixture";
    doc.layers[0].params.width = 0.01;
    return doc;
  });
  const thinPortal = await page.evaluate(
    (doc) => Probe.render(doc, false),
    portalDoc,
  );
  portalDoc.layers[0].params.width = 0.15;
  const thickPortal = await page.evaluate(
    (doc) => Probe.render(doc, false),
    portalDoc,
  );
  assert.ok(Object.values(thickPortal.gates).every(Boolean));
  assert.notEqual(
    thinPortal.frames[3].png,
    thickPortal.frames[3].png,
    "Portal rim width must affect rendered pixels, not just stored parameters",
  );
  await writeFile(
    path.join(output, "portal-width.jpg"),
    Buffer.from(thickPortal.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "portal-width",
    source: "authored_renderer_fixture",
    gates: thickPortal.gates,
    widthChangesPixels: true,
    renderer: thickPortal.evidence.renderer,
  });
  const energyDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("beam");
    doc.name = "Sharp energy ribbon — authored renderer fixture";
    doc.layers = doc.layers.filter((l) => l.id === "beam-0");
    const beam = doc.layers[0];
    beam.surface = "energy-ribbon";
    beam.params.color = "#FFFFFF";
    beam.params.secondaryColor = "#E600A8";
    beam.params.intensity = 1.3;
    beam.params.turbulence = 0.5;
    doc.post.bloom = 0.15;
    return doc;
  });
  const energyResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    energyDoc,
  );
  assert.ok(Object.values(energyResult.gates).every(Boolean));
  assert.ok(energyResult.evidence.renderedPixels > 20);
  await writeFile(
    path.join(output, "energy-ribbon.jpg"),
    Buffer.from(energyResult.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "energy-ribbon",
    source: "authored_renderer_fixture",
    gates: energyResult.gates,
    renderer: energyResult.evidence.renderer,
  });
  const symbolDocs = await page.evaluate(() => {
    const ringDoc = Probe.createPreset("lightning"),
      ring = ringDoc.layers.find((l) => l.kind === "ring");
    ringDoc.layers = [ring];
    ringDoc.name = "Ring plane silhouette — authored renderer fixture";
    ring.params.rotation = [0, 0, 0];
    ring.params.turbulence = 0;
    ring.params.opacity = 1;
    ring.params.radius = 1;
    ring.params.width = 0.28;
    ring.start = 0;
    ring.end = ringDoc.duration;
    ring.tracks = [];
    ring.geometry = "plane";
    ring.surface = "solid";
    const starDoc = structuredClone(ringDoc);
    starDoc.name = "Pointed stars — authored renderer fixture";
    starDoc.layers[0].kind = "sprite";
    starDoc.layers[0].surface = "star";
    starDoc.layers[0].params.color = "#FF238A";
    starDoc.layers[0].params.secondaryColor = "#D20A65";
    starDoc.post.bloom = 0.1;
    const faceDoc = structuredClone(starDoc);
    faceDoc.name = "Circle and attached eyes — authored renderer fixture";
    faceDoc.layers[0].surface = "circle-eyes";
    faceDoc.layers[0].params.secondaryColor = "#FFF5FA";
    faceDoc.layers[0].params.spin = 0;
    const auraDoc = structuredClone(starDoc);
    auraDoc.name = "Soft upright glow — authored renderer fixture";
    auraDoc.layers[0].surface = "default";
    auraDoc.layers[0].params.color = "#60E850";
    auraDoc.layers[0].params.secondaryColor = "#25872E";
    auraDoc.layers[0].params.length = 3;
    auraDoc.layers[0].params.opacity = 0.35;
    const glintDoc = structuredClone(starDoc);
    glintDoc.name = "Four point sparkle — authored renderer fixture";
    glintDoc.layers[0].surface = "sparkle";
    return [ringDoc, starDoc, faceDoc, auraDoc, glintDoc];
  });
  for (const [i, doc] of symbolDocs.entries()) {
    const result = await page.evaluate((doc) => Probe.render(doc, false), doc);
    assert.ok(Object.values(result.gates).every(Boolean));
    const id = [
      "ring-plane",
      "pointed-stars",
      "circle-eyes",
      "soft-plane-aura",
      "four-point-sparkle",
    ][i];
    await writeFile(
      path.join(output, `${id}.jpg`),
      Buffer.from(result.evidence.sheet.split(",")[1], "base64"),
    );
    results.push({
      id,
      source: "authored_renderer_fixture",
      gates: result.gates,
      renderer: result.evidence.renderer,
    });
  }
  const crystalDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("lightning"),
      layer = doc.layers[0];
    doc.name = "Faceted crystal crown — authored renderer fixture";
    doc.duration = 3;
    doc.impact = 0.6;
    doc.layers = [layer];
    layer.kind = "sprite";
    layer.geometry = "crystal-cluster";
    layer.surface = "ice";
    layer.start = 0;
    layer.end = 3;
    Object.assign(layer.params, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      count: 18,
      radius: 1.2,
      width: 0.24,
      length: 1.8,
      color: "#DFFAFF",
      secondaryColor: "#148AC2",
      intensity: 1,
      opacity: 1,
      blend: "normal",
    });
    layer.tracks = [
      {
        target: "length",
        keys: [
          [0, 0.01],
          [0.6, 1.8],
          [2.3, 1.8],
          [3, 0.1],
        ],
        ease: "smooth",
      },
      {
        target: "width",
        keys: [
          [0, 0.01],
          [0.6, 0.24],
          [2.3, 0.24],
          [3, 0.01],
        ],
        ease: "smooth",
      },
      {
        target: "opacity",
        keys: [
          [0, 0],
          [0.1, 1],
          [2.3, 1],
          [3, 0],
        ],
        ease: "smooth",
      },
    ];
    doc.post.bloom = 0.1;
    return doc;
  });
  const crystalResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    crystalDoc,
  );
  assert.ok(Object.values(crystalResult.gates).every(Boolean));
  assert.ok(crystalResult.performance.triangles > 100);
  await writeFile(
    path.join(output, "crystal-cluster.jpg"),
    Buffer.from(crystalResult.evidence.sheet.split(",")[1], "base64"),
  );
  await writeFile(
    path.join(output, "crystal-cluster.json"),
    JSON.stringify(crystalDoc, null, 2),
  );
  results.push({
    id: "crystal-cluster",
    source: "authored_renderer_fixture",
    gates: crystalResult.gates,
    performance: crystalResult.performance,
    renderer: crystalResult.evidence.renderer,
  });
  const smokeDoc = await page.evaluate(() => Probe.createPreset("smoke"));
  smokeDoc.name = "Two generated smoke masks — authored renderer fixture";
  smokeDoc.textures = [];
  for (const id of ["smoke-lobe", "smoke-curl"]) {
    const bytes = await readFile(`public/textures/generated-${id}.png`);
    smokeDoc.textures.push({
      id,
      data: `data:image/png;base64,${bytes.toString("base64")}`,
      prompt: `Generated ${id} fixture`,
      model: "Codex imagegen (model not exposed)",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  smokeDoc.layers.forEach((layer, i) => {
    layer.geometry = "plane";
    layer.textureId = i < 3 ? "smoke-lobe" : "smoke-curl";
    layer.params.length = 2;
  });
  const smokeResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    smokeDoc,
  );
  assert.ok(Object.values(smokeResult.gates).every(Boolean));
  assert.equal(smokeResult.performance.assetTextures, 2);
  await writeFile(
    path.join(output, "generated-smoke-masks.jpg"),
    Buffer.from(smokeResult.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "two-generated-smoke-masks",
    source: "authored_effect_with_codex_generated_textures",
    gates: smokeResult.gates,
    renderer: smokeResult.evidence.renderer,
    performance: smokeResult.performance,
  });
  const energyTextureDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("beam");
    doc.name = "Generated torn energy edges — authored renderer fixture";
    doc.layers = doc.layers.filter((l) => l.id === "beam-0");
    const core = doc.layers[0];
    core.surface = "energy-ribbon";
    Object.assign(core.params, {
      width: 0.09,
      color: "#FFFFFF",
      secondaryColor: "#FFFFFF",
      intensity: 1.05,
    });
    const edges = structuredClone(core);
    edges.id = "textured-energy-edges";
    edges.kind = "sprite";
    edges.geometry = "plane";
    edges.surface = "solid";
    edges.textureId = "energy-edges";
    Object.assign(edges.params, {
      radius: 0.4,
      color: "#D900E8",
      secondaryColor: "#D900E8",
      intensity: 1.1,
    });
    edges.tracks = edges.tracks.map((t) =>
      t.target === "length"
        ? { ...t, keys: t.keys.map(([time, value]) => [time, value * 1.25]) }
        : t,
    );
    doc.layers.push(edges);
    doc.post.bloom = 0.12;
    return doc;
  });
  const energyBytes = await readFile(
    "public/textures/generated-energy-ribbons.png",
  );
  energyTextureDoc.textures = [
    {
      id: "energy-edges",
      data: `data:image/png;base64,${energyBytes.toString("base64")}`,
      prompt: "Codex-generated torn energy edge mask",
      model: "Codex imagegen (model not exposed)",
      sha256: createHash("sha256").update(energyBytes).digest("hex"),
    },
  ];
  const texturedEnergy = await page.evaluate(
    (doc) => Probe.render(doc, false),
    energyTextureDoc,
  );
  assert.ok(Object.values(texturedEnergy.gates).every(Boolean));
  assert.equal(texturedEnergy.performance.assetTextures, 1);
  await writeFile(
    path.join(output, "generated-energy-edges.jpg"),
    Buffer.from(texturedEnergy.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "generated-energy-edges",
    source: "authored_effect_with_codex_generated_texture",
    gates: texturedEnergy.gates,
    renderer: texturedEnergy.evidence.renderer,
    performance: texturedEnergy.performance,
  });
  // A hex grid must form connected shared edges, not isolated three-sided marks.
  const hexDoc = await page.evaluate(() => {
    const doc = Probe.createPreset("magic"),
      layer = doc.layers[0];
    doc.name = "Connected hex grid fixture";
    doc.duration = 2;
    doc.impact = 0.2;
    doc.post = { bloom: 0, exposure: 1, background: "#000000" };
    doc.textures = [];
    layer.id = "hex-grid-fixture";
    layer.kind = "sprite";
    layer.geometry = "plane";
    layer.surface = "hexagon";
    layer.start = 0;
    layer.end = 2;
    layer.tracks = [];
    layer.overrides = [];
    layer.motion = null;
    layer.textureId = null;
    Object.assign(layer.params, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      radius: 1.5,
      length: 3,
      color: "#FFFFFF",
      secondaryColor: "#000000",
      opacity: 1,
      intensity: 1,
      turbulence: 0,
      erosion: 0,
      blend: "normal",
    });
    doc.layers = [layer];
    return doc;
  });
  const hexResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    hexDoc,
  );
  const hexPng = Buffer.from(hexResult.frames[2].png.split(",")[1], "base64");
  const sharp = (await import("sharp")).default;
  const { data: hexPixels, info: hexInfo } = await sharp(hexPng)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = hexInfo.width * hexInfo.height,
    bright = new Uint8Array(n),
    visited = new Uint8Array(n),
    queue = new Int32Array(n);
  let total = 0,
    largest = 0;
  for (let i = 0; i < n; i++)
    if (hexPixels[i * 3] + hexPixels[i * 3 + 1] + hexPixels[i * 3 + 2] > 360) {
      bright[i] = 1;
      total++;
    }
  for (let i = 0; i < n; i++)
    if (bright[i] && !visited[i]) {
      let head = 0,
        tail = 1;
      queue[0] = i;
      visited[i] = 1;
      while (head < tail) {
        const at = queue[head++],
          x = at % hexInfo.width,
          y = Math.floor(at / hexInfo.width);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || xx >= hexInfo.width || yy < 0 || yy >= hexInfo.height)
              continue;
            const next = yy * hexInfo.width + xx;
            if (bright[next] && !visited[next]) {
              visited[next] = 1;
              queue[tail++] = next;
            }
          }
      }
      largest = Math.max(largest, tail);
    }
  assert.ok(Object.values(hexResult.gates).every(Boolean));
  assert.ok(
    total > 1000 && largest / total > 0.85,
    `Disconnected hex grid: ${largest}/${total}`,
  );
  await writeFile(path.join(output, "connected-hex-grid.png"), hexPng);
  results.push({
    id: "connected-hex-grid",
    source: "authored_renderer_fixture",
    gates: hexResult.gates,
    brightPixels: total,
    largestConnectedFraction: largest / total,
    renderer: hexResult.evidence.renderer,
  });
  const vortexDoc = structuredClone(hexDoc),
    vortexLayer = vortexDoc.layers[0];
  vortexDoc.name = "Generated cloud vortex material fixture";
  vortexDoc.duration = 6;
  vortexDoc.impact = 1;
  vortexDoc.post = { bloom: 0.12, exposure: 0.9, background: "#0E0808" };
  vortexLayer.kind = "decal";
  vortexLayer.surface = "solid";
  vortexLayer.end = 6;
  vortexLayer.textureId = "vortex-cloud";
  Object.assign(vortexLayer.params, {
    position: [0, 2, 0],
    rotation: [-0.9, 0, 0],
    radius: 2,
    length: 4,
    color: "#FFB35C",
    secondaryColor: "#78170C",
    spin: -0.24,
    intensity: 0.9,
    opacity: 0.85,
  });
  vortexLayer.tracks = [
    {
      target: "opacity",
      keys: [
        [0, 0],
        [0.9, 0.85],
        [4.8, 0.85],
        [6, 0],
      ],
      ease: "smooth",
    },
  ];
  const vortexBytes = await readFile(
    "public/textures/generated-vortex-cloud.png",
  );
  vortexDoc.textures = [
    {
      id: "vortex-cloud",
      data: `data:image/png;base64,${vortexBytes.toString("base64")}`,
      prompt: "Generated grayscale atmospheric spiral cloud",
      model: "Codex imagegen (model not exposed)",
      sha256: createHash("sha256").update(vortexBytes).digest("hex"),
    },
  ];
  const vortexResult = await page.evaluate(
    (doc) => Probe.render(doc, false),
    vortexDoc,
  );
  assert.ok(Object.values(vortexResult.gates).every(Boolean));
  assert.equal(vortexResult.performance.assetTextures, 1);
  assert.ok(
    vortexResult.frames[2].png !== vortexResult.frames[3].png,
    "Textured plane spin must change the rendered spiral",
  );
  await writeFile(
    path.join(output, "generated-vortex-cloud.jpg"),
    Buffer.from(vortexResult.evidence.sheet.split(",")[1], "base64"),
  );
  results.push({
    id: "generated-vortex-cloud",
    source: "authored_effect_with_codex_generated_texture",
    gates: vortexResult.gates,
    renderer: vortexResult.evidence.renderer,
    performance: vortexResult.performance,
  });
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
        savedGeneratedExampleLoaded: true,
        crystalCountEditable: true,
        renderer: results[0]?.renderer,
        performanceAcceptance: "not measured by this correctness suite",
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

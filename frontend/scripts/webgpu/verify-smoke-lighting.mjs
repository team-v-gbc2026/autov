/** Smoke lighting mechanism test: direction, tint, darkness, seek repeat,
 * and unlit compatibility on sprites and particles, with post disabled.
 * Run with AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a node scripts/webgpu/verify-smoke-lighting.mjs.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { webgpuBrowserOptions } from "../browser-options.mjs";
const bundle = await build({
  stdin: {
    contents: `export {VfxRuntimeV2} from './src/lib/vfx-lab/runtime-v2'; export {createDocument} from './src/lib/vfx-lab/ui-bridge'; export {defaultGeometry} from './src/lib/vfx-lab/schema-v2';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
});
const server = createServer((req, res) =>
  res.end(
    req.url === "/probe.js"
      ? bundle.outputFiles[0].text
      : '<div id="host" style="width:160px;height:160px"></div>',
  ),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch(webgpuBrowserOptions());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ url: "/probe.js" });
  const results = await page.evaluate(async () => {
    const results = [];
    for (const kind of ["sprite", "particles"]) {
      const doc = Probe.createDocument();
      doc.duration = 4;
      doc.environment.ground = "none";
      doc.environment.background = "#000000";
      doc.environment.ambient = 0;
      doc.environment.fog.density = 0;
      const layer = doc.layers[0];
      layer.kind = kind;
      layer.start = 0;
      layer.end = 4;
      layer.transform.position = [0, 0, 0];
      layer.material.shading = "litSmoke";
      layer.material.blend = "alpha";
      layer.material.mask.textureId = null;
      layer.material.procedural = "none";
      layer.material.noise = null;
      layer.material.erosion = null;
      layer.material.ramp.stops = [
        { t: 0, color: "#ffffff", intensity: 1 },
        { t: 1, color: "#ffffff", intensity: 1 },
      ];
      if (kind === "sprite") {
        delete layer.emitter;
        layer.geometry = Probe.defaultGeometry();
        layer.geometry.radius = 1.5;
      } else {
        const e = layer.emitter;
        e.count = 1;
        e.shape.type = "point";
        e.spawn.window = 0;
        e.velocity.speed = [0, 0];
        e.life = [4, 4];
        e.forces.gravity = [0, 0, 0];
        e.render.size = [3, 3];
        e.render.sizeCurve = {
          keys: [
            [0, 1],
            [1, 1],
          ],
          ease: "linear",
        };
        e.render.alphaCurve = {
          keys: [
            [0, 1],
            [1, 1],
          ],
          ease: "linear",
        };
        e.render.rotation = { initial: [0, 0], speed: [0, 0] };
      }
      const lamp = {
        id: "test-light",
        name: "Test light",
        kind: "light",
        role: "secondary",
        start: 0,
        end: 4,
        enabled: true,
        transform: {
          position: [-2, 0, 2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        motion: null,
        tracks: [],
        overrides: [],
        light: {
          color: "#ffffff",
          intensity: {
            keys: [
              [0, 12],
              [1, 12],
            ],
            ease: "linear",
          },
          radius: 10,
          decay: 2,
        },
      };
      doc.layers.push(lamp);
      const runtime = new Probe.VfxRuntimeV2(document.getElementById("host"));
      runtime.setInteractive(false);
      runtime.setFeatureFlags({ post: false, aa: false });
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const capture = async () => {
        runtime.setDocument(doc);
        runtime.renderer.setPixelRatio(1);
        runtime.resize(160, 160);
        await runtime.whenReady();
        if (!runtime.renderer.backend.isWebGPUBackend)
          throw Error("WebGPU required");
        runtime.camera.position.set(0, 0, 5);
        runtime.camera.lookAt(0, 0, 0);
        runtime.camera.updateMatrixWorld();
        runtime.render(1);
        ctx.clearRect(0, 0, 160, 160);
        ctx.drawImage(runtime.renderer.domElement, 0, 0, 160, 160);
        const pixels = Array.from(ctx.getImageData(0, 0, 160, 160).data);
        const sums = [0, 0, 0],
          sides = [0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          const side = (i / 4) % 160 < 80 ? 0 : 1;
          for (let c = 0; c < 3; c++) {
            sums[c] += pixels[i + c];
            sides[side] += pixels[i + c];
          }
        }
        return { pixels, sums, sides, png: canvas.toDataURL() };
      };
      try {
        const left = await capture();
        lamp.transform.position = [2, 0, 2];
        const right = await capture();
        lamp.light.color = "#00ff00";
        const green = await capture();
        lamp.light.intensity.keys = [
          [0, 0],
          [1, 0],
        ];
        const dark = await capture();
        lamp.light.color = "#ffffff";
        lamp.light.intensity.keys = [
          [0, 12],
          [1, 12],
        ];
        const repeat = await capture();
        layer.material.shading = "unlit";
        const unlit = await capture();
        lamp.light.intensity.keys = [
          [0, 0],
          [1, 0],
        ];
        const unlitDark = await capture();
        results.push({
          kind,
          left: left.sides,
          right: right.sides,
          green: green.sums,
          dark: dark.sums,
          repeat: right.pixels.every((v, i) => v === repeat.pixels[i]),
          unchanged: unlit.pixels.every((v, i) => v === unlitDark.pixels[i]),
          images: {
            left: left.png,
            right: right.png,
            green: green.png,
            unlit: unlit.png,
          },
        });
      } finally {
        await runtime.dispose();
      }
    }
    return results;
  });
  const output = process.env.AUTOV_EVIDENCE_DIR || "/tmp/autov-smoke-lighting";
  await mkdir(output, { recursive: true });
  for (const r of results) {
    for (const [label, png] of Object.entries(r.images))
      await writeFile(
        `${output}/${r.kind}-${label}.png`,
        Buffer.from(png.split(",")[1], "base64"),
      );
    delete r.images;
    console.log(JSON.stringify(r));
    assert.deepEqual(errors, []);
    assert.ok(
      r.left[0] > r.left[1] * 1.05,
      "left light must brighten left-facing smoke",
    );
    assert.ok(
      r.right[1] > r.right[0] * 1.05,
      "right light must brighten right-facing smoke",
    );
    assert.ok(
      r.green[1] > r.green[0] * 2 && r.green[1] > r.green[2] * 2,
      "light color must reach smoke",
    );
    assert.equal(
      r.dark.reduce((s, v) => s + v, 0),
      0,
      "no illumination means no diffuse smoke output",
    );
    assert.ok(r.repeat, "returning to a light state must reproduce pixels");
    assert.ok(r.unchanged, "unlit shading must ignore lights");
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}

/** Isolated mask animation test: two constant atlas cells, fixed geometry,
 * no post. Mid-frame intensity must lie between endpoints; loop/seek repeat.
 * Run with AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a node scripts/webgpu/verify-flipbooks.mjs.
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
    const atlas = document.createElement("canvas");
    atlas.width = 128;
    atlas.height = 64;
    const ac = atlas.getContext("2d");
    ac.fillStyle = "#333333";
    ac.fillRect(0, 0, 64, 64);
    ac.fillStyle = "#ffffff";
    ac.fillRect(64, 0, 64, 64);
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const results = [];
    for (const kind of [
      "sprite",
      "shell",
      "ring",
      "beam",
      "trail",
      "decal",
      "particles",
    ]) {
      const doc = Probe.createDocument();
      doc.duration = 4;
      doc.environment.ground = "none";
      doc.environment.background = "#000000";
      doc.environment.fog.density = 0;
      doc.quality.aa = "none";
      doc.post.bloom.strength = 0;
      doc.post.vignette = 0;
      doc.post.chromatic = 0;
      const l = doc.layers[0];
      l.start = 0;
      l.end = 4;
      l.kind = kind;
      l.transform.position = [0, 0, 0];
      l.material.mask.textureId = "test-atlas";
      l.material.mask.flipbook = { cols: 2, rows: 1, mode: "fps", fps: 1 };
      l.material.noise = null;
      l.material.erosion = null;
      l.material.procedural = "solid";
      l.material.fresnel = null;
      l.material.blend = "alpha";
      l.material.opacity = 1;
      l.material.ramp.stops = [
        { t: 0, color: "#ffffff", intensity: 1 },
        { t: 1, color: "#ffffff", intensity: 1 },
      ];
      if (kind === "particles") {
        const e = l.emitter;
        e.count = 1;
        e.shape.type = "point";
        e.spawn.mode = "burst";
        e.spawn.window = 0;
        e.life = [4, 4];
        e.velocity.speed = [0, 0];
        e.forces.gravity = [0, 0, 0];
        e.forces.wind = [0, 0, 0];
        e.forces.curl = null;
        e.forces.vortex = null;
        e.forces.floor = null;
        e.render.size = [1, 1];
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
      } else {
        delete l.emitter;
        l.geometry = Probe.defaultGeometry();
        l.geometry.type = kind === "shell" ? "sphere" : "plane";
      }
      doc.textures = [
        {
          id: "test-atlas",
          data: atlas.toDataURL(),
          prompt: "test",
          model: "test",
          sha256: "0".repeat(64),
        },
      ];
      const r = new Probe.VfxRuntimeV2(document.getElementById("host"));
      try {
        r.setInteractive(false);
        r.setFeatureFlags({ post: false, aa: false });
        r.setDocument(doc);
        r.renderer.setPixelRatio(1);
        r.resize(160, 160);
        await r.whenReady();
        if (!r.renderer.backend.isWebGPUBackend) throw Error("WebGPU required");
        const read = (t) => {
          r.render(t);
          ctx.clearRect(0, 0, 160, 160);
          ctx.drawImage(r.renderer.domElement, 0, 0, 160, 160);
          return Array.from(ctx.getImageData(0, 0, 160, 160).data);
        };
        const energy = (p) =>
          p.reduce((s, v, i) => s + (i % 4 === 3 ? 0 : v), 0);
        read(0.1);
        const low = read(0.1),
          mid = read(0.5),
          high = read(1),
          loop = read(2.1),
          repeat = read(0.5);
        const images = {};
        if (kind === "sprite") {
          for (const [label, t] of [
            ["low", 0.1],
            ["blend", 0.5],
            ["high", 1],
          ]) {
            read(t);
            images[label] = canvas.toDataURL();
          }
        }
        l.material.mask.flipbook.mode = "life";
        r.setDocument(doc);
        await r.whenReady();
        const life = [0.4, 2, 3.8].map((t) => energy(read(t)));
        doc.environment.ground = "plane";
        doc.environment.groundY = 0;
        l.material.softParticle = 1;
        r.setDocument(doc);
        await r.whenReady();
        r.setFeatureFlags({ softParticles: false });
        const hard = read(2);
        if (kind === "sprite") images.hard = canvas.toDataURL();
        r.setFeatureFlags({ softParticles: true });
        const soft = read(2);
        if (kind === "sprite") images.soft = canvas.toDataURL();
        results.push({
          images,
          life,
          softChanges: hard.some((v, i) => v !== soft[i]),
          kind,
          low: energy(low),
          mid: energy(mid),
          high: energy(high),
          loop: low.every((v, i) => v === loop[i]),
          seek: mid.every((v, i) => v === repeat[i]),
        });
      } finally {
        r.dispose();
      }
    }
    return results;
  });
  const output = process.env.AUTOV_EVIDENCE_DIR || "/tmp/autov-layer-quality";
  await mkdir(output, { recursive: true });
  for (const r of results) {
    for (const [label, png] of Object.entries(r.images))
      await writeFile(
        `${output}/${r.kind}-${label}.png`,
        Buffer.from(png.split(",")[1], "base64"),
      );
    delete r.images;
    assert.ok(
      r.life[0] < r.life[1] && r.life[1] < r.life[2],
      `${r.kind}: life playback must advance smoothly`,
    );
    assert.ok(
      r.softChanges,
      `${r.kind}: soft intersections must affect pixels`,
    );
    assert.ok(
      r.low < r.mid && r.mid < r.high,
      `${r.kind}: intermediate frame must blend: ${JSON.stringify(r)}`,
    );
    // Analytic shells have independent time-varying procedural shading.
    if (r.kind !== "shell")
      assert.ok(r.loop, `${r.kind}: FPS loop must repeat`);
    assert.ok(r.seek, `${r.kind}: seek must repeat`);
    console.log(JSON.stringify(r));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}

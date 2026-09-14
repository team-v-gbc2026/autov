import { webgpuBrowserOptions } from "../browser-options.mjs";
/** The studio's own path: a PREVIEW runtime, its warm pass, and animated
 * preview frames at the studio's size.
 *
 * verify-port.mjs drives capture runtimes at one authored timestamp. That misses
 * anything the preview does differently — the warm pass draws every emitter at
 * once, and a draw that never appears at the sampled time is never built there.
 * A crystals layer that needed a ninth vertex buffer passed the capture check
 * and broke every studio page; this is the check that would have caught it.
 */
import { chromium } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const output = path.resolve(
  process.env.AUTOV_EVIDENCE_DIR || ".autov-local/studio-verification",
);
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2"; export {createDocument} from "./src/lib/vfx-lab/ui-bridge";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
});
const server = createServer((req, res) => {
  if (req.url === "/probe.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<style>body{margin:0;background:#101112}</style><div id="host" style="width:1264px;height:790px"></div>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ids = process.env.AUTOV_FIXTURES?.split(",") || [
  "workspace",
  ...(await readdir("fixtures/v2")).sort(),
];
const browser = await chromium.launch(webgpuBrowserOptions());
const results = [];
try {
  for (const id of ids) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
        console.error(message.text());
      }
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.addScriptTag({ url: "/probe.js" });
    const doc =
      id === "workspace"
        ? null
        : JSON.parse(await readFile(`fixtures/v2/${id}/document.json`, "utf8"));
    console.log("Checking", id);
    const result = await page.evaluate(
      async ({ doc }) => {
        const host = document.getElementById("host");
        const runtime = new Probe.VfxRuntimeV2(host, { preview: true });
        try {
          runtime.setInteractive(false);
          const document_ = doc ?? Probe.createDocument("Workspace emitter");
          runtime.setDocument(document_);
          runtime.resize(1264, 790);
          // whenReady runs the warm pass, which is where a preview-only draw is
          // built for the first time.
          await runtime.whenReady();
          const device = runtime.renderer.backend.device;
          device.addEventListener("uncapturederror", (event) =>
            console.error("GPU " + event.error.message),
          );
          // WebGPU binds at most eight vertex buffers per pipeline.
          const draws = [];
          runtime.scene.traverse((object) => {
            if (!object.geometry || !object.material) return;
            const buffers = new Set();
            for (const attribute of Object.values(object.geometry.attributes))
              buffers.add(
                attribute.isInterleavedBufferAttribute
                  ? attribute.data
                  : attribute,
              );
            draws.push({
              name: object.name || object.parent?.name || object.type,
              buffers: buffers.size,
            });
          });
          const started = performance.now();
          const frames = 24;
          for (let i = 0; i < frames; i++)
            runtime.render((document_.duration * i) / (frames - 1));
          await device.queue.onSubmittedWorkDone();
          const frameMs = (performance.now() - started) / frames;
          const scratch = document.createElement("canvas");
          scratch.width = 320;
          scratch.height = 180;
          const context = scratch.getContext("2d", {
            willReadFrequently: true,
          });
          runtime.render(document_.duration * 0.5);
          context.drawImage(runtime.renderer.domElement, 0, 0, 320, 180);
          const pixels = context.getImageData(0, 0, 320, 180).data;
          let lit = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++;
          return {
            draws: draws.length,
            worstBuffers: Math.max(...draws.map((draw) => draw.buffers)),
            over: draws
              .filter((draw) => draw.buffers > 8)
              .map((draw) => draw.name),
            frameMs: Math.round(frameMs * 10) / 10,
            lit,
            png: scratch.toDataURL("image/png"),
          };
        } finally {
          await runtime.dispose();
        }
      },
      { doc },
    );
    await writeFile(
      path.join(output, `${id}-studio.png`),
      Buffer.from(result.png.split(",")[1], "base64"),
    );
    delete result.png;
    results.push({ id, ...result });
    console.log(JSON.stringify(results.at(-1)));
    assert.deepEqual(
      result.over,
      [],
      `${id}: ${result.over.join(", ")} needs more than eight vertex buffers`,
    );
    assert.ok(result.lit > 200, `${id}: preview drew a blank frame`);
    assert.equal(errors.length, 0, errors.join("\n").slice(0, 4000));
    await page.close();
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ browser: browser.version(), results }, null, 2),
  );
  console.log(
    `Verified ${results.length} studio previews. Evidence: ${output}`,
  );
} finally {
  await browser.close();
  server.close();
}

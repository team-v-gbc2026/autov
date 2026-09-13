/** Run under xvfb-run with AUTOV_WEBGPU_SOFTWARE=1 in Linux CI.
 * Optional AUTOV_STUDIO_BASELINE points to a previous Probe IIFE runtime bundle.
 * Timing includes only warmed render submission, not GPU completion or compilation.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { webgpuBrowserOptions } from '../browser-options.mjs';
const output = process.env.AUTOV_EVIDENCE_DIR || '.autov-local/studio-performance';
await mkdir(output, { recursive: true });
const bundle = (await build({
  stdin: { contents: 'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2";', resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'Probe', write: false, minify: true,
})).outputFiles[0].text;
const baseline = process.env.AUTOV_STUDIO_BASELINE
  ? (await readFile(process.env.AUTOV_STUDIO_BASELINE, 'utf8')).replace('var Probe=', 'var Baseline=') : '';
const server = createServer((req, res) => {
  if (req.url === '/probe.js') res.end(bundle);
  else if (req.url === '/baseline.js') res.end(baseline);
  else res.end('<style>body{margin:0}</style><div id="host" style="width:320px;height:180px"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch(webgpuBrowserOptions());
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ url: '/probe.js' });
  if (baseline) await page.addScriptTag({ url: '/baseline.js' });
  for (const id of (process.env.AUTOV_FIXTURES?.split(',') || ['fire-projectile', 'beam', 'lightning-impact', 'smoke-burst', 'many-emitters'])) {
    const doc = JSON.parse(await readFile(`fixtures/v2/${id === 'many-emitters' ? 'fire-projectile' : id}/document.json`, 'utf8'));
    if (id === 'many-emitters') {
      const particle = doc.layers.find(layer => layer.kind === 'particles');
      doc.layers = Array.from({ length: 24 }, (_, index) => ({ ...structuredClone(particle), id: `emitter-${index}` }));
    }
    const result = await page.evaluate(async ({ doc, compare }) => {
      const check = (condition, message) => { if (!condition) throw Error(message); };
      const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const host = document.getElementById('host');
      const outputs = [];
      let reference;
      for (const api of compare ? [Baseline, Probe] : [Probe]) {
        const runtime = new api.VfxRuntimeV2(host, { preview: true });
        try {
          runtime.setInteractive(false);
          runtime.setDocument(doc);
          runtime.resize(320, 180);
          await runtime.whenReady();
          check(runtime.renderer.backend.isWebGPUBackend, 'WebGPU required');
          const queue = runtime.renderer.backend.device.queue;
          for (let i = 0; i < 3; i++) { runtime.render(0.4); await queue.onSubmittedWorkDone(); }
          const samples = [];
          for (let i = 0; i < 12; i++) {
            const start = performance.now(); runtime.render(0.4 + i * 0.01);
            samples.push(performance.now() - start);
            await queue.onSubmittedWorkDone();
          }
          // Read back in the same task as rendering, matching capture's contract.
          runtime.render(0.4);
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
          const context = canvas.getContext('2d'); context.drawImage(runtime.renderer.domElement, 0, 0);
          const pixels = context.getImageData(0, 0, 320, 180).data;
          if (api !== Probe) reference = pixels;
          else if (reference) check(pixels.every((value, i) => value === reference[i]), 'Optimized output differs from baseline');
          const original = runtime.objects.slice();
          const position = runtime.camera.position.clone();
          const target = runtime.controls.target.clone();
          const editTimes = [];
          let edited;
          for (let i = 0; i < 6; i++) {
            edited = structuredClone(doc);
            edited.layers[0].transform.position[0] += (i + 1) * 0.01;
            const start = performance.now();
            runtime.setDocument(edited, { preserveCamera: true });
            editTimes.push(performance.now() - start);
          }
          const retained = runtime.objects.filter(object => original.includes(object)).length;
          if (api === Probe) {
            check(retained === original.length - 1, 'Editing one layer rebuilt unaffected layers');
            check(runtime.camera.position.equals(position) && runtime.controls.target.equals(target), 'Edit moved the camera');
            const installed = runtime.objects.slice();
            runtime.setDocument(structuredClone(edited), { preserveCamera: true });
            check(runtime.objects.every((object, i) => object === installed[i]), 'Equivalent document rebuilt resources');
            edited.seed++;
            runtime.setDocument(edited, { preserveCamera: true });
            check(runtime.objects.every(object => !installed.includes(object)), 'Seed edit reused stale attributes');
            await runtime.whenReady();
            runtime.render(0.4);
            await queue.onSubmittedWorkDone();
            runtime.renderPreview(0.4);
            const renderCalls = runtime.renderer.info.render.calls;
            runtime.renderPreview(0.4);
            check(runtime.renderer.info.render.calls === renderCalls, 'Paused preview submitted an unchanged frame');
            if (doc.layers.some(layer => layer.kind === 'particles')) {
              const parent = structuredClone(doc.layers.find(layer => layer.kind === 'particles'));
              parent.id = 'parent'; parent.emitter.sub = null;
              const child = structuredClone(parent); child.id = 'child';
              child.emitter.sub = { parentLayerId: 'parent', offset: [0, 0.1], mode: 'alongPath', inheritVelocity: 0.5 };
              const independent = structuredClone(parent); independent.id = 'independent';
              const dependencies = { ...structuredClone(doc), layers: [parent, child, independent] };
              runtime.setDocument(dependencies, { preserveCamera: true });
              const linked = runtime.objects.slice();
              dependencies.layers[0].transform.position[0] += 0.01;
              runtime.setDocument(dependencies, { preserveCamera: true });
              check(runtime.objects[0] !== linked[0] && runtime.objects[1] !== linked[1], 'Parent edit left stale child bindings');
              check(runtime.objects[2] === linked[2], 'Parent edit rebuilt an independent emitter');
              const old = runtime.objects.slice();
              dependencies.duration += 0.1;
              runtime.setDocument(dependencies, { preserveCamera: true });
              check(runtime.objects.every(object => !old.includes(object)), 'Duration edit reused stale spawn timing');
            }
          }
          outputs.push({ version: api === Probe ? 'after' : 'before', cpuMedianMs: median(samples), editMedianMs: median(editTimes), retained, layers: original.length });
        } finally { runtime.dispose(); }
      }
      return { outputs, pixelIdentical: compare ? true : null };
    }, { doc, compare: Boolean(baseline) });
    results.push({ id, ...result });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

// Real route and image processing, mocked paid provider/ComfyUI/budget only.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const dir = await mkdtemp(path.join(tmpdir(), 'autov-splat-test-'));
const template = JSON.parse(await readFile('src/lib/vfx-lab/workflows/triposplat_image_to_splat.json', 'utf8'));
const serverSource = await readFile('src/lib/vfx-lab/server.ts', 'utf8');
const localGuard = serverSource.slice(serverSource.indexOf('export function isLocalRequest'), serverSource.indexOf('export async function getKey'));
const h = { keyCalls: 0, network: 0, calls: [], reservations: [], settled: [], edit: null };
globalThis.__splatGenerationTest = h;
const bundled = await build({ entryPoints: ['src/app/api/local-splat/route.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'mock-services', setup(build) {
  build.onResolve({ filter: /^(openai|@\/lib\/vfx-lab\/(budget|server))$/ }, args => ({ path: args.path, namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'ts', contents: args.path === 'openai' ? `
    export const toFile = async (bytes, name, options) => ({ bytes, name, ...options });
    export default class OpenAI {
      static APIError = class extends Error {};
      images = { edit: async args => { globalThis.__splatGenerationTest.calls.push(args); return globalThis.__splatGenerationTest.edit(args); } };
    }
  ` : args.path.endsWith('budget') ? `
    export const DATA_DIR = ${JSON.stringify(dir)};
    export async function reserveUsd() { const id = globalThis.__splatGenerationTest.reservations.length + 1; globalThis.__splatGenerationTest.reservations.push(id); return id; }
    export async function settleUsd(id, cost) { globalThis.__splatGenerationTest.settled.push({id, cost}); }
  ` : `${localGuard} export const getKey = async () => { globalThis.__splatGenerationTest.keyCalls++; return "mock-only"; };` }));
  build.onResolve({ filter: /^(sharp|zod)$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
} } ] });
const { POST, GET } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const request = body => new Request('http://localhost:3000/api/local-splat', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' }, body: JSON.stringify(body) });
const get = url => GET(new Request(url, { headers: { host: 'localhost:3000' } }));
const post = async body => { const response = await POST(request(body)); return { status: response.status, body: await response.json() }; };
const reference = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#a03080' } }).png().toBuffer();
const data = `data:image/png;base64,${reference.toString('base64')}`;
h.edit = async () => ({ data: [{ b64_json: reference.toString('base64') }] });
function nodeInfo() {
  const info = {};
  for (const node of Object.values(template)) {
    const definition = info[node.class_type] ??= { input: { required: {} } };
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      const choices = definition.input.required[key] ??= [[]];
      if (!choices[0].includes(value)) choices[0].push(value);
    }
  }
  info.LoadImage.input.required.image = [[]]; // fresh server, no placeholder
  return info;
}
let info = nodeInfo(), prompts = [], uploads = [], failPrompt = false, turntableMode = false, failedFrame = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  h.network++;
  const pathname = new URL(url).pathname;
  if (pathname === '/object_info') return Response.json(info);
  if (pathname === '/upload/image') {
    assert.equal(h.settled.length, h.reservations.length, 'paid stage settled before reconstruction');
    const file = options.body.get('image');
    assert.equal(options.body.get('overwrite'), 'false');
    uploads.push({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ name: file.name, subfolder: 'inputs' });
  }
  if (pathname === '/prompt') {
    if (failPrompt) return new Response('controlled failure', { status: 500 });
    const payload = JSON.parse(options.body); prompts.push(payload.prompt);
    return Response.json({ prompt_id: String(prompts.length) });
  }
  if (pathname.startsWith('/history/')) {
    const images = turntableMode ? Array.from({ length: 48 }, (_, index) => ({ filename: `triposplat_turntable_${String(index + 1).padStart(5, '0')}.png`, subfolder: 'output' })) : [];
    return Response.json({ [pathname.split('/').at(-1)]: { outputs: { file: { filename: 'result.ply' }, images } } });
  }
  if (pathname === '/view') {
    const filename = new URL(url).searchParams.get('filename');
    if (filename === failedFrame) return new Response('controlled frame failure', { status: 503 });
    return new Response(filename?.endsWith('.png') ? `png-${filename}` : 'ply\nmock-result');
  }
  throw new Error(`Unexpected request ${url}`);
};
const check = (name) => console.log(`PASS ${name}`);
try {
  const savedCwd = process.cwd(); process.chdir(tmpdir());
  try {
    info = {}; // Import must succeed with no configured reconstruction nodes.
    const imported = [];
    for (const format of ['png', 'jpeg', 'webp']) {
      const bytes = await sharp(reference).toFormat(format).toBuffer();
      const result = await post({ stage: 'import', cleanImage: `data:image/${format};base64,${bytes.toString('base64')}` });
      assert.equal(result.status, 200, result.body.error);
      imported.push(result.body);
      const asset = await get(`http://localhost:3000${result.body.cleanImage}`);
      assert.equal(asset.status, 200);
      const meta = await sharp(Buffer.from(await asset.arrayBuffer())).metadata();
      assert.equal(meta.format, 'png'); assert.equal(meta.width, 160); assert.equal(meta.height, 90);
    }
    assert.equal(new Set(imported.map(i => i.cleanId)).size, 3);
    assert.equal(h.keyCalls, 0); assert.equal(h.network, 0); assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0);
    check('PNG/JPEG/WebP import saves unique full-aspect PNGs without any provider, budget, or ComfyUI calls');
    for (const cleanImage of ['data:image/png;base64,AAAA', 'data:image/png;base64,!!!', data.replace('image/png', 'image/jpeg'), `data:image/png;base64,${Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64')}`]) {
      assert.equal((await post({ stage: 'import', cleanImage })).status, 400);
    }
    assert.equal((await post({ stage: 'import', cleanImage: data, reference: data })).status, 400);
    assert.equal((await post({ stage: 'splat', cleanId: imported[0].cleanId, cleanImage: data })).status, 400);
    const foreign = request({ stage: 'import', cleanImage: data }); foreign.headers.set('origin', 'https://example.com');
    assert.equal((await POST(foreign)).status, 403);
    const noHost = request({ stage: 'import', cleanImage: data }); noHost.headers.delete('host');
    assert.equal((await POST(noHost)).status, 403);
    assert.equal((await get('http://localhost:3000/api/local-splat?id=../../secret&kind=clean')).status, 404);
    assert.equal(h.network, 0); assert.equal(h.keyCalls, 0);
    check('invalid uploads and stage combinations rejected; real same-origin guard and safe IDs enforced');
    info = nodeInfo(); failPrompt = true;
    assert.equal((await post({ stage: 'splat', cleanId: imported[0].cleanId })).status, 500);
    failPrompt = false;
    const importedRetry = await post({ stage: 'splat', cleanId: imported[0].cleanId });
    assert.equal(importedRetry.status, 200, importedRetry.body.error);
    assert.equal(h.keyCalls, 0); assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0);
    assert.equal((await get(`http://localhost:3000${imported[0].cleanImage}`)).status, 200);
    check('imported image reconstruction and retry reuse saved image without OpenAI');
    prompts = []; uploads = [];
    info = {}; const missing = await post({ reference: data });
    assert.equal(missing.status, 500); assert.match(missing.body.error, /missing required node/);
    assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0);
    info = nodeInfo(); info.UNETLoader.input.required.unet_name = [[]];
    const noModel = await post({ reference: data }); assert.equal(noModel.status, 500);
    assert.equal(h.calls.length, 0); assert.equal(h.reservations.length, 0);
    check('preflight nodes/models fail before paid provider and reservation');
    info = nodeInfo();
    const clean = await post({ reference: data, stage: 'clean', adjustment: 'Keep the painted texture.' });
    assert.equal(clean.status, 200, clean.body.error);
    assert.ok(clean.body.cleanId); assert.equal(prompts.length, 0); assert.equal(uploads.length, 0);
    assert.equal(h.calls.length, 1); assert.equal(h.settled.length, 1);
    const id = clean.body.cleanId;
    const saved = await get(`http://localhost:3000${clean.body.cleanImage}`);
    assert.equal(saved.status, 200);
    const metadata = await sharp(Buffer.from(await saved.arrayBuffer())).metadata();
    assert.equal(metadata.width, 160); assert.equal(metadata.height, 90);
    assert.equal(h.calls[0].size, 'auto'); assert.match(h.calls[0].prompt, /Preserve the original visual style/);
    assert.match(h.calls[0].prompt, /160 by 90/); assert.match(h.calls[0].prompt, /Keep the painted texture/);
    check('repo-bundled workflow works from another cwd; clean review stage saves/settles without queuing splat; aspect/style preserved');
    failPrompt = true;
    const failed = await post({ stage: 'splat', cleanId: id });
    assert.equal(failed.status, 500); assert.equal(failed.body.cleanId, id);
    assert.equal((await get(`http://localhost:3000${clean.body.cleanImage}`)).status, 200);
    assert.equal(h.calls.length, 1); assert.equal(h.settled.length, 1);
    failPrompt = false;
    const retry = await post({ stage: 'splat', cleanId: id });
    assert.equal(retry.status, 200, retry.body.error); assert.ok(retry.body.splatUrl);
    assert.equal(h.calls.length, 1); assert.equal(h.reservations.length, 1);
    check('downstream failure retains clean artifact; retry reuses it without provider/budget calls');
    const square = await sharp(uploads[0].bytes).metadata(); assert.equal(square.width, 1024); assert.equal(square.height, 1024);
    const rgba = await sharp(uploads[0].bytes).ensureAlpha().raw().toBuffer(); assert.equal(rgba[3], 0, 'square padding is transparent');
    check('square preparation is separate from saved wide cleanup');
    // Distinct references produce distinct uploads even when queued concurrently.
    const secondImage = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#20b060' } }).png().toBuffer();
    h.edit = async () => ({ data: [{ b64_json: secondImage.toString('base64') }] });
    const second = await post({ stage: 'clean', reference: data });
    const before = uploads.length;
    const concurrent = await Promise.all([post({ stage: 'splat', cleanId: id }), post({ stage: 'splat', cleanId: second.body.cleanId })]);
    assert.ok(concurrent.every(result => result.status === 200));
    const pair = uploads.slice(before); assert.equal(pair.length, 2);
    assert.notEqual(pair[0].name, pair[1].name); assert.ok(!pair[0].bytes.equals(pair[1].bytes));
    assert.deepEqual(new Set(prompts.slice(-2).map(p => p['1'].inputs.image)), new Set(pair.map(p => `inputs/${p.name}`)));
    check('concurrent reconstruction jobs upload isolated filenames/bytes and queue corresponding images');
    turntableMode = true;
    failedFrame = null;
    const turntableResult = await post({ stage: 'splat', cleanId: id });
    assert.equal(turntableResult.status, 200, turntableResult.body.error);
    assert.deepEqual(turntableResult.body.turntable, {
      expected: 48, downloaded: 48, complete: true,
      paths: Array.from({ length: 48 }, (_, index) => `/api/local-splat?id=${turntableResult.body.id}&kind=frame&frame=frame-${String(index + 1).padStart(3, '0')}.png`),
    });
    for (const [index, framePath] of turntableResult.body.turntable.paths.entries()) {
      const frame = await get(`http://localhost:3000${framePath}`);
      assert.equal(frame.status, 200);
      assert.equal(await frame.text(), `png-triposplat_turntable_${String(index + 1).padStart(5, '0')}.png`);
    }
    assert.equal((await get(`http://localhost:3000/api/local-splat?id=${turntableResult.body.id}&kind=frame&frame=../result.ply`)).status, 404);
    check('48 ordered turntable frames save under the splat ID with local retrieval paths and safe filenames');
    failedFrame = 'triposplat_turntable_00017.png';
    const partial = await post({ stage: 'splat', cleanId: id });
    assert.equal(partial.status, 200, partial.body.error);
    assert.equal(partial.body.turntable.expected, 48);
    assert.equal(partial.body.turntable.downloaded, 47);
    assert.equal(partial.body.turntable.complete, false);
    assert.match(partial.body.turntable.warning, /incomplete/);
    assert.ok(partial.body.turntable.failures.some(failure => failure.startsWith('frame-017.png:')));
    assert.equal((await get(`http://localhost:3000${partial.body.splatUrl}`)).status, 200);
    check('partial frame download reports incompleteness while preserving the successful PLY');
  } finally { process.chdir(savedCwd); }
} finally {
  globalThis.fetch = originalFetch; delete globalThis.__splatGenerationTest;
  await rm(dir, { recursive: true, force: true });
}

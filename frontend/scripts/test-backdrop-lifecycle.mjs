import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the actual controller with a deterministic Spark initializer. The
// real Spark/browser integration is covered separately by verify-backdrop.mjs.
const harness = { meshes: [], renderers: [] };
globalThis.__backdropLifecycle = harness;
const result = await build({
  entryPoints: ['src/lib/vfx-lab/backdrop-controller.ts'], bundle: true,
  write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'controlled-spark', setup(build) {
    build.onResolve({ filter: /^@sparkjsdev\/spark$/ }, () => ({ path: 'spark', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      import { Object3D, Box3, Vector3 } from "three";
      export class SplatMesh extends Object3D {
        getBoundingBox() { return new Box3(new Vector3(-1,-2,-1), new Vector3(1,3,1)); }
        numSplats = 42; disposed = 0; updateMatrixWorld() {}
        constructor({ url }) {
          super(); this.url = url;
          this.initialized = new Promise((resolve, reject) => {
            this.complete = () => resolve(this); this.fail = reject;
          });
          globalThis.__backdropLifecycle.meshes.push(this);
        }
        dispose() { this.disposed++; }
      }
      export class SparkRenderer {
        disposed = 0;
        constructor() { globalThis.__backdropLifecycle.renderers.push(this); }
        dispose() { this.disposed++; }
      }
    `, resolveDir: process.cwd() }));
  } }],
});
const { BackdropController } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const revoked = [];
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
let serial = 0;
URL.createObjectURL = () => `blob:test-${++serial}`;
URL.revokeObjectURL = url => revoked.push(url);
const make = () => {
  const scene = { children: [], add(o) { this.children.push(o); }, remove(o) { this.children = this.children.filter(x => x !== o); } };
  return { scene, controller: new BackdropController({ scene, renderer: {} }) };
};
const latest = () => harness.meshes.at(-1);
const flush = () => new Promise(resolve => setImmediate(resolve));
try {
  const { controller: c, scene } = make();
  const a = c.loadFile({}); const ma = latest();
  const b = c.loadFile({}); const mb = latest();
  assert.equal(await a, 'superseded');
  ma.complete(); await flush();
  assert.equal(ma.disposed, 1);
  assert.deepEqual(revoked, ['blob:test-1']); // B still decoding
  mb.complete(); assert.equal(await b, 'loaded');
  mb.updateMatrix();
  assert.ok(Math.abs(mb.getBoundingBox().applyMatrix4(mb.matrix).min.y) < 1e-8);
  c.setTransform({ rotation: [0.4, 0.2, 0.8], scale: 2, position: [1, 0.5, 3] });
  mb.updateMatrix();
  assert.ok(Math.abs(mb.getBoundingBox().applyMatrix4(mb.matrix).min.y - 0.5) < 1e-8);
  c.setTransform({ scale: 2 });
  mb.updateMatrix();
  assert.ok(Math.abs(mb.getBoundingBox().applyMatrix4(mb.matrix).min.y - 0.5) < 1e-8);
  assert.equal(scene.children.length, 2);
  assert.equal(harness.renderers.length, 1); // no renderer for abandoned loads
  const failed = c.load('/broken.ply'); const mf = latest();
  mf.fail(new Error('decode failed'));
  await assert.rejects(failed, /decode failed/);
  assert.equal(mf.disposed, 1);
  assert.equal(c.snapshot.settings.url, 'blob:test-2');
  assert.equal(c.snapshot.state, 'ready');
  assert.equal(scene.children.length, 2);
  const replace = c.load('/normal.ply'); latest().complete(); await replace;
  assert.equal(mb.disposed, 1);
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
  c.remove(); assert.equal(scene.children.length, 0);
  const local = c.loadFile({}); latest().complete(); await local;
  c.remove(); assert.equal(revoked.filter(x => x === 'blob:test-3').length, 1);

  // Remove/dispose during pending load settle immediately; late success and
  // late failure both clean up without reattaching or unhandled rejection.
  for (const action of ['remove', 'dispose']) {
    const { controller, scene } = make();
    const pending = controller.loadFile({}); const mesh = latest();
    controller[action](); assert.equal(await pending, 'superseded');
    if (action === 'remove') mesh.complete(); else mesh.fail(new Error('late failure'));
    await flush();
    assert.equal(mesh.disposed, 1); assert.equal(scene.children.length, 0);
    assert.equal(revoked.filter(x => x === mesh.url).length, 1);
  }

  // Trigger the real timeout branch without spending two minutes sleeping.
  for (const completion of ['complete', 'fail']) {
    const { controller, scene } = make();
    const originalSetTimeout = globalThis.setTimeout;
    let timeout;
    globalThis.setTimeout = fn => { timeout = fn; return 0; };
    const pending = controller.loadFile({}); const mesh = latest();
    globalThis.setTimeout = originalSetTimeout;
    timeout(); await assert.rejects(pending, /Timed out/);
    assert.equal(controller.snapshot.state, 'error');
    mesh[completion](new Error('late rejection')); await flush();
    assert.equal(mesh.disposed, 1); assert.equal(scene.children.length, 0);
    assert.equal(revoked.filter(x => x === mesh.url).length, 1);
  }
  c.dispose();
  assert.ok(harness.renderers.every(x => x.disposed === 1));
  assert.ok(harness.meshes.every(x => x.disposed === 1));
  console.log('PASS backdrop lifecycle: concurrent ownership, async rejection, URL replacement/removal, pending cancellation, timeout, late success/failure, resource disposal');
} finally {
  URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  delete globalThis.__backdropLifecycle;
}

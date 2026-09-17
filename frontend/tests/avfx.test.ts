import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three/webgpu";
import { unzipSync } from "three/addons/libs/fflate.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { exportAvfx } from "../src/lib/avfx/export";
import { prepareAvfxDocument } from "../src/lib/avfx/scope";
import { zipStore } from "../src/lib/avfx/binary";
import { createV2ExportScene } from "../src/lib/vfx-lab/runtime-v2";
import { defaultBlob, defaultGeometry, defaultMaterial, validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

const fixture = () => validateDocumentV2(JSON.parse(fs.readFileSync("fixtures/v2/fire-projectile/document.json", "utf8")));
// Deliberately tiny fixture asset. Production export reads the actual URL.
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9kAAAAASUVORK5CYII=", "base64"));
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, bytes.slice(start, start + size));
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return files;
}
const readJson = (files: Map<string, Uint8Array>, path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!));

test("fire projectile produces deterministic, self-contained AVFX payloads without mutating input", async () => {
  const source = fixture(), before = JSON.stringify(source);
  const reads = new Set<string>();
  const readAsset = async (url: string) => { reads.add(url); return png; };
  const first = await exportAvfx(source, { readAsset });
  const second = await exportAvfx(source, { readAsset });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(JSON.stringify(source), before);
  assert.equal(first.filename, "fire-projectile.avfx");
  assert.equal(first.manifest.layers.length, 8);
  assert.deepEqual(first.manifest.excluded, [{ id: "fire-light", kind: "light", reason: "out-of-scope" }]);
  assert.ok(reads.size >= 8);
  const files = unzip(first.bytes);
  const independentFiles = unzipSync(first.bytes);
  assert.equal(Object.keys(independentFiles).length, files.size);
  for (const [path, bytes] of files) assert.deepEqual(independentFiles[path], bytes);
  assert.equal(files.size, first.fileCount);
  const timeline = readJson(files, "timeline.json");
  assert.equal(timeline.sampleRate, 60);
  assert.equal(timeline.interpolation, "step");
  for (const entry of first.manifest.files) {
    const bytes = files.get(entry.path)!;
    assert.equal(bytes.length, entry.bytes);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))).toString("hex");
    assert.equal(hash, entry.sha256);
  }
  const session = createV2ExportScene(prepareAvfxDocument(source).document);
  try {
    for (const layer of first.manifest.layers) {
      const descriptor = readJson(files, layer.path);
      const runtime = session.objects.find(object => object.id === layer.id)!;
      const meshes: THREE.Mesh[] = [];
      runtime.object.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
      assert.equal(descriptor.draws.length, meshes.length);
      descriptor.draws.forEach((draw: { id: string; mesh: string; instances: string | null; uniforms: Record<string, { type: string; binding?: { path?: string } }> }, i: number) => {
        const glb = files.get(draw.mesh)!;
        const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
        assert.equal(view.getUint32(0, true), 0x46546c67);
        assert.equal(view.getUint32(8, true), glb.length);
        const jsonLength = view.getUint32(12, true);
        const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
        const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
        assert.equal(position.count, meshes[i].geometry.attributes.position.count);
        if (draw.instances) {
          const instances = readJson(files, draw.instances);
          const seed = meshes[i].geometry.attributes.aSeed;
          assert.equal(instances.count, seed.count);
          for (let j = 0; j < seed.count; j++) for (let k = 0; k < 4; k++)
            assert.equal(instances.attributes.aSeed.values[j * 4 + k], seed.getComponent(j, k));
          assert.ok(instances.attributes.aIndex, "include all attributes, not just the original 12 floats");
        }
        for (const uniform of Object.values(draw.uniforms)) if (uniform.binding?.path) assert.ok(files.has(uniform.binding.path));
        assert.ok(timeline.draws[draw.id].length > 0);
        assert.equal(timeline.draws[draw.id].at(-1).visible, false);
      });
    }
  } finally { session.dispose(); }
});

test("missing/invalid texture bytes fail instead of producing a broken archive", async () => {
  await assert.rejects(exportAvfx(fixture(), { readAsset: async () => { throw new Error("offline asset"); } }), /offline asset/);
  await assert.rejects(exportAvfx(fixture(), { readAsset: async () => new TextEncoder().encode("not PNG") }), /not a PNG/);
});

test("scope rejects empty exports and unsupported camera frames", () => {
  const doc = fixture();
  doc.layers.forEach(layer => { layer.enabled = layer.kind === "light"; });
  assert.throws(() => prepareAvfxDocument(doc), /No enabled/);
  const camera = fixture();
  camera.layers[0].frame = "camera";
  assert.throws(() => prepareAvfxDocument(camera), /camera-frame/);
});

test("ZIP output is deterministic and rejects traversal paths", () => {
  const files = new Map([["avfx.json", new TextEncoder().encode("{}")]]);
  assert.deepEqual(zipStore(files), zipStore(files));
  assert.throws(() => zipStore(new Map([["../escape", png]])), /Unsafe/);
});

test("all six geometry kinds produce surface meshes and sampled renderer state", async () => {
  const doc = fixture();
  const template = doc.layers.find(layer => layer.kind === "shell")!;
  doc.layers = (["ring", "shell", "trail", "beam", "sprite", "decal"] as const).map(kind => ({
    ...structuredClone(template), id: kind, kind, start: 0, end: doc.duration,
    geometry: defaultGeometry(), material: defaultMaterial(), tracks: [], overrides: [],
  }));
  const result = await exportAvfx(doc, { readAsset: async () => png });
  const files = unzip(result.bytes), timeline = readJson(files, "timeline.json");
  const session = createV2ExportScene(prepareAvfxDocument(doc).document);
  try {
    session.sample(0.5);
    for (const entry of result.manifest.layers) {
      const layer = readJson(files, entry.path), draw = layer.draws[0];
      const glb = Uint8Array.from(files.get(draw.mesh)!);
      const loaded = await new GLTFLoader().parseAsync(glb.buffer, "");
      assert.equal(loaded.scene.children.length, 1);
      loaded.scene.traverse(object => {
        if (object instanceof THREE.Mesh || "geometry" in object) {
          const mesh = object as THREE.Mesh;
          mesh.geometry.dispose();
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
        }
      });
      assert.equal(draw.program, "surface");
      assert.equal(draw.instances, null);
      assert.equal(draw.uniforms.uProcedural.storage, "constant");
      const sample = timeline.draws[draw.id].findLast((s: { time: number }) => s.time <= 0.5);
      assert.ok(sample.visible);
      assert.equal("uProcedural" in sample.uniforms, false);
      const object = session.objects.find(object => object.id === entry.id)!;
      assert.deepEqual(sample.matrix, object.object.matrixWorld.toArray());
    }
  } finally { session.dispose(); }
});

test("scope includes generator dependencies and rejects disabled sources", () => {
  const doc = validateDocumentV2(JSON.parse(fs.readFileSync("fixtures/v2/ice-blast/document.json", "utf8")));
  // The authored fixture borrows its debris sites from crystal geometry.
  const dependent = doc.layers.find(layer => layer.emitter?.shape.sourceLayerId);
  assert.ok(dependent, "fixture must exercise a source-layer dependency");
  assert.ok(prepareAvfxDocument(doc).document.layers.some(layer => layer.kind === "crystals"));
  doc.layers.find(layer => layer.id === dependent.emitter!.shape.sourceLayerId)!.enabled = false;
  assert.throws(() => prepareAvfxDocument(doc), /excluded layer/);
});

test("animated torus geometry is exported as a mesh sequence, not a frozen first frame", async () => {
  const doc = fixture();
  const layer = structuredClone(doc.layers.find(layer => layer.kind === "shell")!);
  layer.kind = "ring";
  layer.geometry = { ...defaultGeometry(), type: "torus", segments: 12, radialSegments: 6 };
  layer.material = defaultMaterial();
  layer.start = 0;
  layer.end = doc.duration;
  layer.tracks = [{ target: "geometry.radius", keys: [[0, 1], [doc.duration, 2]], ease: "linear" }];
  layer.overrides = [];
  doc.layers = [layer];
  const result = await exportAvfx(doc);
  const files = unzip(result.bytes);
  const descriptor = readJson(files, result.manifest.layers[0].path);
  const samples = readJson(files, "timeline.json").draws[descriptor.draws[0].id];
  const meshes = new Set<string>(samples.map((sample: { mesh: string }) => sample.mesh));
  assert.ok(meshes.size > 2);
  for (const path of meshes) assert.ok(files.has(path));
  const mid = samples.findLast((sample: { time: number }) => sample.time <= 0.5);
  assert.notEqual(samples[0].mesh, mid.mesh);
});

test("blob exports changing instance tables, hides empty frames and preserves rewind data", async () => {
  const doc = fixture();
  const layer = structuredClone(doc.layers.find(layer => layer.kind === "shell")!);
  layer.kind = "blob";
  layer.blob = defaultBlob();
  delete layer.geometry;
  layer.material = defaultMaterial();
  layer.motion = null;
  layer.tracks = [];
  layer.overrides = [];
  layer.start = 0;
  layer.end = doc.duration = 1;
  doc.layers = [layer];
  const result = await exportAvfx(doc);
  const files = unzip(result.bytes);
  const descriptor = readJson(files, result.manifest.layers[0].path);
  assert.ok(descriptor.draws.length > 0);
  let visibleDraws = 0;
  for (const draw of descriptor.draws) {
    assert.equal(draw.program, "blob");
    const samples = readJson(files, "timeline.json").draws[draw.id];
    assert.equal(samples[0].visible, false);
    if (samples.some((sample: { visible: boolean }) => sample.visible)) visibleDraws++;
    const paths = new Set<string>(samples.map((sample: { instances: string }) => sample.instances));
    assert.ok(paths.size > 2, "live lobe data must not freeze at construction");
    for (const path of paths) {
      const instances = readJson(files, path);
      assert.ok(instances.count > 0);
      for (const attr of Object.values(instances.attributes) as Array<{ count: number; itemSize: number; values: number[] }>) {
        assert.equal(attr.count, instances.count);
        assert.equal(attr.values.length, attr.count * attr.itemSize);
      }
    }
  }
  assert.ok(visibleDraws > 0);
});

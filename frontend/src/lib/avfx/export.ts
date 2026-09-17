import * as THREE from "three/webgpu";
import type { V2NodeMaterial } from "../vfx-lab/node-material-v2";
import { createV2ExportScene, RUNTIME_VERSION_V2 } from "../vfx-lab/runtime-v2";
import type { VfxDocumentV2 } from "../vfx-lab/schema-v2";
import * as shaderReferences from "../vfx-lab/shaders-v2";
import { jsonBytes, meshGlb, zipStore, type PackedAttribute } from "./binary";
import { prepareAvfxDocument } from "./scope";

type Value = number | number[] | Value[];
type Binding = { kind: string; type: string; size?: number };
type Abi = { program: string; vertexName: string; fragmentName: string; bindings: Record<string, Binding>; constants: string[] };
type Sample = { time: number; visible: boolean; matrix: number[]; mesh: string; uniforms: Record<string, Value> };
type ExportOptions = {
  onProgress?: (message: string) => void;
  /** Injectable for offline verification; must return actual PNG bytes. */
  readAsset?: (url: string) => Promise<Uint8Array>;
};
const FPS = 60;
const MAX_BYTES = 256 * 1024 * 1024;
const EXTERNAL: Record<string, string> = {
  uResolution: "viewport-size-pixels", uNear: "camera-near", uFar: "camera-far",
  uSmokeRight: "camera-right-world", uSmokeUp: "camera-up-world", uSmokeForward: "camera-back-world",
};
function valueOf(value: unknown): Value {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.map(valueOf);
  if (value && typeof value === "object" && "toArray" in value && typeof value.toArray === "function")
    return valueOf(value.toArray());
  throw new Error("Non-finite or unsupported shader uniform in AVFX export.");
}
function packAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): PackedAttribute {
  const values: number[] = [];
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) {
    const value = attribute.getComponent(i, k);
    if (!Number.isFinite(value)) throw new Error("Non-finite mesh attribute in AVFX export.");
    values.push(value);
  }
  return { itemSize: attribute.itemSize, count: attribute.count, values };
}
function instanced(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  return (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute ||
    (attribute instanceof THREE.InterleavedBufferAttribute &&
      attribute.data instanceof THREE.InstancedInterleavedBuffer);
}
async function readPng(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Texture fetch failed (${response.status}): ${url}`);
  if (Number(response.headers.get("content-length")) > 32 * 1024 * 1024) throw new Error("Texture exceeds 32 MiB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 32 * 1024 * 1024) throw new Error("Texture exceeds 32 MiB.");
  return bytes;
}
async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function visible(mesh: THREE.Object3D) {
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent) if (!object.visible) return false;
  return true;
}

/** Build a standalone archive from renderer-owned geometry and typed uniforms.
 * Does not mutate the input, current preview, or any external storage. */
export async function exportAvfx(input: VfxDocumentV2, options: ExportOptions = {}) {
  const { source, document, excluded } = prepareAvfxDocument(input);
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  const put = (path: string, bytes: Uint8Array) => {
    totalBytes += bytes.length - (files.get(path)?.length ?? 0);
    if (totalBytes > MAX_BYTES) throw new Error("AVFX exceeds the 256 MiB first-pass bundle limit.");
    files.set(path, bytes);
  };
  const json = (path: string, data: unknown) => put(path, jsonBytes(data));
  options.onProgress?.("Baking renderer geometry and particle attributes…");
  const session = createV2ExportScene(document);
  try {
    const meshPaths = new Map<THREE.BufferGeometry, string>();
    const texturePaths = new Map<string, string>();
    const textureTasks: Array<() => Promise<void>> = [];
    const textureInfo: Record<string, unknown> = {};
    const shaderInfo: Record<string, unknown> = {};
    const draws: Array<{
      id: string; layerId: string; mesh: THREE.Mesh; abi: Abi; material: V2NodeMaterial;
      descriptor: Record<string, unknown>; samples: Sample[]; previous?: string;
    }> = [];

    function meshFile(geometry: THREE.BufferGeometry) {
      const cached = meshPaths.get(geometry);
      if (cached) return cached;
      const path = `meshes/mesh-${meshPaths.size}.glb`;
      const attributes = Object.fromEntries(Object.entries(geometry.attributes)
        .filter(([, attribute]) => !instanced(attribute)).map(([name, attribute]) => [name, packAttribute(attribute)]));
      if (!attributes.position) throw new Error("Export draw has no position attribute.");
      put(path, meshGlb({ attributes, indices: geometry.index ? packAttribute(geometry.index).values : null }));
      meshPaths.set(geometry, path);
      return path;
    }
    function textureBinding(texture: THREE.Texture | null) {
      if (!texture) return { source: "unbound", fallback: "zero" };
      if (texture instanceof THREE.DepthTexture) return { source: "engine", semantic: "opaque-scene-depth" };
      const url = texture.userData.avfxSource as string | undefined;
      const key = url ?? texture.uuid;
      let path = texturePaths.get(key);
      if (!path) {
        path = `textures/texture-${texturePaths.size}.${url ? "png" : "json"}`;
        texturePaths.set(key, path);
        const target = path;
        if (url) {
          // The runtime currently uses linear PNG masks/noise. Never silently
          // embed an HTML error or rename a JPEG to PNG.
          textureTasks.push(() => (options.readAsset ?? readPng)(url).then(bytes => {
            if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte))
              throw new Error(`Texture is not a PNG: ${url}`);
            put(target, bytes);
          }));
        } else if (texture instanceof THREE.DataTexture) {
          const data = texture.image;
          json(target, { encoding: "raw-data-texture", width: data.width, height: data.height,
            type: texture.type, format: texture.format, values: Array.from(data.data as unknown as ArrayLike<number>) });
        } else throw new Error("Unsupported generated texture; cannot export it losslessly.");
        textureInfo[target] = { encoding: url ? "png" : "raw-data-texture", colorSpace: texture.colorSpace || "linear" };
      }
      const wrap = (mode: number) => mode === THREE.RepeatWrapping ? "repeat" : mode === THREE.MirroredRepeatWrapping ? "mirrored-repeat" : "clamp-to-edge";
      return { source: "bundle", path, colorSpace: texture.colorSpace || "linear", flipY: texture.flipY,
        wrapS: wrap(texture.wrapS), wrapT: wrap(texture.wrapT), minFilter: texture.minFilter,
        magFilter: texture.magFilter, generateMipmaps: texture.generateMipmaps, anisotropy: texture.anisotropy };
    }
    for (const object of session.objects) {
      const layer = object.source;
      object.object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        if (Array.isArray(child.material)) throw new Error("Multi-material draws are not supported in AVFX 0.1.");
        const material = child.material as V2NodeMaterial;
        const abi = material.userData.avfx as Abi | undefined;
        if (!abi) throw new Error(`Missing shader ABI for ${layer.id}.`);
        const id = `draw-${draws.length}`;
        const geometry = child.geometry as THREE.BufferGeometry;
        const instances = Object.fromEntries(Object.entries(geometry.attributes)
          .filter(([, attribute]) => instanced(attribute)).map(([name, attribute]) => [name, packAttribute(attribute)]));
        const instancePath = Object.keys(instances).length ? `meshes/${id}-instances.json` : null;
        if (instancePath) json(instancePath, {
          count: (child.geometry as THREE.InstancedBufferGeometry).instanceCount,
          order: "authored-seed-order", attributes: instances,
        });
        const uniforms: Record<string, unknown> = {};
        for (const [name, binding] of Object.entries(abi.bindings)) {
          if (binding.kind !== "uniform") continue;
          const value = material.uniforms[name]?.value;
          uniforms[name] = { type: binding.type, ...(binding.size ? { size: binding.size } : {}),
            ...(binding.type === "sampler2D" ? { binding: textureBinding(value) }
              : name === "uTime" ? { binding: { source: "engine", semantic: "layer-local-seconds", start: layer.start } }
              : EXTERNAL[name] ? { binding: { source: "engine", semantic: EXTERNAL[name] } }
              : { value: valueOf(value), storage: abi.constants.includes(name) ? "constant" : "uniform" }) };
        }
        const sources = shaderReferences as unknown as Record<string, string>;
        // Use the same attribute-complete variants as port-shaders.mts, not
        // the historical particleVertexV2 shorthand (which omits attributes).
        const vertexSources: Record<string, () => string> = {
          particleVertex: () => shaderReferences.particleVertexSource(false, true, true),
          subParticleVertex: () => shaderReferences.particleVertexSource(true, true, true),
          trailVertex: () => shaderReferences.trailVertexSource(false, true, true),
          subTrailVertex: () => shaderReferences.trailVertexSource(true, true, true),
          stripVertex: () => shaderReferences.stripVertexSource(true, true),
          sliverVertex: () => shaderReferences.sliverVertexSource(true, true),
        };
        for (const name of [abi.vertexName, abi.fragmentName]) {
          const path = `kernel/glsl/${name}.glsl`;
          if (!files.has(path)) {
            const code = vertexSources[name]?.() ?? sources[`${name}V2`];
            if (typeof code !== "string") throw new Error(`Missing shader reference: ${name}`);
            put(path, new TextEncoder().encode(code));
          }
        }
        shaderInfo[abi.program] = { vertex: `kernel/glsl/${abi.vertexName}.glsl`, fragment: `kernel/glsl/${abi.fragmentName}.glsl`, bindings: abi.bindings, constants: abi.constants };
        const blend = layer.material!.blend;
        const descriptor = {
          id, name: child.name, program: abi.program, mesh: meshFile(child.geometry), instances: instancePath,
          uniforms, renderState: {
            blend, rgb: { operation: "add", source: blend === "additive" || blend === "alpha" ? "src-alpha" : "one",
              destination: blend === "additive" ? "one" : blend === "screen" ? "one-minus-src-color" : "one-minus-src-alpha" },
            alpha: { operation: "add", source: "one", destination: blend === "additive" ? "one" : "one-minus-src-alpha" },
            depthTest: material.depthTest, depthWrite: material.depthWrite,
            side: material.side === THREE.DoubleSide ? "double" : material.side === THREE.BackSide ? "back" : "front",
            premultipliedAlpha: material.premultipliedAlpha, renderOrder: child.renderOrder,
            depthFunction: "less-equal",
            sort: layer.emitter ? {
              requested: layer.emitter.render.sortMode,
              effective: child.userData.avfxSort,
            } : { effective: "object-distance" },
          },
        };
        draws.push({ id, layerId: layer.id, mesh: child, material, abi, descriptor, samples: [] });
      });
    }
    // Await all outstanding requests even after one fails, before cleanup. This
    // prevents orphaned promise rejections or writes after the export returns.
    options.onProgress?.("Packaging textures…");
    const assets = await Promise.allSettled(textureTasks.map(task => task()));
    const failure = assets.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;

    const times = new Set<number>([0, document.duration]);
    for (let frame = 0; frame <= Math.ceil(document.duration * FPS); frame++) times.add(Math.min(document.duration, frame / FPS));
    for (const layer of session.document.layers) {
      times.add(layer.start); times.add(layer.end);
      if (layer.geometry?.type === "lightning") for (let t = layer.start; t < layer.end; t += 1 / 8) times.add(t);
    }
    const orderedTimes = [...times].filter(t => t >= 0 && t <= document.duration).sort((a, b) => a - b);
    options.onProgress?.(`Sampling animation at ${FPS} Hz…`);
    let timelineBytes = 0;
    for (let i = 0; i < orderedTimes.length; i++) {
      const time = orderedTimes[i];
      session.sample(time);
      for (const draw of draws) {
        const uniforms: Record<string, Value> = {};
        for (const [name, binding] of Object.entries(draw.abi.bindings)) {
          if (binding.kind !== "uniform" || binding.type === "sampler2D" || EXTERNAL[name] || name === "uTime" || draw.abi.constants.includes(name)) continue;
          uniforms[name] = valueOf(draw.material.uniforms[name].value);
        }
        const state = { visible: visible(draw.mesh), matrix: draw.mesh.matrixWorld.toArray(), mesh: meshFile(draw.mesh.geometry), uniforms };
        const serialized = JSON.stringify(state);
        if (serialized !== draw.previous) {
          timelineBytes += serialized.length;
          if (timelineBytes + totalBytes > MAX_BYTES) throw new Error("AVFX animation exceeds the 256 MiB first-pass limit.");
          draw.samples.push({ time, ...state });
          draw.previous = serialized;
        }
      }
      if (i % 30 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const layers = session.document.layers.map((layer, i) => {
      const path = `layers/layer-${i}.json`;
      json(path, { id: layer.id, name: layer.name, kind: layer.kind, start: layer.start, end: layer.end,
        draws: draws.filter(draw => draw.layerId === layer.id).map(draw => draw.descriptor) });
      return { id: layer.id, kind: layer.kind, path };
    });
    json("timeline.json", { sampleRate: FPS, interpolation: "step", matrixLayout: "column-major",
      timeDomain: "absolute-seconds", draws: Object.fromEntries(draws.map(draw => [draw.id, draw.samples])) });
    json("source/document.json", source);
    json("source/export-document.json", session.document);
    const warnings = [
      "Engine adapters must implement the listed shader programs. GLSL is migration reference, not a verified engine shader.",
      "CPU-evaluated transforms and uniforms use step-held 60 Hz samples; shader uTime remains continuous.",
      "Particle attributes are in seed order. Adapters must implement the declared camera-dependent sorting policy.",
      "Environment, post-processing and excluded layers are reference context, not effect layers.",
      "No engine parity claim or reference screenshots are included in this bundle.",
    ];
    if (excluded.length) warnings.push(`Excluded layers: ${excluded.map(layer => `${layer.id} (${layer.reason})`).join(", ")}.`);
    const manifest = {
      version: "avfx/0.1", exporter: "autov-avfx/0.1", runtime: RUNTIME_VERSION_V2,
      name: source.name, seed: source.seed, duration: source.duration,
      source: { path: "source/document.json", sha256: await sha256(jsonBytes(source)) },
      coordinates: { handedness: "right", up: "+Y", layerForward: "+Z", units: "meters", uvOrigin: "bottom-left" },
      layers, excluded, timeline: "timeline.json", textures: textureInfo, programs: shaderInfo,
      reference: { status: "not-captured", camera: source.camera, environment: source.environment, post: source.post },
      compatibility: { status: "adapter-required", adapterVersion: "avfx/0.1", warnings },
      files: await Promise.all([...files].sort(([a], [b]) => a.localeCompare(b, "en")).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await sha256(bytes) }))),
    };
    json("avfx.json", manifest);
    options.onProgress?.("Writing .avfx archive…");
    const bytes = zipStore(files);
    return { bytes, manifest, fileCount: files.size, filename: `${source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "effect"}.avfx` };
  } finally { session.dispose(); }
}

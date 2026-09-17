import * as THREE from "three/webgpu";
import { VfxRuntimeV2 } from "../runtime-v2";
import { validateDocumentV2, type VfxDocumentV2 } from "../schema-v2";
import { zipFiles } from "../agent-handoff";
import { dataTextureBytes } from "./data-texture";
import { geometryData } from "./geometry";
import { kernels, parseKernel } from "./kernels";
import { godotShader } from "./godot-shader";
import { sampleTimes, type AvfxBundle, type GeometryData, type Numeric } from "./types";

type File = { name: string; blob: Blob };
const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });
function numeric(value: unknown): Numeric {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A shader uniform contains a non-finite value.");
    return value;
  }
  if (typeof value === "boolean") return Number(value);
  if (Array.isArray(value)) return value.map(numeric) as number[] | number[][];
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (value && typeof (value as THREE.Vector3).toArray === "function")
    return (value as THREE.Vector3).toArray();
  throw new Error("Unsupported native shader uniform value.");
}

function visible(object: THREE.Object3D) {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
function attributeBytes(g: GeometryData, program: string) {
  const attrs = parseKernel(kernels[program][0]).bindings.filter(b => b.kind === "attribute");
  const width = 1024;
  const rows = attrs.length ? g.attributes[attrs[0].name].values.length / g.attributes[attrs[0].name].size : 0;
  const height = Math.max(1, Math.ceil(rows * attrs.length / width));
  const data = new Float32Array(width * height * 4);
  for (let v = 0; v < rows; v++) attrs.forEach((b, i) => {
    const a = g.attributes[b.name];
    if (!a) throw new Error(`Missing native attribute ${b.name}`);
    for (let c = 0; c < a.size; c++) data[(v * attrs.length + i) * 4 + c] = a.values[v * a.size + c];
  });
  return { data, width, height };
}
export async function exportEngineBundle(input: VfxDocumentV2, options: {
  fps?: number; signal?: AbortSignal; onProgress?: (message: string, progress: number) => void;
} = {}) {
  const doc = validateDocumentV2(structuredClone(input));
  const fps = options.fps ?? 30;
  const times = sampleTimes(doc.duration, fps);
  const report = options.onProgress ?? (() => {});
  const check = () => { if (options.signal?.aborted) throw new DOMException("Export cancelled", "AbortError"); };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none";
  document.body.append(host);
  const runtime = new VfxRuntimeV2(host);
  const files: File[] = [];
  const bundle: AvfxBundle = {
    format: "avfx/0.1", name: doc.name, duration: doc.duration, fps,
    coordinates: "right-handed-y-up-metres", camera: { position: [], target: [], fov: 0, aspect: 16 / 9, near: .1, far: 60 },
    reference: { background: doc.environment.background, exposure: doc.post.exposure, time: times[Math.min(times.length-1,Math.round(Math.min(.75,doc.duration*.5)*fps))] },
    draws: [], geometries: [], warnings: [
      "Native 3D shaders retain camera-facing particles. CPU-authored animation is sampled at the selected rate.",
      "Post-processing, scene dressing, camera shake/push-in and soft intersection fading are not included. Configure the engine's lighting and post-processing separately.",
      "Transparent particle sorting and camera-anchored CPU transforms are sampled from the reference camera. Orbiting can change transparency overlap.",
      "Shader ports are generated from the GLSL reference. Compare against the production WebGPU reference frames before shipping.",
    ],
  };
  const drawMap = new Map<string, number>();
  const geometryMap = new Map<string, number>();
  const baseGeometryMap = new Map<string, number>();
  const textureMap = new Map<THREE.Texture, string>();
  let estimatedBytes = 0;
  try {
    report("Preparing native 3D export", 0); check();
    runtime.setInteractive(false);
    runtime.setFeatureFlags({ post: false, ground: false, softParticles: false });
    runtime.renderer.setPixelRatio(1);
    const captureDoc=structuredClone(doc); captureDoc.camera.shake=null; captureDoc.camera.pushIn=null;
    runtime.setDocument(captureDoc); runtime.resize(640, 360);
    await runtime.whenReady(); check();
    bundle.camera = { position: runtime.camera.position.toArray(), target: runtime.controls.target.toArray(), fov: runtime.camera.fov, aspect: runtime.camera.aspect, near: runtime.camera.near, far: runtime.camera.far };
    for (let ti = 0; ti < times.length; ti++) {
      check(); runtime.render(times[ti]); runtime.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      runtime.scene.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.geometry || Array.isArray(mesh.material)) return;
        if (mesh.material?.userData.avfxProgram) meshes.push(mesh);
      });
      for (const mesh of meshes) {
        const mat = mesh.material as THREE.NodeMaterial & { uniforms: Record<string, { value: unknown }> };
        const program = mat.userData.avfxProgram as string;
        if (!kernels[program]) throw new Error(`No native kernel for ${program}`);
        let di = drawMap.get(mesh.uuid);
        if (di === undefined) {
          di = bundle.draws.length; drawMap.set(mesh.uuid, di);
          let owner: THREE.Object3D | null = mesh;
          while (owner?.parent && !doc.layers.some(l => l.id === owner!.name)) owner = owner.parent;
          const layer = doc.layers.find(l => l.id === owner?.name);
          if (!layer) throw new Error(`Cannot identify export layer for ${mesh.name}`);
          const blend = layer.material?.blend ?? "alpha";
          if (blend === "screen") bundle.warnings.push(`${layer.name}: Godot approximates screen blending with premultiplied alpha.`);
          bundle.draws.push({ id: `draw-${di}`, layerId: layer.id, program, blend, order: mesh.renderOrder,
            depthTest: mat.depthTest, depthWrite: mat.depthWrite, side: mat.side === THREE.FrontSide ? "front" : mat.side === THREE.BackSide ? "back" : "double",
            uniformTypes: Object.fromEntries(kernels[program].flatMap(source => parseKernel(source).bindings).filter(b => b.kind === "uniform").map(b => [b.name, { type: b.type, size: b.size }])),
            textures: {}, samples: [] });
        }
        const draw = bundle.draws[di];
        const values: Record<string, Numeric> = {};
        const bindings = [...parseKernel(kernels[program][0]).bindings, ...parseKernel(kernels[program][1]).bindings];
        for (const b of bindings.filter(b => b.kind === "uniform")) {
          const value = mat.uniforms[b.name]?.value;
          if (b.type === "sampler2D") {
            if (b.name === "tDepth" || !value) continue;
            const tex = value as THREE.Texture;
            let path = textureMap.get(tex);
            if (!path) {
              const image = tex.image as HTMLImageElement;
              if (!image || !image.width || !image.height) throw new Error(`Texture ${b.name} failed to load. Export stopped to avoid missing materials.`);
              if ((tex as THREE.DataTexture).isDataTexture) {
                const data=dataTextureBytes(tex as THREE.DataTexture);
                path=`textures/texture-${textureMap.size}.rgba32f`;
                files.push({name:path,blob:new Blob([data.pixels.buffer])});
                files.push({name:path+".json",blob:json({width:data.width,height:data.height})});
              } else {
                const canvas=document.createElement("canvas"); canvas.width=image.width; canvas.height=image.height;
                const ctx=canvas.getContext("2d")!;
                if(!tex.flipY) {ctx.translate(0,image.height);ctx.scale(1,-1);}
                ctx.drawImage(image,0,0);
                const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Texture encoding failed")),"image/png"));
                path=`textures/texture-${textureMap.size}.png`; files.push({name:path,blob});
              }
              textureMap.set(tex,path);
            }
            draw.textures[b.name] = path;
          } else values[b.name] = b.name === "uSoft" ? 0 : numeric(value);
        }
        const g = geometryData(mesh);
        const baseKey = JSON.stringify({ ...g, attributes: {} });
        let baseId = baseGeometryMap.get(baseKey);
        if(baseId === undefined) {
          baseId=bundle.geometries.length;
          bundle.geometries.push({...g,attributes:{}}); baseGeometryMap.set(baseKey,baseId);
          estimatedBytes+=baseKey.length;
        }
        const compact: GeometryData = {...g, baseGeometry:baseId, positions:[],normals:[],uv:[],indices:[],attributeIndex:[]};
        const key = JSON.stringify(compact);
        let gi = geometryMap.get(key);
        if (gi === undefined) {
          gi = bundle.geometries.length; geometryMap.set(key, gi); bundle.geometries.push(compact);
          estimatedBytes += key.length;
        }
        const sample = { time: times[ti], visible: visible(mesh) && g.indices.length > 0, depthWrite: mat.depthWrite, matrix: mesh.matrixWorld.toArray(), uniforms: values, geometry: gi };
        draw.samples.push(sample); estimatedBytes += JSON.stringify(sample).length;
        if (estimatedBytes > 192 * 1024 * 1024) throw new Error("Export exceeds 192 MB. Shorten the effect or reduce the sample rate / particle count.");
      }
      if ([0, Math.floor(times.length / 4), Math.floor(times.length / 2), Math.floor(times.length * 3 / 4)].includes(ti)) {
        const blob = await new Promise<Blob | null>(resolve => runtime.renderer.domElement.toBlob(resolve, "image/png"));
        if (blob) files.push({ name: `reference/t-${times[ti].toFixed(3)}.png`, blob });
      }
      report(`Sampling 3D motion ${ti + 1}/${times.length}`, .05 + .75 * (ti + 1) / times.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!bundle.draws.length) throw new Error("No renderable effect layers to export.");
    const offset = runtime.camera.position.clone().sub(runtime.controls.target);
    for (const angle of [0, 90, 180]) {
      runtime.camera.position.copy(offset.clone().applyAxisAngle(new THREE.Vector3(0,1,0), angle*Math.PI/180).add(runtime.controls.target));
      runtime.camera.lookAt(runtime.controls.target); runtime.camera.updateMatrixWorld();
      runtime.render(bundle.reference.time);
      const blob = await new Promise<Blob | null>(resolve => runtime.renderer.domElement.toBlob(resolve, "image/png"));
      if (blob) files.push({ name: `reference/view-${angle}.png`, blob });
    }
    report("Packaging engine importers", .82);
    for (const draw of bundle.draws) {
      for (const depthWrite of new Set(draw.samples.map(s=>s.depthWrite)))
        files.push({ name: `shaders/${draw.id}-${Number(depthWrite)}.gdshader`, blob: new Blob([godotShader(draw.program, draw.blend, draw.depthTest, depthWrite, draw.side)]) });
      for (const gi of new Set(draw.samples.map(s => s.geometry))) {
        const a = attributeBytes(bundle.geometries[gi], draw.program);
        files.push({ name: `attributes/${draw.id}-${gi}.bin`, blob: new Blob([a.data.buffer]) });
        files.push({ name: `attributes/${draw.id}-${gi}.json`, blob: json({ width: a.width, height: a.height }) });
      }
      const shader = await fetch(`/engine-export/unity/${draw.program}.shader`);
      if (!shader.ok) throw new Error(`Native Unity kernel ${draw.program} is missing.`);
      files.push({ name: `Unity/${draw.program}.shader`, blob: new Blob([await shader.text()]) });
    }
    for (const path of ["Godot/avfx_player.gd", "Godot/demo.gd", "Godot/project.godot", "Godot/main.tscn", "Unity/AvfxPlayer.cs", "Unity/AvfxPreviewCamera.cs", "Unity/AvfxPreviewTone.cs", "Unity/AvfxPreviewTone.shader", "Unity/THREE-LICENSE.txt", "Unity/Editor/AvfxImporter.cs"]) {
      const res = await fetch(`/engine-export/${path}`);
      if (!res.ok) throw new Error(`Missing adapter ${path}`);
      files.push({ name: path, blob: await res.blob() });
    }
    files.push({ name: "effect.avfx.json", blob: json(bundle) }, { name: "source.autov.json", blob: json(doc) });
    files.push({ name: "effect.unity.json", blob: json({ ...bundle, draws: bundle.draws.map(d => {
      const bindings = new Map(kernels[d.program].flatMap(s => parseKernel(s).bindings).map(b => [b.name, b]));
      return { ...d, textures: Object.entries(d.textures).map(([name, path]) => ({ name, path })), samples: d.samples.map(s => ({ ...s,
        uniforms: Object.entries(s.uniforms).map(([name, value]) => ({ name, type: bindings.get(name)!.type, size: bindings.get(name)!.size, values: [value].flat(3) })) })) };
    }) }) });
    files.push({ name: "README.md", blob: new Blob([`# ${doc.name}\n\nNative 3D AVFX export. ${fps} CPU samples/second; shader particles retain 3D positions.\n\nGodot: open Godot/project.godot, press Play. Drag to orbit; mouse wheel zooms. Copy the bundle and player to your game to reuse.\n\nUnity: copy Unity/ into Assets/AutoVAdapters once, then copy the remaining bundle files into a dedicated folder under Assets. Select effect.avfx.json and choose Assets > autoV > Import selected AVFX. Do not install duplicate adapter scripts when importing another bundle. Use Effect.prefab in your game, or drop Preview.prefab into an empty scene and press Play. Drag to orbit, scroll to zoom, Space to pause. The reference preview uses the Built-in pipeline with matching ACES output. URP/HDRP preview post-processing is not validated.\n\nUnreal: the minimal importer is still under development; this bundle currently includes verified Unity and Godot adapters.\n\n## Known differences\n${bundle.warnings.map(w => `- ${w}`).join("\n")}\n\nReference PNGs use the original WebGPU renderer with post, ground and soft depth disabled. Source JSON is included for reproducibility.\n`]) });
    check();
    const unique = [...new Map(files.map(f => [f.name, f])).values()];
    const blob = await zipFiles(unique); report("3D bundle ready", 1);
    return { blob, manifest: bundle, files: unique };
  } finally { await runtime.dispose(); host.remove(); }
}

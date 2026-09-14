import * as THREE from "three/webgpu";
import WGSLNodeBuilder from "curve-wgsl-builder";
import { createV2NodeMaterial } from "../../src/lib/vfx-lab/node-material-v2";
import * as shaders from "../../src/lib/vfx-lab/shaders-v2-nodes.js";
for (const kind of ["surface", "particle", "trail"]) {
  const renderer = new THREE.WebGPURenderer({
    canvas: {
      width: 640,
      height: 360,
      style: {},
      addEventListener() {},
      removeEventListener() {},
    } as any,
  });
  renderer.hasFeature = () => false;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uniforms: any = {};
  for (const [name, b] of Object.entries({
    ...shaders[kind + "VertexBindings"],
    ...shaders[kind + "FragmentBindings"],
  }) as any) {
    if (b.kind === "uniform") {
      const value = () =>
        b.type === "vec2"
          ? new THREE.Vector2(1, 1)
          : b.type === "vec3"
            ? new THREE.Vector3(0, 0, 1)
            : b.type === "vec4"
              ? new THREE.Vector4(1, 1, 1, 1)
              : b.type === "sampler2D"
                ? new THREE.Texture()
                : 0;
      uniforms[name] = {
        value: b.size ? Array.from({ length: b.size }, value) : value(),
      };
    } else if (b.kind === "attribute")
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(new Float32Array(4 * 4).fill(0.5), 4),
      );
  }
  uniforms.uEffectPathMode.value = kind === "surface" ? 1 : 3;
  uniforms.uRenderMode && (uniforms.uRenderMode.value = 1);
  const material = createV2NodeMaterial(kind as any, uniforms, {});
  const mesh = new THREE.Mesh(geometry, material);
  const builder = new WGSLNodeBuilder(mesh, renderer);
  builder.camera = new THREE.PerspectiveCamera();
  builder.scene = new THREE.Scene();
  builder.build();
  for (const [stage, code] of [
    ["vertex", builder.vertexShader],
    ["fragment", builder.fragmentShader],
  ]) {
    const count = (code.match(/var<uniform>/g) ?? []).length;
    if (count > 12)
      throw new Error(
        `${kind} ${stage}: ${count} uniform buffers exceeds WebGPU default limit 12`,
      );
    console.log(`${kind} ${stage}: ${count}/12 uniform buffers`);
  }
}

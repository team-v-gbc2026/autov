import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { type VfxDocument, validateDocument } from "./schema";
import { evaluateLayer, random, sampleTimes } from "./evaluate";
import {
  surfaceVertex,
  surfaceFragment,
  particleVertex,
  particleFragment,
} from "./shaders";

export type Evidence = {
  sheet: string;
  times: number[];
  width: number;
  height: number;
  runtime: string;
  renderer: string;
  camera: number[];
  layers: string[];
  observations: { time: number; visible: string[] }[];
};
const kindIndex = {
  ring: 0,
  shell: 1,
  trail: 2,
  beam: 3,
  sprite: 4,
  particles: 4,
  decal: 5,
};
export function createEffect(doc: VfxDocument, camera: THREE.Camera) {
  const group = new THREE.Group();
  const objects = doc.layers.map((layer) => {
    const uniforms: Record<string, THREE.IUniform> = {};
    for (const key of [
      "Time",
      "Opacity",
      "Intensity",
      "Width",
      "Radius",
      "Turbulence",
      "Erosion",
      "Arc",
      "Spin",
      "Life",
      "Emission",
      "Speed",
      "Spread",
      "Gravity",
      "Drag",
      "Length",
    ])
      uniforms[`u${key}`] = { value: 0 };
    uniforms.uColor = { value: new THREE.Color() };
    uniforms.uSecondary = { value: new THREE.Color() };
    uniforms.uKind = { value: kindIndex[layer.kind] };
    const isParticles = layer.kind === "particles";
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: isParticles ? particleVertex : surfaceVertex,
      fragmentShader: isParticles ? particleFragment : surfaceFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending:
        layer.params.blend === "additive"
          ? THREE.AdditiveBlending
          : THREE.NormalBlending,
    });
    let geometry: THREE.BufferGeometry;
    if (isParticles) {
      const plane = new THREE.PlaneGeometry(1, 1);
      const instanced = new THREE.InstancedBufferGeometry();
      instanced.index = plane.index;
      instanced.attributes.position = plane.attributes.position;
      instanced.attributes.uv = plane.attributes.uv;
      const seeds = new Float32Array(layer.params.count * 4),
        extra = new Float32Array(layer.params.count * 4);
      for (let i = 0; i < layer.params.count; i++) {
        ["birth", "life", "angle", "height"].forEach(
          (a, j) => (seeds[i * 4 + j] = random(doc.seed, layer.id, i, a)),
        );
        ["speed", "origin", "size", "rotation"].forEach(
          (a, j) => (extra[i * 4 + j] = random(doc.seed, layer.id, i, a)),
        );
      }
      instanced.setAttribute(
        "aSeed",
        new THREE.InstancedBufferAttribute(seeds, 4),
      );
      instanced.setAttribute(
        "aExtra",
        new THREE.InstancedBufferAttribute(extra, 4),
      );
      instanced.instanceCount = layer.params.count;
      geometry = instanced;
    } else
      geometry =
        layer.kind === "shell"
          ? new THREE.SphereGeometry(1, 64, 40)
          : new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = layer.id;
    mesh.frustumCulled = false;
    mesh.renderOrder =
      layer.params.blend === "normal" ? 0 : layer.role === "impact" ? 3 : 2;
    group.add(mesh);
    return { layer, mesh, material, geometry };
  });
  return {
    group,
    update(time: number, solo?: string) {
      for (const { layer, mesh, material } of objects) {
        const { params: p, visible, age } = evaluateLayer(layer, time);
        mesh.visible = visible && (!solo || layer.id === solo);
        if (!mesh.visible) continue;
        mesh.position.fromArray(p.position);
        mesh.rotation.set(...p.rotation);
        if (layer.kind === "sprite") mesh.quaternion.copy(camera.quaternion);
        if (layer.kind === "beam") {
          mesh.quaternion.copy(camera.quaternion);
          mesh.scale.set(p.width * 2, p.length / 2, 1);
        } else if (layer.kind !== "particles") mesh.scale.setScalar(p.radius);
        material.uniforms.uTime.value = age;
        for (const key of [
          "opacity",
          "intensity",
          "width",
          "radius",
          "turbulence",
          "erosion",
          "arc",
          "spin",
          "life",
          "emission",
          "speed",
          "spread",
          "gravity",
          "drag",
          "length",
        ] as const)
          material.uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`].value =
            p[key];
        material.uniforms.uColor.value.set(p.color);
        material.uniforms.uSecondary.value.set(p.secondaryColor);
      }
    },
    dispose() {
      for (const o of objects) {
        o.geometry.dispose();
        o.material.dispose();
      }
      group.clear();
    },
  };
}
export class VfxRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly controls: OrbitControls;
  private effect?: ReturnType<typeof createEffect>;
  private doc?: VfxDocument;
  private observer: ResizeObserver;
  private disposed = false;
  private grid: THREE.GridHelper;
  constructor(
    readonly host: HTMLElement,
    private onError: (error: string) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Generated VFX preview",
    );
    this.renderer.domElement.className = "webgpu-canvas";
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(5, 3.1, 7);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 22;
    this.grid = new THREE.GridHelper(20, 40, 0x44494d, 0x292d31);
    this.grid.position.y = -0.72;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.25;
    this.scene.add(this.grid);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.renderer.debug.onShaderError = () =>
      this.onError("A VFX shader failed to compile. Reload the preview.");
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.onError("Graphics context lost. Reload the page to restore preview.");
  };
  resize(width = this.host.clientWidth, height = this.host.clientHeight) {
    width = Math.max(width, 1);
    height = Math.max(height, 1);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  setDocument(input: VfxDocument) {
    const doc = validateDocument(input);
    const next = createEffect(doc, this.camera);
    if (this.effect) {
      this.scene.remove(this.effect.group);
      this.effect.dispose();
    }
    this.effect = next;
    this.scene.add(next.group);
    this.doc = doc;
    this.scene.background = new THREE.Color(doc.post.background);
    this.renderer.toneMappingExposure = doc.post.exposure;
    this.bloom.strength = doc.post.bloom;
  }
  resetCamera() {
    this.camera.position.set(5, 3.1, 7);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  render(time: number, solo?: string, diagnostic = false) {
    if (this.disposed) return;
    this.effect?.update(time, solo);
    this.bloom.enabled = !diagnostic;
    this.composer.render(0);
  }
  capture(
    doc: VfxDocument,
    options: { solo?: string; diagnostic?: boolean } = {},
  ): Evidence {
    const previous = this.doc,
      camera = this.camera.position.clone(),
      quaternion = this.camera.quaternion.clone(),
      target = this.controls.target.clone();
    const ratio = this.renderer.getPixelRatio();
    const sheet = document.createElement("canvas");
    sheet.width = 1280;
    sheet.height = 606;
    const ctx = sheet.getContext("2d");
    if (!ctx) throw new Error("Capture unavailable.");
    const times = sampleTimes(doc);
    try {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.resize(320, 180);
      this.resetCamera();
      this.grid.visible = false;
      this.setDocument(doc);
      ctx.fillStyle = "#101112";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      times.forEach((time, index) => {
        this.render(time, options.solo, options.diagnostic);
        const x = (index % 4) * 320,
          y = Math.floor(index / 4) * 202;
        ctx.drawImage(this.renderer.domElement, x, y, 320, 180);
        ctx.fillStyle = "#bdc5cc";
        ctx.font = "11px monospace";
        ctx.fillText(`${time.toFixed(3)} s`, x + 12, y + 195);
      });
      return {
        sheet: sheet.toDataURL("image/jpeg", 0.88),
        times,
        width: 320,
        height: 180,
        runtime: "autov.lab/1-three-r186",
        renderer: this.renderer
          .getContext()
          .getParameter(this.renderer.getContext().RENDERER),
        camera: [5, 3.1, 7, 0, 0, 0],
        layers: options.solo ? [options.solo] : doc.layers.map((l) => l.id),
        observations: times.map((time) => ({
          time,
          visible: doc.layers
            .filter((l) => evaluateLayer(l, time).visible)
            .map((l) => l.id),
        })),
      };
    } finally {
      if (previous) this.setDocument(previous);
      this.camera.position.copy(camera);
      this.camera.quaternion.copy(quaternion);
      this.controls.target.copy(target);
      this.grid.visible = true;
      this.renderer.setPixelRatio(ratio);
      this.composer.setPixelRatio(ratio);
      this.resize();
      this.bloom.enabled = true;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.effect?.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

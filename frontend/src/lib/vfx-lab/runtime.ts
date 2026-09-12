import { textureAlphaBounds } from "./texture-bounds";
import * as THREE from "three";
import { buildGeometry } from "./geometry";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { type VfxDocument, validateDocument } from "./schema";
import { evaluateLayer, particleAt, random, sampleTimes } from "./evaluate";
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
  renderedPixels?: number;
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
export function createEffect(
  doc: VfxDocument,
  camera: THREE.Camera,
  textures = new Map<string, THREE.Texture>(),
) {
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
    uniforms.uSurface = {
      value: [
        "default",
        "flame",
        "water",
        "hexagon",
        "smoke",
        "star",
        "solid",
        "portal",
      ].indexOf(layer.surface || "default"),
    };
    uniforms.uMesh = {
      value: layer.geometry && layer.geometry !== "auto" ? 1 : 0,
    };
    uniforms.uStreamer = { value: layer.geometry === "streamer" ? 1 : 0 };
    uniforms.uTexture = {
      value: layer.textureId ? textures.get(layer.textureId) || null : null,
    };
    uniforms.uHasTexture = {
      value: layer.textureId && textures.has(layer.textureId) ? 1 : 0,
    };
    const isParticles = layer.kind === "particles";
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: isParticles ? particleVertex : surfaceVertex,
      fragmentShader: isParticles ? particleFragment : surfaceFragment,
      transparent: true,
      // Solid water heads occlude membranes behind them; smoke and glow stay depth-soft.
      depthWrite:
        layer.params.blend === "normal" &&
        layer.surface === "water" &&
        ["teardrop", "cone", "crystal"].includes(layer.geometry || ""),
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
    } else geometry = buildGeometry(layer, doc.seed);
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
        if (
          layer.kind === "sprite" &&
          (!layer.geometry || ["auto", "plane"].includes(layer.geometry))
        ) {
          mesh.quaternion.copy(camera.quaternion);
          mesh.rotateZ(p.rotation[2]);
        }
        if (layer.geometry === "plane") {
          mesh.scale.set(p.radius, p.length / 2, 1);
        } else if (layer.geometry === "lightning") {
          mesh.scale.set(
            p.width / layer.params.width,
            p.length / 2,
            p.width / layer.params.width,
          );
        } else if (
          layer.geometry === "cone" ||
          layer.geometry === "crystal" ||
          layer.geometry === "streamer" ||
          layer.geometry === "teardrop"
        ) {
          mesh.scale.set(p.radius, p.length / 2, p.radius);
        } else if (
          layer.kind === "beam" &&
          (!layer.geometry || layer.geometry === "auto")
        ) {
          mesh.quaternion.copy(camera.quaternion);
          mesh.rotateZ(p.rotation[2]);
          mesh.scale.set(p.width * 2, p.length / 2, 1);
        } else if (layer.kind !== "particles") mesh.scale.setScalar(p.radius);
        if (["ribbon", "torus"].includes(layer.geometry || ""))
          mesh.rotateZ(age * p.spin);
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
    bounds(viewMatrix = new THREE.Matrix4()) {
      const box = new THREE.Box3(),
        point = new THREE.Vector3();
      const times = [
        ...sampleTimes(doc),
        ...Array.from({ length: 25 }, (_, i) => (doc.duration * i) / 25),
      ];
      for (const time of times) {
        this.update(time);
        group.updateMatrixWorld(true);
        for (const { layer, mesh, geometry } of objects) {
          const p = evaluateLayer(layer, time).params;
          if (!mesh.visible || p.opacity < 0.04 || p.intensity < 0.04) continue;
          if (layer.kind === "particles") {
            // Evaluate actual deterministic particles rather than bounding the untransformed unit billboard.
            for (let i = 0; i < layer.params.count; i++) {
              const particle = particleAt(doc, layer, i, time);
              if (!particle.alive) continue;
              point
                .fromArray(particle.position)
                .applyMatrix4(mesh.matrixWorld)
                .applyMatrix4(viewMatrix);
              box.expandByPoint(point);
            }
          } else {
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const local = geometry.boundingBox!.clone();
            const alpha =
              layer.textureId &&
              textures.get(layer.textureId)?.userData.alphaBounds;
            if (
              layer.geometry === "plane" &&
              alpha &&
              ["flame", "smoke"].includes(layer.surface || "")
            ) {
              const margin =
                layer.surface === "flame" ? 0.07 * (0.5 + p.turbulence) : 0;
              local.min.set(alpha.minX, Math.max(-1, alpha.minY - margin), 0);
              local.max.set(alpha.maxX, Math.min(1, alpha.maxY + margin), 0);
            }
            if (layer.geometry === "streamer") {
              local.min.x -= 0.24 * p.turbulence;
              local.max.x += 0.24 * p.turbulence;
              local.min.z -= 0.08 * p.turbulence;
              local.max.z += 0.08 * p.turbulence;
            }
            // Project oriented corners directly. World-axis boxes overestimate camera-facing cards.
            for (const x of [local.min.x, local.max.x])
              for (const y of [local.min.y, local.max.y])
                for (const z of [local.min.z, local.max.z]) {
                  point
                    .set(x, y, z)
                    .applyMatrix4(mesh.matrixWorld)
                    .applyMatrix4(viewMatrix);
                  box.expandByPoint(point);
                }
          }
        }
      }
      return box;
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
  private textures = new Map<string, THREE.Texture>();
  private textureSources = new Map<string, string>();
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
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Generated VFX preview",
    );
    this.renderer.domElement.className = "webgpu-canvas";
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(5, 3.85, 7);
    this.camera.lookAt(0, 0.75, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.75, 0);
    this.controls.enableDamping = false;
    this.controls.minDistance = 1.5;
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
  async prepare(input: VfxDocument) {
    const doc = validateDocument(input);
    for (const asset of doc.textures || []) {
      if (this.textureSources.get(asset.id) === asset.data) continue;
      const img = new Image();
      img.src = asset.data;
      await img.decode();
      if (this.disposed) throw new Error("Renderer disposed.");
      if (img.width > 1024 || img.height > 1024)
        throw new Error("Texture exceeds the 1024 pixel GPU limit.");
      const texture = new THREE.Texture(img);
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(256, img.width);
      canvas.height = Math.min(256, img.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        texture.userData.alphaBounds = textureAlphaBounds(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      this.textures.get(asset.id)?.dispose();
      this.textures.set(asset.id, texture);
      this.textureSources.set(asset.id, asset.data);
    }
  }
  setDocument(input: VfxDocument) {
    const doc = validateDocument(input);
    const initialCamera =
      !this.doc || this.doc.name !== doc.name || this.doc.seed !== doc.seed;
    for (const asset of doc.textures || []) {
      if (this.textureSources.get(asset.id) !== asset.data)
        throw new Error("Prepare textures before installing this effect.");
    }
    const next = createEffect(doc, this.camera, this.textures);
    if (this.effect) {
      this.scene.remove(this.effect.group);
      this.effect.dispose();
    }
    this.effect = next;
    this.scene.add(next.group);
    this.doc = doc;
    const keep = new Set((doc.textures || []).map((a) => a.id));
    for (const [id, texture] of this.textures)
      if (!keep.has(id)) {
        texture.dispose();
        this.textures.delete(id);
        this.textureSources.delete(id);
      }
    this.scene.background = new THREE.Color(doc.post.background);
    this.renderer.toneMappingExposure = doc.post.exposure;
    this.bloom.strength = doc.post.bloom;
    if (initialCamera) this.resetCamera();
  }
  get rendererDescription() {
    const gl = this.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    return String(
      gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
  }
  get assetTextureCount() {
    return this.textures.size;
  }
  resetCamera() {
    const direction = new THREE.Vector3(5, 3.1, 7).normalize();
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), direction)
      .normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, direction);
    this.camera.position.copy(direction);
    this.camera.lookAt(0, 0, 0);
    const bounds = this.effect?.bounds(basis.clone().transpose());
    const center =
      bounds && !bounds.isEmpty()
        ? bounds.getCenter(new THREE.Vector3()).applyMatrix4(basis)
        : new THREE.Vector3(0, 0.75, 0);
    let distance = 1.5;
    if (bounds && !bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3()),
        tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      distance = Math.max(
        distance,
        size.z / 2 +
          Math.max(
            size.y / (2 * tan),
            size.x / (2 * tan * this.camera.aspect),
          ) *
            1.15,
      );
    }
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.target.copy(center);
    this.controls.update();
  }
  render(time: number, solo?: string, diagnostic = false) {
    if (this.disposed) return;
    this.effect?.update(time, solo);
    this.bloom.enabled = !diagnostic;
    this.renderer.info.reset();
    this.composer.render(0);
  }
  async capture(
    doc: VfxDocument,
    options: { solo?: string; diagnostic?: boolean } = {},
  ): Promise<Evidence> {
    await this.prepare(doc);
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
    let renderedPixels = 0;
    try {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.resize(320, 180);
      this.grid.visible = false;
      this.setDocument(doc);
      this.resetCamera();
      ctx.fillStyle = "#101112";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      times.forEach((time, index) => {
        this.render(time, options.solo, options.diagnostic);
        const x = (index % 4) * 320,
          y = Math.floor(index / 4) * 202;
        ctx.drawImage(this.renderer.domElement, x, y, 320, 180);
        const pixels = ctx.getImageData(x, y, 320, 180).data;
        // Compare against the actual corner background, before adding timestamp text.
        const background = [pixels[0], pixels[1], pixels[2]];
        for (let p = 0; p < pixels.length; p += 4)
          if (
            Math.max(...background.map((v, c) => Math.abs(pixels[p + c] - v))) >
            12
          )
            renderedPixels++;
        ctx.fillStyle = "#bdc5cc";
        ctx.font = "11px monospace";
        ctx.fillText(`${time.toFixed(3)} s`, x + 12, y + 195);
      });
      return {
        renderedPixels,
        sheet: sheet.toDataURL("image/jpeg", 0.88),
        times,
        width: 320,
        height: 180,
        runtime: "autov.lab/1-three-r186-streamer5",
        renderer: this.rendererDescription,
        camera: [
          ...this.camera.position.toArray(),
          ...this.controls.target.toArray(),
        ],
        layers: options.solo ? [options.solo] : doc.layers.map((l) => l.id),
        observations: times.map((time) => ({
          time,
          visible: doc.layers
            .filter((l) => evaluateLayer(l, time).visible)
            .map((l) => l.id),
        })),
      };
    } finally {
      if (previous) {
        await this.prepare(previous);
        this.setDocument(previous);
      }
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
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
    this.textureSources.clear();
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

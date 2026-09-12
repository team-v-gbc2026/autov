import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createParticleStudy, EFFECT_DURATION } from "./particle-study";

type Options = {
  host: HTMLDivElement;
  signal: AbortSignal;
  interactive: boolean;
  animated: boolean;
  getTime: () => number;
  onError: (message: string) => void;
};

const FALLBACK_PARTICLE_COUNT = 3200;

async function createFallbackSceneRuntime(options: Options): Promise<() => void> {
  const { host, signal, interactive, animated, getTime } = options;
  const THREE = (await import("three")) as typeof import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");

  let disposed = false;
  let frame = 0;
  let controls: InstanceType<typeof OrbitControls> | undefined;
  let observer: ResizeObserver | undefined;
  let fallbackEffect: { object: unknown; update: (seconds: number) => void; dispose: () => void } | undefined;
  let fallbackError: Error | undefined;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.3, 6.8);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls?.dispose();
    fallbackEffect?.dispose();
    renderer.domElement.remove();
    renderer.dispose();
  };

  const initialize = () => {
    const canvas = renderer.domElement;
    canvas.className = "webgpu-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Three-dimensional silver particle field");
    host.appendChild(canvas);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    fallbackEffect = createFallbackParticleStudy(THREE);
    scene.add(fallbackEffect.object as THREE.Object3D);
    controls = new OrbitControls(camera, canvas) as InstanceType<typeof OrbitControls>;
    controls.enabled = interactive;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 12;
    controls.target.set(0, -0.18, 0);
    controls.update();

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0;
    let previous = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (!document.hidden) {
        if (animated && !reducedMotion.matches) elapsed = (elapsed + delta) % EFFECT_DURATION;
        fallbackEffect!.update(animated ? elapsed : getTime());
        controls!.update();
        try {
          renderer.render(scene, camera);
        } catch (error) {
          console.error("Fallback VFX rendering failed", error);
          throw error;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
  };

  try {
    initialize();
    signal.addEventListener("abort", dispose, { once: true });
  } catch (error) {
    fallbackError = error instanceof Error ? error : new Error("Unable to start fallback renderer.");
    dispose();
    throw fallbackError;
  }

  return dispose;
}

function createFallbackParticleStudy(three: typeof import("three")) {
  const baseX = new Float32Array(FALLBACK_PARTICLE_COUNT);
  const baseY = new Float32Array(FALLBACK_PARTICLE_COUNT);
  const baseZ = new Float32Array(FALLBACK_PARTICLE_COUNT);
  const seeds = new Float32Array(FALLBACK_PARTICLE_COUNT);
  for (let i = 0; i < FALLBACK_PARTICLE_COUNT; i++) {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const y = 1 - 2 * (i + 0.5) / FALLBACK_PARTICLE_COUNT;
    const r = Math.sqrt(1 - y * y);
    baseX[i] = Math.cos(angle) * r;
    baseY[i] = y;
    baseZ[i] = Math.sin(angle) * r;
    seeds[i] = (i * 0.61803398875) % 1;
  }

  const geometry = new three.BufferGeometry();
  const position = new Float32Array(FALLBACK_PARTICLE_COUNT * 3);
  geometry.setAttribute("position", new three.Float32BufferAttribute(position, 3));
  const material = new three.PointsMaterial({
    color: 0xdce4ec,
    size: 0.018,
    transparent: true,
    depthWrite: false,
    blending: three.AdditiveBlending,
    opacity: 0.85,
  });
  const points = new three.Points(geometry, material);
  const update = (seconds: number) => {
    const angle = (seconds * 2 * Math.PI) / EFFECT_DURATION;
    for (let i = 0; i < FALLBACK_PARTICLE_COUNT; i++) {
      const baseIndex = i * 3;
      const wave = Math.sin(baseY[i] * 11 + seeds[i] * 6.28 + angle);
      const radius = wave * 0.1 + 1.55;
      const a = angle + baseY[i] * 0.35;
      const x = baseX[i] * Math.cos(a) - baseZ[i] * Math.sin(a);
      const z = baseX[i] * Math.sin(a) + baseZ[i] * Math.cos(a);
      position[baseIndex] = x * radius;
      position[baseIndex + 1] = baseY[i];
      position[baseIndex + 2] = z * radius;
    }
    geometry.attributes.position.needsUpdate = true;
  };
  return {
    object: points,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export async function createSceneRuntime(options: Options) {
  const { host, signal } = options;
  if (!window.isSecureContext || !navigator.gpu) {
    return createFallbackSceneRuntime(options);
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter is available. Check that browser hardware acceleration is enabled.");
  if (signal.aborted) return;
  const device = await adapter.requestDevice();
  if (signal.aborted) { device.destroy(); return; }
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, device });
  let disposed = false;
  let controls: OrbitControls | undefined;
  let effect: ReturnType<typeof createParticleStudy> | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls?.dispose();
    effect?.dispose();
    renderer.domElement.remove();
    renderer.dispose();
    device.destroy();
  };
  try {
    await renderer.init();
    if (signal.aborted) { dispose(); return; }
    signal.addEventListener("abort", dispose, { once: true });
    renderer.onDeviceLost = () => {
      if (disposed) return;
      dispose();
      options.onError("The graphics device disconnected. Reload the scene to continue.");
    };
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement;
    canvas.className = "webgpu-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Three-dimensional silver particle field");
    host.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    camera.position.set(0, .3, 6.8);
    effect = createParticleStudy();
    scene.add(effect.object);
    controls = new OrbitControls(camera, canvas);
    controls.enabled = options.interactive;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 12;
    controls.target.set(0, -.18, 0);
    controls.update();
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0;
    let previous = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const delta = Math.min((now - previous) / 1000, .1);
      previous = now;
      if (!document.hidden) {
        if (options.animated && !reducedMotion.matches) elapsed = (elapsed + delta) % EFFECT_DURATION;
        effect!.update(options.animated ? elapsed : options.getTime());
        controls!.update();
        try { renderer.render(scene, camera); }
        catch (error) {
          console.error("VFX rendering failed", error);
          dispose();
          options.onError("The scene could not be rendered. Reload the scene to try again.");
          return;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return dispose;
  } catch (error) {
    dispose();
    if (signal.aborted) {
      throw error;
    }
    try {
      return await createFallbackSceneRuntime(options);
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
}

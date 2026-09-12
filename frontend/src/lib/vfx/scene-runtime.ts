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

export async function createSceneRuntime(options: Options) {
  const { host, signal } = options;
  if (!window.isSecureContext || !navigator.gpu) {
    throw new Error("WebGPU is unavailable. Open this page in a WebGPU-capable browser over HTTPS or localhost.");
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
    throw error;
  }
}

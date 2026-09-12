import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
export async function profile(input: VfxDocument, seconds?: number) {
  const doc = validateDocument(input),
    host = document.createElement("div"),
    errors: string[] = [];
  host.style.cssText = "position:fixed;inset:0;width:960px;height:540px";
  document.body.appendChild(host);
  const runtime = new VfxRuntime(host, (e) => errors.push(e));
  try {
    await runtime.prepare(doc);
    runtime.setDocument(doc);
    const gl = runtime.renderer.getContext(),
      debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    for (let i = 0; i < 12; i++) runtime.render((doc.duration * i) / 12);
    gl.finish();
    const samples: number[] = [],
      intervals: number[] = [];
    const duration = Math.max(seconds ?? 6, doc.duration + 0.6);
    const start = performance.now();
    let previous = start,
      maxCalls = 0,
      maxTriangles = 0;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const t = (now - start) / 1000;
        const before = performance.now();
        runtime.render(t % doc.duration);
        gl.finish();
        const elapsed = performance.now() - before;
        if (t > 0.6) {
          samples.push(elapsed);
          intervals.push(now - previous);
        }
        previous = now;
        maxCalls = Math.max(maxCalls, runtime.renderer.info.render.calls);
        maxTriangles = Math.max(
          maxTriangles,
          runtime.renderer.info.render.triangles,
        );
        if (t < duration) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const quantile = (values: number[], p: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return (
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0
      );
    };
    const software = /swiftshader|llvmpipe|software/i.test(renderer),
      hardwareKnown =
        !software && /Apple|NVIDIA|AMD|Intel|Radeon|GeForce/i.test(renderer);
    return {
      name: doc.name,
      renderer,
      software,
      hardwareKnown,
      resolution: [960, 540],
      durationSeconds: duration,
      devicePixelRatio: runtime.renderer.getPixelRatio(),
      samples: samples.length,
      measuredPlaybackFps:
        1000 /
        (intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length)),
      renderP50Ms: quantile(samples, 0.5),
      renderP95Ms: quantile(samples, 0.95),
      frameIntervalP95Ms: quantile(intervals, 0.95),
      maxCalls,
      maxTriangles,
      errors,
      method:
        "Headless Chrome requestAnimationFrame playback; render duration includes gl.finish; 0.6 s warmup discarded. Timing is local-device evidence, not a game-engine certification.",
    };
  } finally {
    runtime.dispose();
    host.remove();
  }
}

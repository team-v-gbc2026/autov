import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { generatePipeline } from "../src/lib/vfx-lab/pipeline";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
import { evaluateLayer } from "../src/lib/vfx-lab/evaluate";
function mount(Runtime = VfxRuntime) {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;background:#101112;z-index:99999;width:960px;height:540px";
  document.body.appendChild(host);
  const errors: string[] = [];
  const runtime = new Runtime(host, (e) => errors.push(e));
  return { runtime, host, errors };
}
export async function run(
  input: { prompt: string; references: string[] },
  options: { mode: "fast" | "quality"; textures: boolean },
) {
  const { runtime, host } = mount();
  try {
    return await generatePipeline({
      ...input,
      ...options,
      signal: AbortSignal.timeout(30 * 60 * 1000),
      request: async (body, signal) => {
        const r = await fetch("/api/local-vfx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error || "Generation failed");
        return data;
      },
      capture: (doc, solo, diagnostic) =>
        runtime.capture(doc, { solo, diagnostic }),
      progress: (message) => console.log(`BENCHMARK: ${message}`),
      candidate: () => {},
    });
  } finally {
    runtime.dispose();
    host.remove();
  }
}
export async function render(
  input: VfxDocument,
  video = true,
  Runtime = VfxRuntime,
) {
  const doc = validateDocument(input),
    { runtime, host, errors } = mount(Runtime);
  try {
    await runtime.prepare(doc);
    runtime.setDocument(doc);
    const evidence = await runtime.capture(doc);
    const frame = (t: number) => {
      runtime.render(t);
      return runtime.renderer.domElement.toDataURL("image/png");
    };
    const at = Math.min(doc.duration - 0.001, doc.impact + 0.05),
      first = frame(at);
    frame(doc.duration * 0.9);
    frame(0.1);
    const second = frame(at);
    const frames = [
      0,
      doc.impact * 0.5,
      at,
      doc.duration * 0.5,
      doc.duration * 0.8,
      doc.duration,
    ].map((time) => ({ time, png: frame(time) }));
    runtime.render(at);
    const info = runtime.renderer.info.render;
    const performanceInfo = {
      calls: info.calls,
      triangles: info.triangles,
      geometries: runtime.renderer.info.memory.geometries,
      textures: runtime.renderer.info.memory.textures,
      assetTextures: runtime.assetTextureCount,
    };
    let webm: string | undefined;
    if (video) {
      const stream = runtime.renderer.domElement.captureStream(30),
        mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
      const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 3_000_000,
        }),
        chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const time = (performance.now() - start) / 1000;
          runtime.render(Math.min(time, doc.duration));
          if (time < doc.duration + 0.15) requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      recorder.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      webm = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(new Blob(chunks, { type: mime }));
      });
    }
    return {
      evidence,
      frames,
      webm,
      performance: performanceInfo,
      gates: {
        schema: true,
        seekDeterministic: first === second,
        extinguishedAtEnd: doc.layers.every(
          (l) => !evaluateLayer(l, doc.duration).visible,
        ),
        noShaderErrors: errors.length === 0,
      },
      errors,
    };
  } finally {
    runtime.dispose();
    host.remove();
  }
}

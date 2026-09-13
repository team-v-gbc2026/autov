import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { VfxRuntimeV2 } from "../src/lib/vfx-lab/runtime-v2";
import { captureV2 } from "../src/lib/vfx-lab/capture-v2";
import {
  generatePipeline,
  type PipelineDocument,
} from "../src/lib/vfx-lab/pipeline";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
import {
  isV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";
import { evaluateLayer } from "../src/lib/vfx-lab/evaluate";
import { evaluateLayerV2 } from "../src/lib/vfx-lab/evaluate-v2";
function mount(Runtime = VfxRuntime) {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;background:#101112;z-index:99999;width:960px;height:540px";
  document.body.appendChild(host);
  const errors: string[] = [];
  const runtime = new Runtime(host, (e) => errors.push(e));
  return { runtime, host, errors };
}
function mountV2() {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;background:#101112;z-index:99999;width:960px;height:540px";
  document.body.appendChild(host);
  const runtime = new VfxRuntimeV2(host);
  return { runtime, host };
}
export async function run(
  input: { prompt: string; references: string[]; caseId?: string },
  options: {
    mode: "fast" | "quality";
    textures: boolean;
    candidateCount?: 1 | 2 | 3;
    schema?: "v1" | "v2";
  },
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
      // v1 candidates reuse the long-lived preview runtime; a v2 candidate
      // renders in its own disposable v2 runtime.
      capture: (doc: PipelineDocument, solo?: string, diagnostic?: boolean) =>
        isV2(doc)
          ? captureV2(doc, { solo, diagnostic })
          : runtime.capture(doc as VfxDocument, { solo, diagnostic }),
      progress: (message) => console.log(`BENCHMARK: ${message}`),
      candidate: async (candidate) => {
        const response = await fetch("/api/local-trials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: candidate.id,
            prompt: input.prompt,
            references: input.references,
            caseId: input.caseId,
            source: "openai-live",
            origin: candidate.origin,
            selected: false,
            document: candidate.document,
            sheet: candidate.evidence.sheet,
            review: candidate.review,
          }),
        });
        if (!response.ok)
          throw Error(
            "Candidate archive failed: " +
              (await response.text()).slice(0, 300),
          );
      },
    });
  } finally {
    runtime.dispose();
    host.remove();
  }
}
/**
 * v2 evidence render. There is no MediaRecorder path here: v2 videos are
 * recorded deterministically at 30 Hz by scripts/deterministic-video.mjs.
 */
async function renderV2(input: VfxDocumentV2) {
  const doc = validateDocumentV2(input);
  const { runtime, host } = mountV2();
  const errors: string[] = [];
  try {
    runtime.setDocument(doc);
    runtime.resize(960, 540);
    await runtime.whenReady();
    const evidence = await captureV2(doc);
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
      assetTextures: doc.textures?.length ?? 0,
    };
    return {
      evidence,
      frames,
      webm: undefined as string | undefined,
      performance: performanceInfo,
      gates: {
        schema: true,
        // v2 has no debug grid: environment.ground belongs to the document and
        // is deliberately part of the captured evidence.
        groundIsAuthored: true,
        seekDeterministic: first === second,
        extinguishedAtEnd: doc.layers.every(
          (l) => !evaluateLayerV2(l, doc.duration).visible,
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
export async function render(
  input: VfxDocument | VfxDocumentV2,
  video = true,
  Runtime = VfxRuntime,
) {
  if (isV2(input)) return renderV2(input);
  const doc = validateDocument(input),
    { runtime, host, errors } = mount(Runtime);
  try {
    await runtime.prepare(doc);
    runtime.setDocument(doc);
    const grid = runtime.scene.children.find(
      (object) => object.type === "GridHelper",
    );
    if (!grid) throw new Error("Reference grid missing");
    grid.visible = false;
    const evidence = await runtime.capture(doc),
      capturePreservesHiddenGrid = !grid.visible;
    grid.visible = true;
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
        capturePreservesHiddenGrid,
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

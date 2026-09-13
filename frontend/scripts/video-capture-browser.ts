import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { VfxRuntimeV2 } from "../src/lib/vfx-lab/runtime-v2";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
import {
  isV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../src/lib/vfx-lab/schema-v2";
type Active = {
  host: HTMLElement;
  errors: string[];
  render: (time: number) => void;
  renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext };
  dispose: () => void;
};
let active: Active | undefined;
export async function begin(
  input: VfxDocument | VfxDocumentV2,
  Runtime = VfxRuntime,
) {
  end();
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;width:960px;height:540px;z-index:999999";
  document.body.appendChild(host);
  const errors: string[] = [];
  if (isV2(input)) {
    // v2 documents always play on the v2 runtime; a historical v1 bundle,
    // if one was injected for this run, is not a valid player for them.
    const runtime = new VfxRuntimeV2(host);
    runtime.setDocument(validateDocumentV2(input));
    runtime.resize(960, 540);
    await runtime.whenReady();
    active = {
      host,
      errors,
      render: (time) => runtime.render(time),
      renderer: runtime.renderer,
      dispose: () => runtime.dispose(),
    };
  } else {
    const runtime = new Runtime(host, (e) => errors.push(e));
    const doc = validateDocument(input);
    await runtime.prepare(doc);
    runtime.setDocument(doc);
    runtime.resetCamera();
    active = {
      host,
      errors,
      render: (time) => runtime.render(time),
      renderer: runtime.renderer,
      dispose: () => runtime.dispose(),
    };
  }
  const gl = active.renderer.getContext(),
    debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    width: 960,
    height: 540,
    renderer: String(
      gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    ),
  };
}
export function frame(time: number) {
  if (!active) throw Error("Video capture has not started");
  active.render(time);
  if (active.errors.length) throw Error(active.errors.join("; "));
  // Read the completed framebuffer directly so the capture path can report GL errors.
  const gl = active.renderer.getContext();
  if (gl.isContextLost()) throw Error("Video capture graphics context lost");
  gl.finish();
  const width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  if (error !== gl.NO_ERROR)
    throw Error(`Video framebuffer read failed: ${error}`);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(width, height);
  for (let y = 0; y < height; y++)
    data.data.set(
      pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
      y * width * 4,
    );
  context.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
export function end() {
  active?.dispose();
  active?.host.remove();
  active = undefined;
}

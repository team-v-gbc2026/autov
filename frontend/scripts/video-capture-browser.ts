import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { validateDocument, type VfxDocument } from "../src/lib/vfx-lab/schema";
let active:
  { runtime: VfxRuntime; host: HTMLElement; errors: string[] } | undefined;
export async function begin(input: VfxDocument, Runtime = VfxRuntime) {
  end();
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;width:960px;height:540px;z-index:999999";
  document.body.appendChild(host);
  const errors: string[] = [];
  const runtime = new Runtime(host, (e) => errors.push(e));
  active = { runtime, host, errors };
  const doc = validateDocument(input);
  await runtime.prepare(doc);
  runtime.setDocument(doc);
  runtime.resetCamera();
  const gl = runtime.renderer.getContext(),
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
  active.runtime.render(time);
  if (active.errors.length) throw Error(active.errors.join("; "));
  return active.runtime.renderer.domElement.toDataURL("image/png");
}
export function end() {
  active?.runtime.dispose();
  active?.host.remove();
  active = undefined;
}

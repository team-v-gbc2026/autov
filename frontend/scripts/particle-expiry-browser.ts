import { VfxRuntime } from "../src/lib/vfx-lab/runtime";
import { createPreset } from "../src/lib/vfx-lab/recipes";
export async function verifyParticleExpiry() {
  const doc = createPreset("shockwave");
  doc.name = "Retired particles keep the bloom framebuffer finite";
  doc.seed = 419;
  doc.duration = 6;
  doc.impact = 1;
  const particles = doc.layers.find((l) => l.kind === "particles")!;
  particles.start = 0;
  particles.end = 6;
  particles.params.life = 1.1;
  particles.params.emission = 0.001;
  particles.params.count = 128;
  particles.params.spread = 0;
  particles.tracks = [];
  particles.overrides = [];
  doc.layers = [particles];
  doc.post = { background: "#191723", bloom: 0.5, exposure: 1 };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;width:320px;height:180px";
  document.body.appendChild(host);
  const errors: string[] = [];
  const runtime = new VfxRuntime(host, (message) => errors.push(message));
  try {
    await runtime.prepare(doc);
    runtime.setDocument(doc);
    const gl = runtime.renderer.getContext(),
      pixel = new Uint8Array(4);
    let minimumBackground = Infinity;
    for (let frame = 0; frame <= 180; frame++) {
      runtime.render(frame / 30);
      gl.finish();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      minimumBackground = Math.min(
        minimumBackground,
        pixel[0] + pixel[1] + pixel[2],
      );
    }
    return {
      frames: 181,
      minimumBackground,
      errors,
      renderer: runtime.rendererDescription,
    };
  } finally {
    runtime.dispose();
    host.remove();
  }
}

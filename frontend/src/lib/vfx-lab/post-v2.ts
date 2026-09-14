import * as THREE from "three/webgpu";
import {
  pass,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  dot,
  mix,
  max,
  fract,
  floor,
  step,
  abs,
  clamp,
  smoothstep,
  convertToTexture,
  uv as screenUV,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { VfxDocumentV2 } from "./schema-v2";
import { sampleCurve } from "./ribbon-v2";

/** post.glitch quantises on hash(floor(t * GLITCH_HZ)), so a seek lands on
 * exactly the frame playback would have drawn. */
const GLITCH_HZ = 20;

/** Same 1D hash the migration reference used, so the pattern is unchanged. It
 * is inlined into the graph rather than declared as a WGSL function: three
 * call sites, all in one pass. */
function glitchHash(seed: ReturnType<typeof float>) {
  const a = fract(seed.mul(0.1031));
  const b = a.mul(a.add(33.33));
  return fract(b.mul(b.add(b)));
}

export interface PostStackV2 {
  render(): void;
  /** `time` is DOCUMENT seconds; only post.glitch and post.flash read it. */
  apply(
    doc: VfxDocumentV2,
    flags: { post: boolean; aa: boolean },
    time?: number,
  ): void;
  dispose(): void;
}

/** Scene-linear HDR -> bloom -> glitch -> flash -> grade -> chromatic/vignette
 * -> output -> SMAA. RenderPipeline owns the sole tone-map and output
 * conversion (inside SMAA when enabled). PassNode tracks renderer size/DPR; no
 * second resize owner.
 *
 * post.glitch displaces bands, so it has to read neighbouring pixels: it needs
 * its own resolved texture, and the graph that carries it is built only for
 * documents that declare a glitch. post.flash is a per-pixel additive wash and
 * stays in every graph; it is exactly neutral at zero strength.
 */
export function createPostStack(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  samples = 4,
): PostStackV2 {
  const scenePass = pass(scene, camera, { samples });
  const src = scenePass.getTextureNode();
  const glow = bloom(src, 0.45, 0.4, 1.3);
  const contrast = uniform(1),
    saturation = uniform(1),
    lift = uniform(0);
  const tint = uniform(new THREE.Color("#ffffff"));
  const vignette = uniform(0.35),
    chromatic = uniform(0.0025);
  const glitchTime = uniform(0),
    glitchStrength = uniform(0),
    glitchBands = uniform(15),
    glitchSplit = uniform(0.008),
    glitchEdgeBias = uniform(1);
  const glitchBlocks = uniform(new THREE.Vector2(54, 34));
  const flashStrength = uniform(0),
    flashVignette = uniform(0.6);
  const flashColor = uniform(new THREE.Color("#ffffff"));

  const uv = screenUV();
  const bloomed = vec4(max(src.rgb.add(glow.rgb), 0), src.a);

  // Lazily built so a document without post.glitch never allocates the extra
  // resolved texture, and so a toggle is a structural rebuild rather than a
  // per-frame branch.
  let glitchTexture: ReturnType<typeof convertToTexture> | null = null;
  const withGlitch = () => {
    glitchTexture ??= convertToTexture(bloomed);
    const source = glitchTexture;
    const block = floor(glitchTime.mul(GLITCH_HZ));
    // The frame edges break harder than its centre, which is what keeps the
    // subject readable through the worst frames.
    const edge = float(1).add(
      glitchEdgeBias.mul(
        smoothstep(0.3, 0.5, abs(uv.x.sub(0.5)))
          .mul(1.15)
          .add(smoothstep(0.36, 0.5, abs(uv.y.sub(0.5))).mul(0.75)),
      ),
    );
    const k = glitchStrength.mul(clamp(edge, 0, 2.4));
    const band = floor(uv.y.mul(glitchBands));
    const shift = step(0.58, glitchHash(float(band.mul(7.3).add(block.mul(13.7)))))
      .mul(glitchHash(float(band.mul(3.1).add(block.mul(5.9)))).sub(0.5))
      .mul(0.14)
      .mul(k);
    const shifted = vec2(fract(uv.x.add(shift)), uv.y);
    const d = glitchSplit.mul(k);
    const centre = source.sample(shifted);
    const colour = vec3(
      source.sample(shifted.add(vec2(d, 0))).r,
      centre.g,
      source.sample(shifted.sub(vec2(d, 0))).b,
    );
    const cell = floor(uv.mul(glitchBlocks));
    const h = glitchHash(
      float(cell.x.mul(1.7).add(cell.y.mul(31.3)).add(block.mul(77.1))),
    );
    // A few blocks swap channels, a few drop to near black.
    const swapped = mix(
      colour,
      colour.bgr.mul(1.1),
      step(float(1).sub(k.mul(0.085)), h),
    );
    const dropped = mix(swapped, swapped.mul(0.35), step(h, k.mul(0.05)));
    return vec4(dropped, centre.a);
  };

  /** post.flash: a full-screen ADDITIVE wash, after bloom so the wash is not
   * itself bloomed into a smear. The vignette darkens it toward the frame
   * edges, which is what leaves the flash a centre instead of a flat card. */
  const withFlash = (base: ReturnType<typeof vec4>) => {
    const q = uv.sub(0.5).mul(2);
    const v = max(
      smoothstep(0.1, 1.1, q.mul(vec2(1, 0.62)).length())
        .mul(flashVignette)
        .oneMinus(),
      0,
    );
    return vec4(base.rgb.add(flashColor.mul(flashStrength).mul(v)), base.a);
  };

  const gradeTextures: ReturnType<typeof convertToTexture>[] = [];
  const buildFinal = (glitching: boolean) => {
    const lit = withFlash(glitching ? withGlitch() : bloomed);
    const c = lit.rgb.sub(0.18).mul(contrast).add(0.18).max(0);
    const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const graded = max(mix(vec3(l), c, saturation), 0)
      .mul(tint)
      .add(lift)
      .max(0);
    const gradeTexture = convertToTexture(vec4(graded, lit.a));
    gradeTextures.push(gradeTexture);
    const d = uv.sub(0.5);
    const split = vec3(
      gradeTexture.sample(uv.add(d.mul(chromatic))).r,
      gradeTexture.sample(uv).g,
      gradeTexture.sample(uv.sub(d.mul(chromatic))).b,
    );
    return vec4(
      split.mul(
        smoothstep(0.35, 1.05, d.length().mul(1.6)).mul(vignette).oneMinus(),
      ),
      1,
    );
  };

  const finals = new Map<boolean, ReturnType<typeof buildFinal>>();
  const finalFor = (glitching: boolean) => {
    let node = finals.get(glitching);
    if (!node) finals.set(glitching, (node = buildFinal(glitching)));
    return node;
  };
  // SMAA operates on display-referred pixels, after the single output transform.
  const aaInputs: ReturnType<typeof convertToTexture>[] = [];
  const aaNodes = new Map<boolean, ReturnType<typeof smaa>>();
  const aaFor = (glitching: boolean) => {
    let node = aaNodes.get(glitching);
    if (!node) {
      const input = convertToTexture(
        finalFor(glitching).renderOutput(
          renderer.toneMapping,
          renderer.outputColorSpace,
        ),
      );
      aaInputs.push(input);
      aaNodes.set(glitching, (node = smaa(input)));
    }
    return node;
  };

  const pipeline = new THREE.RenderPipeline(renderer, finalFor(false));
  let usingAA = false;
  let usingGlitch = false;
  return {
    render() {
      pipeline.render();
    },
    apply(doc, flags, time = 0) {
      // UnrealBloomPass r186 multiplies its composite by 3; BloomNode does not.
      glow.strength.value = flags.post ? doc.post.bloom.strength * 3 : 0;
      glow.radius.value = doc.post.bloom.radius;
      glow.threshold.value = doc.post.bloom.threshold;
      contrast.value = doc.post.grade.contrast;
      saturation.value = doc.post.grade.saturation;
      lift.value = doc.post.grade.lift;
      tint.value.set(doc.post.grade.tint);
      vignette.value = doc.post.vignette;
      chromatic.value = doc.post.chromatic;
      const progress = time / Math.max(doc.duration, 1e-4);
      // Strength is the curve over the document's own 0..1 progress, so a seek
      // lands on exactly the frame playback would have drawn.
      const glitch = doc.post.glitch;
      glitchTime.value = time;
      glitchStrength.value =
        glitch && flags.post
          ? Math.max(0, sampleCurve(glitch.curve, progress))
          : 0;
      if (glitch) {
        glitchBands.value = glitch.bands;
        glitchBlocks.value.fromArray(glitch.blockGrid);
        glitchSplit.value = glitch.split;
        glitchEdgeBias.value = glitch.edgeBias;
      }
      const flash = doc.post.flash;
      flashStrength.value =
        flash && flags.post ? Math.max(0, sampleCurve(flash.curve, progress)) : 0;
      if (flash) {
        flashColor.value.set(flash.color);
        flashVignette.value = flash.vignette;
      }
      // Structural, so crossing a glitch window mid-playback never rebuilds.
      const nextGlitch = Boolean(glitch) && flags.post;
      const nextAA = flags.aa && doc.quality.aa === "msaa+smaa";
      if (nextAA !== usingAA || nextGlitch !== usingGlitch) {
        usingAA = nextAA;
        usingGlitch = nextGlitch;
        pipeline.outputNode = nextAA ? aaFor(nextGlitch) : finalFor(nextGlitch);
        pipeline.outputColorTransform = !nextAA;
        pipeline.needsUpdate = true;
      }
    },
    dispose() {
      pipeline.dispose();
      for (const node of aaNodes.values()) node.dispose();
      for (const input of aaInputs) input.dispose();
      glow.dispose();
      scenePass.dispose();
      glitchTexture?.dispose();
      for (const texture of gradeTextures) texture.dispose();
    },
  };
}

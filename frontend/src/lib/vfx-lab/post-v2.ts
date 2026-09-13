import * as THREE from "three/webgpu";
import {
  pass,
  uniform,
  vec3,
  vec4,
  dot,
  mix,
  max,
  smoothstep,
  convertToTexture,
  uv as screenUV,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { VfxDocumentV2 } from "./schema-v2";

export interface PostStackV2 {
  render(): void;
  apply(doc: VfxDocumentV2, flags: { post: boolean; aa: boolean }): void;
  dispose(): void;
}

/** Scene-linear HDR -> bloom -> grade -> chromatic/vignette -> output -> SMAA.
 * RenderPipeline owns the sole tone-map and output conversion (inside SMAA
 * when enabled). PassNode tracks renderer size/DPR; no second resize owner.
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
  const c = max(src.rgb.add(glow.rgb), 0)
    .sub(0.18)
    .mul(contrast)
    .add(0.18)
    .max(0);
  const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  const graded = max(mix(vec3(l), c, saturation), 0)
    .mul(tint)
    .add(lift)
    .max(0);
  const gradeTexture = convertToTexture(vec4(graded, src.a));
  const uv = screenUV();
  const d = uv.sub(0.5);
  const shifted = vec3(
    gradeTexture.sample(uv.add(d.mul(chromatic))).r,
    gradeTexture.sample(uv).g,
    gradeTexture.sample(uv.sub(d.mul(chromatic))).b,
  );
  const final = vec4(
    shifted.mul(
      smoothstep(0.35, 1.05, d.length().mul(1.6)).mul(vignette).oneMinus(),
    ),
    1,
  );
  const pipeline = new THREE.RenderPipeline(renderer, final);
  // SMAA operates on display-referred pixels, after the single output transform.
  const aaInput = convertToTexture(
    final.renderOutput(renderer.toneMapping, renderer.outputColorSpace),
  );
  const aa = smaa(aaInput);
  let usingAA = false;
  return {
    render() {
      pipeline.render();
    },
    apply(doc, flags) {
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
      const nextAA = flags.aa && doc.quality.aa === "msaa+smaa";
      if (nextAA !== usingAA) {
        usingAA = nextAA;
        pipeline.outputNode = nextAA ? aa : final;
        pipeline.outputColorTransform = !nextAA;
        pipeline.needsUpdate = true;
      }
    },
    dispose() {
      pipeline.dispose();
      aa.dispose();
      aaInput.dispose();
      glow.dispose();
      scenePass.dispose();
      gradeTexture.dispose();
    },
  };
}

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import type { VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Post stack: HalfFloat (MSAA x4) target -> render -> bloom -> grade ->
// vignette + chromatic aberration -> output (tone map + sRGB) -> SMAA.
//
// The grade and vignette/chromatic passes run before OutputPass so they operate
// on linear HDR; SMAA runs last, on the already display-referred image.
// ---------------------------------------------------------------------------

const MSAA_SAMPLES = 4;

/** Contrast / saturation / tint / lift, on linear HDR, after bloom. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uLift: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uContrast,uSaturation,uLift; uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec4 src=texture2D(tDiffuse,vUv);
      vec3 c=max(src.rgb,0.);
      // Contrast pivots around mid grey in linear light.
      c=max((c-0.18)*uContrast+0.18,0.);
      float l=dot(c,vec3(.2126,.7152,.0722));
      c=max(mix(vec3(l),c,uSaturation),0.);
      c*=uTint;
      c=max(c+uLift,0.);
      gl_FragColor=vec4(c,src.a);
    }`,
};

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.35 },
    uChromatic: { value: 0.0025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette,uChromatic; varying vec2 vUv;
    void main(){
      vec2 d=(vUv-.5);
      vec3 c;
      c.r=texture2D(tDiffuse,vUv+d*uChromatic).r;
      c.g=texture2D(tDiffuse,vUv).g;
      c.b=texture2D(tDiffuse,vUv-d*uChromatic).b;
      float v=1.-uVignette*smoothstep(.35,1.05,length(d)*1.6);
      gl_FragColor=vec4(c*v,1.);
    }`,
};

export interface PostStackV2 {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  smaa: SMAAPass;
  vignette: ShaderPass;
  grade: ShaderPass;
  setSize(width: number, height: number): void;
  apply(doc: VfxDocumentV2, flags: { post: boolean; aa: boolean }): void;
  dispose(): void;
}

export function createPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  samples = MSAA_SAMPLES,
): PostStackV2 {
  const target = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    samples,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
    0.45,
    0.4,
    1.3,
  );
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  return {
    composer,
    bloom,
    smaa,
    vignette,
    grade,
    setSize(w, h) {
      composer.setSize(Math.max(1, w), Math.max(1, h));
    },
    apply(doc, flags) {
      bloom.enabled = flags.post;
      bloom.strength = doc.post.bloom.strength;
      bloom.radius = doc.post.bloom.radius;
      bloom.threshold = doc.post.bloom.threshold;
      const g = doc.post.grade;
      const neutral =
        g.contrast === 1 && g.saturation === 1 && g.lift === 0 && g.tint === "#ffffff";
      grade.enabled = flags.post && !neutral;
      grade.uniforms.uContrast.value = g.contrast;
      grade.uniforms.uSaturation.value = g.saturation;
      grade.uniforms.uLift.value = g.lift;
      (grade.uniforms.uTint.value as THREE.Color).set(g.tint);
      vignette.enabled = flags.post;
      vignette.uniforms.uVignette.value = doc.post.vignette;
      vignette.uniforms.uChromatic.value = doc.post.chromatic;
      smaa.enabled = flags.aa && doc.quality.aa === "msaa+smaa";
    },
    dispose() {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
      target.dispose();
    },
  };
}

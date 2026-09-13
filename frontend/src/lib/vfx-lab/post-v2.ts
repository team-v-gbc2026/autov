import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import type { VfxDocumentV2 } from "./schema-v2";
import { sampleCurve } from "./ribbon-v2";

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

/**
 * post.glitch: horizontal band displacement, per-channel split and block
 * dropout, every one of them keyed on hash(floor(t * GLITCH_HZ)) so a seek
 * lands on exactly the frame playback would have drawn. Runs right after bloom,
 * on linear HDR, so a displaced band carries its own glow with it.
 */
const GLITCH_HZ = 20;

const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uI: { value: 0 },
    uBands: { value: 15 },
    uBlocks: { value: new THREE.Vector2(54, 34) },
    uSplit: { value: 0.008 },
    uEdgeBias: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime,uI,uBands,uSplit,uEdgeBias;
    uniform vec2 uBlocks; varying vec2 vUv;
    float gHash(float p){ p=fract(p*0.1031); p*=p+33.33; p*=p+p; return fract(p); }
    void main(){
      vec2 uv=vUv;
      float blk=floor(uTime*${GLITCH_HZ}.);
      // The frame edges break harder than its centre, which is what keeps the
      // subject readable through the worst frames.
      float edge=1.+uEdgeBias*(1.15*smoothstep(.30,.5,abs(uv.x-.5))
                              +.75*smoothstep(.36,.5,abs(uv.y-.5)));
      float k=uI*clamp(edge,0.,2.4);
      float band=floor(uv.y*uBands);
      float shift=step(.58,gHash(band*7.3+blk*13.7))
                 *(gHash(band*3.1+blk*5.9)-.5)*.14*k;
      vec2 uv2=vec2(fract(uv.x+shift),uv.y);
      float d=uSplit*k;
      float r=texture2D(tDiffuse,uv2+vec2(d,0.)).r;
      vec4 g=texture2D(tDiffuse,uv2);
      float b=texture2D(tDiffuse,uv2-vec2(d,0.)).b;
      vec3 col=vec3(r,g.g,b);
      vec2 bc=floor(uv*uBlocks);
      float h=gHash(bc.x*1.7+bc.y*31.3+blk*77.1);
      // A few blocks swap channels, a few drop to near black.
      if(h>1.-.085*k) col=col.bgr*1.1;
      if(h<.05*k) col*=.35;
      gl_FragColor=vec4(col,g.a);
    }`,
};

export interface PostStackV2 {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  smaa: SMAAPass;
  vignette: ShaderPass;
  grade: ShaderPass;
  glitch: ShaderPass;
  setSize(width: number, height: number): void;
  /** `time` is DOCUMENT seconds; only post.glitch reads it. */
  apply(
    doc: VfxDocumentV2,
    flags: { post: boolean; aa: boolean },
    time?: number,
  ): void;
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
  const glitch = new ShaderPass(GlitchShader);
  composer.addPass(glitch);
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
    glitch,
    setSize(w, h) {
      composer.setSize(Math.max(1, w), Math.max(1, h));
    },
    apply(doc, flags, time = 0) {
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
      const spec = doc.post.glitch;
      // Strength is the curve over the document's own 0..1 progress; a pass at
      // zero strength is disabled outright so it costs nothing off its window.
      const strength = spec
        ? Math.max(0, sampleCurve(spec.curve, time / Math.max(doc.duration, 1e-4)))
        : 0;
      glitch.enabled = flags.post && strength > 0.002;
      if (spec) {
        glitch.uniforms.uTime.value = time;
        glitch.uniforms.uI.value = strength;
        glitch.uniforms.uBands.value = spec.bands;
        (glitch.uniforms.uBlocks.value as THREE.Vector2).fromArray(spec.blockGrid);
        glitch.uniforms.uSplit.value = spec.split;
        glitch.uniforms.uEdgeBias.value = spec.edgeBias;
      }
      smaa.enabled = flags.aa && doc.quality.aa === "msaa+smaa";
    },
    dispose() {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
      target.dispose();
    },
  };
}

import * as THREE from "three";
import { GROUND_POOL_BUDGET_V2, type VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Scene dressing for the v2 renderer: background, fog, ground plane (with a
// procedural grid patched into MeshStandardMaterial) and the hemisphere fill
// that keeps the grid readable while the effect's own lights flicker.
// ---------------------------------------------------------------------------

/**
 * Fill light strength at environment.ambient = 1; the grid reads as a lit
 * surface rather than a decal. The document scales it from there.
 */
const HEMISPHERE_INTENSITY = 5;
const GROUND_SIZE = 60;
/** Pools the ground shader compiles slots for; see environment.groundPool. */
const POOLS = GROUND_POOL_BUDGET_V2;

export interface EnvironmentV2 {
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  fill: THREE.HemisphereLight;
  /** environment.backdrop: the screen-space card behind everything. */
  backdrop: THREE.Mesh;
  apply(doc: VfxDocumentV2, scene: THREE.Scene, showGround: boolean): void;
  /**
   * environment.groundPool, re-evaluated every frame: each pool's live centre
   * (its own position, or the transform of the layer it follows) and its
   * intensity sampled from the curve over the document's own 0..1 progress.
   * Analytic, so the floor takes light from a portal or a falling meteor
   * without a real light and without a decal to sort.
   */
  writePools(
    centres: Array<{ centre: THREE.Vector3; intensity: number }>,
  ): void;
  dispose(): void;
}

/** Piecewise curve sample; the environment carries no curve machinery. */
export function sampleCurveAt(
  keys: ReadonlyArray<readonly [number, number]>,
  ease: "linear" | "smooth",
  u: number,
) {
  const x = Math.min(1, Math.max(0, u));
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x <= keys[i][0]) {
      let f = (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-5);
      if (ease === "smooth") f = f * f * (3 - 2 * f);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
}

export function createEnvironment(scene: THREE.Scene): EnvironmentV2 {
  const gridColor = { value: new THREE.Color("#9a9cab") };
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#4a4952"),
    roughness: 0.9,
    metalness: 0,
  });
  const gridOn = { value: 1 };
  // (centre.xz, radius, anisotropy) and (colour.rgb, intensity) per pool, plus
  // whether each one is a rectangle rather than a disc.
  const poolA = {
    value: Array.from({ length: POOLS }, () => new THREE.Vector4(0, 0, 1, 1)),
  };
  const poolC = {
    value: Array.from({ length: POOLS }, () => new THREE.Vector4(0, 0, 0, 0)),
  };
  const poolRect = { value: Array.from({ length: POOLS }, () => 0) };
  const poolN = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = gridColor;
    shader.uniforms.uGridOn = gridOn;
    shader.uniforms.uPoolA = poolA;
    shader.uniforms.uPoolC = poolC;
    shader.uniforms.uPoolRect = poolRect;
    shader.uniforms.uPoolN = poolN;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uGrid; uniform float uGridOn; varying vec3 vWp;
        uniform vec4 uPoolA[${POOLS}]; uniform vec4 uPoolC[${POOLS}];
        uniform float uPoolRect[${POOLS}]; uniform int uPoolN;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 g=abs(fract(vWp.xz*1.0-0.5)-0.5)/max(fwidth(vWp.xz*1.0),vec2(1e-5));
        float line=1.-min(min(g.x,g.y),1.);
        vec2 g2=abs(fract(vWp.xz*4.0-0.5)-0.5)/max(fwidth(vWp.xz*4.0),vec2(1e-5));
        float line2=1.-min(min(g2.x,g2.y),1.);
        diffuseColor.rgb=mix(diffuseColor.rgb, uGrid, (line*0.30+line2*0.07)*uGridOn);
        // environment.groundPool: one gaussian per pool, round or rectangular.
        // A rectangle measures from the EDGE of its footprint, which is what
        // makes a doorway throw a bar of light rather than a disc.
        for(int i=0;i<${POOLS};i++){
          if(i>=uPoolN) break;
          vec2 d=vWp.xz-uPoolA[i].xy;
          float r=max(uPoolA[i].z,1e-3);
          float across=max(abs(d.x)-r*uPoolA[i].w, 0.0);
          float along=abs(d.y);
          float g = uPoolRect[i]>0.5
            ? exp(-pow(across/r,2.0))*exp(-pow(along/r,2.0))
            : exp(-pow(length(d)/r,2.0));
          diffuseColor.rgb+=uPoolC[i].rgb*uPoolC[i].a*g;
        }`,
      );
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    material,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = "environment-ground";
  scene.add(ground);

  // environment.backdrop: a card locked to the clip-space corners, drawn before
  // anything else with depth off. It is not lit and it is not fogged; it is the
  // paper the effect is drawn on, which is exactly what a cartoon impact needs
  // instead of a flat background colour.
  const backdropUniforms = {
    uHot: { value: new THREE.Color("#3d8ada") },
    uCold: { value: new THREE.Color("#0c2a55") },
    uCentre: { value: new THREE.Vector2(0.5, 0.46) },
    uAspect: { value: 1.1 },
    uTop: { value: 0.4 },
  };
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: backdropUniforms,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,1.,1.); }`,
      fragmentShader: /* glsl */ `
        precision highp float; varying vec2 vUv;
        uniform vec3 uHot,uCold; uniform vec2 uCentre; uniform float uAspect,uTop;
        void main(){
          vec2 d=(vUv-uCentre)*vec2(uAspect,1.);
          // Wide, so the hot centre reaches the frame edges instead of ending
          // in a visible disc.
          float v=1.-smoothstep(.02,1.35,length(d));
          vec3 c=mix(uCold,uHot,pow(max(v,1e-4),1.15));
          c*=1.-uTop*smoothstep(.50,1.,vUv.y);
          c*=1.-uTop*.55*smoothstep(.30,0.,vUv.y);
          gl_FragColor=vec4(c,1.);
        }`,
    }),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -100;
  backdrop.visible = false;
  scene.add(backdrop);

  const fill = new THREE.HemisphereLight(
    new THREE.Color("#8a8894"),
    new THREE.Color("#3a3840"),
    HEMISPHERE_INTENSITY,
  );
  scene.add(fill);

  return {
    ground,
    fill,
    backdrop,
    apply(doc, target, showGround) {
      target.background = new THREE.Color(doc.environment.background);
      const card = doc.environment.backdrop;
      backdrop.visible = !!card;
      if (card) {
        backdropUniforms.uHot.value.set(card.hot);
        backdropUniforms.uCold.value.set(card.cold);
        backdropUniforms.uCentre.value.fromArray(card.center);
        backdropUniforms.uAspect.value = card.aspect;
        backdropUniforms.uTop.value = card.topFalloff;
      }
      const fog = doc.environment.fog;
      target.fog =
        fog.density > 0
          ? new THREE.FogExp2(new THREE.Color(fog.color).getHex(), fog.density)
          : null;
      gridOn.value = doc.environment.ground === "grid" ? 1 : 0;
      material.color.set(doc.environment.groundColor);
      ground.position.y = doc.environment.groundY;
      ground.visible = showGround && doc.environment.ground !== "none";
      fill.intensity = HEMISPHERE_INTENSITY * doc.environment.ambient;
      fill.visible = showGround;
      const pools = doc.environment.groundPool ?? [];
      poolN.value = Math.min(pools.length, POOLS);
      pools.slice(0, POOLS).forEach((pool, i) => {
        poolA.value[i].set(
          pool.position[0],
          pool.position[2],
          pool.radius,
          pool.anisotropy,
        );
        const colour = new THREE.Color(pool.color);
        poolC.value[i].set(colour.r, colour.g, colour.b, 0);
        poolRect.value[i] = pool.shape === "rect" ? 1 : 0;
      });
    },
    writePools(live) {
      poolN.value = Math.min(live.length, POOLS);
      live.slice(0, POOLS).forEach((entry, i) => {
        poolA.value[i].x = entry.centre.x;
        poolA.value[i].y = entry.centre.z;
        poolC.value[i].w = Math.max(0, entry.intensity);
      });
    },
    dispose() {
      backdrop.geometry.dispose();
      (backdrop.material as THREE.Material).dispose();
      backdrop.removeFromParent();
      ground.geometry.dispose();
      material.dispose();
      ground.removeFromParent();
      fill.removeFromParent();
      fill.dispose();
    },
  };
}

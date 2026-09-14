import * as THREE from "three/webgpu";
import {
  uniform,
  positionWorld,
  positionGeometry,
  vec2,
  vec4,
  abs,
  exp,
  pow,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  smoothstep,
  uv as meshUV,
} from "three/tsl";
import { GROUND_POOL_BUDGET_V2, type VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Scene dressing for the v2 renderer: background, fog, node-based ground plane
// (derivative-filtered grid plus analytic light pools), the screen-space
// backdrop card, and the hemisphere fill that keeps the grid readable while the
// effect's own lights flicker.
// ---------------------------------------------------------------------------

/**
 * Fill light strength at environment.ambient = 1; the grid reads as a lit
 * surface rather than a decal. The document scales it from there.
 */
const HEMISPHERE_INTENSITY = 5;
const GROUND_SIZE = 60;
/** Pools the ground graph carries slots for; see environment.groundPool. */
const POOLS = GROUND_POOL_BUDGET_V2;

export interface EnvironmentV2 {
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>;
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
  // WebGPU caches fog nodes by object identity. Replacing FogExp2 on every
  // playback/orbit frame invalidates the ground's node graph and pipeline.
  const background = new THREE.Color();
  const environmentFog = new THREE.FogExp2("#000000", 0);
  const gridColor = uniform(new THREE.Color("#737779"));
  const groundColor = uniform(new THREE.Color("#484b4e"));
  const gridOn = uniform(1);
  // (centre.xz, radius, anisotropy) and (colour.rgb, intensity) per pool, plus
  // whether each one is a rectangle rather than a disc. Every slot is evaluated;
  // an unused pool carries intensity 0, so no loop bound enters the graph and a
  // document that adds a pool does not rebuild the ground pipeline.
  const poolArea = Array.from(
    { length: POOLS },
    () => new THREE.Vector4(0, 0, 1, 1),
  );
  const poolColor = Array.from(
    { length: POOLS },
    () => new THREE.Vector4(0, 0, 0, 0),
  );
  const poolRect = Array.from({ length: POOLS }, () => 0);
  // One uniform per slot rather than a uniform array: the graph unrolls every
  // slot anyway, and individual uniforms keep the node types exact.
  const poolAreaNode = poolArea.map((value) => uniform(value));
  const poolColorNode = poolColor.map((value) => uniform(value));
  const poolRectNode = poolRect.map((value) => uniform(value));
  let poolCount = 0;
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
  });
  const grid = (scale: number) => {
    const p = positionWorld.xz.mul(scale);
    const g = abs(fract(p.sub(0.5)).sub(0.5)).div(max(fwidth(p), 1e-5));
    return min(min(g.x, g.y), 1).oneMinus();
  };
  const base = mix(
    groundColor,
    gridColor,
    grid(1).mul(0.32).add(grid(4).mul(0.06)).mul(gridOn),
  );
  // environment.groundPool: one gaussian per pool, round or rectangular. A
  // rectangle measures from the EDGE of its footprint, which is what makes a
  // doorway throw a bar of light rather than a disc.
  // One expression rather than an accumulator: these graphs are assembled
  // outside any Fn, where TSL has no statement stack to assign into.
  const pools = poolAreaNode.map((area, i) => {
    const colour = poolColorNode[i];
    const d = positionWorld.xz.sub(area.xy);
    const r = max(area.z, 1e-3);
    const across = max(abs(d.x).sub(r.mul(area.w)), 0);
    const along = abs(d.y);
    const round = exp(pow(length(d).div(r), 2).negate());
    const rect = exp(pow(across.div(r), 2).negate()).mul(
      exp(pow(along.div(r), 2).negate()),
    );
    const falloff = mix(round, rect, poolRectNode[i]);
    return colour.rgb.mul(colour.a).mul(falloff);
  });
  material.colorNode = pools.reduce((sum, term) => sum.add(term), base);
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
  const backdropHot = uniform(new THREE.Color("#3d8ada"));
  const backdropCold = uniform(new THREE.Color("#0c2a55"));
  const backdropCentre = uniform(new THREE.Vector2(0.5, 0.46));
  const backdropAspect = uniform(1.1);
  const backdropTop = uniform(0.4);
  const backdropMaterial = new THREE.NodeMaterial();
  backdropMaterial.depthTest = false;
  backdropMaterial.depthWrite = false;
  backdropMaterial.fog = false;
  backdropMaterial.vertexNode = vec4(positionGeometry.xy, 1, 1);
  {
    const card = meshUV();
    const d = card.sub(backdropCentre).mul(vec2(backdropAspect, 1));
    // Wide, so the hot centre reaches the frame edges instead of ending in a
    // visible disc.
    const v = smoothstep(0.02, 1.35, length(d)).oneMinus();
    const c = mix(backdropCold, backdropHot, pow(max(v, 1e-4), 1.15))
      .mul(smoothstep(0.5, 1, card.y).mul(backdropTop).oneMinus())
      .mul(smoothstep(0.3, 0, card.y).mul(backdropTop.mul(0.55)).oneMinus());
    backdropMaterial.fragmentNode = vec4(c, 1);
  }
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    backdropMaterial,
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -100;
  backdrop.visible = false;
  scene.add(backdrop);

  const fill = new THREE.HemisphereLight(
    new THREE.Color("#909090"),
    new THREE.Color("#383838"),
    HEMISPHERE_INTENSITY,
  );
  scene.add(fill);

  const poolColour = new THREE.Color();
  return {
    ground,
    fill,
    backdrop,
    apply(doc, target, showGround) {
      background.set(doc.environment.background);
      target.background = background;
      const card = doc.environment.backdrop;
      backdrop.visible = !!card;
      if (card) {
        backdropHot.value.set(card.hot);
        backdropCold.value.set(card.cold);
        backdropCentre.value.fromArray(card.center);
        backdropAspect.value = card.aspect;
        backdropTop.value = card.topFalloff;
      }
      const fog = doc.environment.fog;
      environmentFog.color.set(fog.color);
      environmentFog.density = fog.density;
      target.fog = fog.density > 0 ? environmentFog : null;
      gridOn.value = doc.environment.ground === "grid" ? 1 : 0;
      groundColor.value.set(doc.environment.groundColor);
      ground.position.y = doc.environment.groundY;
      ground.visible = showGround && doc.environment.ground !== "none";
      fill.intensity = HEMISPHERE_INTENSITY * doc.environment.ambient;
      fill.visible = showGround;
      const spec = doc.environment.groundPool ?? [];
      poolCount = Math.min(spec.length, POOLS);
      for (let i = 0; i < POOLS; i++) {
        const pool = i < poolCount ? spec[i] : null;
        if (!pool) {
          poolColor[i].set(0, 0, 0, 0);
          continue;
        }
        poolArea[i].set(
          pool.position[0],
          pool.position[2],
          pool.radius,
          pool.anisotropy,
        );
        poolColour.set(pool.color);
        poolColor[i].set(poolColour.r, poolColour.g, poolColour.b, 0);
        poolRectNode[i].value = pool.shape === "rect" ? 1 : 0;
      }
    },
    writePools(live) {
      for (let i = 0; i < POOLS; i++) {
        const entry = i < poolCount ? live[i] : undefined;
        if (!entry) {
          poolColor[i].w = 0;
          continue;
        }
        poolArea[i].x = entry.centre.x;
        poolArea[i].y = entry.centre.z;
        poolColor[i].w = Math.max(0, entry.intensity);
      }
    },
    dispose() {
      backdrop.geometry.dispose();
      backdropMaterial.dispose();
      backdrop.removeFromParent();
      ground.geometry.dispose();
      material.dispose();
      ground.removeFromParent();
      fill.removeFromParent();
      fill.dispose();
    },
  };
}

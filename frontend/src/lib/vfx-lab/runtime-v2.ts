import { layerBuildKey } from "./layer-build-key";
import type { IUniform } from "three";
import * as THREE from "three/webgpu";
import { createV2NodeMaterial, type V2NodeMaterial } from "./node-material-v2";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGeometry } from "./geometry";
import { createEnvironment, type EnvironmentV2 } from "./environment-v2";
import { createPostStack, type PostStackV2 } from "./post-v2";
import { evaluateLayerV2Readonly as evaluateLayerV2 } from "./evaluate-v2";
import { upgradeDocument } from "./migrate";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";
import { textureUrl } from "./asset-urls";
import type { VfxDocument } from "./schema";
import {
  isV2,
  validateDocumentV2,
  validateWorkspaceDocumentV2,
  type Curve,
  type Emitter,
  type LayerV2,
  type Material,
  type VfxDocumentV2,
} from "./schema-v2";
import {
  CURVE_KEYS,
  curveUniforms,
  rampUniforms,
  writeCurve,
  writeRamp,
} from "./uniforms-v2";
import {
  STRIKE_HZ,
  buildLightningGeometry,
  lightningBounds,
} from "./lightning-v2";

export const RUNTIME_VERSION_V2 = "autov.lab/2-three-r186-webgpu";

// ---------------------------------------------------------------------------
// autov.lab/2 renderer.
//
// Everything is closed form in time: state = f(document, time, seed), no
// accumulation anywhere, so seeking to t draws exactly what playing to t draws.
//
// ---------------------------------------------------------------------------
// What `geometry` means, per layer kind
// ---------------------------------------------------------------------------
// Axis convention: a layer's local +Z is its *forward* axis. A beam, a trail
// and a shell all grow along local +Z and are aimed with transform.rotation
// (rotation [0,0,0] points at +Z; [0, -PI/2, 0] points at +X; [0, PI/2, 0] at
// -X). Flat things (ring, decal, and a `plane` under any other kind) are built
// in the local XY plane facing +Z, so laying one on the ground takes the
// explicit rotation [-PI/2, 0, 0]. transform.scale multiplies whatever the
// geometry fields already produce; it is never required to get the size right.
//
//   kind      geometry.type              length        radius        thickness
//   --------- -------------------------- ------------- ------------- ---------
//   beam      auto|plane|ribbon|streamer bar length    bar half-width -
//             cylinder                   tube length   tube radius    -
//             lightning                  bolt length   bolt spread    bolt width
//   trail     as beam, tapered to the tail by geometry.lightning.widthCurve
//             when present, else a default taper toward the far end
//             ribbon                     arc angle     arc radius     half-width
//             (radians, uArc)
//   ring      torus                      -             ring radius    tube width
//             disc|auto|plane            flat depth    disc/half-width -
//             ribbon                     as trail's ribbon
//   sprite    plane|auto                 -             half-size      -
//             (always faces the camera; transform.rotation[2] rolls it)
//   decal     plane|auto                 flat depth    flat half-width -
//   shell     sphere|teardrop|auto       nose-to-tail  body radius    -
//             crystal|crystal-cluster|cone|cylinder|streamer: the library mesh,
//             turned to run along local +Z, scaled length x radius
//             plane|disc|torus|...       falls through to the flat/bar shapes
//   particles no geometry - see `emitter.shape` instead
//
// beam/trail/sprite/decal take their size from `geometry` every frame, so a
// track on geometry.length or geometry.radius animates them. A ring rebuilds
// its torus when the tracked radius or thickness moves, so a shockwave really
// does expand.
//
// Still parsed and ignored (read off the document without throwing, no effect):
//   environment.groundReflect.
//
// Deliberate approximations, all of them bounded:
//   - the CPU mirror used for depth sorting and camera framing ignores the
//     curl and vortex offsets and evaluates sub-emitters from their parent's
//     sample points rather than per instance;
//   - a sub-emitter binds its parent's authored emitter, so tracks that
//     animate the *parent's* emitter do not move the children (the parent's
//     transform, including motion keys, is sampled and does move them).
// ---------------------------------------------------------------------------

export type FeatureFlagsV2 = {
  aa: boolean;
  textures: boolean;
  erosion: boolean;
  curl: boolean;
  light: boolean;
  post: boolean;
  ground: boolean;
  softParticles: boolean;
};

const DEFAULT_FLAGS: FeatureFlagsV2 = {
  aa: true,
  textures: true,
  erosion: true,
  curl: true,
  light: true,
  post: true,
  ground: true,
  softParticles: true,
};

/** Above this instance count a per-frame CPU depth sort stops being worth it. */
const SORT_LIMIT = 8000;
/** Point lights the renderer will actually install (strongest first). */
const MAX_LIGHTS = 4;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 60;

const SHAPE_INDEX: Record<string, number> = {
  point: 0,
  sphere: 1,
  hemisphere: 2,
  cone: 3,
  ring: 4,
  disc: 5,
  box: 6,
  line: 7,
};
const VELOCITY_INDEX: Record<string, number> = {
  radial: 0,
  directional: 1,
  tangential: 2,
  cone: 3,
};
const RENDER_INDEX: Record<string, number> = {
  billboard: 0,
  velocityStretch: 1,
  horizontal: 2,
  vertical: 3,
};
const BLEND_INDEX: Record<string, number> = {
  additive: 0,
  alpha: 1,
  premultiplied: 2,
  screen: 3,
};
/** Procedural patterns the fragment shaders know about; "none" is 0. */
const PROCEDURAL_INDEX: Record<string, number> = {
  flame: 1,
  smoke: 2,
  solid: 3,
  hexagon: 4,
  ice: 5,
  water: 6,
  "water-streaks": 7,
  star: 8,
  sparkle: 9,
  portal: 10,
  "energy-ribbon": 11,
};
const SUB_MODE_INDEX: Record<string, number> = {
  alongPath: 0,
  onDeath: 1,
  continuous: 2,
};

// The library lives in the public `vfx-textures` bucket (or wherever
// NEXT_PUBLIC_VFX_ASSET_BASE / globalThis.__VFX_ASSET_BASE points), so these
// are absolute cross-origin URLs in production.
const TEXTURE_FILES = new Map(
  TEXTURE_MANIFEST_V2.map((entry) => [entry.id, entry.file] as const),
);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function blendingFor(blend: string): Partial<THREE.MaterialParameters> {
  if (blend === "additive") return { blending: THREE.AdditiveBlending };
  if (blend === "alpha") return { blending: THREE.NormalBlending };
  if (blend === "screen")
    return {
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
    };
  return {
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  };
}

/** Stable 32-bit hash so every layer gets its own deterministic attribute set. */
function hashSeed(seed: number, key: string) {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  return (h >>> 0) % 2147483646 || 1;
}

/** The spike's LCG: same sequence on CPU and in the attribute buffers. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

class TextureCacheV2 {
  private readonly loader = new THREE.TextureLoader();

  constructor() {
    // The library is cross-origin (Supabase Storage). WebGL refuses to sample
    // a tainted image, so the request has to be an anonymous CORS request.
    this.loader.setCrossOrigin("anonymous");
  }
  private readonly cache = new Map<string, THREE.Texture>();
  private pending = 0;
  private waiters: (() => void)[] = [];

  resolve(id: string | null, doc: VfxDocumentV2, repeat: boolean) {
    if (!id) return null;
    const embedded = doc.textures?.find((asset) => asset.id === id);
    const file = TEXTURE_FILES.get(id);
    const url = embedded ? embedded.data : file ? textureUrl(file) : undefined;
    if (!url) return null;
    const key = `${url}:${repeat ? "r" : "c"}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.pending++;
    const texture = this.loader.load(
      url,
      () => this.settle(),
      undefined,
      () => this.settle(),
    );
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = repeat
      ? THREE.RepeatWrapping
      : THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    this.cache.set(key, texture);
    return texture;
  }

  private settle() {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  /** Resolves once every texture requested so far has loaded (or failed). */
  whenReady(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  dispose() {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// CPU mirror of the particle vertex shader
// ---------------------------------------------------------------------------

interface ParticleAttributes {
  seed: Float32Array;
  extra: Float32Array;
  extra2: Float32Array;
  count: number;
}

function makeAttributes(count: number, seed: number): ParticleAttributes {
  const rnd = lcg(seed);
  const s = new Float32Array(count * 4);
  const e = new Float32Array(count * 4);
  const e2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 4; k++) {
      s[i * 4 + k] = rnd();
      e[i * 4 + k] = rnd();
      e2[i * 4 + k] = rnd();
    }
  return { seed: s, extra: e, extra2: e2, count };
}

function orthoOf(a: THREE.Vector3, out: THREE.Vector3) {
  // a × Y or a × X, without allocating a helper for every particle.
  if (Math.abs(a.y) < 0.9) out.set(-a.z, 0, a.x);
  else out.set(0, a.z, -a.y);
  return out.lengthSq() > 1e-10 ? out.normalize() : out.set(1, 0, 0);
}

/** Integral of a piecewise-linear speed curve from 0 to u; mirrors selfSpeedI. */
function speedIntegral(curve: Curve, u: number) {
  const keys = curve.keys;
  const x = clamp01(u);
  let acc = Math.min(x, keys[0][0]) * keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [a, va] = keys[i - 1];
    const [b, vb] = keys[i];
    const f = clamp01((x - a) / Math.max(b - a, 1e-5));
    acc += (b - a) * f * (va + (vb - va) * f * 0.5);
    if (i === keys.length - 1) acc += Math.max(x - b, 0) * vb;
  }
  return acc;
}

// particlePositionV2 is synchronous and never calls user code; only `out`
// escapes. Reuse its working vectors across sorting and bounds samples.
const particleScratch = {
  unit: new THREE.Vector3(), sphere: new THREE.Vector3(), axis: new THREE.Vector3(),
  a1: new THREE.Vector3(), a2: new THREE.Vector3(), origin: new THREE.Vector3(),
  base: new THREE.Vector3(), direction: new THREE.Vector3(),
  t1: new THREE.Vector3(), t2: new THREE.Vector3(), force: new THREE.Vector3(),
};

/**
 * Positions for bounds and depth sorting. Deliberately ignores the curl and
 * vortex offsets (both bounded perturbations) and sub-emitter parentage so the
 * CPU mirror stays cheap; everything else matches the shader term for term.
 */
function particlePositionV2(
  emitter: Emitter,
  attrs: ParticleAttributes,
  index: number,
  time: number,
  period: number,
  spawnWindow: number,
  out: THREE.Vector3,
): boolean {
  const i4 = index * 4;
  const s0 = attrs.seed[i4],
    s1 = attrs.seed[i4 + 1],
    s2 = attrs.seed[i4 + 2],
    s3 = attrs.seed[i4 + 3];
  const e0 = attrs.extra[i4],
    e1 = attrs.extra[i4 + 1],
    e2 = attrs.extra[i4 + 2],
    e3 = attrs.extra[i4 + 3];
  const x3 = attrs.extra2[i4 + 3];

  const life = emitter.life[0] + (emitter.life[1] - emitter.life[0]) * s1;
  let age: number;
  if (emitter.spawn.mode === "continuous") {
    const birth = s0 * spawnWindow;
    const cycle = Math.floor((time - birth) / Math.max(period, 1e-4));
    const absolute = birth + cycle * period;
    if (absolute < 0 || absolute > emitter.spawn.duration) return false;
    age = time - absolute;
  } else if (emitter.spawn.mode === "bursts") {
    const total = emitter.spawn.bursts.reduce((n, b) => n + b.count, 0) || 1;
    let cumulative = 0;
    let start = emitter.spawn.bursts[0]?.t ?? 0;
    for (const burst of emitter.spawn.bursts) {
      cumulative += burst.count / total;
      if (s0 <= cumulative) {
        start = burst.t;
        break;
      }
    }
    age = time - (start + ((s0 * 7.13 + 0.37) % 1) * spawnWindow);
  } else {
    age = time - s0 * spawnWindow;
  }
  if (age < 0 || age >= life) return false;

  const ca = e0 * Math.PI * 2;
  const cz = e1 * 2 - 1;
  const cr = Math.sqrt(Math.max(0, 1 - cz * cz));
  const unit = particleScratch.unit.set(cr * Math.cos(ca), cz, cr * Math.sin(ca));
  const fill = emitter.shape.surfaceOnly ? 1 : Math.sqrt(Math.max(e2, 0));
  const sph = particleScratch.sphere.copy(unit).multiplyScalar(fill);
  const bias = emitter.shape.bias;
  sph.set(
    sph.x + (Math.abs(sph.x) - sph.x) * clamp01(bias[0]),
    sph.y + (Math.abs(sph.y) - sph.y) * clamp01(bias[1]),
    sph.z + (Math.abs(sph.z) - sph.z) * clamp01(bias[2]),
  );

  const axis = particleScratch.axis.fromArray(emitter.shape.axis);
  if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0);
  axis.normalize();
  const a1 = orthoOf(axis, particleScratch.a1);
  const a2 = particleScratch.a2.crossVectors(axis, a1);
  const shape = emitter.shape;
  const origin = particleScratch.origin.set(0, 0, 0);
  switch (shape.type) {
    case "point":
      break;
    case "sphere":
      origin.copy(sph).multiplyScalar(shape.radius);
      break;
    case "hemisphere":
      origin.set(sph.x, Math.abs(sph.y), sph.z).multiplyScalar(shape.radius);
      break;
    case "cone": {
      const h = e3 * shape.length;
      const rr = shape.radius + h * Math.tan(Math.min(shape.angle, 1.5));
      origin
        .copy(axis)
        .multiplyScalar(h)
        .addScaledVector(a1, Math.cos(ca) * rr * Math.sqrt(Math.max(e2, 0)))
        .addScaledVector(a2, Math.sin(ca) * rr * Math.sqrt(Math.max(e2, 0)));
      break;
    }
    case "ring":
      origin
        .addScaledVector(a1, Math.cos(ca) * shape.radius)
        .addScaledVector(a2, Math.sin(ca) * shape.radius);
      break;
    case "disc": {
      const rr =
        shape.innerRadius +
        (shape.radius - shape.innerRadius) * Math.sqrt(Math.max(e2, 0));
      origin
        .addScaledVector(a1, Math.cos(ca) * rr)
        .addScaledVector(a2, Math.sin(ca) * rr);
      break;
    }
    case "box":
      origin.set(
        (e0 * 2 - 1) * shape.size[0] * 0.5,
        (e1 * 2 - 1) * shape.size[1] * 0.5,
        (e2 * 2 - 1) * shape.size[2] * 0.5,
      );
      break;
    default:
      origin
        .copy(axis)
        .multiplyScalar(shape.length * e3)
        .addScaledVector(sph, shape.radius);
  }

  const base = particleScratch.base.fromArray(emitter.velocity.direction);
  if (base.lengthSq() < 1e-10) base.set(0, 1, 0);
  base.normalize();
  const dir = particleScratch.direction.set(0, 0, 0);
  if (emitter.velocity.mode === "radial") {
    if (origin.lengthSq() > 1e-10) dir.copy(origin).normalize();
    else dir.copy(base);
  } else if (emitter.velocity.mode === "directional") dir.copy(base);
  else if (emitter.velocity.mode === "tangential")
    dir
      .crossVectors(axis, origin.lengthSq() > 1e-10 ? origin : base)
      .normalize();
  else {
    const t1 = orthoOf(base, particleScratch.t1);
    const t2 = particleScratch.t2.crossVectors(base, t1);
    const ph = s2 * Math.PI * 2;
    const cone = s3 * emitter.velocity.angle;
    dir
      .copy(base)
      .addScaledVector(t1, Math.cos(ph) * cone)
      .addScaledVector(t2, Math.sin(ph) * cone)
      .normalize();
  }

  const v0 =
    emitter.velocity.speed[0] +
    (emitter.velocity.speed[1] - emitter.velocity.speed[0]) * x3;
  const drag = emitter.forces.drag;
  const d = emitter.velocity.speedCurve
    ? life *
      speedIntegral(emitter.velocity.speedCurve, age / Math.max(life, 1e-4))
    : drag < 0.001
      ? age
      : (1 - Math.exp(-drag * age)) / drag;
  out
    .copy(origin)
    .addScaledVector(dir, v0 * d)
    .addScaledVector(
      particleScratch.force.fromArray(emitter.forces.gravity),
      0.5 * age * age,
    )
    .addScaledVector(particleScratch.force.fromArray(emitter.forces.wind), age);
  const floor = emitter.forces.floor;
  if (floor) {
    const dy = out.y - floor.y;
    out.y = floor.y + Math.max(dy, dy * floor.softness);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Layer objects
// ---------------------------------------------------------------------------

interface LayerObject {
  id: string;
  source: LayerV2;
  object: THREE.Object3D;
  update(
    time: number,
    flags: FeatureFlagsV2,
    camera: THREE.PerspectiveCamera,
  ): void;
  bounds(time: number, push: (p: THREE.Vector3) => void): void;
  dispose(): void;
  /** Non-null for particle layers that need the depth texture. */
  soft: boolean;
  /**
   * A particle cloud's visual extent is its dense core: the farthest
   * straggler of a 150-spark layer must not claim a fifth of the frame.
   * Mesh layers contribute their whole box.
   */
  trim: boolean;
}

function spawnPeriod(emitter: Emitter, duration: number) {
  if (emitter.spawn.mode !== "continuous") return Math.max(duration, 1e-3);
  const period =
    emitter.spawn.rate > 0 ? emitter.count / emitter.spawn.rate : duration;
  return Math.max(1e-3, Math.min(period, duration));
}

function spawnWindowOf(emitter: Emitter, period: number) {
  return emitter.spawn.mode === "continuous"
    ? period
    : Math.max(emitter.spawn.window, 1e-4);
}

function proceduralIndex(material: Material) {
  return PROCEDURAL_INDEX[material.procedural] ?? 0;
}

const FLAT_CURVE: Curve = {
  keys: [
    [0, 1],
    [1, 1],
  ],
  ease: "linear",
};

/**
 * The trajectory uniforms of one emitter, under a name prefix. Emitted twice
 * for a sub-emitter layer: once for the layer itself ("") and once for the
 * parent it is launched from ("Parent").
 */
function emitterCoreUniforms(
  P: string,
  emitter: Emitter,
  duration: number,
): Record<string, IUniform> {
  const period = spawnPeriod(emitter, duration);
  const speed = emitter.velocity.speedCurve ?? FLAT_CURVE;
  const keys: THREE.Vector2[] = [];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = speed.keys[Math.min(i, speed.keys.length - 1)];
    keys.push(new THREE.Vector2(key[0], key[1]));
  }
  const uniforms: Record<string, IUniform> = {
    [`u${P}Period`]: { value: period },
    [`u${P}SpawnWindow`]: { value: spawnWindowOf(emitter, period) },
    [`u${P}SpawnDuration`]: {
      value:
        emitter.spawn.mode === "continuous" ? emitter.spawn.duration : duration,
    },
    [`u${P}SpawnMode`]: {
      value:
        emitter.spawn.mode === "continuous"
          ? 1
          : emitter.spawn.mode === "bursts"
            ? 2
            : 0,
    },
    [`u${P}BurstT`]: { value: new Array(CURVE_KEYS).fill(0) },
    [`u${P}BurstC`]: { value: new Array(CURVE_KEYS).fill(1) },
    [`u${P}BurstN`]: { value: Math.max(1, emitter.spawn.bursts.length) },
    [`u${P}ShapeType`]: { value: SHAPE_INDEX[emitter.shape.type] ?? 0 },
    [`u${P}ShapeLength`]: { value: emitter.shape.length },
    [`u${P}ShapeRadius`]: { value: emitter.shape.radius },
    [`u${P}ShapeInner`]: { value: emitter.shape.innerRadius },
    [`u${P}ShapeAngle`]: { value: emitter.shape.angle },
    [`u${P}ShapeSize`]: {
      value: new THREE.Vector3().fromArray(emitter.shape.size),
    },
    [`u${P}SurfaceOnly`]: { value: emitter.shape.surfaceOnly ? 1 : 0 },
    [`u${P}Bias`]: { value: new THREE.Vector3().fromArray(emitter.shape.bias) },
    [`u${P}Axis`]: { value: new THREE.Vector3().fromArray(emitter.shape.axis) },
    [`u${P}VelMode`]: { value: VELOCITY_INDEX[emitter.velocity.mode] ?? 3 },
    [`u${P}Dir`]: {
      value: new THREE.Vector3().fromArray(emitter.velocity.direction),
    },
    [`u${P}Angle`]: { value: emitter.velocity.angle },
    [`u${P}Speed`]: {
      value: new THREE.Vector2().fromArray(emitter.velocity.speed),
    },
    [`u${P}SpeedKey`]: { value: keys },
    [`u${P}SpeedN`]: {
      value: emitter.velocity.speedCurve ? speed.keys.length : 0,
    },
    [`u${P}Life`]: { value: new THREE.Vector2().fromArray(emitter.life) },
    [`u${P}Gravity`]: {
      value: new THREE.Vector3().fromArray(emitter.forces.gravity),
    },
    [`u${P}Drag`]: { value: emitter.forces.drag },
    [`u${P}Wind`]: {
      value: new THREE.Vector3().fromArray(emitter.forces.wind),
    },
    [`u${P}Curl`]: { value: emitter.forces.curl?.strength ?? 0 },
    [`u${P}CurlFreq`]: { value: emitter.forces.curl?.frequency ?? 1 },
    [`u${P}CurlSpeed`]: { value: emitter.forces.curl?.speed ?? 1 },
    [`u${P}VortexAxis`]: {
      value: new THREE.Vector3().fromArray(
        emitter.forces.vortex?.axis ?? [0, 1, 0],
      ),
    },
    [`u${P}VortexW`]: { value: emitter.forces.vortex?.strength ?? 0 },
    [`u${P}VortexFalloff`]: { value: emitter.forces.vortex?.falloff ?? 0 },
    [`u${P}FloorY`]: { value: emitter.forces.floor?.y ?? 0 },
    [`u${P}FloorSoft`]: { value: emitter.forces.floor?.softness ?? 1 },
    [`u${P}HasFloor`]: { value: emitter.forces.floor ? 1 : 0 },
  };
  if (emitter.spawn.bursts.length) {
    const total = emitter.spawn.bursts.reduce((n, b) => n + b.count, 0) || 1;
    const times = uniforms[`u${P}BurstT`].value as number[];
    const cumulative = uniforms[`u${P}BurstC`].value as number[];
    let sum = 0;
    for (let i = 0; i < CURVE_KEYS; i++) {
      const burst =
        emitter.spawn.bursts[Math.min(i, emitter.spawn.bursts.length - 1)];
      if (i < emitter.spawn.bursts.length) sum += burst.count / total;
      times[i] = burst.t;
      cumulative[i] = sum;
    }
  }
  return uniforms;
}

/**
 * Strip of `segments` rows x 2 vertices per instance. `position` carries
 * (side, k, 0); the vertex shader turns k into an age offset.
 */
function trailStripGeometry(segments: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < segments; k++) {
    positions.push(-1, k, 0, 1, k, 0);
    if (k < segments - 1) {
      const a = k * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return { positions: new Float32Array(positions), indices };
}

function createParticleLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
  textures: TextureCacheV2,
  depth: THREE.DepthTexture,
): LayerObject {
  const emitter = layer.emitter!;
  const material = layer.material!;
  const density = doc.quality.particleDensity;
  const count = Math.max(1, Math.round(emitter.count * density));
  const attrs = makeAttributes(count, hashSeed(doc.seed, layer.id));

  // Sub-emitter: the parent's attributes ride along on the child instances so
  // the parent trajectory can be evaluated in the child's vertex shader.
  const sub = emitter.sub ?? null;
  const parentLayer = sub
    ? (doc.layers.find((l) => l.id === sub.parentLayerId) ?? null)
    : null;
  // The schema already rejects a non-particles parent; the runtime refuses to
  // bind one anyway rather than reading an absent emitter.
  const parentEmitter =
    parentLayer && parentLayer.kind === "particles"
      ? parentLayer.emitter!
      : null;
  const parentAttrs = parentEmitter
    ? makeAttributes(
        Math.max(1, Math.round(parentEmitter.count * density)),
        hashSeed(doc.seed, parentLayer!.id),
      )
    : null;

  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.attributes.position = plane.attributes.position;
  geometry.attributes.uv = plane.attributes.uv;
  const seedAttr = new THREE.InstancedBufferAttribute(
    Float32Array.from(attrs.seed),
    4,
  );
  const extraAttr = new THREE.InstancedBufferAttribute(
    Float32Array.from(attrs.extra),
    4,
  );
  const extra2Attr = new THREE.InstancedBufferAttribute(
    Float32Array.from(attrs.extra2),
    4,
  );
  geometry.setAttribute("aSeed", seedAttr);
  geometry.setAttribute("aExtra", extraAttr);
  geometry.setAttribute("aExtra2", extra2Attr);
  const parentAttributes: THREE.InstancedBufferAttribute[] = [];
  if (parentAttrs) {
    const pick = (source: Float32Array) => {
      const out = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const from = (i % parentAttrs.count) * 4;
        for (let k = 0; k < 4; k++) out[i * 4 + k] = source[from + k];
      }
      return new THREE.InstancedBufferAttribute(out, 4);
    };
    const names = ["aPSeed", "aPExtra", "aPExtra2"] as const;
    const sources = [parentAttrs.seed, parentAttrs.extra, parentAttrs.extra2];
    names.forEach((name, i) => {
      const attribute = pick(sources[i]);
      geometry.setAttribute(name, attribute);
      parentAttributes.push(attribute);
    });
  }
  geometry.instanceCount = count;
  plane.dispose();

  const atlas = material.mask.atlas;
  const flipbook = material.mask.flipbook;
  const mask = textures.resolve(material.mask.textureId, doc, false);
  const noise = textures.resolve(material.noise?.textureId ?? null, doc, true);
  const trail = emitter.trail;
  const trailTexture = textures.resolve(trail?.textureId ?? null, doc, false);
  const period = spawnPeriod(emitter, doc.duration);

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    ...emitterCoreUniforms("", emitter, doc.duration),
    ...(parentEmitter
      ? emitterCoreUniforms("Parent", parentEmitter, doc.duration)
      : {}),
    uParentTimeShift: {
      value: parentLayer ? layer.start - parentLayer.start : 0,
    },
    uSubMode: { value: sub ? (SUB_MODE_INDEX[sub.mode] ?? 0) : 0 },
    uSubOffset: {
      value: new THREE.Vector2().fromArray(sub?.offset ?? [0, 0]),
    },
    // emitter.sub.inheritVelocity is the sub-emitter site; emitter.velocity.
    // inherit is the layer-level fallback when the former is left at 0.
    uInherit: {
      value: sub ? sub.inheritVelocity || emitter.velocity.inherit : 0,
    },
    uParentPath: {
      value: Array.from({ length: CURVE_KEYS }, () => new THREE.Vector3()),
    },
    uPathT0: { value: 0 },
    uPathDt: {
      value: parentLayer
        ? Math.max(
            1e-3,
            (parentLayer.end - parentLayer.start) / (CURVE_KEYS - 1),
          )
        : 1,
    },
    uRenderMode: { value: RENDER_INDEX[emitter.render.mode] ?? 0 },
    uStretch: { value: emitter.render.stretch },
    uMotionBlur: { value: doc.post.motionBlur },
    uSize: { value: new THREE.Vector2().fromArray(emitter.render.size) },
    uRot: {
      value: new THREE.Vector2().fromArray(emitter.render.rotation.speed),
    },
    uRotInit: {
      value: material.mask.randomRotation
        ? new THREE.Vector2().fromArray(emitter.render.rotation.initial)
        : new THREE.Vector2(0, 0),
    },
    uHasAlphaSpawn: { value: emitter.render.alphaAlongSpawn ? 1 : 0 },
    uMask: { value: mask },
    uHasMask: { value: mask ? 1 : 0 },
    uSegments: { value: trail?.segments ?? 2 },
    uSpacing: { value: trail?.spacing ?? 0.02 },
    uTrail: { value: trailTexture },
    uHasTrail: { value: trailTexture ? 1 : 0 },
    // A flipbook replaces the random atlas tile with a tile keyed on life or
    // on wall time; both are functions of the particle's age alone.
    uFlipMode: { value: flipbook ? (flipbook.mode === "life" ? 1 : 2) : 0 },
    uFlipFps: { value: flipbook?.fps ?? 12 },
    uAtlasCols: { value: flipbook?.cols ?? atlas?.cols ?? 1 },
    uAtlasRows: { value: flipbook?.rows ?? atlas?.rows ?? 1 },
    uAtlasTiles: {
      value: flipbook ? flipbook.cols * flipbook.rows : (atlas?.tiles ?? 1),
    },
    uMaskScale: { value: new THREE.Vector2().fromArray(material.mask.uvScale) },
    uMaskPan: { value: new THREE.Vector2().fromArray(material.mask.uvPan) },
    uMaskRot: { value: material.mask.rotation },
    uNoise: { value: noise },
    uHasNoise: { value: noise ? 1 : 0 },
    uNoiseScale: {
      value: new THREE.Vector2().fromArray(material.noise?.uvScale ?? [1, 1]),
    },
    uNoisePan: {
      value: new THREE.Vector2().fromArray(material.noise?.uvPan ?? [0, 0]),
    },
    uDistortPan: {
      value: new THREE.Vector2().fromArray(
        material.noise?.distortionPan ?? [0, 0],
      ),
    },
    uDistort: { value: material.noise?.distortion ?? 0 },
    uUseErosion: { value: material.erosion ? 1 : 0 },
    uErodeSoft: { value: material.erosion?.softness ?? 0.1 },
    uEdgeW: { value: material.erosion?.edgeWidth ?? 0 },
    uEdgeCol: {
      value: new THREE.Color(material.erosion?.edgeColor ?? "#ffffff"),
    },
    uEdgeI: { value: material.erosion?.edgeIntensity ?? 0 },
    uOpacity: { value: material.opacity },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
    uProcedural: { value: proceduralIndex(material) },
    tDepth: { value: depth },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: CAMERA_NEAR },
    uFar: { value: CAMERA_FAR },
    uSoft: { value: material.softParticle },
    ...rampUniforms(material.ramp),
    ...curveUniforms("A", emitter.render.sizeCurve),
    ...curveUniforms("B", emitter.render.alphaCurve),
    ...curveUniforms("C", material.erosion?.curve ?? null),
    ...curveUniforms("D", emitter.render.alphaAlongSpawn),
    ...curveUniforms("E", emitter.forces.curl?.envelope ?? null),
    ...curveUniforms("G", trail?.widthCurve ?? null),
  };

  const shaderMaterial = createV2NodeMaterial(
    parentEmitter ? "subParticle" : "particle",
    uniforms,
    {
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Velocity-aligned quads flip winding; both faces must draw.
      side: THREE.DoubleSide,
      ...blendingFor(material.blend),
    },
  );

  const mesh = new THREE.Mesh(geometry, shaderMaterial);
  mesh.name = layer.id;
  mesh.frustumCulled = false;
  mesh.renderOrder = index;

  // The ribbon is a second instanced draw over the same instance attributes:
  // one strip per particle, each vertex evaluating the same closed-form
  // position at age - k*spacing.
  const group = new THREE.Group();
  group.name = layer.id;
  group.add(mesh);
  let trailMaterial: V2NodeMaterial | null = null;
  let trailGeometry: THREE.InstancedBufferGeometry | null = null;
  if (trail) {
    const strip = trailStripGeometry(trail.segments);
    trailGeometry = new THREE.InstancedBufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(strip.positions, 3),
    );
    trailGeometry.setIndex(strip.indices);
    trailGeometry.setAttribute("aSeed", seedAttr);
    trailGeometry.setAttribute("aExtra", extraAttr);
    trailGeometry.setAttribute("aExtra2", extra2Attr);
    if (parentAttributes.length) {
      trailGeometry.setAttribute("aPSeed", parentAttributes[0]);
      trailGeometry.setAttribute("aPExtra", parentAttributes[1]);
      trailGeometry.setAttribute("aPExtra2", parentAttributes[2]);
    }
    trailGeometry.instanceCount = count;
    trailMaterial = createV2NodeMaterial(
      parentEmitter ? "subTrail" : "trail",
      uniforms,
      {
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        ...blendingFor(material.blend),
      },
    );
    const ribbon = new THREE.Mesh(trailGeometry, trailMaterial);
    ribbon.name = `${layer.id}-trail`;
    ribbon.frustumCulled = false;
    ribbon.renderOrder = index;
    group.add(ribbon);
  }

  const sortable =
    emitter.render.sortMode === "byDistance" &&
    count <= SORT_LIMIT &&
    material.blend !== "additive";
  const order = Array.from({ length: count }, (_, i) => i);
  const depths = new Float32Array(count);
  const scratch = new THREE.Vector3();

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: material.softParticle > 0,
    trim: true,
    update(time, flags, camera) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const e = live.emitter!;
      const m = live.material!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);

      if (parentLayer) {
        // Where the parent layer's transform was, sampled over its own live
        // window, relative to where this layer is now: the sub-emitter's
        // origins ride the parent's motion instead of this layer's.
        const table = uniforms.uParentPath.value as THREE.Vector3[];
        const dt = uniforms.uPathDt.value as number;
        for (let i = 0; i < CURVE_KEYS; i++) {
          const local = i * dt;
          const at = evaluateLayerV2(parentLayer, parentLayer.start + local);
          table[i]
            .fromArray(at.layer.transform.position)
            .sub(group.position);
        }
      }

      uniforms.uTime.value = age;
      uniforms.uShapeLength.value = e.shape.length;
      uniforms.uShapeRadius.value = e.shape.radius;
      uniforms.uShapeInner.value = e.shape.innerRadius;
      uniforms.uShapeAngle.value = e.shape.angle;
      (uniforms.uAxis.value as THREE.Vector3).fromArray(e.shape.axis);
      (uniforms.uBias.value as THREE.Vector3).fromArray(e.shape.bias);
      (uniforms.uDir.value as THREE.Vector3).fromArray(e.velocity.direction);
      uniforms.uAngle.value = e.velocity.angle;
      (uniforms.uSpeed.value as THREE.Vector2).fromArray(e.velocity.speed);
      (uniforms.uLife.value as THREE.Vector2).fromArray(e.life);
      (uniforms.uGravity.value as THREE.Vector3).fromArray(e.forces.gravity);
      uniforms.uDrag.value = e.forces.drag;
      (uniforms.uWind.value as THREE.Vector3).fromArray(e.forces.wind);
      uniforms.uCurl.value = flags.curl ? (e.forces.curl?.strength ?? 0) : 0;
      uniforms.uCurlFreq.value = e.forces.curl?.frequency ?? 1;
      uniforms.uCurlSpeed.value = e.forces.curl?.speed ?? 1;
      uniforms.uStretch.value = e.render.stretch;
      (uniforms.uSize.value as THREE.Vector2).fromArray(e.render.size);
      (uniforms.uRot.value as THREE.Vector2).fromArray(e.render.rotation.speed);
      uniforms.uOpacity.value = m.opacity;
      uniforms.uSoft.value = flags.softParticles ? m.softParticle : 0;
      uniforms.uDistort.value = flags.textures ? (m.noise?.distortion ?? 0) : 0;
      uniforms.uHasMask.value = flags.textures && mask ? 1 : 0;
      uniforms.uHasNoise.value = flags.textures && noise ? 1 : 0;
      // Re-read every UV uniform from the live material: a track on
      // mask.uvPan, mask.rotation or noise.distortionPan has to move.
      (uniforms.uMaskScale.value as THREE.Vector2).fromArray(m.mask.uvScale);
      (uniforms.uMaskPan.value as THREE.Vector2).fromArray(m.mask.uvPan);
      uniforms.uMaskRot.value = m.mask.rotation;
      (uniforms.uNoiseScale.value as THREE.Vector2).fromArray(
        m.noise?.uvScale ?? [1, 1],
      );
      (uniforms.uNoisePan.value as THREE.Vector2).fromArray(
        m.noise?.uvPan ?? [0, 0],
      );
      (uniforms.uDistortPan.value as THREE.Vector2).fromArray(
        m.noise?.distortionPan ?? [0, 0],
      );
      uniforms.uProcedural.value = proceduralIndex(m);
      uniforms.uUseErosion.value = flags.erosion && m.erosion ? 1 : 0;
      uniforms.uErodeSoft.value = m.erosion?.softness ?? 0.1;
      uniforms.uEdgeW.value = m.erosion?.edgeWidth ?? 0;
      uniforms.uEdgeI.value = m.erosion?.edgeIntensity ?? 0;
      (uniforms.uEdgeCol.value as THREE.Color).set(
        m.erosion?.edgeColor ?? "#ffffff",
      );
      writeRamp(uniforms, m.ramp);
      writeCurve(uniforms, "A", e.render.sizeCurve);
      writeCurve(uniforms, "B", e.render.alphaCurve);
      writeCurve(uniforms, "C", m.erosion?.curve ?? null);
      writeCurve(uniforms, "D", e.render.alphaAlongSpawn);
      writeCurve(uniforms, "E", e.forces.curl?.envelope ?? null);
      writeCurve(uniforms, "G", e.trail?.widthCurve ?? null);
      if (e.trail) {
        uniforms.uSegments.value = e.trail.segments;
        uniforms.uSpacing.value = e.trail.spacing;
      }
      uniforms.uVortexW.value = e.forces.vortex?.strength ?? 0;
      uniforms.uVortexFalloff.value = e.forces.vortex?.falloff ?? 0;
      (uniforms.uVortexAxis.value as THREE.Vector3).fromArray(
        e.forces.vortex?.axis ?? [0, 1, 0],
      );

      if (!sortable) return;
      // Alpha-blended sprites need a back-to-front draw order; reordering the
      // instance attributes is deterministic in (doc, time).
      const view = camera.getWorldDirection(scratch).clone();
      const point = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        depths[i] = particlePositionV2(
          e,
          attrs,
          i,
          age,
          period,
          spawnWindowOf(e, period),
          point,
        )
          ? point.dot(view)
          : -Infinity;
      }
      order.sort((a, b) => depths[a] - depths[b]);
      const s = seedAttr.array as Float32Array;
      const x = extraAttr.array as Float32Array;
      const x2 = extra2Attr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const from = order[i] * 4;
        for (let k = 0; k < 4; k++) {
          s[i * 4 + k] = attrs.seed[from + k];
          x[i * 4 + k] = attrs.extra[from + k];
          x2[i * 4 + k] = attrs.extra2[from + k];
        }
      }
      seedAttr.needsUpdate = true;
      extraAttr.needsUpdate = true;
      extra2Attr.needsUpdate = true;
    },
    bounds(time, push) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      const e = live.emitter!;
      const window = spawnWindowOf(e, period);
      // Half the largest quad: the billboard is centred on the particle.
      const margin = e.render.size[1] * 0.5;
      const point = new THREE.Vector3();
      const stride = Math.max(1, Math.floor(count / 96));
      for (let i = 0; i < count; i += stride) {
        if (!particlePositionV2(e, attrs, i, age, period, window, point))
          continue;
        point.applyMatrix4(matrix);
        push(point.clone().addScalar(margin));
        push(point.clone().addScalar(-margin));
      }
      if (!parentEmitter || !parentAttrs || !parentLayer) return;
      // Sub-emitter children live around the parent's path, not around this
      // layer's origin, so the parent's own sample points claim the room.
      const parentPeriod = spawnPeriod(parentEmitter, doc.duration);
      const parentWindow = spawnWindowOf(parentEmitter, parentPeriod);
      const reach =
        Math.abs(e.velocity.speed[1]) * e.life[1] + e.render.size[1] * 0.5;
      const parentStride = Math.max(1, Math.floor(parentAttrs.count / 48));
      for (let i = 0; i < parentAttrs.count; i += parentStride) {
        if (
          !particlePositionV2(
            parentEmitter,
            parentAttrs,
            i,
            time - parentLayer.start,
            parentPeriod,
            parentWindow,
            point,
          )
        )
          continue;
        point.applyMatrix4(matrix);
        push(point.clone().addScalar(reach));
        push(point.clone().addScalar(-reach));
      }
    },
    dispose() {
      geometry.dispose();
      shaderMaterial.dispose();
      trailGeometry?.dispose();
      trailMaterial?.dispose();
    },
  };
}

/**
 * Geometry types the analytic teardrop (uShell=1 in surfaceVertexV2) can act
 * as the parametric domain for. Anything else a `shell` layer asks for -- a
 * crystal, a cone, a plane, a torus, a bar -- is an explicit request for that
 * shape and falls through to the ordinary surface path (fresnel, surface-space
 * ramp along local +Z, erosion) instead of silently becoming a blob.
 */
const SHELL_VOLUME_TYPES = new Set(["auto", "sphere", "teardrop"]);

/** True when this layer draws the analytic teardrop rather than a real mesh. */
function isShellSurface(layer: LayerV2) {
  const geometry = layer.geometry!;
  if (geometry.type === "lightning" && geometry.lightning) return false;
  return layer.kind === "shell" && SHELL_VOLUME_TYPES.has(geometry.type);
}

/** Bar-shaped kinds: their mesh is a unit shape scaled by length/radius. */
const BAR_KINDS = new Set(["beam", "trail"]);

/** Sample a piecewise-linear curve at u; used for the trail's width taper. */
function curveAt(curve: Curve | null | undefined, u: number) {
  if (!curve) return 1;
  const keys = curve.keys;
  const x = clamp01(u);
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x <= keys[i][0]) {
      let f =
        (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-5);
      if (curve.ease === "smooth") f = f * f * (3 - 2 * f);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
}

/**
 * A unit bar along local +Z: z runs 0 (the emitter end) to 1 (the far tip),
 * half-width 1 across. uv.y is the position along the bar, so a "surface" ramp
 * and a UV-panned noise erosion both flow along the length, and uv.x crosses
 * it. `tube` sweeps a real open cylinder; otherwise two crossed sheets give the
 * bar volume from any camera angle without a closed surface's silhouette.
 */
function unitBarGeometry(
  segments: number,
  radialSegments: number,
  tube: boolean,
  taper: (t: number) => number,
) {
  const rows = Math.max(2, Math.min(128, segments));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sheets: [number, number][][] = tube
    ? [
        Array.from(
          { length: Math.max(3, Math.min(48, radialSegments)) + 1 },
          (_, j) => {
            const a =
              (j / Math.max(3, Math.min(48, radialSegments))) * Math.PI * 2;
            return [Math.cos(a), Math.sin(a)] as [number, number];
          },
        ),
      ]
    : [
        [
          [-1, 0],
          [1, 0],
        ],
        [
          [0, -1],
          [0, 1],
        ],
      ];
  for (const ring of sheets) {
    const base = positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const w = Math.max(1e-4, taper(t));
      for (let j = 0; j < ring.length; j++) {
        positions.push(ring[j][0] * w, ring[j][1] * w, t);
        uvs.push(ring.length > 2 ? j / (ring.length - 1) : j, t);
        if (i < rows && j < ring.length - 1) {
          const k = base + i * ring.length + j;
          indices.push(
            k,
            k + 1,
            k + ring.length,
            k + 1,
            k + ring.length + 1,
            k + ring.length,
          );
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * A unit strip carrying (u along the arc, side, 0) in `position`; the arc
 * itself is swept in surfaceVertexV2 from uRadius/uArc/uThickness, so a track
 * on any of them re-sweeps it without rebuilding the mesh.
 */
function ribbonStripGeometry(segments: number) {
  const rows = Math.max(4, Math.min(256, segments));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    for (const side of [-1, 1]) {
      positions.push(u, side, 0);
      uvs.push(u, (side + 1) / 2);
    }
    if (i < rows) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** True when this layer sweeps the analytic arc ribbon rather than a bar. */
function isArcRibbon(layer: LayerV2) {
  return (
    layer.geometry!.type === "ribbon" &&
    (layer.kind === "trail" || layer.kind === "ring")
  );
}

function meshGeometryFor(layer: LayerV2, seed = 0) {
  const geometry = layer.geometry!;
  const shell = isShellSurface(layer);
  if (geometry.type === "lightning" && geometry.lightning)
    return buildLightningGeometry(geometry, seed, 0);
  if (isArcRibbon(layer)) return ribbonStripGeometry(geometry.segments);
  if (shell)
    // The shell's teardrop is analytic (see surfaceVertexV2): the sphere is the
    // parametric domain, not the silhouette.
    return new THREE.SphereGeometry(
      1,
      Math.min(128, geometry.segments),
      Math.min(64, geometry.radialSegments),
    );
  if (BAR_KINDS.has(layer.kind)) {
    // A beam is a straight bar of `length` along +Z, half-width `radius`; a
    // trail is the same bar narrowing toward its far end. Both are unit-sized
    // here and scaled per frame, so a track on geometry.length extends them.
    const width = geometry.lightning?.widthCurve ?? null;
    const taper =
      layer.kind === "trail"
        ? width
          ? (t: number) => Math.max(0.02, curveAt(width, t))
          : (t: number) => Math.max(0.08, Math.pow(1 - t, 0.6))
        : width
          ? (t: number) => Math.max(0.02, curveAt(width, t))
          : () => 1;
    return unitBarGeometry(
      geometry.segments,
      geometry.radialSegments,
      geometry.type === "cylinder",
      taper,
    );
  }
  if (layer.kind === "sprite")
    // A square of half-size `radius`; scaled per frame and turned to face the
    // camera in the vertex shader.
    return new THREE.PlaneGeometry(2, 2);
  if (
    layer.kind === "decal" &&
    (geometry.type === "plane" || geometry.type === "auto")
  )
    // Flat dressing in local XY, scaled per frame to radius x length/2.
    return new THREE.PlaneGeometry(2, 2);
  // Flat carriers are unit-sized and scaled per frame, so a track on
  // geometry.radius or geometry.length really resizes them.
  if (geometry.type === "plane" || geometry.type === "auto")
    return new THREE.PlaneGeometry(2, 2);
  if (geometry.type === "disc") return new THREE.CircleGeometry(1, 48);
  if (geometry.type === "torus")
    return new THREE.TorusGeometry(
      geometry.radius,
      Math.min(geometry.thickness, geometry.radius * 0.98),
      Math.max(6, Math.min(24, geometry.radialSegments)),
      Math.max(12, Math.min(96, geometry.segments)),
    );
  // Everything else is a real mesh from the shared library. Those are authored
  // Y-up around the origin; the v2 axis convention is local +Z forward, so the
  // shape is turned once at build time and then scaled by radius/length.
  const built = buildGeometry(
    {
      id: layer.id,
      kind: layer.kind === "decal" ? "decal" : "shell",
      surface: "default",
      geometry: geometry.type,
      params: {
        count: 32,
        width: geometry.thickness,
        radius: geometry.radius,
        length: geometry.length,
        arc: Math.PI * 2,
        turbulence: geometry.vertexNoise?.amplitude ?? 0,
        position: layer.transform.position,
      },
    } as Parameters<typeof buildGeometry>[0],
    0,
  );
  built.rotateX(Math.PI / 2);
  return built;
}

function createMeshLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
  textures: TextureCacheV2,
): LayerObject {
  const material = layer.material!;
  const geometry = layer.geometry!;
  const shell = isShellSurface(layer);
  const mask = textures.resolve(material.mask.textureId, doc, false);
  const noise = textures.resolve(material.noise?.textureId ?? null, doc, true);
  const vertexNoise = geometry.vertexNoise;
  const rampSpace =
    material.ramp.space === "surface"
      ? 2
      : material.ramp.space === "layerTime"
        ? 1
        : 0;

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uLayerU: { value: 0 },
    uRampKeyMode: { value: rampSpace },
    uShell: { value: shell ? 1 : 0 },
    uBolt: {
      value: geometry.type === "lightning" && geometry.lightning ? 1 : 0,
    },
    uRibbon: { value: isArcRibbon(layer) ? 1 : 0 },
    uLength: { value: geometry.length },
    uRadius: { value: geometry.radius },
    uThickness: { value: geometry.thickness },
    uArc: { value: geometry.length },
    uUseLocalZ: { value: 0 },
    uZRange: { value: new THREE.Vector2(0, 1) },
    uHasVertexNoise: { value: vertexNoise ? 1 : 0 },
    uVertexAmp: { value: vertexNoise?.amplitude ?? 0 },
    uVertexFreq: { value: vertexNoise?.frequency ?? 1 },
    uVertexSpeed: { value: vertexNoise?.speed ?? 0 },
    uVertexBias: {
      value: new THREE.Vector3().fromArray(vertexNoise?.bias ?? [0, 1, 0]),
    },
    uDisplaceShift: { value: material.ramp.displacementShift },
    uMask: { value: mask },
    uHasMask: { value: mask ? 1 : 0 },
    uMaskScale: { value: new THREE.Vector2().fromArray(material.mask.uvScale) },
    uMaskPan: { value: new THREE.Vector2().fromArray(material.mask.uvPan) },
    uMaskRot: { value: material.mask.rotation },
    uNoise: { value: noise },
    uHasNoise: { value: noise ? 1 : 0 },
    uNoiseScale: {
      value: new THREE.Vector2().fromArray(material.noise?.uvScale ?? [1, 1]),
    },
    uNoisePan: {
      value: new THREE.Vector2().fromArray(material.noise?.uvPan ?? [0, 0]),
    },
    uDistortPan: {
      value: new THREE.Vector2().fromArray(
        material.noise?.distortionPan ?? [0, 0],
      ),
    },
    uDistort: { value: material.noise?.distortion ?? 0 },
    uUseErosion: { value: material.erosion ? 1 : 0 },
    uErodeSoft: { value: material.erosion?.softness ?? 0.1 },
    uEdgeW: { value: material.erosion?.edgeWidth ?? 0 },
    uEdgeCol: {
      value: new THREE.Color(material.erosion?.edgeColor ?? "#ffffff"),
    },
    uEdgeI: { value: material.erosion?.edgeIntensity ?? 0 },
    uProtect: { value: material.erosion?.displacementProtect ?? 0 },
    uRimBias: { value: material.erosion?.rimBias ?? 0 },
    uBillboard: { value: layer.kind === "sprite" ? 1 : 0 },
    uRoll: { value: 0 },
    uHasFresnel: { value: material.fresnel ? 1 : 0 },
    uFresnelPower: { value: material.fresnel?.power ?? 2 },
    uFresnelStrength: { value: material.fresnel?.strength ?? 0 },
    uOpacity: { value: material.opacity },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
    uProcedural: { value: proceduralIndex(material) },
    uCam: { value: new THREE.Vector3() },
    ...rampUniforms(material.ramp),
    ...curveUniforms("C", material.erosion?.curve ?? null),
    ...curveUniforms("F", vertexNoise?.alongCurve ?? null),
  };

  const shaderMaterial = createV2NodeMaterial("surface", uniforms, {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const boltSeed = hashSeed(doc.seed, layer.id);
  const bolt =
    geometry.type === "lightning" && geometry.lightning ? geometry : null;
  /**
   * The factor that turns the unit mesh into the authored size, read off the
   * *live* geometry every frame so a track on geometry.length or
   * geometry.radius animates the shape. See the table at the top of the file.
   */
  const ribbon = isArcRibbon(layer);
  const flatCard =
    geometry.type === "plane" ||
    geometry.type === "auto" ||
    geometry.type === "disc";
  const sizeOf = (g: typeof geometry, out: THREE.Vector3) => {
    // The arc ribbon, the analytic shell and the bolt build themselves from the
    // live uniforms, so only transform.scale applies on top of them.
    if (ribbon || shell || bolt) return out.set(1, 1, 1);
    if (BAR_KINDS.has(layer.kind)) return out.set(g.radius, g.radius, g.length);
    if (layer.kind === "sprite") return out.set(g.radius, g.radius, 1);
    if (g.type === "disc") return out.set(g.radius, g.radius, 1);
    if (flatCard) return out.set(g.radius, g.length * 0.5, 1);
    if (g.type === "torus") return out.set(1, 1, 1);
    // A library mesh, turned to run along local +Z: radius across, length along.
    return out.set(g.radius, g.radius, g.length * 0.5);
  };
  /** A ring's torus is baked, so a tracked radius/thickness has to rebuild it. */
  const ringTorus = layer.kind === "ring" && geometry.type === "torus";
  let ringKey = `${geometry.radius.toFixed(3)}:${geometry.thickness.toFixed(3)}`;
  const size = new THREE.Vector3();
  const scratchScale = new THREE.Vector3();
  const mesh = new THREE.Mesh(meshGeometryFor(layer, boltSeed), shaderMaterial);
  // A mesh whose extent really runs along local +Z keys its surface ramp and
  // erosion on that axis instead of on uv.y; a flat card or an arc cannot.
  if (!shell && !ribbon && !bolt && !flatCard) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    const span = box.getSize(new THREE.Vector3());
    if (span.z > 1e-3 && span.z >= Math.max(span.x, span.y) * 0.35) {
      uniforms.uUseLocalZ.value = 1;
      (uniforms.uZRange.value as THREE.Vector2).set(box.min.z, box.max.z);
    }
  }
  mesh.name = layer.id;
  mesh.frustumCulled = false;
  mesh.renderOrder = index;
  // The bolt re-shapes STRIKE_HZ times a second. The strike index is a pure
  // function of layer time, so rebuilding on a change keeps seek == play.
  let strike = 0;

  return {
    id: layer.id,
    source: layer,
    object: mesh,
    soft: false,
    trim: false,
    update(time, flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const g = live.geometry!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale).multiply(sizeOf(g, size));
      if (layer.kind === "sprite") {
        // The quad is rebuilt around the camera axes in the vertex shader, so
        // the transform's own orientation would double up; only the roll
        // (rotation[2]) survives, as a spin in screen space.
        uniforms.uRoll.value = live.transform.rotation[2];
        mesh.rotation.set(0, 0, 0);
      }
      uniforms.uTime.value = age;
      uniforms.uLayerU.value = u;
      uniforms.uLength.value = g.length;
      uniforms.uRadius.value = g.radius;
      uniforms.uThickness.value = g.thickness;
      uniforms.uArc.value = g.length;
      if (ringTorus) {
        const next = `${g.radius.toFixed(3)}:${g.thickness.toFixed(3)}`;
        if (next !== ringKey) {
          ringKey = next;
          mesh.geometry.dispose();
          mesh.geometry = meshGeometryFor({ ...layer, geometry: g }, boltSeed);
        }
      }
      if (bolt && g.lightning) {
        const next = Math.max(0, Math.floor(age * STRIKE_HZ));
        if (next !== strike || mesh.geometry.userData.bolt !== true) {
          strike = next;
          mesh.geometry.dispose();
          mesh.geometry = buildLightningGeometry(g, boltSeed, strike);
          mesh.geometry.userData.bolt = true;
        }
      }
      uniforms.uVertexAmp.value = flags.textures
        ? (g.vertexNoise?.amplitude ?? 0)
        : 0;
      uniforms.uVertexFreq.value = g.vertexNoise?.frequency ?? 1;
      uniforms.uVertexSpeed.value = g.vertexNoise?.speed ?? 0;
      uniforms.uHasVertexNoise.value = g.vertexNoise ? 1 : 0;
      uniforms.uOpacity.value = m.opacity;
      uniforms.uDisplaceShift.value = m.ramp.displacementShift;
      uniforms.uHasMask.value = flags.textures && mask ? 1 : 0;
      uniforms.uHasNoise.value = flags.textures && noise ? 1 : 0;
      // Every UV uniform is re-read from the live material, so a track on
      // mask.uvPan or noise.distortionPan actually scrolls the surface.
      (uniforms.uMaskScale.value as THREE.Vector2).fromArray(m.mask.uvScale);
      (uniforms.uMaskPan.value as THREE.Vector2).fromArray(m.mask.uvPan);
      uniforms.uMaskRot.value = m.mask.rotation;
      (uniforms.uNoiseScale.value as THREE.Vector2).fromArray(
        m.noise?.uvScale ?? [1, 1],
      );
      (uniforms.uNoisePan.value as THREE.Vector2).fromArray(
        m.noise?.uvPan ?? [0, 0],
      );
      (uniforms.uDistortPan.value as THREE.Vector2).fromArray(
        m.noise?.distortionPan ?? [0, 0],
      );
      uniforms.uDistort.value = flags.textures ? (m.noise?.distortion ?? 0) : 0;
      uniforms.uProcedural.value = proceduralIndex(m);
      uniforms.uHasFresnel.value = m.fresnel ? 1 : 0;
      uniforms.uFresnelPower.value = m.fresnel?.power ?? 2;
      uniforms.uFresnelStrength.value = m.fresnel?.strength ?? 0;
      uniforms.uUseErosion.value = flags.erosion && m.erosion ? 1 : 0;
      uniforms.uErodeSoft.value = m.erosion?.softness ?? 0.1;
      uniforms.uEdgeW.value = m.erosion?.edgeWidth ?? 0;
      (uniforms.uEdgeCol.value as THREE.Color).set(
        m.erosion?.edgeColor ?? "#ffffff",
      );
      uniforms.uEdgeI.value = m.erosion?.edgeIntensity ?? 0;
      uniforms.uProtect.value = m.erosion?.displacementProtect ?? 0;
      uniforms.uRimBias.value = m.erosion?.rimBias ?? 0;
      uniforms.uRampKeyMode.value =
        m.ramp.space === "surface" ? 2 : m.ramp.space === "layerTime" ? 1 : 0;
      (uniforms.uCam.value as THREE.Vector3).copy(camera.position);
      writeRamp(uniforms, m.ramp);
      writeCurve(uniforms, "C", m.erosion?.curve ?? null);
      writeCurve(uniforms, "F", g.vertexNoise?.alongCurve ?? null);
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const g = live.geometry!;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        scratchScale
          .fromArray(live.transform.scale)
          .multiply(sizeOf(g, size))
          .clone(),
      );
      const point = new THREE.Vector3();
      if (bolt) {
        // Strike-independent: the envelope every strike of this bolt fits in.
        for (const p of lightningBounds(g, boltSeed))
          push(p.applyMatrix4(matrix));
        return;
      }
      if (ringTorus) {
        // The baked torus is only ever at one radius; the framing pass needs
        // the widest the tracked radius gets, so measure it from the live
        // values instead of the mesh.
        const r = g.radius + g.thickness;
        for (const x of [-r, r])
          for (const y of [-r, r])
            for (const z of [-g.thickness, g.thickness])
              push(point.set(x, y, z).applyMatrix4(matrix).clone());
        return;
      }
      if (ribbon) {
        // Only the swept arc, not the full circle: a 90-degree swoosh must not
        // claim the four quadrants it never reaches.
        const scale = new THREE.Vector3().fromArray(live.transform.scale);
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(live.transform.position),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...live.transform.rotation),
          ),
          scale,
        );
        for (let step = 0; step <= 24; step++) {
          const u = step / 24;
          const a = u * g.length;
          const w = g.thickness * Math.pow(Math.sin(Math.PI * u), 0.6);
          for (const side of [-1, 1]) {
            const r = g.radius + side * w;
            push(
              point
                .set(
                  Math.cos(a) * r,
                  Math.sin(a) * r,
                  0.12 * g.radius * Math.sin(a * 2),
                )
                .applyMatrix4(local)
                .clone(),
            );
          }
        }
        return;
      }
      if (shell) {
        // Envelope of the analytic teardrop, sampled along its axis: a plain
        // box around the whole sphere would claim the empty corners above the
        // head and push the camera a third of the way out of the scene.
        const head = new THREE.Vector3().fromArray(live.transform.position);
        const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...live.transform.rotation),
          ),
        );
        const t1 = orthoOf(axis, new THREE.Vector3());
        const t2 = new THREE.Vector3().crossVectors(axis, t1);
        const bias = new THREE.Vector3()
          .fromArray(g.vertexNoise?.bias ?? [0, 1, 0])
          .normalize();
        const amplitude = g.vertexNoise?.amplitude ?? 0;
        const alongCurve = g.vertexNoise?.alongCurve ?? null;
        // transform.scale shapes the analytic body in the vertex shader, so the
        // envelope has to carry the same factors.
        const s = live.transform.scale;
        const sAxis = Math.abs(s[2]);
        const sRad = (Math.abs(s[0]) + Math.abs(s[1])) * 0.5;
        const length_ = g.length * sAxis;
        const radius_ = g.radius * sRad;
        for (let step = 0; step <= 10; step++) {
          const a = step / 10;
          const len = length_ * (a < 0.5 ? a * 0.9 : 0.45 + (a - 0.5) * 1.1);
          const taper = a * 2 - 1;
          const r =
            radius_ *
            (1.05 * Math.sqrt(Math.max(0, 1 - taper * taper)) * (1 - a * 0.45) +
              0.06);
          let envelope = 1;
          if (alongCurve) {
            const keys = alongCurve.keys;
            envelope = keys[keys.length - 1][1];
            for (let i = 1; i < keys.length; i++)
              if (a <= keys[i][0]) {
                const f =
                  (a - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0] || 1);
                envelope = keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
                break;
              }
          }
          // |fbm| and the lobe noise both stay well under 1, and the lick is
          // gated the same way the vertex shader gates it.
          const radius = r + 0.55 * amplitude * envelope * radius_ * 2.4;
          const gate = Math.min(1, Math.max(0, (a - 0.35) / 0.45));
          const lick =
            radius_ * amplitude * 6.2 * 0.6 * gate * gate * (3 - 2 * gate);
          const lift = length_ * 0.236 * a ** 2.3 + lick;
          const center = head
            .clone()
            .addScaledVector(axis, len)
            .addScaledVector(bias, lift);
          for (const su of [-1, 1])
            for (const sv of [-1, 1])
              push(
                point
                  .copy(center)
                  .addScaledVector(t1, su * radius)
                  .addScaledVector(t2, sv * radius)
                  .clone(),
              );
        }
      } else {
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              push(point.set(x, y, z).applyMatrix4(matrix).clone());
      }
    },
    dispose() {
      mesh.geometry.dispose();
      shaderMaterial.dispose();
    },
  };
}

/**
 * Where a particle layer *emits*, not where its particles end up: the spawn
 * shape around the layer origin, plus half the largest billboard. Framing on
 * the emission region is what keeps a long debris arc or a drifting smoke
 * column from pulling the camera back to the horizon.
 */
function spawnBoundsV2(
  layer: LayerV2,
  time: number,
  push: (p: THREE.Vector3) => void,
) {
  const { layer: live, visible } = evaluateLayerV2(layer, time);
  if (!visible) return;
  const emitter = live.emitter!;
  const shape = emitter.shape;
  const extent = new THREE.Vector3();
  // A "line" spawns from the origin *along* +axis for `length`, never behind
  // it, so its box is one-sided; `lean` carries that asymmetry.
  const lean = new THREE.Vector3();
  if (shape.type === "box") {
    extent.set(shape.size[0] * 0.5, shape.size[1] * 0.5, shape.size[2] * 0.5);
  } else if (shape.type !== "point") {
    const lateral =
      shape.radius +
      (shape.type === "cone"
        ? shape.length * Math.tan(Math.min(shape.angle, 1.5))
        : 0);
    extent.set(lateral, lateral, lateral);
    const axis = new THREE.Vector3().fromArray(shape.axis);
    if (axis.lengthSq() > 1e-10) {
      const reach = axis.clone().normalize().multiplyScalar(shape.length);
      if (shape.type === "line") lean.copy(reach);
      else
        extent.add(
          new THREE.Vector3(
            Math.abs(reach.x),
            Math.abs(reach.y),
            Math.abs(reach.z),
          ),
        );
    }
  }
  const margin = emitter.render.size[1] * 0.5;
  const center = new THREE.Vector3().fromArray(live.transform.position);
  const lo = center.clone().min(center.clone().add(lean));
  const hi = center.clone().max(center.clone().add(lean));
  push(hi.add(extent).addScalar(margin));
  push(lo.sub(extent).addScalar(-margin));
}

function createLightLayer(layer: LayerV2): LayerObject {
  const spec = layer.light!;
  const light = new THREE.PointLight(
    new THREE.Color(spec.color),
    0,
    spec.radius,
    spec.decay,
  );
  light.name = layer.id;
  return {
    id: layer.id,
    source: layer,
    object: light,
    soft: false,
    trim: false,
    update(time, flags) {
      const { layer: live, visible, u } = evaluateLayerV2(layer, time);
      // Keep the light layout stable across timeline edges. Removing a light
      // invalidates Three's render-object shader caches, including unlit VFX.
      light.visible = true;
      if (!visible || !flags.light) {
        light.intensity = 0;
        return;
      }
      const l = live.light!;
      light.position.fromArray(live.transform.position);
      light.color.set(l.color);
      light.distance = l.radius;
      light.decay = l.decay;
      const keys = l.intensity.keys;
      let value = keys[keys.length - 1][1];
      if (u <= keys[0][0]) value = keys[0][1];
      else
        for (let i = 1; i < keys.length; i++)
          if (u <= keys[i][0]) {
            let f = (u - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
            if (l.intensity.ease === "smooth") f = f * f * (3 - 2 * f);
            value = keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
            break;
          }
      light.intensity = Math.max(0, value);
    },
    bounds() {},
    dispose() {
      light.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class VfxRuntimeV2 {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    32,
    16 / 9,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  /**
   * Dev-gallery orbit/pan/zoom. Auto-framing (computeFraming/resetCamera)
   * sets the camera's position and this.controls.target directly; the
   * controls only take over from there when interactive. The deterministic
   * capture path (capture-v2.ts, the headless fixture harness) calls
   * setInteractive(false) so controls.update() is never invoked there and
   * captures stay byte-identical to a build without controls at all.
   */
  readonly controls: OrbitControls;
  private interactive = true;
  private readonly environment: EnvironmentV2;
  private post: PostStackV2;
  private postSamples = 4;
  private readonly textures = new TextureCacheV2();
  private readonly depthTarget: THREE.RenderTarget;
  private readonly group = new THREE.Group();
  private objects: LayerObject[] = [];
  private objectKeys = new Map<string, string>();
  private doc?: VfxDocumentV2;
  private flags: FeatureFlagsV2 = { ...DEFAULT_FLAGS };
  private frame = { center: new THREE.Vector3(), distance: 6 };
  /** Seeds the camera-shake noise; set from the document. */
  private shakeSeed = 1;
  private disposed = false;
  private initialized = false;
  private initialization: Promise<void>;
  private preparedPreviewDocument?: VfxDocumentV2;
  private lastPreviewRequest = { time: 0, solo: undefined as string | undefined };
  private deviceError: Error | null = null;
  private removeDeviceErrorListener?: () => void;
  private previewSample: { time: number; solo?: string; diagnostic: boolean } | null = null;
  private width = 1280;
  private height = 720;

  constructor(readonly host: HTMLElement, private readonly options: { preview?: boolean } = {}) {
    this.renderer = new THREE.WebGPURenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    // No silent WebGL fallback: evaluation must use the same WebGPU backend.
    this.initialization = Promise.resolve().then(async () => {
      if (!globalThis.navigator?.gpu)
        throw new Error(
          "WebGPU is unavailable. Use a supported browser in a secure context.",
        );
      await this.renderer.init();
      this.initialized = true;
      if (
        !(this.renderer.backend as unknown as { isWebGPUBackend?: boolean })
          .isWebGPUBackend
      ) {
        this.renderer.dispose();
        this.initialized = false;
        throw new Error(
          "WebGPU is unavailable. Use a WebGPU-capable browser with hardware acceleration.",
        );
      }
      if (this.disposed) {
        this.renderer.dispose();
        return;
      }
      // WebGPU validation errors are asynchronous and do not throw from render().
      // Surface them through the preview's existing error/retry state instead of
      // continuing to present a black canvas when a particle pipeline is rejected.
      const device = (this.renderer.backend as unknown as { device: GPUDevice }).device;
      const onGpuError = (event: GPUUncapturedErrorEvent) => {
        if (!this.disposed)
          this.deviceError = new Error(`WebGPU rendering failed: ${event.error.message}`);
      };
      device.addEventListener("uncapturederror", onGpuError);
      this.removeDeviceErrorListener = () => device.removeEventListener("uncapturederror", onGpuError);
    });
    // Report through whenReady()/render(), including callers that mount then unmount.
    void this.initialization.catch((error) => {
      this.deviceError =
        error instanceof Error ? error : new Error(String(error));
    });
    this.renderer.onDeviceLost = () => {
      this.deviceError = new Error(
        "The WebGPU device disconnected. Reload the scene.",
      );
    };
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(
      Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2),
    );
    // `resize()` calls setSize(w, h, false), which sizes the drawing buffer but
    // deliberately leaves the canvas' inline style alone. Without a CSS size the
    // canvas lays out at its buffer size in CSS pixels — devicePixelRatio times
    // too large on a retina display, so the effect ends up zoomed and pushed
    // out of the bottom-right of the host. `webgpu-canvas` (the class the v1
    // runtime uses) pins it to width/height 100% of the host.
    this.renderer.domElement.className = "webgpu-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Generated VFX preview",
    );
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;
    this.scene.add(this.group);
    this.environment = createEnvironment(this.scene);
    this.depthTarget = new THREE.RenderTarget(1, 1, {
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
      depthBuffer: true,
    });
    this.post = createPostStack(
      this.renderer,
      this.scene,
      this.camera,
    );
    this.resize();
  }

  setFeatureFlags(flags: Partial<FeatureFlagsV2>) {
    this.previewSample = null;
    const aa = this.flags.aa;
    this.flags = { ...this.flags, ...flags };
    if (this.doc)
      this.environment.apply(this.doc, this.scene, this.flags.ground);
    if (aa !== this.flags.aa) this.rebuildPost();
  }

  /** Accepts a v2 document, or a v1 document which is upgraded on the way in. */
  setDocument(input: VfxDocumentV2 | VfxDocument, options: { preserveCamera?: boolean } = {}) {
    if (this.disposed) return;
    this.previewSample = null;
    const doc = isV2(input)
      ? (this.options.preview ? validateWorkspaceDocumentV2(input) : validateDocumentV2(input))
      : upgradeDocument(input as VfxDocument);
    const nextDoc = applyStyle(doc);
    const preserveCamera = options.preserveCamera && this.doc !== undefined;
    const previous = new Map(this.objects.map(object => [object.id, object]));
    // Validation returns fresh objects. Compare content once per edit, including
    // every document value captured by layer factories and sub-emitter parents.
    const sharedKey = JSON.stringify([nextDoc.seed, nextDoc.duration,
      nextDoc.quality.particleDensity, nextDoc.post.motionBlur, nextDoc.textures]);
    const keys = new Map<string, string>();
    const created: LayerObject[] = [];
    let nextObjects: LayerObject[];
    try {
      nextObjects = nextDoc.layers.filter(layer => layer.enabled).map((layer, index) => {
        const parent = layer.emitter?.sub
          ? nextDoc.layers.find(item => item.id === layer.emitter!.sub!.parentLayerId) : null;
        const key = JSON.stringify([sharedKey, index, layerBuildKey(layer), parent]);
        keys.set(layer.id, key);
        const existing = previous.get(layer.id);
        if (existing && this.objectKeys.get(layer.id) === key) return existing;
        const object = layer.kind === "light" ? createLightLayer(layer)
          : layer.kind === "particles"
            ? createParticleLayer(nextDoc, layer, index, this.textures, this.depthTarget.depthTexture!)
            : createMeshLayer(nextDoc, layer, index, this.textures);
        created.push(object);
        return object;
      });
    } catch (error) {
      for (const object of created) object.dispose();
      throw error;
    }
    const retained = new Set(nextObjects);
    for (const object of this.objects) {
      object.object.removeFromParent();
      if (!retained.has(object)) object.dispose();
    }
    // Factories close over source; keep that object identity and replace its live values.
    for (const object of nextObjects) {
      const updated = nextDoc.layers.find(layer => layer.id === object.id)!;
      Object.assign(object.source, updated);
    }
    this.objects = nextObjects;
    this.objectKeys = keys;
    this.doc = nextDoc;
    if (preserveCamera && created.length === 0) this.preparedPreviewDocument = nextDoc;
    const lights = this.objects
      .filter((o) => o.source.kind === "light")
      .sort(
        (a, b) =>
          Math.max(...b.source.light!.intensity.keys.map((k) => k[1])) -
          Math.max(...a.source.light!.intensity.keys.map((k) => k[1])),
      );
    for (const object of this.objects) {
      if (
        object.source.kind === "light" &&
        lights.indexOf(object) >= MAX_LIGHTS
      )
        continue;
      this.group.add(object.object);
    }
    this.environment.apply(this.doc, this.scene, this.flags.ground);
    this.renderer.toneMappingExposure = this.doc.post.exposure;
    this.shakeSeed = hashSeed(this.doc.seed, "camera-shake");
    this.camera.fov = this.doc.camera.fov;
    this.rebuildPost();
    // Existing edits keep the authored view and avoid whole-duration bounds
    // sampling. Focus/resize recomputes bounds when framing is actually needed.
    if (!preserveCamera) this.resize(this.width, this.height);
    else {
      this.camera.updateProjectionMatrix();
      this.updateResolutionUniforms();
    }
  }

  /** Previews prepare delayed emitters before playback reaches their bars. */
  async whenReady() {
    await Promise.all([this.initialization, this.textures.whenReady()]);
    if (this.disposed) return;
    if (this.deviceError) throw this.deviceError;
    if (this.options.preview && this.doc && this.preparedPreviewDocument !== this.doc) {
      this.warmPreview();
      this.preparedPreviewDocument = this.doc;
    }
    this.previewSample = null;
  }

  private warmPreview() {
    this.advanceFrame();
    const size = this.renderer.getSize(new THREE.Vector2());
    const target = this.renderer.getRenderTarget();
    try {
      // r186 compileAsync uses a top-level render context; the nested scene
      // pass has a different cache key. Warm the actual graph at a small size
      // so every delayed emitter is prepared in playback's render context.
      this.renderer.setSize(64, 64, false);
      for (const object of this.objects) {
        const layer = object.source;
        object.update(layer.start + (layer.end - layer.start) * 0.5, this.flags, this.camera);
        object.object.visible = layer.kind === "light";
      }
      if (this.flags.softParticles && this.objects.some(object => object.soft)) {
        this.renderer.setRenderTarget(this.depthTarget);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
      }
      this.renderer.setRenderTarget(null);
      for (const object of this.objects) object.object.visible = true;
      if (this.flags.post) this.post.render();
      else this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setSize(size.x, size.y, false);
      this.renderer.setRenderTarget(target);
      this.previewSample = null;
      // Restore the requested image in the same task, before the browser can
      // present the temporary all-emitter frame. No timeline time is advanced.
      this.renderPreview(this.lastPreviewRequest.time, this.lastPreviewRequest.solo);
    }
  }

  private rebuildPost() {
    const doc = this.doc;
    const samples = doc && doc.quality.aa !== "none" && this.flags.aa ? 4 : 0;
    if (samples !== this.postSamples) {
      this.postSamples = samples;
      this.post.dispose();
      this.post = createPostStack(this.renderer, this.scene, this.camera, samples);
    }
    if (doc) this.post.apply(doc, { post: this.flags.post, aa: this.flags.aa && !this.options.preview });
  }

  /**
   * Whole-duration bounds, computed once per document. Per-frame framing would
   * make the camera breathe with the effect.
   *
   * Hero-centric: the frame is set by what the effect *is*, not by how far its
   * debris travels. A mesh layer claims its whole extent, a decal claims half
   * of its (ground dressing, not subject) and a particle layer claims only the
   * region it emits from. Only when a document has no mesh layer at all does
   * the trimmed trajectory box take over, and the distance is clamped either
   * way so no single layer can push the camera out to the horizon.
   */
  private computeFraming() {
    const doc = this.doc;
    if (!doc) return;
    const dir = directionOf(doc.camera.azimuth, doc.camera.elevation);
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), dir)
      .normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const steps = 24;
    const boxOf = (
      sample: (time: number, push: (p: THREE.Vector3) => void) => void,
      trim: number,
    ) => {
      const axes: number[][] = [[], [], []];
      const push = (p: THREE.Vector3) => {
        axes[0].push(p.dot(right));
        axes[1].push(p.dot(up));
        axes[2].push(p.dot(dir));
      };
      for (let i = 0; i <= steps; i++) sample((doc.duration * i) / steps, push);
      if (!axes[0].length) return null;
      const lo = new THREE.Vector3();
      const hi = new THREE.Vector3();
      axes.forEach((values, axis) => {
        values.sort((a, b) => a - b);
        const cut = Math.floor(values.length * trim);
        lo.setComponent(axis, values[cut]);
        hi.setComponent(axis, values[values.length - 1 - cut]);
      });
      return { lo, hi };
    };

    const hero = new THREE.Box3();
    const trajectories = new THREE.Box3();
    let meshExtent = 0;
    let hasMesh = false;
    for (const object of this.objects) {
      // A light's radius is reach, not visual extent: framing on it pushes the
      // camera back until the lit effect fills a corner of the shot.
      const kind = object.source.kind;
      if (kind === "light") continue;
      if (kind === "particles") {
        const spawn = boxOf(
          (time, push) => spawnBoundsV2(object.source, time, push),
          0,
        );
        if (spawn) {
          hero.expandByPoint(spawn.lo);
          hero.expandByPoint(spawn.hi);
        }
        const travel = boxOf((time, push) => object.bounds(time, push), 0.04);
        if (travel) {
          trajectories.expandByPoint(travel.lo);
          trajectories.expandByPoint(travel.hi);
        }
        continue;
      }
      const extent = boxOf((time, push) => object.bounds(time, push), 0);
      if (!extent) continue;
      if (kind === "decal") {
        const middle = extent.lo.clone().add(extent.hi).multiplyScalar(0.5);
        hero.expandByPoint(middle.clone().lerp(extent.lo, 0.5));
        hero.expandByPoint(middle.clone().lerp(extent.hi, 0.5));
        continue;
      }
      hasMesh = true;
      meshExtent = Math.max(
        meshExtent,
        ...extent.hi.clone().sub(extent.lo).toArray(),
      );
      hero.expandByPoint(extent.lo);
      hero.expandByPoint(extent.hi);
    }
    const box = hasMesh ? hero : trajectories.isEmpty() ? hero : trajectories;
    if (box.isEmpty()) {
      this.frame = { center: new THREE.Vector3(0, 0.75, 0), distance: 6 };
      return;
    }
    const size = box
      .getSize(new THREE.Vector3())
      .max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
    const center = box.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(doc.camera.fov / 2));
    const framing = Math.max(0.1, doc.camera.framing);
    const aspect = Math.max(0.2, this.camera.aspect);
    const reference = hasMesh ? meshExtent : Math.max(size.x, size.y, size.z);
    const distance = Math.min(
      3 * (reference + 1),
      Math.max(
        1,
        size.y / framing / (2 * tan),
        size.x / framing / (2 * tan * aspect),
        size.z / 2 + 1,
      ),
    );
    this.frame = {
      center: new THREE.Vector3()
        .addScaledVector(right, center.x)
        .addScaledVector(up, center.y)
        .addScaledVector(dir, center.z),
      distance,
    };
  }

  /**
   * Enables or disables the orbit/pan/zoom controls without touching the
   * camera. Default true (the dev gallery); the deterministic capture path
   * passes false so render() never calls controls.update(), keeping capture
   * output identical to a build without controls.
   */
  setInteractive(on: boolean) {
    this.interactive = on;
    this.controls.enabled = on;
  }

  /** Fit the complete sampled effect into a CSS-pixel safe rectangle. The
   * asymmetric projection keeps orbit centered on the effect, not the UI gap.
   */
  focus(area: { left: number; top: number; width: number; height: number }, solo?: string) {
    if (!this.doc) return;
    const box = new THREE.Box3();
    for (const object of this.objects) {
      const layer = object.source;
      if (!layer.enabled || layer.kind === "light" || (solo && layer.id !== solo)) continue;
      for (let i = 0; i <= 48; i++)
        object.bounds(layer.start + (layer.end - layer.start) * i / 48, point => box.expandByPoint(point));
    }
    if (box.isEmpty()) box.setFromCenterAndSize(this.frame.center, new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(this.doc.camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * area.width / area.height);
    const distance = Math.max(1, sphere.radius * 1.12 / Math.sin(Math.min(vertical, horizontal)));
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!direction.lengthSq()) direction.copy(directionOf(this.doc.camera.azimuth, this.doc.camera.elevation));
    // Flush pending damping before taking ownership of the new pose.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(sphere.center);
    this.controls.maxDistance = Math.max(60, distance * 2);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.fov = this.doc.camera.fov;
    this.camera.far = Math.max(this.camera.far, distance + sphere.radius * 2);
    this.camera.setViewOffset(area.width, area.height, -area.left, -area.top, this.width, this.height);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.previewSample = null;
  }

  resetCamera() {
    this.camera.clearViewOffset();
    this.camera.aspect = this.width / this.height;
    this.previewSample = null;
    const doc = this.doc;
    if (!doc) return;
    const dir = directionOf(doc.camera.azimuth, doc.camera.elevation);
    this.camera.fov = doc.camera.fov;
    this.camera.position
      .copy(this.frame.center)
      .addScaledVector(dir, this.frame.distance);
    this.camera.lookAt(this.frame.center);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.frame.center);
    // Only sync the controls' internal spherical state when interactive: the
    // round-trip through OrbitControls' spherical coordinates can perturb the
    // camera position by float epsilon, which the deterministic capture path
    // (interactive=false) cannot tolerate.
    if (this.interactive) this.controls.update();
  }

  resize(
    width = this.host.clientWidth || 1280,
    height = this.host.clientHeight,
  ) {
    this.previewSample = null;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height || Math.round((w * 9) / 16)));
    this.width = w;
    this.height = h;
    // Interactive previews retain MSAA but cap raster work at one megapixel.
    // Offscreen evaluation/export keeps the document AA and requested resolution.
    if (this.options.preview)
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5, Math.sqrt(1_000_000 / (w * h))));
    this.renderer.setSize(w, h, false);
    const pixelWidth = this.renderer.domElement.width;
    const pixelHeight = this.renderer.domElement.height;
    this.depthTarget.setSize(pixelWidth, pixelHeight);
    this.updateResolutionUniforms();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.computeFraming();
    this.resetCamera();
  }

  private updateResolutionUniforms() {
    const pixelWidth = this.renderer.domElement.width;
    const pixelHeight = this.renderer.domElement.height;
    for (const object of this.objects)
      object.object.traverse((node) => {
        const material = (node as THREE.Mesh).material as
          V2NodeMaterial | undefined;
        const resolution = material?.uniforms?.uResolution?.value as
          THREE.Vector2 | undefined;
        resolution?.set(pixelWidth, pixelHeight);
      });
  }

  /**
   * camera.shake and camera.pushIn, applied as an offset on top of whatever
   * the camera already is — the auto-framed pose, or the orbit pose when the
   * gallery is interactive. Both are pure functions of time, and the base pose
   * is restored right after the frame, so nothing accumulates.
   */
  private applyCameraMove(time: number) {
    const doc = this.doc;
    if (!doc) return null;
    const { shake, pushIn } = doc.camera;
    if (!shake && !pushIn) return null;
    const base = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
    };
    const target = this.controls.target;
    if (pushIn) {
      const span = Math.max(pushIn.end - pushIn.start, 1e-4);
      let f = clamp01((time - pushIn.start) / span);
      if (pushIn.ease === "smooth") f = f * f * (3 - 2 * f);
      const scale = pushIn.from + (pushIn.to - pushIn.from) * f;
      this.camera.position
        .sub(target)
        .multiplyScalar(Math.max(0.05, scale))
        .add(target);
    }
    if (shake) {
      // Trauma model: trauma decays linearly from the start of the window and
      // the shake is amplitude * trauma^2, so it dies away fast and smoothly.
      const decay = 1 + shake.fade;
      const span = Math.max(shake.end - shake.start, 1e-4);
      const trauma = clamp01(
        Math.min(1 - (time - shake.start) * decay, (shake.end - time) / span),
      );
      const strength = shake.amplitude * trauma * trauma;
      if (time >= shake.start && strength > 1e-5) {
        const phase = time * shake.frequency;
        const nx = seededNoise1D(phase, this.shakeSeed);
        const ny = seededNoise1D(phase, this.shakeSeed + 977);
        const nz = seededNoise1D(phase * 0.6, this.shakeSeed + 4013);
        // Rotation is what sells a shake: +-5 degrees at full trauma.
        const swing = (5 * Math.PI) / 180 / 0.3;
        const euler = new THREE.Euler(
          ny * strength * swing,
          nx * strength * swing,
          nz * strength * swing * 0.6,
          "XYZ",
        );
        this.camera.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(euler),
        );
        this.camera.position.addScaledVector(
          new THREE.Vector3(nx, ny, nz),
          strength * 0.35,
        );
      }
    }
    this.camera.updateMatrixWorld();
    return base;
  }

  render(time: number, solo?: string, diagnostic = false) {
    this.renderSample(time, solo, diagnostic, false);
  }

  /** Paused previews draw only for edits, resize, seeking, or orbit damping.
   * Explicit capture render() always submits a fresh frame for canvas readback.
   */
  renderPreview(time: number, solo?: string) {
    this.lastPreviewRequest = { time, solo };
    this.renderSample(time, solo, false, true);
  }

  private advanceFrame() {
    // Each explicit time sample is a complete frame, including multiple captures
    // in one browser task. r186 advances NodeFrame only from its own RAF loop;
    // without this seam FRAME-cached post nodes silently reuse the first sample.
    // Keep this version-specific access here and cover it with seek/solo tests.
    const nodes = (
      this.renderer as unknown as { _nodes: { nodeFrame: { frameId: number } } }
    )._nodes;
    nodes.nodeFrame.frameId++;
  }

  private renderSample(time: number, solo: string | undefined, diagnostic: boolean, skipUnchanged: boolean) {
    if (this.disposed || !this.doc) return;
    if (this.deviceError) throw this.deviceError;
    if (!this.initialized)
      throw new Error("Await whenReady() before rendering a V2 document.");
    const cameraChanged = this.interactive && this.controls.update();
    // No emitter/light is alive and the camera has no authored motion: all
    // times in this interval produce the same environment image.
    const sampleTime = skipUnchanged && !this.doc.camera.shake && !this.doc.camera.pushIn &&
      !this.doc.layers.some(layer => layer.enabled && (!solo || layer.id === solo) && time >= layer.start && time < layer.end)
      ? -Infinity : time;
    if (skipUnchanged && !cameraChanged && this.previewSample?.time === sampleTime &&
        this.previewSample.solo === solo && this.previewSample.diagnostic === diagnostic) return;
    this.advanceFrame();
    const move = this.applyCameraMove(time);
    const doc = this.doc;
    for (const object of this.objects) {
      if (object.source.kind === "light") {
        object.update(time, this.flags, this.camera);
        if (solo && object.id !== solo) (object.object as THREE.PointLight).intensity = 0;
        continue;
      }
      if ((solo && object.id !== solo) || time < object.source.start || time >= object.source.end) {
        object.object.visible = false;
        continue;
      }
      object.update(time, this.flags, this.camera);
    }
    this.environment.apply(doc, this.scene, this.flags.ground);
    this.renderer.toneMappingExposure = doc.post.exposure;
    this.post.apply(doc, {
      post: this.flags.post && !diagnostic,
      aa: this.flags.aa && !this.options.preview,
    });

    if (this.flags.softParticles && this.objects.some((o) => o.soft && o.object.visible)) {
      // Depth pre-pass: opaque receivers only (ground + any depth-writing mesh).
      const hidden: THREE.Object3D[] = [];
      for (const object of this.objects)
        if (object.object.visible && object.source.kind !== "light") {
          hidden.push(object.object);
          object.object.visible = false;
        }
      this.renderer.setRenderTarget(this.depthTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      for (const object of hidden) object.visible = true;
    }

    if (this.flags.post && !diagnostic) this.post.render();
    else this.renderer.render(this.scene, this.camera);

    this.previewSample = { time: sampleTime, solo, diagnostic };
    if (move) {
      this.camera.position.copy(move.position);
      this.camera.quaternion.copy(move.quaternion);
      this.camera.updateMatrixWorld();
    }
  }

  private disposeObjects() {
    for (const object of this.objects) {
      object.object.removeFromParent();
      object.dispose();
    }
    this.objects = [];
    this.objectKeys.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeDeviceErrorListener?.();
    this.controls.dispose();
    this.disposeObjects();
    this.environment.dispose();
    this.post.dispose();
    this.textures.dispose();
    this.depthTarget.depthTexture?.dispose();
    this.depthTarget.dispose();
    if (this.initialized) this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * Smooth value noise in [-1,1], deterministic in (x, seed). Used only by the
 * camera shake, which must stay a pure function of time.
 */
function seededNoise1D(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const at = (n: number) => {
    let v = Math.imul((n ^ seed) >>> 0, 2246822519) >>> 0;
    v = Math.imul(v ^ (v >>> 13), 3266489917) >>> 0;
    return (v / 4294967296) * 2 - 1;
  };
  const s = f * f * (3 - 2 * f);
  return at(i) + (at(i + 1) - at(i)) * s;
}

function directionOf(azimuth: number, elevation: number) {
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ).normalize();
}

/**
 * Retro styles are approximated cheaply for now: textures off, fewer particles
 * and no anti-aliasing. Phase B: point filtering, vertex jitter, affine UVs.
 */
function applyStyle(doc: VfxDocumentV2): VfxDocumentV2 {
  if (doc.quality.style === "modern") return doc;
  const next = structuredClone(doc);
  next.quality.particleDensity =
    doc.quality.style === "ps1"
      ? Math.min(doc.quality.particleDensity, 0.3)
      : Math.min(doc.quality.particleDensity, 0.6);
  next.quality.aa = "none";
  for (const layer of next.layers) {
    if (!layer.material) continue;
    layer.material.mask.textureId = null;
    if (layer.material.noise) layer.material.noise.textureId = null;
    if (layer.emitter?.trail) layer.emitter.trail.textureId = null;
  }
  return next;
}

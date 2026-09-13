import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGeometry } from "./geometry";
import { createEnvironment, type EnvironmentV2 } from "./environment-v2";
import { createPostStack, type PostStackV2 } from "./post-v2";
import { evaluateLayerV2 } from "./evaluate-v2";
import { upgradeDocument } from "./migrate";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";
import { textureUrl } from "./asset-urls";
import type { VfxDocument } from "./schema";
import {
  isV2,
  validateDocumentV2,
  type Curve,
  type Emitter,
  type GeometryV2,
  type LayerV2,
  type Material,
  type PathV2,
  type VfxDocumentV2,
} from "./schema-v2";
import {
  findPath,
  invertCurve,
  pathBounds,
  pathPoint,
  pathTangent,
  pathUniforms,
  writePathUniforms,
} from "./paths-v2";
import {
  buildRibbonGeometry,
  ribbonBounds,
  sampleCurve,
} from "./ribbon-v2";
import { buildWireBurstGeometry, wireBurstBounds } from "./wire-burst-v2";
import {
  blobLobes,
  blobBounds,
  lobeStateAt,
  type Lobe,
} from "./blob-v2";
import {
  crystalBounds,
  crystalGeometry,
  crystalInstances,
  crystalSpawnSites,
} from "./crystals-v2";
import { latticeTexture } from "./lattice-v2";
import {
  splashSlivers,
  sliverGeometry,
  sliverStateAt,
  splashBounds,
} from "./splash-v2";
import {
  CURVE_KEYS,
  blobFragmentV2,
  blobVertexV2,
  curveUniforms,
  particleFragmentV2,
  particleVertexSource,
  rampUniforms,
  ribbonFragmentV2,
  ribbonVertexV2,
  splashFragmentV2,
  splashVertexV2,
  crystalFragmentV2,
  crystalVertexV2,
  surfaceFragmentV2,
  surfaceVertexV2,
  trailFragmentV2,
  trailVertexSource,
  wireBurstFragmentV2,
  wireBurstVertexV2,
  writeCurve,
  writeRamp,
} from "./shaders-v2";
import { STRIKE_HZ, buildLightningGeometry, lightningBounds } from "./lightning-v2";

export const RUNTIME_VERSION_V2 = "autov.lab/2-three-r186";

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
  path: 8,
  layerInstances: 9,
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
  pathAligned: 4,
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
  star4: 12,
  softRadial: 13,
  swirlRing: 14,
  ringFill: 15,
  sigil: 16,
};
/**
 * Spawn modes the vertex shader knows about. It has to stay in step with the
 * `selfBirth` branches in glslParticleCore AND with particlePositionV2's CPU
 * mirror: a mode missing here silently falls back to "burst", which is what
 * made a path-anchored trail appear all at once instead of following its head.
 */
const SPAWN_MODE_INDEX: Record<string, number> = {
  burst: 0,
  continuous: 1,
  bursts: 2,
  pathAnchored: 3,
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
    const key = `${id}:${repeat ? "r" : "c"}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const embedded = doc.textures?.find((asset) => asset.id === id);
    const file = TEXTURE_FILES.get(id);
    const url = embedded ? embedded.data : file ? textureUrl(file) : undefined;
    if (!url) return null;
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
  /**
   * i / (count - 1). The ONLY monotone per-instance value an emitter has: a
   * path shape reads it as the instance's u along the path and a pathAnchored
   * spawn inverts the head curve at it. Everything else is hashed noise.
   */
  index: Float32Array;
  count: number;
}

function makeAttributes(count: number, seed: number): ParticleAttributes {
  const rnd = lcg(seed);
  const s = new Float32Array(count * 4);
  const e = new Float32Array(count * 4);
  const e2 = new Float32Array(count * 4);
  const index = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    index[i] = count > 1 ? i / (count - 1) : 0;
    for (let k = 0; k < 4; k++) {
      s[i * 4 + k] = rnd();
      e[i * 4 + k] = rnd();
      e2[i * 4 + k] = rnd();
    }
  }
  return { seed: s, extra: e, extra2: e2, index, count };
}

function orthoOf(a: THREE.Vector3, out: THREE.Vector3) {
  const helper =
    Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  out.crossVectors(a, helper);
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
  /** The layer's own span and path, for the two path-driven modes. */
  span = 1,
  path: PathV2 | null = null,
  /** Borrowed spawn sites, for shape "layerInstances". */
  sites: { positions: Float32Array; axes: Float32Array } | null = null,
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
  } else if (emitter.spawn.mode === "pathAnchored" && emitter.spawn.headCurve) {
    age = time - invertCurve(emitter.spawn.headCurve, attrs.index[index]) * span;
  } else {
    age = time - s0 * spawnWindow;
  }
  if (age < 0 || age >= life) return false;

  const ca = e0 * Math.PI * 2;
  const cz = e1 * 2 - 1;
  const cr = Math.sqrt(Math.max(0, 1 - cz * cz));
  const unit = new THREE.Vector3(cr * Math.cos(ca), cz, cr * Math.sin(ca));
  const fill = emitter.shape.surfaceOnly ? 1 : Math.sqrt(Math.max(e2, 0));
  const sph = unit.clone().multiplyScalar(fill);
  const bias = emitter.shape.bias;
  sph.set(
    sph.x + (Math.abs(sph.x) - sph.x) * clamp01(bias[0]),
    sph.y + (Math.abs(sph.y) - sph.y) * clamp01(bias[1]),
    sph.z + (Math.abs(sph.z) - sph.z) * clamp01(bias[2]),
  );

  const axis = new THREE.Vector3().fromArray(emitter.shape.axis);
  if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0);
  axis.normalize();
  const a1 = orthoOf(axis, new THREE.Vector3());
  const a2 = new THREE.Vector3().crossVectors(axis, a1);
  const shape = emitter.shape;
  const origin = new THREE.Vector3();
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
    case "path": {
      if (!path) break;
      const u = attrs.index[index];
      const tangent = new THREE.Vector3().fromArray(pathTangent(path, u));
      const side = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .add(new THREE.Vector3(1e-5, 0, 0))
        .normalize();
      const up = new THREE.Vector3().crossVectors(side, tangent).normalize();
      origin
        .fromArray(pathPoint(path, u))
        .addScaledVector(side, (e0 - 0.5) * 2 * shape.radius)
        .addScaledVector(up, (e1 - 0.5) * 1.5 * shape.radius);
      break;
    }
    case "layerInstances": {
      if (!sites) break;
      origin
        .fromArray(sites.positions, index * 3)
        .addScaledVector(sph, shape.radius);
      break;
    }
    default:
      origin
        .copy(axis)
        .multiplyScalar(shape.length * e3)
        .addScaledVector(sph, shape.radius);
  }

  const base = new THREE.Vector3().fromArray(emitter.velocity.direction);
  if (base.lengthSq() < 1e-10) base.set(0, 1, 0);
  base.normalize();
  const dir = new THREE.Vector3();
  if (sites && shape.type === "layerInstances" && emitter.velocity.mode === "radial")
    dir.fromArray(sites.axes, index * 3).normalize();
  else if (emitter.velocity.mode === "radial")
    dir.copy(origin.lengthSq() > 1e-10 ? origin.clone().normalize() : base);
  else if (emitter.velocity.mode === "directional") dir.copy(base);
  else if (emitter.velocity.mode === "tangential")
    dir
      .crossVectors(axis, origin.lengthSq() > 1e-10 ? origin : base)
      .normalize();
  else {
    const t1 = orthoOf(base, new THREE.Vector3());
    const t2 = new THREE.Vector3().crossVectors(base, t1);
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
    ? life * speedIntegral(emitter.velocity.speedCurve, age / Math.max(life, 1e-4))
    : drag < 0.001
      ? age
      : (1 - Math.exp(-drag * age)) / drag;
  out
    .copy(origin)
    .addScaledVector(dir, v0 * d)
    .addScaledVector(
      new THREE.Vector3().fromArray(emitter.forces.gravity),
      0.5 * age * age,
    )
    .addScaledVector(new THREE.Vector3().fromArray(emitter.forces.wind), age);
  const planar = emitter.forces.planarDrag;
  if (planar > 0) {
    // Mirrors the shader: the horizontal travel gets its own drag integral, the
    // vertical stays ballistic.
    const dp = (1 - Math.exp(-planar * age)) / planar;
    out.x = origin.x + dir.x * v0 * dp + emitter.forces.wind[0] * age;
    out.z = origin.z + dir.z * v0 * dp + emitter.forces.wind[2] * age;
  }
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
  update(time: number, flags: FeatureFlagsV2, camera: THREE.PerspectiveCamera): void;
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
  /**
   * True for a layer that writes depth and must therefore stay VISIBLE during
   * the soft-particle depth pre-pass: without it a blob's opaque lobes would
   * not occlude the particles drifting behind them. Everything else is hidden
   * for that pass so only real receivers end up in the depth texture.
   */
  occluder?: boolean;
}

function spawnPeriod(emitter: Emitter, duration: number) {
  if (emitter.spawn.mode !== "continuous") return Math.max(duration, 1e-3);
  const period = emitter.spawn.rate > 0 ? emitter.count / emitter.spawn.rate : duration;
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

/** Ramp space -> the shaders' uRampKeyMode. */
function rampKeyMode(material: Material) {
  const space = material.ramp.space;
  return space === "height" ? 3 : space === "surface" ? 2 : space === "layerTime" ? 1 : 0;
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
): Record<string, THREE.IUniform> {
  const period = spawnPeriod(emitter, duration);
  const speed = emitter.velocity.speedCurve ?? FLAT_CURVE;
  const keys: THREE.Vector2[] = [];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = speed.keys[Math.min(i, speed.keys.length - 1)];
    keys.push(new THREE.Vector2(key[0], key[1]));
  }
  const uniforms: Record<string, THREE.IUniform> = {
    [`u${P}Period`]: { value: period },
    [`u${P}SpawnWindow`]: { value: spawnWindowOf(emitter, period) },
    [`u${P}SpawnDuration`]: {
      value:
        emitter.spawn.mode === "continuous" ? emitter.spawn.duration : duration,
    },
    [`u${P}SpawnMode`]: { value: SPAWN_MODE_INDEX[emitter.spawn.mode] ?? 0 },
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
    [`u${P}SpeedN`]: { value: emitter.velocity.speedCurve ? speed.keys.length : 0 },
    [`u${P}Life`]: { value: new THREE.Vector2().fromArray(emitter.life) },
    [`u${P}Gravity`]: {
      value: new THREE.Vector3().fromArray(emitter.forces.gravity),
    },
    [`u${P}Drag`]: { value: emitter.forces.drag },
    [`u${P}Wind`]: { value: new THREE.Vector3().fromArray(emitter.forces.wind) },
    [`u${P}Curl`]: { value: emitter.forces.curl?.strength ?? 0 },
    [`u${P}CurlFreq`]: { value: emitter.forces.curl?.frequency ?? 1 },
    [`u${P}CurlSpeed`]: { value: emitter.forces.curl?.speed ?? 1 },
    [`u${P}VortexAxis`]: {
      value: new THREE.Vector3().fromArray(emitter.forces.vortex?.axis ?? [0, 1, 0]),
    },
    [`u${P}VortexW`]: { value: emitter.forces.vortex?.strength ?? 0 },
    [`u${P}VortexFalloff`]: { value: emitter.forces.vortex?.falloff ?? 0 },
    [`u${P}FloorY`]: { value: emitter.forces.floor?.y ?? 0 },
    [`u${P}FloorSoft`]: { value: emitter.forces.floor?.softness ?? 1 },
    [`u${P}HasFloor`]: { value: emitter.forces.floor ? 1 : 0 },
    [`u${P}PlanarDrag`]: { value: emitter.forces.planarDrag },
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

/**
 * Spawn sites borrowed from another layer's generator, for
 * `emitter.shape.type:"layerInstances"`. Returns null for every other shape.
 *
 * Only generator kinds can be borrowed from, because only their instances are
 * hashed out of their own spec: `crystals` gives a point along each spike's
 * axis plus that spike's direction, and `blob` gives each lobe's birth position
 * plus the direction it drifts in. Both are pure functions of the source spec,
 * never of anything the renderer holds.
 */
function borrowedSites(doc: VfxDocumentV2, layer: LayerV2, count: number) {
  const shape = layer.emitter!.shape;
  if (shape.type !== "layerInstances" || !shape.sourceLayerId) return null;
  const source = doc.layers.find((l) => l.id === shape.sourceLayerId);
  if (!source) return null;
  if (source.crystals)
    return crystalSpawnSites(
      source.crystals,
      count,
      doc.environment.groundY + 0.02,
    );
  if (source.blob) {
    const lobes = blobLobes(source.blob);
    const positions = new Float32Array(count * 3);
    const axes = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const lobe = lobes[i % lobes.length];
      positions.set(lobe.base, i * 3);
      const away = new THREE.Vector3(
        lobe.drift[0],
        Math.max(0.2, lobe.rise * 0.2),
        lobe.drift[1],
      ).normalize();
      axes.set(away.toArray(), i * 3);
    }
    return { positions, axes };
  }
  return null;
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
    parentLayer && parentLayer.kind === "particles" ? parentLayer.emitter! : null;
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
  const indexAttr = new THREE.InstancedBufferAttribute(
    Float32Array.from(attrs.index),
    1,
  );
  geometry.setAttribute("aSeed", seedAttr);
  geometry.setAttribute("aExtra", extraAttr);
  geometry.setAttribute("aExtra2", extra2Attr);
  geometry.setAttribute("aIndex", indexAttr);
  // emitter.shape "layerInstances": the spawn sites come from the SOURCE
  // layer's own generator hash, computed once here and uploaded as instance
  // attributes. That keeps the burst closed form — nothing is read back out of
  // the source layer at draw time, so the two layers cannot disagree however
  // they are ordered.
  const sites = borrowedSites(doc, layer, count);
  if (sites) {
    geometry.setAttribute(
      "aSrcPos",
      new THREE.InstancedBufferAttribute(sites.positions, 3),
    );
    geometry.setAttribute(
      "aSrcDir",
      new THREE.InstancedBufferAttribute(sites.axes, 3),
    );
  }
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

  // The emitter's own path, if it has one: a path shape samples it and a
  // pathAligned quad reads its tangent. Paths live in DOCUMENT space, so a
  // layer that uses one belongs at the origin.
  const path = findPath(doc, emitter.shape.pathId);
  const span = Math.max(layer.end - layer.start, 1e-6);

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uSpan: { value: span },
    uTwinkleFreq: { value: emitter.render.twinkle?.frequency ?? 1 },
    uTwinkleDepth: { value: emitter.render.twinkle?.depth ?? 0 },
    ...pathUniforms("E", path),
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
        ? Math.max(1e-3, (parentLayer.end - parentLayer.start) / (CURVE_KEYS - 1))
        : 1,
    },
    uRenderMode: { value: RENDER_INDEX[emitter.render.mode] ?? 0 },
    uStretch: { value: emitter.render.stretch },
    uMotionBlur: { value: doc.post.motionBlur },
    uSize: { value: new THREE.Vector2().fromArray(emitter.render.size) },
    uRot: { value: new THREE.Vector2().fromArray(emitter.render.rotation.speed) },
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
    uRampKeyMode: { value: rampKeyMode(material) },
    uGroundY: { value: doc.environment.groundY },
    uHeightSpan: { value: material.ramp.heightSpan },
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
    ...curveUniforms("H", emitter.spawn.headCurve),
    uProcParams: {
      value: new THREE.Vector4().fromArray(material.proceduralParams),
    },
  };

  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: particleVertexSource(!!parentEmitter, !!sites),
    fragmentShader: particleFragmentV2,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Velocity-aligned quads flip winding; both faces must draw.
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });

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
  let trailMaterial: THREE.ShaderMaterial | null = null;
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
    trailGeometry.setAttribute("aIndex", indexAttr);
    if (sites) {
      trailGeometry.setAttribute("aSrcPos", geometry.getAttribute("aSrcPos"));
      trailGeometry.setAttribute("aSrcDir", geometry.getAttribute("aSrcDir"));
    }
    if (parentAttributes.length) {
      trailGeometry.setAttribute("aPSeed", parentAttributes[0]);
      trailGeometry.setAttribute("aPExtra", parentAttributes[1]);
      trailGeometry.setAttribute("aPExtra2", parentAttributes[2]);
    }
    trailGeometry.instanceCount = count;
    trailMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: trailVertexSource(!!parentEmitter, !!sites),
      fragmentShader: trailFragmentV2,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      ...blendingFor(material.blend),
    });
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
            .sub(new THREE.Vector3().fromArray(live.transform.position));
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
      uniforms.uPlanarDrag.value = e.forces.planarDrag;
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
      uniforms.uRampKeyMode.value = rampKeyMode(m);
      uniforms.uGroundY.value = doc.environment.groundY;
      uniforms.uHeightSpan.value = m.ramp.heightSpan;
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
      writeCurve(uniforms, "H", e.spawn.headCurve);
      uniforms.uTwinkleFreq.value = e.render.twinkle?.frequency ?? 1;
      uniforms.uTwinkleDepth.value = e.render.twinkle?.depth ?? 0;
      (uniforms.uProcParams.value as THREE.Vector4).fromArray(
        m.proceduralParams,
      );
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
          span,
          path,
          sites,
        )
          ? point.dot(view)
          : -Infinity;
      }
      order.sort((a, b) => depths[a] - depths[b]);
      const s = seedAttr.array as Float32Array;
      const x = extraAttr.array as Float32Array;
      const x2 = extra2Attr.array as Float32Array;
      const ix = indexAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const from = order[i] * 4;
        for (let k = 0; k < 4; k++) {
          s[i * 4 + k] = attrs.seed[from + k];
          x[i * 4 + k] = attrs.extra[from + k];
          x2[i * 4 + k] = attrs.extra2[from + k];
        }
        // aIndex rides the same permutation: it identifies the instance, so a
        // sorted draw that left it behind would tear a path emitter apart.
        ix[i] = attrs.index[order[i]];
      }
      seedAttr.needsUpdate = true;
      extraAttr.needsUpdate = true;
      extra2Attr.needsUpdate = true;
      indexAttr.needsUpdate = true;
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
        if (
          !particlePositionV2(
            e,
            attrs,
            i,
            age,
            period,
            window,
            point,
            span,
            path,
            sites,
          )
        )
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
  // A lattice needs a real sphere to wrap: its cells are looked up on the
  // object-space normal, which the analytic teardrop does not have.
  if (layer.material?.lattice) return false;
  return layer.kind === "shell" && SHELL_VOLUME_TYPES.has(geometry.type);
}

/**
 * A spherical belt: the strip of a sphere of `geometry.radius` whose angular
 * width is `geometry.thickness` metres of arc, leant over by `band.tilt`. uv.x
 * runs ALONG the belt and uv.y ACROSS it, so a "surface" ramp colours the
 * section and the stripes run round it.
 */
function bandGeometry(geometry: GeometryV2) {
  const band = geometry.band!;
  const radius = geometry.radius;
  const dTheta = Math.min(Math.PI * 0.9, geometry.thickness / Math.max(radius, 1e-3));
  const strip = new THREE.SphereGeometry(
    radius,
    Math.max(24, Math.min(256, geometry.segments)),
    Math.max(2, Math.min(16, geometry.radialSegments)),
    0,
    Math.PI * 2,
    Math.PI / 2 - dTheta / 2,
    dTheta,
  );
  strip.rotateZ(band.tilt);
  return strip;
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
      let f = (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-5);
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
        Array.from({ length: Math.max(3, Math.min(48, radialSegments)) + 1 }, (_, j) => {
          const a = (j / Math.max(3, Math.min(48, radialSegments))) * Math.PI * 2;
          return [Math.cos(a), Math.sin(a)] as [number, number];
        }),
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
          indices.push(k, k + 1, k + ring.length, k + 1, k + ring.length + 1, k + ring.length);
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
  if (geometry.type === "band" && geometry.band) return bandGeometry(geometry);
  // A lattice layer IS the sphere its cells wrap; geometry.radius scales it.
  if (layer.material?.lattice)
    return new THREE.IcosahedronGeometry(1, Math.max(3, Math.min(6, Math.round(geometry.segments / 12))));
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
    const base =
      layer.kind === "trail"
        ? width
          ? (t: number) => Math.max(0.02, curveAt(width, t))
          : (t: number) => Math.max(0.08, Math.pow(1 - t, 0.6))
        : width
          ? (t: number) => Math.max(0.02, curveAt(width, t))
          : () => 1;
    // geometry.taper is the cylinder's own far/near radius ratio, on top of
    // whatever taper the kind already applies: an upright glow tube narrows as
    // it rises. Baked into the buffer, so it is not animatable by a track.
    const cylinder = geometry.type === "cylinder";
    const taper = cylinder
      ? (t: number) => base(t) * (1 + (geometry.taper - 1) * t)
      : base;
    return unitBarGeometry(
      geometry.segments,
      geometry.radialSegments,
      cylinder,
      taper,
    );
  }
  if (layer.kind === "sprite")
    // A square of half-size `radius`; scaled per frame and turned to face the
    // camera in the vertex shader.
    return new THREE.PlaneGeometry(2, 2);
  if (layer.kind === "decal" && (geometry.type === "plane" || geometry.type === "auto"))
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

/**
 * Ripple origins as (x, y, z, birth time). A null origin is hashed off the
 * document seed and the ripple's index, so it is stable across seeks and still
 * different for every ripple.
 */
function rippleOrigins(
  ripples: NonNullable<Material["ripples"]>,
  seed: number,
) {
  return Array.from({ length: 4 }, (_, i) => {
    const ripple = ripples[i];
    if (!ripple) return new THREE.Vector4(0, 1, 0, -1);
    if (ripple.origin)
      return new THREE.Vector4(...ripple.origin, ripple.time);
    const a = ((hashSeed(seed, `ripple-${i}`) % 10007) / 10007) * Math.PI * 2;
    const y = 0.15 + 0.7 * ((hashSeed(seed, `ripple-y-${i}`) % 9973) / 9973);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    return new THREE.Vector4(Math.cos(a) * r, y, Math.sin(a) * r, ripple.time);
  });
}

/** Ripple (speed, width, decay) alongside the origins above. */
function rippleParams(ripples: NonNullable<Material["ripples"]>) {
  return Array.from({ length: 4 }, (_, i) => {
    const ripple = ripples[i];
    return ripple
      ? new THREE.Vector4(ripple.speed, ripple.width, ripple.decay, 0)
      : new THREE.Vector4(1, 0.1, 1, 0);
  });
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
  const rampSpace = rampKeyMode(material);
  // Relaxed once per (cells, seed) and shared by every layer that asks for the
  // same lattice; see lattice-v2.ts.
  const lattice = material.lattice
    ? latticeTexture(material.lattice, doc.seed)
    : null;
  const ripples = material.ripples ?? [];

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uLayerU: { value: 0 },
    uRampKeyMode: { value: rampSpace },
    uGroundY: { value: doc.environment.groundY },
    uHeightSpan: { value: material.ramp.heightSpan },
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
    uProcParams: {
      value: new THREE.Vector4().fromArray(material.proceduralParams),
    },
    // Overwritten per channel on the split copies; -1 is the ordinary draw.
    uChannel: { value: -1 },
    uSplitOffset: { value: material.rgbSplit?.offset ?? 0 },
    uSplitGrowth: { value: material.rgbSplit?.growth ?? 0 },
    // material.lattice: the relaxed site table plus the pattern's own weights.
    uSites: { value: lattice?.texture ?? null },
    uCells: { value: lattice?.sites.count ?? 1 },
    uCellA: { value: lattice?.sites.cellRadius ?? 1 },
    uHasLattice: { value: material.lattice ? 1 : 0 },
    uTileCol: {
      value: new THREE.Color(material.lattice?.tileColor ?? "#ffffff"),
    },
    uLatEdgeCol: {
      value: new THREE.Color(material.lattice?.edgeColor ?? "#ffffff"),
    },
    uLatEdge: { value: material.lattice?.edgeWidth ?? 0.2 },
    uLatGap: { value: material.lattice?.gapWidth ?? 0.08 },
    uPulseSpeed: { value: material.lattice?.pulse.speed ?? 0 },
    uPhaseJitter: { value: material.lattice?.pulse.phaseJitter ?? 0 },
    uGrazeFade: { value: material.lattice?.grazeFade ?? 0.3 },
    uHasDissolve: { value: material.lattice?.dissolve ? 1 : 0 },
    uDisStart: { value: material.lattice?.dissolve?.start ?? 1 },
    uDisStagger: { value: material.lattice?.dissolve?.stagger ?? 0 },
    uDisSoft: { value: material.lattice?.dissolve?.softness ?? 0.2 },
    // material.reveal: a travelling front over the layer's own progress.
    uHasReveal: { value: material.reveal ? 1 : 0 },
    uRevealMode: { value: material.reveal?.mode === "scan" ? 1 : 0 },
    uRevealFrom: { value: material.reveal?.from ?? 0 },
    uRevealTo: { value: material.reveal?.to ?? 1 },
    uRevealWidth: { value: material.reveal?.frontWidth ?? 0.1 },
    // material.planeGlow: analytic proximity to the ground plane.
    uHasPlaneGlow: { value: material.planeGlow ? 1 : 0 },
    uPlaneDist: { value: material.planeGlow?.distance ?? 0.4 },
    uPlaneI: { value: material.planeGlow?.intensity ?? 0 },
    uPlaneCol: {
      value: new THREE.Color(material.planeGlow?.color ?? "#ffffff"),
    },
    // material.ripples: up to four expanding great circles.
    uRippleN: { value: ripples.length },
    uRipple: { value: rippleOrigins(ripples, doc.seed) },
    uRippleP: {
      value: rippleParams(ripples),
    },
    uBand: { value: geometry.type === "band" && geometry.band ? 1 : 0 },
    uBandStripes: { value: geometry.band?.stripes ?? 1 },
    ...rampUniforms(material.ramp),
    ...curveUniforms("C", material.erosion?.curve ?? null),
    ...curveUniforms("F", vertexNoise?.alongCurve ?? null),
  };

  // A band is real geometry sorting against a body, so it writes depth: without
  // it the far arc of the belt glows through the dome it is meant to go behind.
  const isBand = geometry.type === "band" && !!geometry.band;
  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: surfaceVertexV2,
    fragmentShader: surfaceFragmentV2,
    transparent: true,
    depthWrite: isBand && material.blend === "alpha",
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const boltSeed = hashSeed(doc.seed, layer.id);
  const bolt = geometry.type === "lightning" && geometry.lightning ? geometry : null;
  /**
   * The factor that turns the unit mesh into the authored size, read off the
   * *live* geometry every frame so a track on geometry.length or
   * geometry.radius animates the shape. See the table at the top of the file.
   */
  const ribbon = isArcRibbon(layer);
  const flatCard =
    geometry.type === "plane" || geometry.type === "auto" || geometry.type === "disc";
  const sizeOf = (g: typeof geometry, out: THREE.Vector3) => {
    // The arc ribbon, the analytic shell, the bolt and the band build themselves
    // at their own radius, so only transform.scale applies on top of them.
    if (ribbon || shell || bolt || isBand) return out.set(1, 1, 1);
    // A lattice wraps a unit sphere scaled to geometry.radius.
    if (material.lattice) return out.set(g.radius, g.radius, g.radius);
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
  if (!shell && !ribbon && !bolt && !flatCard && !isBand && !material.lattice) {
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
  // material.rgbSplit: the base mesh becomes the green copy and two more are
  // added for red and blue. They share the geometry and the whole uniform set
  // except uChannel, so the split costs two draw calls and one uniform.
  const splitCopies: THREE.Mesh[] = [];
  let object: THREE.Object3D = mesh;
  if (material.rgbSplit) {
    uniforms.uChannel.value = 1;
    const group = new THREE.Group();
    group.name = layer.id;
    group.add(mesh);
    for (const channel of [0, 2]) {
      const copy = new THREE.Mesh(
        mesh.geometry,
        new THREE.ShaderMaterial({
          // Same uniform OBJECTS as the base draw, so every per-frame write
          // reaches all three copies; only uChannel is its own.
          uniforms: { ...uniforms, uChannel: { value: channel } },
          vertexShader: surfaceVertexV2,
          fragmentShader: surfaceFragmentV2,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          ...blendingFor(material.blend),
        }),
      );
      copy.name = `${layer.id}-ch${channel}`;
      copy.frustumCulled = false;
      copy.renderOrder = index;
      group.add(copy);
      splitCopies.push(copy);
    }
    object = group;
  }
  // The bolt re-shapes STRIKE_HZ times a second. The strike index is a pure
  // function of layer time, so rebuilding on a change keeps seek == play.
  let strike = 0;

  return {
    id: layer.id,
    source: layer,
    object,
    soft: false,
    trim: false,
    // A depth-writing band has to stay visible through the soft-particle depth
    // pre-pass, or the particles behind it would not be occluded by it.
    occluder: shaderMaterial.depthWrite,
    update(time, flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      for (const copy of splitCopies) copy.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const g = live.geometry!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale).multiply(sizeOf(g, size));
      for (const copy of splitCopies) {
        copy.position.copy(mesh.position);
        copy.rotation.copy(mesh.rotation);
        copy.scale.copy(mesh.scale);
        copy.geometry = mesh.geometry;
      }
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
      (uniforms.uProcParams.value as THREE.Vector4).fromArray(m.proceduralParams);
      uniforms.uSplitOffset.value = m.rgbSplit?.offset ?? 0;
      uniforms.uSplitGrowth.value = m.rgbSplit?.growth ?? 0;
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
      uniforms.uRampKeyMode.value = rampKeyMode(m);
      uniforms.uGroundY.value = doc.environment.groundY;
      uniforms.uHeightSpan.value = m.ramp.heightSpan;
      // Everything the ice/shield vocabulary adds is re-read from the LIVE
      // material, so a track on a reveal front, a lattice edge or a ground glow
      // really moves.
      if (m.lattice) {
        uniforms.uLatEdge.value = m.lattice.edgeWidth;
        uniforms.uLatGap.value = m.lattice.gapWidth;
        uniforms.uPulseSpeed.value = m.lattice.pulse.speed;
        uniforms.uPhaseJitter.value = m.lattice.pulse.phaseJitter;
        uniforms.uGrazeFade.value = m.lattice.grazeFade;
        (uniforms.uTileCol.value as THREE.Color).set(m.lattice.tileColor);
        (uniforms.uLatEdgeCol.value as THREE.Color).set(m.lattice.edgeColor);
        if (m.lattice.dissolve) {
          uniforms.uDisStart.value = m.lattice.dissolve.start;
          uniforms.uDisStagger.value = m.lattice.dissolve.stagger;
          uniforms.uDisSoft.value = m.lattice.dissolve.softness;
        }
      }
      if (m.reveal) {
        uniforms.uRevealFrom.value = m.reveal.from;
        uniforms.uRevealTo.value = m.reveal.to;
        uniforms.uRevealWidth.value = m.reveal.frontWidth;
      }
      if (m.planeGlow) {
        uniforms.uPlaneDist.value = m.planeGlow.distance;
        uniforms.uPlaneI.value = m.planeGlow.intensity;
        (uniforms.uPlaneCol.value as THREE.Color).set(m.planeGlow.color);
      }
      if (m.ripples) {
        uniforms.uRippleN.value = m.ripples.length;
        (uniforms.uRipple.value as THREE.Vector4[]).forEach((v, i) =>
          v.copy(rippleOrigins(m.ripples!, doc.seed)[i]),
        );
        (uniforms.uRippleP.value as THREE.Vector4[]).forEach((v, i) =>
          v.copy(rippleParams(m.ripples!)[i]),
        );
      }
      // geometry.band.spin adds to the layer's own Y rotation, so a belt turns
      // without a track and still follows whatever the transform says.
      if (isBand && g.band) mesh.rotation.y += g.band.spin * Math.max(age, 0);
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
        for (const p of lightningBounds(g, boltSeed)) push(p.applyMatrix4(matrix));
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
          const lick = radius_ * amplitude * 6.2 * 0.6 * gate * gate * (3 - 2 * gate);
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
      for (const copy of splitCopies)
        (copy.material as THREE.ShaderMaterial).dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Blob layers
// ---------------------------------------------------------------------------

/**
 * A cluster of cel-shaded lobes, generated from `layer.blob` (see blob-v2.ts
 * for the generator itself).
 *
 * Each lobe is drawn twice: the inverted hull first (back faces, inflated, flat
 * and unlit) and the fill over it. Both run the SAME vertex program, so the
 * outline tracks every fbm bump instead of a smooth sphere. The two passes
 * share one shader program (three.js keys the program cache on the shader
 * source, and every lobe clones the same material), so the per-lobe uniforms
 * cost draw calls, not compilations — bounded by BLOB_LOBE_BUDGET.
 *
 * Depth: while a lobe is inside `material.opaqueUntil` it renders opaque and
 * depth-writing, which is what makes the cluster read as solid volumes with
 * contour seams rather than a pile of transparent balls, and what lets it
 * occlude soft particles. Past that fraction it flips to transparent and the
 * outline fades with it. three.js draws the opaque list before the transparent
 * one, so the ordering of the two phases is handled by that flip alone;
 * renderOrder only separates hull from fill and filler lobes from the pairs.
 */
function createBlobLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
): LayerObject {
  const material = layer.material!;
  const spec = layer.blob!;
  const lobes = blobLobes(spec);
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const group = new THREE.Group();
  group.name = layer.id;

  const makeUniforms = (lobe: Lobe, hull: boolean) => ({
    uTime: { value: 0 },
    uSeed: { value: lobe.seed },
    uAmp: { value: lobe.amplitude },
    uFreq: { value: lobe.frequency },
    uNoiseSpeed: { value: spec.bump.speed },
    uSquash: { value: lobe.squash },
    uCurl: { value: lobe.curl },
    uTaper: { value: lobe.taper },
    uRot: { value: lobe.rot },
    uInflate: { value: 0 },
    uShadow: {
      value: new THREE.Color(
        hull
          ? (material.outline?.color ?? "#000000")
          : (material.toon?.shadow ?? "#000000"),
      ),
    },
    uBody: { value: new THREE.Color(material.toon?.body ?? "#888888") },
    uHigh: { value: new THREE.Color(material.toon?.highlight ?? "#ffffff") },
    uRimCol: { value: new THREE.Color(material.toon?.highlight ?? "#ffffff") },
    uLight: {
      value: new THREE.Vector3().fromArray(
        material.toon?.light ?? [-0.474, 0.848, 0.236],
      ),
    },
    uBands: { value: material.toon?.bands ?? 3 },
    uBandA: { value: material.toon?.thresholds[0] ?? 0.48 },
    uBandB: { value: material.toon?.thresholds[1] ?? 0.74 },
    uRimPow: { value: material.toon?.rim.power ?? 3 },
    uRimAmt: { value: material.toon?.rim.amount ?? 0 },
    uFlat: { value: hull ? 1 : 0 },
    uUseToon: { value: material.toon ? 1 : 0 },
    uOpacity: { value: 1 },
    uLayerU: { value: 0 },
    uLobeU: { value: 0 },
    uRampKeyMode: { value: rampKeyMode(material) },
    uGroundY: { value: doc.environment.groundY },
    uHeightSpan: { value: material.ramp.heightSpan },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 1 },
    ...rampUniforms(material.ramp),
  });

  const parts = lobes.map((lobe) => {
    const fillUniforms = makeUniforms(lobe, false);
    const hullUniforms = makeUniforms(lobe, true);
    const common = {
      vertexShader: blobVertexV2,
      fragmentShader: blobFragmentV2,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    };
    const fill = new THREE.ShaderMaterial({
      ...common,
      uniforms: fillUniforms,
      side: THREE.FrontSide,
    });
    const hull = new THREE.ShaderMaterial({
      ...common,
      uniforms: hullUniforms,
      side: THREE.BackSide,
    });
    const fillMesh = new THREE.Mesh(geometry, fill);
    const hullMesh = new THREE.Mesh(geometry, hull);
    fillMesh.frustumCulled = false;
    hullMesh.frustumCulled = false;
    // The smooth filler lobes of a column sit behind the pairs; the hull of a
    // lobe always sits behind its own fill.
    const order = index * 8 + lobe.depth * 2;
    hullMesh.renderOrder = order;
    fillMesh.renderOrder = order + 1;
    group.add(hullMesh);
    group.add(fillMesh);
    return { lobe, fill, hull, fillMesh, hullMesh, fillUniforms, hullUniforms };
  });

  const span = Math.max(layer.end - layer.start, 1e-6);
  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    occluder: material.opaqueUntil !== null,
    update(time, flags) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const blob = live.blob!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      const outline = m.outline;
      for (const part of parts) {
        const state = lobeStateAt(part.lobe, blob, age, span, m.opaqueUntil);
        part.fillMesh.visible = state.alive;
        part.hullMesh.visible = state.alive && !!outline && flags.textures;
        if (!state.alive) continue;
        part.fillMesh.position.fromArray(state.position);
        part.fillMesh.scale.setScalar(state.radius);
        part.hullMesh.position.fromArray(state.position);
        part.hullMesh.scale.setScalar(state.radius);
        const alpha = state.alpha * m.opacity;
        // Opaque and depth-writing until the lobe starts fading; after that it
        // joins the transparent pass, which three.js draws last and sorts by
        // depth on its own.
        for (const [mat, uniforms] of [
          [part.fill, part.fillUniforms],
          [part.hull, part.hullUniforms],
        ] as const) {
          mat.transparent = state.fading || alpha < 1;
          mat.depthWrite = !mat.transparent;
          uniforms.uOpacity.value = alpha;
          uniforms.uTime.value = age;
          uniforms.uLayerU.value = u;
          uniforms.uLobeU.value = state.age;
          uniforms.uSquash.value = part.lobe.squash * (blob.squash / (spec.squash || 1));
          uniforms.uAmp.value = flags.textures
            ? part.lobe.amplitude * (blob.bump.amplitude / (spec.bump.amplitude || 1))
            : 0;
          uniforms.uNoiseSpeed.value = blob.bump.speed;
          uniforms.uRampKeyMode.value = rampKeyMode(m);
          uniforms.uHeightSpan.value = m.ramp.heightSpan;
          uniforms.uGroundY.value = doc.environment.groundY;
          uniforms.uUseToon.value = m.toon ? 1 : 0;
          writeRamp(uniforms as Record<string, THREE.IUniform>, m.ramp);
        }
        if (m.toon) {
          (part.fillUniforms.uShadow.value as THREE.Color).set(m.toon.shadow);
          (part.fillUniforms.uBody.value as THREE.Color).set(m.toon.body);
          (part.fillUniforms.uHigh.value as THREE.Color).set(m.toon.highlight);
          (part.fillUniforms.uRimCol.value as THREE.Color).set(m.toon.highlight);
          (part.fillUniforms.uLight.value as THREE.Vector3).fromArray(m.toon.light);
          part.fillUniforms.uBandA.value = m.toon.thresholds[0];
          part.fillUniforms.uBandB.value = m.toon.thresholds[1];
          part.fillUniforms.uBands.value = m.toon.bands;
          part.fillUniforms.uRimPow.value = m.toon.rim.power;
          part.fillUniforms.uRimAmt.value = m.toon.rim.amount;
        }
        if (outline) {
          (part.hullUniforms.uShadow.value as THREE.Color).set(outline.color);
          // A constant world-space line: the hull is inflated in the lobe's own
          // unit space, so the push has to be divided by the live radius.
          part.hullUniforms.uInflate.value =
            outline.width / Math.max(state.radius, 0.12);
        }
      }
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      const [lo, hi] = blobBounds(live.blob!);
      for (const x of [lo.x, hi.x])
        for (const y of [lo.y, hi.y])
          for (const z of [lo.z, hi.z])
            push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      for (const part of parts) {
        part.fill.dispose();
        part.hull.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Crystal layers
// ---------------------------------------------------------------------------

/**
 * An instanced faceted crystal cluster, generated from `layer.crystals` (see
 * crystals-v2.ts for the generator itself).
 *
 * One draw call for the fill, one more for `material.outline`'s inverted hull.
 * Both run the same vertex program — the hull with back faces and a positive
 * inflation — so the dark separator tracks the facets instead of a smooth cone.
 * The growth, the hold breath and the collapse are all evaluated in the vertex
 * shader from layer time, so nothing is rebuilt as the cluster erupts.
 *
 * The fill writes depth: that is what makes overlapping spikes read as solid
 * ice with real intersections, and it is why the layer is an `occluder` for the
 * soft-particle depth pre-pass.
 */
function createCrystalsLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
): LayerObject {
  const material = layer.material!;
  const spec = layer.crystals!;
  const table = crystalInstances(spec);
  const base = crystalGeometry();
  const span = Math.max(layer.end - layer.start, 1e-6);

  const instanced = () => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("normal", base.getAttribute("normal"));
    g.setAttribute("aAlong", base.getAttribute("aAlong"));
    const direction = new Float32Array(table.length * 3);
    const origin = new Float32Array(table.length * 3);
    const length = new Float32Array(table.length);
    const width = new Float32Array(table.length);
    const start = new Float32Array(table.length);
    const seed = new Float32Array(table.length);
    table.forEach((spike, i) => {
      direction.set(spike.direction, i * 3);
      origin.set(spike.origin, i * 3);
      length[i] = spike.length;
      width[i] = spike.width;
      start[i] = spike.start;
      seed[i] = spike.seed;
    });
    g.setAttribute("aDir", new THREE.InstancedBufferAttribute(direction, 3));
    g.setAttribute("aOrg", new THREE.InstancedBufferAttribute(origin, 3));
    g.setAttribute("aLen", new THREE.InstancedBufferAttribute(length, 1));
    g.setAttribute("aWid", new THREE.InstancedBufferAttribute(width, 1));
    g.setAttribute("aT0", new THREE.InstancedBufferAttribute(start, 1));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = table.length;
    return g;
  };

  const makeUniforms = (hull: boolean): Record<string, THREE.IUniform> => ({
    uTime: { value: 0 },
    uSpan: { value: span },
    uGrowDur: { value: spec.growth.duration },
    uOvershoot: { value: spec.growth.overshoot },
    uHasCollapse: { value: spec.collapse ? 1 : 0 },
    uCollapseStart: { value: spec.collapse?.start ?? 1 },
    uCollapseDur: { value: spec.collapse?.duration ?? 0.16 },
    uInflate: { value: 0 },
    uTip: { value: new THREE.Color(spec.tipColor) },
    uFace: { value: new THREE.Color(spec.faceColor) },
    uEdge: {
      value: new THREE.Color(
        hull ? (material.outline?.color ?? "#000000") : spec.edgeColor,
      ),
    },
    uCam: { value: new THREE.Vector3() },
    uFresPow: { value: spec.fresnelPower },
    uGlintFreq: { value: spec.glint.frequency },
    uGlintSpeed: { value: spec.glint.speed },
    uOpacity: { value: material.opacity },
    uFlat: { value: hull ? 1 : 0 },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 1 },
  });

  const group = new THREE.Group();
  group.name = layer.id;
  const opaque = material.blend === "alpha";
  const build = (hull: boolean) => {
    const uniforms = makeUniforms(hull);
    const shader = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: crystalVertexV2,
      fragmentShader: crystalFragmentV2,
      transparent: !opaque,
      depthWrite: true,
      depthTest: true,
      side: hull ? THREE.BackSide : THREE.DoubleSide,
      ...blendingFor(material.blend),
    });
    const geometry = instanced();
    const mesh = new THREE.Mesh(geometry, shader);
    mesh.name = hull ? `${layer.id}-outline` : layer.id;
    mesh.frustumCulled = false;
    // The hull draws first, so it only ever shows past the fill's silhouette.
    mesh.renderOrder = index * 8 + (hull ? 0 : 1);
    group.add(mesh);
    return { mesh, shader, geometry, uniforms };
  };
  const hull = build(true);
  const fill = build(false);

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    occluder: opaque,
    update(time, flags, camera) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const c = live.crystals!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      hull.mesh.visible = !!m.outline && flags.textures;
      for (const part of [hull, fill]) {
        part.uniforms.uTime.value = age;
        part.uniforms.uGrowDur.value = c.growth.duration;
        part.uniforms.uOvershoot.value = c.growth.overshoot;
        part.uniforms.uCollapseStart.value = c.collapse?.start ?? 1;
        part.uniforms.uCollapseDur.value = c.collapse?.duration ?? 0.16;
        part.uniforms.uOpacity.value = m.opacity;
        part.uniforms.uFresPow.value = c.fresnelPower;
        part.uniforms.uGlintFreq.value = c.glint.frequency;
        part.uniforms.uGlintSpeed.value = c.glint.speed;
        (part.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
        (part.uniforms.uTip.value as THREE.Color).set(c.tipColor);
        (part.uniforms.uFace.value as THREE.Color).set(c.faceColor);
      }
      (fill.uniforms.uEdge.value as THREE.Color).set(c.edgeColor);
      if (m.outline) {
        (hull.uniforms.uEdge.value as THREE.Color).set(m.outline.color);
        hull.uniforms.uInflate.value = m.outline.width;
      }
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      const [lo, hi] = crystalBounds(live.crystals!);
      for (const x of [lo.x, hi.x])
        for (const y of [lo.y, hi.y])
          for (const z of [lo.z, hi.z])
            push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
    },
    dispose() {
      base.dispose();
      for (const part of [hull, fill]) {
        part.geometry.dispose();
        part.shader.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Splash layers
// ---------------------------------------------------------------------------

/**
 * A fan of flat, camera-facing slivers generated from `layer.splash`. Each one
 * is drawn twice — a darker backing 14% larger behind the fill — and carries no
 * lighting, no ramp and no erosion: it is a graphic accent, not material.
 */
function createSplashLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.splash!;
  const slivers = splashSlivers(spec);
  const group = new THREE.Group();
  group.name = layer.id;
  const blend = BLEND_INDEX[material.blend] ?? 1;

  const parts = slivers.map((sliver) => {
    const geometry = sliverGeometry(sliver, spec.jaggedness);
    const make = (color: string, dark: string, order: number, scale: number) => {
      const uniforms: Record<string, THREE.IUniform> = {
        uCol: { value: new THREE.Color(color) },
        uDark: { value: new THREE.Color(dark) },
        uOpacity: { value: 1 },
        uBlendMode: { value: blend },
        uSliverScale: { value: new THREE.Vector2(scale, scale) },
        uSliverOffset: { value: new THREE.Vector3() },
        uSliverRoll: { value: 0 },
      };
      const shader = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: splashVertexV2,
        fragmentShader: splashFragmentV2,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        ...blendingFor(material.blend),
      });
      const mesh = new THREE.Mesh(geometry, shader);
      mesh.frustumCulled = false;
      mesh.renderOrder = index * 8 + order;
      group.add(mesh);
      return { mesh, shader, uniforms, scale };
    };
    return {
      sliver,
      geometry,
      // The backing is the same sliver 14% larger, drawn first.
      backing: make(spec.backing, shade(spec.backing, 0.66), 0, 1.14),
      fill: make(spec.color, shade(spec.color, 0.47), 1, 1),
    };
  });

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    update(time) {
      // A splash's three windows are fractions of the layer's own 0..1
      // progress, so `u` is all the state a sliver needs.
      const { layer: live, visible, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const live_ = live.splash!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      for (const part of parts) {
        const state = sliverStateAt(part.sliver, live_, u);
        for (const draw of [part.backing, part.fill]) {
          draw.mesh.visible = state.visible;
          if (!state.visible) continue;
          (draw.uniforms.uSliverScale.value as THREE.Vector2).set(
            state.scale[0] * draw.scale,
            state.scale[1] * draw.scale,
          );
          (draw.uniforms.uSliverOffset.value as THREE.Vector3).fromArray(
            state.position,
          );
          draw.uniforms.uSliverRoll.value = state.roll;
          draw.uniforms.uOpacity.value =
            state.alpha * m.opacity * (draw === part.backing ? 0.85 : 1);
        }
        (part.backing.uniforms.uCol.value as THREE.Color).set(live_.backing);
        (part.backing.uniforms.uDark.value as THREE.Color).set(
          shade(live_.backing, 0.66),
        );
        (part.fill.uniforms.uCol.value as THREE.Color).set(live_.color);
        (part.fill.uniforms.uDark.value as THREE.Color).set(
          shade(live_.color, 0.47),
        );
      }
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      for (const corner of splashBounds(live.splash!))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      for (const part of parts) {
        part.geometry.dispose();
        part.backing.shader.dispose();
        part.fill.shader.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Ribbon layers
// ---------------------------------------------------------------------------

/**
 * A multi-strand strip swept along a document path inside the moving window
 * [head - tail, head]. One draw call: the strip buffer is (w, side, strand) and
 * every position is evaluated in the vertex shader from the live head, the live
 * morph blend and the path uniforms, so nothing is rebuilt as the head travels
 * and the same head always draws the same strip.
 */
function createRibbonLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
): LayerObject {
  const material = layer.material!;
  const spec = layer.ribbon!;
  const path = findPath(doc, spec.pathId);
  const morphPath = findPath(doc, spec.morph?.pathId ?? null);
  const geometry = buildRibbonGeometry(spec);

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uHead: { value: 0 },
    uTail: { value: spec.window.tail },
    uWidth: { value: spec.width },
    uMorph: { value: 0 },
    uSpread: { value: spec.strands.spread },
    uWidthJitter: { value: spec.strands.widthJitter },
    uPhaseJitter: { value: spec.strands.phaseJitter },
    uTaperHead: { value: spec.taper.head },
    uTaperTail: { value: spec.taper.tail },
    uOrientPath: { value: spec.orientation === "path" ? 1 : 0 },
    uOpacity: { value: material.opacity },
    uCore: { value: spec.core },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
    ...pathUniforms("", path),
    // With no morph the second path is the first one, so the blend is a no-op
    // however the uniform happens to be set.
    ...pathUniforms("Morph", morphPath ?? path),
    ...rampUniforms(material.ramp),
  };

  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: ribbonVertexV2,
    fragmentShader: ribbonFragmentV2,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const mesh = new THREE.Mesh(geometry, shaderMaterial);
  mesh.name = layer.id;
  mesh.frustumCulled = false;
  mesh.renderOrder = index;

  return {
    id: layer.id,
    source: layer,
    object: mesh,
    soft: false,
    trim: false,
    update(time) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const r = live.ribbon!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale);
      uniforms.uTime.value = age;
      uniforms.uHead.value = sampleCurve(r.window.head, u);
      uniforms.uTail.value = r.window.tail;
      uniforms.uWidth.value = r.width;
      uniforms.uMorph.value = r.morph
        ? clamp01(sampleCurve(r.morph.curve, u))
        : 0;
      uniforms.uSpread.value = r.strands.spread;
      uniforms.uWidthJitter.value = r.strands.widthJitter;
      uniforms.uPhaseJitter.value = r.strands.phaseJitter;
      uniforms.uTaperHead.value = r.taper.head;
      uniforms.uTaperTail.value = r.taper.tail;
      uniforms.uOpacity.value = m.opacity;
      uniforms.uCore.value = r.core;
      writePathUniforms(uniforms, "", path);
      writePathUniforms(uniforms, "Morph", morphPath ?? path);
      writeRamp(uniforms, m.ramp);
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible || !path) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      for (const corner of ribbonBounds(live.ribbon!, path, morphPath))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      shaderMaterial.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Wire-burst layers
// ---------------------------------------------------------------------------

/**
 * Polygon outlines and spokes thrown out of the layer origin, as LineSegments.
 * The buffer is generated once (wire-burst-v2.ts) and the outward travel and
 * scale envelope are applied in the vertex shader from layer time.
 *
 * material.rgbSplit draws the whole burst three times, one channel each; the
 * copies share the buffer and differ only in their uChannel uniform.
 */
function createWireBurstLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.wireBurst!;
  const { geometry } = buildWireBurstGeometry(spec);
  const group = new THREE.Group();
  group.name = layer.id;
  const split = material.rgbSplit;

  const draws = (split ? [0, 1, 2] : [-1]).map((channel) => {
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uLayerU: { value: 0 },
      uTravel: { value: spec.travel },
      uOpacity: { value: material.opacity },
      uRampKeyMode: { value: rampKeyMode(material) },
      uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
      uChannel: { value: channel },
      uSplitOffset: { value: split?.offset ?? 0 },
      uSplitGrowth: { value: split?.growth ?? 0 },
      ...rampUniforms(material.ramp),
      ...curveUniforms("A", spec.scale),
    };
    const shader = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: wireBurstVertexV2,
      fragmentShader: wireBurstFragmentV2,
      transparent: true,
      depthWrite: false,
      ...blendingFor(material.blend),
    });
    const lines = new THREE.LineSegments(geometry, shader);
    lines.name = channel < 0 ? layer.id : `${layer.id}-ch${channel}`;
    lines.frustumCulled = false;
    lines.renderOrder = index;
    group.add(lines);
    return { shader, uniforms };
  });

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    update(time) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const burst = live.wireBurst!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      for (const draw of draws) {
        draw.uniforms.uTime.value = age;
        draw.uniforms.uLayerU.value = u;
        draw.uniforms.uTravel.value = burst.travel;
        draw.uniforms.uOpacity.value = m.opacity;
        draw.uniforms.uRampKeyMode.value = rampKeyMode(m);
        draw.uniforms.uSplitOffset.value = m.rgbSplit?.offset ?? 0;
        draw.uniforms.uSplitGrowth.value = m.rgbSplit?.growth ?? 0;
        writeRamp(draw.uniforms, m.ramp);
        writeCurve(draw.uniforms, "A", burst.scale);
      }
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      for (const corner of wireBurstBounds(live.wireBurst!))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      for (const draw of draws) draw.shader.dispose();
    },
  };
}

/** A hex darkened toward black; the root of a sliver is its own colour, dimmed. */
function shade(hex: string, factor: number) {
  const color = new THREE.Color(hex);
  // Linear space (THREE.Color already converted), so a plain scale is a dim.
  return `#${color.multiplyScalar(factor).getHexString()}`;
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
  path: PathV2 | null = null,
) {
  const { layer: live, visible } = evaluateLayerV2(layer, time);
  if (!visible) return;
  const emitter = live.emitter!;
  const shape = emitter.shape;
  if (shape.type === "path" && path) {
    // A path emitter's spawn region IS the path: framing on a point at the
    // layer origin would leave the whole flight line outside the shot.
    const origin = new THREE.Vector3().fromArray(live.transform.position);
    const margin = shape.radius + emitter.render.size[1] * 0.5;
    for (const point of pathBounds(path, 24)) {
      push(point.clone().add(origin).addScalar(margin));
      push(point.clone().add(origin).addScalar(-margin));
    }
    return;
  }
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
    // A ring and a disc lie in the plane PERPENDICULAR to their axis, so they
    // claim nothing along it. Without this an upright ring of radius 1.5 asks
    // the camera for three metres of headroom it never uses.
    if ((shape.type === "ring" || shape.type === "disc") && axis.lengthSq() > 1e-10) {
      const unit = axis.clone().normalize();
      extent.multiply(
        new THREE.Vector3(
          1 - Math.abs(unit.x),
          1 - Math.abs(unit.y),
          1 - Math.abs(unit.z),
        ),
      );
    }
    if (axis.lengthSq() > 1e-10) {
      const reach = axis
        .clone()
        .normalize()
        .multiplyScalar(shape.length);
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
      light.visible = visible && flags.light;
      if (!light.visible) return;
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
  readonly renderer: THREE.WebGLRenderer;
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
  private readonly textures = new TextureCacheV2();
  private readonly depthTarget: THREE.WebGLRenderTarget;
  private readonly group = new THREE.Group();
  private objects: LayerObject[] = [];
  private doc?: VfxDocumentV2;
  private flags: FeatureFlagsV2 = { ...DEFAULT_FLAGS };
  private frame = { center: new THREE.Vector3(), distance: 6 };
  /** Seeds the camera-shake noise; set from the document. */
  private shakeSeed = 1;
  private disposed = false;
  private width = 1280;
  private height = 720;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
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
    this.renderer.domElement.setAttribute("aria-label", "Generated VFX preview");
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;
    this.scene.add(this.group);
    this.environment = createEnvironment(this.scene);
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
      depthBuffer: true,
    });
    this.post = createPostStack(
      this.renderer,
      this.scene,
      this.camera,
      this.width,
      this.height,
    );
    this.resize();
  }

  setFeatureFlags(flags: Partial<FeatureFlagsV2>) {
    const aa = this.flags.aa;
    this.flags = { ...this.flags, ...flags };
    if (this.doc) this.environment.apply(this.doc, this.scene, this.flags.ground);
    if (aa !== this.flags.aa) this.rebuildPost();
  }

  /** Accepts a v2 document, or a v1 document which is upgraded on the way in. */
  setDocument(input: VfxDocumentV2 | VfxDocument) {
    const doc = isV2(input)
      ? validateDocumentV2(input)
      : upgradeDocument(input as VfxDocument);
    this.disposeObjects();
    this.doc = applyStyle(doc);
    const depth = this.depthTarget.depthTexture!;
    this.objects = this.doc.layers
      .filter((layer) => layer.enabled)
      .map((layer, index) => {
        if (layer.kind === "light") return createLightLayer(layer);
        if (layer.kind === "particles")
          return createParticleLayer(this.doc!, layer, index, this.textures, depth);
        if (layer.kind === "blob") return createBlobLayer(this.doc!, layer, index);
        if (layer.kind === "crystals")
          return createCrystalsLayer(this.doc!, layer, index);
        if (layer.kind === "splash") return createSplashLayer(layer, index);
        if (layer.kind === "ribbon")
          return createRibbonLayer(this.doc!, layer, index);
        if (layer.kind === "wireBurst") return createWireBurstLayer(layer, index);
        return createMeshLayer(this.doc!, layer, index, this.textures);
      });
    const lights = this.objects
      .filter((o) => o.source.kind === "light")
      .sort(
        (a, b) =>
          Math.max(...b.source.light!.intensity.keys.map((k) => k[1])) -
          Math.max(...a.source.light!.intensity.keys.map((k) => k[1])),
      );
    for (const object of this.objects) {
      if (object.source.kind === "light" && lights.indexOf(object) >= MAX_LIGHTS)
        continue;
      this.group.add(object.object);
    }
    this.environment.apply(this.doc, this.scene, this.flags.ground);
    this.renderer.toneMappingExposure = this.doc.post.exposure;
    this.shakeSeed = hashSeed(this.doc.seed, "camera-shake");
    this.camera.fov = this.doc.camera.fov;
    this.rebuildPost();
    this.computeFraming();
    this.resetCamera();
  }

  /** Resolves once every texture the current document needs has loaded. */
  whenReady() {
    return this.textures.whenReady();
  }

  private rebuildPost() {
    const doc = this.doc;
    const samples = doc && doc.quality.aa !== "none" && this.flags.aa ? 4 : 0;
    this.post.dispose();
    this.post = createPostStack(
      this.renderer,
      this.scene,
      this.camera,
      this.width,
      this.height,
      samples,
    );
    if (doc) this.post.apply(doc, { post: this.flags.post, aa: this.flags.aa });
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
        const emitterPath = findPath(doc, object.source.emitter!.shape.pathId);
        const spawn = boxOf(
          (time, push) =>
            spawnBoundsV2(object.source, time, push, emitterPath),
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
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
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

  resetCamera() {
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

  resize(width = this.host.clientWidth || 1280, height = this.host.clientHeight) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height || Math.round((w * 9) / 16)));
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    const pixelWidth = this.renderer.domElement.width;
    const pixelHeight = this.renderer.domElement.height;
    this.depthTarget.setSize(pixelWidth, pixelHeight);
    for (const object of this.objects)
      object.object.traverse((node) => {
        const material = (node as THREE.Mesh).material as
          | THREE.ShaderMaterial
          | undefined;
        const resolution = material?.uniforms?.uResolution?.value as
          | THREE.Vector2
          | undefined;
        resolution?.set(pixelWidth, pixelHeight);
      });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.computeFraming();
    this.resetCamera();
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
        this.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(euler));
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
    if (this.disposed || !this.doc) return;
    // Advances damping toward whatever orbit/pan/zoom the user has done since
    // the last frame. Skipped entirely in the deterministic capture path
    // (setInteractive(false)) so captures never depend on controls state.
    if (this.interactive) this.controls.update();
    const move = this.applyCameraMove(time);
    const doc = this.doc;
    for (const object of this.objects) {
      object.update(time, this.flags, this.camera);
      if (solo && object.id !== solo) object.object.visible = false;
    }
    this.environment.apply(doc, this.scene, this.flags.ground);
    this.renderer.toneMappingExposure = doc.post.exposure;
    this.post.apply(
      doc,
      { post: this.flags.post && !diagnostic, aa: this.flags.aa },
      time,
    );

    if (this.flags.softParticles && this.objects.some((o) => o.soft)) {
      // Depth pre-pass: opaque receivers only (ground + any depth-writing mesh).
      const hidden: THREE.Object3D[] = [];
      for (const object of this.objects)
        if (object.object.visible && !object.occluder) {
          hidden.push(object.object);
          object.object.visible = false;
        }
      this.renderer.setRenderTarget(this.depthTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      for (const object of hidden) object.visible = true;
    }

    if (this.flags.post && !diagnostic) this.post.composer.render(0);
    else this.renderer.render(this.scene, this.camera);

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
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.dispose();
    this.disposeObjects();
    this.environment.dispose();
    this.post.dispose();
    this.textures.dispose();
    this.depthTarget.depthTexture?.dispose();
    this.depthTarget.dispose();
    this.renderer.dispose();
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

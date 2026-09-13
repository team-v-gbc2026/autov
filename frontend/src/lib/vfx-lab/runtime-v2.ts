import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGeometry } from "./geometry";
import { createEnvironment, type EnvironmentV2 } from "./environment-v2";
import { createPostStack, type PostStackV2 } from "./post-v2";
import { evaluateLayerV2 } from "./evaluate-v2";
import { upgradeDocument } from "./migrate";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";
import type { VfxDocument } from "./schema";
import {
  isV2,
  validateDocumentV2,
  type Curve,
  type Emitter,
  type LayerV2,
  type Material,
  type VfxDocumentV2,
} from "./schema-v2";
import {
  CURVE_KEYS,
  curveUniforms,
  particleFragmentV2,
  particleVertexSource,
  rampUniforms,
  surfaceFragmentV2,
  surfaceVertexV2,
  trailFragmentV2,
  trailVertexSource,
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
/** Procedural stand-ins the fragment shaders know about. Phase B: the rest. */
const PROCEDURAL_INDEX: Record<string, number> = { flame: 1, smoke: 2, solid: 3 };
const SUB_MODE_INDEX: Record<string, number> = {
  alongPath: 0,
  onDeath: 1,
  continuous: 2,
};

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
  private readonly cache = new Map<string, THREE.Texture>();
  private pending = 0;
  private waiters: (() => void)[] = [];

  resolve(id: string | null, doc: VfxDocumentV2, repeat: boolean) {
    if (!id) return null;
    const key = `${id}:${repeat ? "r" : "c"}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const embedded = doc.textures?.find((asset) => asset.id === id);
    const url = embedded ? embedded.data : TEXTURE_FILES.get(id);
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
  if (emitter.velocity.mode === "radial")
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

  const uniforms: Record<string, THREE.IUniform> = {
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
    uNoise: { value: noise },
    uHasNoise: { value: noise ? 1 : 0 },
    uNoiseScale: {
      value: new THREE.Vector2().fromArray(material.noise?.uvScale ?? [1, 1]),
    },
    uNoisePan: {
      value: new THREE.Vector2().fromArray(material.noise?.uvPan ?? [0, 0]),
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

  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: particleVertexSource(!!parentEmitter),
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
    if (parentAttributes.length) {
      trailGeometry.setAttribute("aPSeed", parentAttributes[0]);
      trailGeometry.setAttribute("aPExtra", parentAttributes[1]);
      trailGeometry.setAttribute("aPExtra2", parentAttributes[2]);
    }
    trailGeometry.instanceCount = count;
    trailMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: trailVertexSource(!!parentEmitter),
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
      uniforms.uStretch.value = e.render.stretch;
      (uniforms.uSize.value as THREE.Vector2).fromArray(e.render.size);
      (uniforms.uRot.value as THREE.Vector2).fromArray(e.render.rotation.speed);
      uniforms.uOpacity.value = m.opacity;
      uniforms.uSoft.value = flags.softParticles ? m.softParticle : 0;
      uniforms.uDistort.value = flags.textures ? (m.noise?.distortion ?? 0) : 0;
      uniforms.uHasMask.value = flags.textures && mask ? 1 : 0;
      uniforms.uHasNoise.value = flags.textures && noise ? 1 : 0;
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

function meshGeometryFor(layer: LayerV2, seed = 0) {
  const geometry = layer.geometry!;
  const shell = layer.kind === "shell";
  if (geometry.type === "lightning" && geometry.lightning)
    return buildLightningGeometry(geometry, seed, 0);
  if (shell || geometry.type === "sphere" || geometry.type === "teardrop")
    // The shell's teardrop is analytic (see surfaceVertexV2): the sphere is the
    // parametric domain, not the silhouette.
    return new THREE.SphereGeometry(
      1,
      Math.min(128, geometry.segments),
      Math.min(64, geometry.radialSegments),
    );
  if (geometry.type === "plane" || geometry.type === "auto")
    return new THREE.PlaneGeometry(geometry.radius * 2, geometry.length);
  if (geometry.type === "disc") return new THREE.CircleGeometry(geometry.radius, 48);
  if (geometry.type === "torus")
    return new THREE.TorusGeometry(geometry.radius, geometry.thickness, 12, 64);
  return buildGeometry(
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
}

function createMeshLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
  textures: TextureCacheV2,
): LayerObject {
  const material = layer.material!;
  const geometry = layer.geometry!;
  const shell = layer.kind === "shell";
  const mask = textures.resolve(material.mask.textureId, doc, false);
  const noise = textures.resolve(material.noise?.textureId ?? null, doc, true);
  const vertexNoise = geometry.vertexNoise;
  const rampSpace =
    material.ramp.space === "surface" ? 2 : material.ramp.space === "layerTime" ? 1 : 0;

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uLayerU: { value: 0 },
    uRampKeyMode: { value: rampSpace },
    uShell: { value: shell ? 1 : 0 },
    uBolt: {
      value: geometry.type === "lightning" && geometry.lightning ? 1 : 0,
    },
    uLength: { value: geometry.length },
    uRadius: { value: geometry.radius },
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
    uNoise: { value: noise },
    uHasNoise: { value: noise ? 1 : 0 },
    uNoiseScale: {
      value: new THREE.Vector2().fromArray(material.noise?.uvScale ?? [1, 1]),
    },
    uNoisePan: {
      value: new THREE.Vector2().fromArray(material.noise?.uvPan ?? [0, 0]),
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

  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: surfaceVertexV2,
    fragmentShader: surfaceFragmentV2,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const boltSeed = hashSeed(doc.seed, layer.id);
  const bolt = geometry.type === "lightning" && geometry.lightning ? geometry : null;
  const mesh = new THREE.Mesh(meshGeometryFor(layer, boltSeed), shaderMaterial);
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
      mesh.scale.fromArray(live.transform.scale);
      uniforms.uTime.value = age;
      uniforms.uLayerU.value = u;
      uniforms.uLength.value = g.length;
      uniforms.uRadius.value = g.radius;
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
      uniforms.uUseErosion.value = flags.erosion && m.erosion ? 1 : 0;
      uniforms.uErodeSoft.value = m.erosion?.softness ?? 0.1;
      uniforms.uEdgeI.value = m.erosion?.edgeIntensity ?? 0;
      uniforms.uProtect.value = m.erosion?.displacementProtect ?? 0;
      uniforms.uRimBias.value = m.erosion?.rimBias ?? 0;
      (uniforms.uCam.value as THREE.Vector3).copy(camera.position);
      writeRamp(uniforms, m.ramp);
      writeCurve(uniforms, "C", m.erosion?.curve ?? null);
      writeCurve(uniforms, "F", g.vertexNoise?.alongCurve ?? null);
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
      const g = live.geometry!;
      const point = new THREE.Vector3();
      if (bolt) {
        // Strike-independent: the envelope every strike of this bolt fits in.
        for (const p of lightningBounds(g, boltSeed)) push(p.applyMatrix4(matrix));
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
        for (let step = 0; step <= 10; step++) {
          const a = step / 10;
          const len = g.length * (a < 0.5 ? a * 0.9 : 0.45 + (a - 0.5) * 1.1);
          const taper = a * 2 - 1;
          const r =
            g.radius *
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
          const radius = r + 0.55 * amplitude * envelope * g.radius * 2.4;
          const gate = Math.min(1, Math.max(0, (a - 0.35) / 0.45));
          const lick = g.radius * amplitude * 6.2 * 0.6 * gate * gate * (3 - 2 * gate);
          const lift = g.length * 0.236 * a ** 2.3 + lick;
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
    // Per layer first, then the union: every visible layer claims room in the
    // frame, but a particle layer claims the box around its dense core.
    const box = new THREE.Box3();
    for (const object of this.objects) {
      const axes: number[][] = [[], [], []];
      const push = (p: THREE.Vector3) => {
        axes[0].push(p.dot(right));
        axes[1].push(p.dot(up));
        axes[2].push(p.dot(dir));
      };
      for (let i = 0; i <= steps; i++)
        object.bounds((doc.duration * i) / steps, push);
      if (!axes[0].length) continue;
      const lo = new THREE.Vector3();
      const hi = new THREE.Vector3();
      axes.forEach((values, axis) => {
        values.sort((a, b) => a - b);
        const cut = object.trim ? Math.floor(values.length * 0.04) : 0;
        lo.setComponent(axis, values[cut]);
        hi.setComponent(axis, values[values.length - 1 - cut]);
      });
      box.expandByPoint(lo);
      box.expandByPoint(hi);
    }
    if (box.isEmpty()) {
      this.frame = { center: new THREE.Vector3(0, 0.75, 0), distance: 6 };
      return;
    }
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
    const center = box.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(doc.camera.fov / 2));
    const framing = Math.max(0.1, doc.camera.framing);
    const aspect = Math.max(0.2, this.camera.aspect);
    const distance = Math.max(
      1,
      size.y / framing / (2 * tan),
      size.x / framing / (2 * tan * aspect),
      size.z / 2 + 1,
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
    this.post.apply(doc, {
      post: this.flags.post && !diagnostic,
      aa: this.flags.aa,
    });

    if (this.flags.softParticles && this.objects.some((o) => o.soft)) {
      // Depth pre-pass: opaque receivers only (ground + any depth-writing mesh).
      const hidden: THREE.Object3D[] = [];
      for (const object of this.objects)
        if (object.object.visible) {
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

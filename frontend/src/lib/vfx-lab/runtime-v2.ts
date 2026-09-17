import {
  smokeLightingUniforms,
  updateSmokeLighting,
} from "./smoke-lighting-v2";
import { layerBuildKey } from "./layer-build-key";
import type { IUniform } from "three";
import * as THREE from "three/webgpu";
import { createV2NodeMaterial, type V2NodeMaterial } from "./node-material-v2";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGeometry } from "./geometry";
import { createEnvironment, type EnvironmentV2 } from "./environment-v2";
import { createPostStack, type PostStackV2 } from "./post-v2";
import { evaluateLayerV2Readonly as evaluateLayerV2 } from "./evaluate-v2";
import { pathEvents, resolveEventWindows } from "./events-v2";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";
import { textureUrl } from "./asset-urls";
import {
  validateDocumentV2,
  validateWorkspaceDocumentV2,
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
import { buildRibbonGeometry, ribbonBounds, sampleCurve } from "./ribbon-v2";
import { buildWireBurstGeometry, wireBurstBounds } from "./wire-burst-v2";
import { arcBounds, buildArcsGeometry } from "./arcs-v2";
import { buildStreakGeometry, streakBurstBounds } from "./streak-burst-v2";
import { blobLobes, blobBounds, lobeStateAt } from "./blob-v2";
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
  RADIAL_CUTOFF,
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
import {
  sheetGeometry,
  sheetInstances,
  sheetStateAt,
  sheetsBounds,
} from "./sheets-v2";
import {
  arcFrame,
  arcPoint,
  arcTangent,
  buildCrescentGeometry,
  crescentBounds,
  crescentWindowAt,
  sampleCrescentCurve,
} from "./crescent-v2";
import { buildLicksGeometry } from "./licks-v2";

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
  path: 8,
  layerInstances: 9,
  pathLine: 10,
  frame: 11,
  orbit: 12,
  radialFan: 13,
};
const VELOCITY_INDEX: Record<string, number> = {
  radial: 0,
  directional: 1,
  tangential: 2,
  cone: 3,
  alongPath: 4,
  orbit: 5,
};
const RENDER_INDEX: Record<string, number> = {
  billboard: 0,
  velocityStretch: 1,
  horizontal: 2,
  vertical: 3,
  pathAligned: 4,
  // flatStrip and sliver draw through their own vertex programs, but the
  // indices still have to exist so the uniform and the CPU mirror agree on the
  // mode.
  flatStrip: 5,
  sliver: 6,
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
  lensFlare: 17,
  radialRays: 18,
  swirlDisc: 19,
  teardropStreak: 20,
  // The drawn symbols. They take their colour from material.symbol, not from
  // the ramp, and both the mesh and the particle fragment branch on >= 21.
  starSolid: 21,
  face: 22,
  heart: 23,
  crescent: 24,
  cloudLobe: 25,
  bolt: 26,
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
  event: 4,
  frontAnchored: 5,
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

  constructor(private readonly deferredImages = false) {
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
    if (!this.deferredImages) this.pending++;
    const texture = this.deferredImages ? new THREE.Texture() : this.loader.load(
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
    texture.userData.avfxSource = url;
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
  unit: new THREE.Vector3(),
  sphere: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  a1: new THREE.Vector3(),
  a2: new THREE.Vector3(),
  origin: new THREE.Vector3(),
  base: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  front: new THREE.Vector3(),
  radial: new THREE.Vector3(),
  turned: new THREE.Vector3(),
  cross: new THREE.Vector3(),
  t1: new THREE.Vector3(),
  t2: new THREE.Vector3(),
  force: new THREE.Vector3(),
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
  /** The layer's own span and path, for the two path-driven modes. */
  span = 1,
  path: PathV2 | null = null,
  /** Borrowed spawn sites, for shape "layerInstances". */
  sites: { positions: Float32Array; axes: Float32Array } | null = null,
  /** Path events, for spawn.mode "event"; layer-local seconds. */
  events: Array<{ position: [number, number, number]; time: number }> = [],
  /** The source crescent's front, for spawn.mode "frontAnchored". */
  front: {
    tail: Curve;
    span: number;
    start: number;
    point: (s: number, out: THREE.Vector3) => THREE.Vector3;
  } | null = null,
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
  } else if (emitter.spawn.mode === "event" && events.length) {
    const event = events[index % events.length];
    age = time - (event.time + ((s0 * 7.13 + 0.37) % 1) * spawnWindow);
  } else if (emitter.spawn.mode === "pathAnchored" && emitter.spawn.headCurve) {
    age =
      time - invertCurve(emitter.spawn.headCurve, attrs.index[index]) * span;
  } else if (emitter.spawn.mode === "frontAnchored" && front) {
    // The instance's own arc parameter is its s0 hash; the birth is the source
    // crescent's tail curve inverted at it, exactly as in the vertex program.
    age = time - (invertCurve(front.tail, s0) * front.span + front.start);
  } else {
    age = time - s0 * spawnWindow;
  }
  if (age < 0 || age >= life) return false;

  const ca = e0 * Math.PI * 2;
  const cz = e1 * 2 - 1;
  const cr = Math.sqrt(Math.max(0, 1 - cz * cz));
  const unit = particleScratch.unit.set(
    cr * Math.cos(ca),
    cz,
    cr * Math.sin(ca),
  );
  const fill = emitter.shape.surfaceOnly ? 1 : Math.sqrt(Math.max(e2, 0));
  const sph = particleScratch.sphere.copy(unit).multiplyScalar(fill);
  const bias = emitter.shape.bias;
  sph.set(
    sph.x + (Math.abs(sph.x) - sph.x) * clamp01(bias[0]),
    sph.y + (Math.abs(sph.y) - sph.y) * clamp01(bias[1]),
    sph.z + (Math.abs(sph.z) - sph.z) * clamp01(bias[2]),
  );

  if (emitter.spawn.mode === "frontAnchored" && front) {
    // A front-anchored instance sits ON the arc, wherever its own parameter is.
    front.point(s0, out);
    const dir = particleScratch.direction
      .set(s2 - 0.5, x3 - 0.5, s3 - 0.5)
      .normalize();
    const speed =
      emitter.velocity.speed[0] +
      (emitter.velocity.speed[1] - emitter.velocity.speed[0]) * x3;
    const drag = emitter.forces.drag;
    const travel = drag < 0.001 ? age : (1 - Math.exp(-drag * age)) / drag;
    out
      .addScaledVector(dir, speed * travel)
      .addScaledVector(
        particleScratch.force.fromArray(emitter.forces.gravity),
        0.5 * age * age,
      );
    return true;
  }

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
    case "radialFan": {
      const bias = Math.max(-1, Math.min(1, shape.angleBias));
      const ang =
        attrs.index[index] * Math.PI * 2 * (1 - 0.25 * Math.abs(bias)) +
        bias * Math.PI * 0.5 +
        (e0 - 0.5) * shape.angleJitter;
      origin
        .addScaledVector(a1, Math.cos(ang) * shape.radius)
        .addScaledVector(a2, Math.sin(ang) * shape.radius);
      break;
    }
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
    case "pathLine": {
      // Scattered along the path at its own hashed u, not at i/(count-1).
      if (!path) break;
      const u = (s2 * 7.31 + s3 * 3.17) % 1;
      const tangent = new THREE.Vector3().fromArray(pathTangent(path, u));
      const side = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .add(new THREE.Vector3(1e-5, 0, 0))
        .normalize();
      const up = new THREE.Vector3().crossVectors(side, tangent).normalize();
      origin
        .fromArray(pathPoint(path, u))
        .addScaledVector(side, (e0 - 0.5) * 2 * shape.radius)
        .addScaledVector(up, (e1 - 0.5) * 2 * shape.radius)
        .addScaledVector(tangent, (e2 - 0.5) * shape.radius);
      break;
    }
    case "frame": {
      // The perimeter of a rectangle across shape.axis, with
      // shape.interiorFraction of the population scattered inside it instead.
      const hx = shape.radius;
      const hy = shape.length * 0.5;
      let px: number;
      let py: number;
      let nx = 0;
      let ny = 0;
      if (e3 < shape.interiorFraction) {
        px = (e0 * 2 - 1) * hx * 0.88;
        py = (e1 * 2 - 1) * hy * 0.9;
        const length = Math.hypot(px, py) || 1;
        nx = px / length;
        ny = py / length;
      } else {
        const per = 2 * hx + 2 * hy;
        const sign = e2 < 0.5 ? -1 : 1;
        const dd = e0 * per;
        if (dd < hx) {
          px = dd;
          py = -hy;
          ny = -1;
        } else if (dd < hx + 2 * hy) {
          px = hx;
          py = -hy + (dd - hx);
          nx = 1;
        } else {
          px = hx - (dd - hx - 2 * hy);
          py = hy;
          ny = 1;
        }
        px *= sign;
        nx *= sign;
        px += nx * (e1 - 0.3) * shape.innerRadius;
        py += ny * (e1 - 0.3) * shape.innerRadius;
      }
      origin
        .addScaledVector(a1, px)
        .addScaledVector(a2, py)
        .addScaledVector(axis, (e2 - 0.5) * shape.innerRadius);
      break;
    }
    case "orbit": {
      const rr =
        shape.innerRadius +
        (shape.radius - shape.innerRadius) * Math.sqrt(Math.max(e2, 0));
      origin
        .addScaledVector(a1, Math.cos(ca) * rr)
        .addScaledVector(a2, Math.sin(ca) * rr);
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

  // spawn.mode "event": the origin IS the path end the event happened at, with
  // the shape's own sample scattering the instance around it.
  if (emitter.spawn.mode === "event" && events.length) {
    const event = events[index % events.length];
    origin.set(
      event.position[0] + sph.x * shape.radius,
      event.position[1] + sph.y * shape.radius,
      event.position[2] + sph.z * shape.radius,
    );
  }

  // velocity.mode "orbit": the instance CIRCLES the emitter axis at its own
  // spawn radius, so there is no ballistic trajectory to integrate either.
  if (emitter.velocity.mode === "orbit") {
    const h = origin.dot(axis);
    const rad = particleScratch.radial.copy(origin).addScaledVector(axis, -h);
    const r = Math.max(rad.length(), 1e-4);
    const w =
      emitter.velocity.speed[1] *
      Math.pow(r / Math.max(shape.radius, 1e-3), -0.5);
    const angle = w * age;
    const turned = particleScratch.turned
      .copy(rad)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(
        particleScratch.cross.crossVectors(axis, rad),
        Math.sin(angle),
      );
    const bob =
      (x3 - 0.5) *
      emitter.velocity.speed[0] *
      Math.sin(age * (0.6 + 1.2 * attrs.extra2[i4]) + e0 * Math.PI * 2);
    out.copy(turned).addScaledVector(axis, h + bob);
    return true;
  }

  // velocity.mode "alongPath": the instance RUNS along the path on the shared
  // head envelope, so there is no ballistic trajectory to integrate at all.
  if (emitter.velocity.mode === "alongPath" && path) {
    const head = emitter.velocity.speedCurve
      ? curveAt(
          emitter.velocity.speedCurve,
          clamp01(time / Math.max(span, 1e-4)),
        )
      : 0;
    const lag =
      emitter.velocity.speed[0] +
      (emitter.velocity.speed[1] - emitter.velocity.speed[0]) * x3;
    out.fromArray(pathPoint(path, clamp01(head - lag))).add(origin);
    const floorSpec = emitter.forces.floor;
    if (floorSpec) {
      const dy = out.y - floorSpec.y;
      out.y = floorSpec.y + Math.max(dy, dy * floorSpec.softness);
    }
    return true;
  }

  const base = particleScratch.base.fromArray(emitter.velocity.direction);
  if (base.lengthSq() < 1e-10) base.set(0, 1, 0);
  base.normalize();
  const dir = particleScratch.direction.set(0, 0, 0);
  if (
    sites &&
    shape.type === "layerInstances" &&
    emitter.velocity.mode === "radial"
  )
    dir.fromArray(sites.axes, index * 3).normalize();
  else if (emitter.velocity.mode === "radial") {
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
  /**
   * True for a layer that writes depth and must therefore stay VISIBLE during
   * the soft-particle depth pre-pass: without it a blob's opaque lobes would
   * not occlude the particles drifting behind them. Everything else is hidden
   * for that pass so only real receivers end up in the depth texture.
   */
  occluder?: boolean;
  /** A second moment worth preparing, when the layer draws in a state its
   * midpoint never reaches — a blob switches blend state at opaqueUntil, and
   * the state is part of the pipeline. */
  warmAt?: number;
  /** The layer's own parts carry different blend states and open at different
   * times, so preparation has to show all of them at once. */
  warmAll?: boolean;
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

/**
 * material.flicker: the hashed STEP multiplier at layer-local `age`, centred on
 * 1 (1 - amount/2 .. 1 + amount/2). Computed on the CPU, once per layer per
 * frame, so every draw a layer owns — mesh, hull, split copies, trail — steps
 * together instead of each hashing its own. floor(age * rate) is the only
 * state, so a seek lands inside exactly the window playback was in.
 */
export function flickerAt(material: Material, age: number) {
  const spec = material.flicker;
  if (!spec || spec.amount <= 0) return 1;
  const step = Math.floor(Math.max(0, age) * spec.rate);
  let x = (step * 2.7 + 0.7) * 0.1031;
  x -= Math.floor(x);
  x *= x + 33.33;
  x *= x + x;
  return 1 + spec.amount * (x - Math.floor(x) - 0.5);
}

/**
 * material.stripes packed for the shader: (frequency, speed, phase, sharpness)
 * and (contrast, 0, 0, 0), three slots either way.
 */
function stripeUniforms(material: Material) {
  const stripes = material.stripes ?? [];
  return {
    uStripeA: {
      value: Array.from({ length: 3 }, (_, i) => {
        const s = stripes[i];
        return new THREE.Vector4(
          s?.frequency ?? 0,
          s?.speed ?? 0,
          s?.phase ?? 0,
          s?.sharpness ?? 0,
        );
      }),
    },
    uStripeB: {
      value: Array.from(
        { length: 3 },
        (_, i) => new THREE.Vector4(stripes[i]?.contrast ?? 0, 0, 0, 0),
      ),
    },
    uStripeN: { value: stripes.length },
  };
}

function writeStripes(uniforms: Record<string, IUniform>, material: Material) {
  const stripes = material.stripes ?? [];
  const a = uniforms.uStripeA.value as THREE.Vector4[];
  const b = uniforms.uStripeB.value as THREE.Vector4[];
  for (let i = 0; i < 3; i++) {
    const s = stripes[i];
    a[i].set(
      s?.frequency ?? 0,
      s?.speed ?? 0,
      s?.phase ?? 0,
      s?.sharpness ?? 0,
    );
    b[i].set(s?.contrast ?? 0, 0, 0, 0);
  }
  uniforms.uStripeN.value = stripes.length;
}

/** geometry.slab's tiers packed for the shader: (height, intensity) + colour. */
function slabUniforms(geometry: GeometryV2) {
  const tiers = geometry.slab?.tiers ?? [];
  return {
    uSlab: { value: geometry.type === "slab" && geometry.slab ? 1 : 0 },
    uSlabBase: { value: geometry.slab?.anchor === "base" ? 1 : 0 },
    uSlabTaper: { value: geometry.slab?.taper ?? 1 },
    uSlabN: { value: tiers.length },
    // Heights in 0..3, colours in 4..7: one uniform array, one uniform buffer.
    uSlabTier: {
      value: Array.from({ length: 8 }, (_, i) =>
        i < 4
          ? new THREE.Vector4(
              tiers[i]?.height ?? 0,
              tiers[i]?.intensity ?? 0,
              0,
              0,
            )
          : slabColour(tiers[i - 4]?.color),
      ),
    },
  };
}

/** A slab tier's colour in the second half of the packed tier array. */
function slabColour(hex: string | undefined) {
  const colour = new THREE.Color(hex ?? "#ffffff");
  return new THREE.Vector4(colour.r, colour.g, colour.b, 0);
}

function writeSlab(uniforms: Record<string, IUniform>, geometry: GeometryV2) {
  const tiers = geometry.slab?.tiers ?? [];
  const packed = uniforms.uSlabTier.value as THREE.Vector4[];
  for (let i = 0; i < 4; i++) {
    packed[i].set(tiers[i]?.height ?? 0, tiers[i]?.intensity ?? 0, 0, 0);
    packed[4 + i].copy(slabColour(tiers[i]?.color));
  }
  uniforms.uSlabN.value = tiers.length;
  uniforms.uSlabTaper.value = geometry.slab?.taper ?? 1;
}

/** Ramp space -> the shaders' uRampKeyMode. */
/**
 * material.streaks / creases / screentone / symbol: the surface line work and
 * the drawn-symbol palette, as uniforms. Every one of them is nullable, so an
 * absent field writes the "off" flag and costs one branch in the fragment.
 */
function lineWorkUniforms(material: Material): Record<string, IUniform> {
  const streaks = material.streaks;
  const creases = material.creases;
  const tone = material.screentone;
  const symbol = material.symbol;
  return {
    uStreakOn: { value: streaks ? 1 : 0 },
    uStreakRadiate: { value: streaks?.radiate ? 1 : 0 },
    uStreakA: {
      value: new THREE.Vector4(
        streaks?.frequency ?? 0,
        streaks?.pan ?? 0,
        streaks?.width ?? 0.03,
        streaks?.segmentation ?? 0,
      ),
    },
    uStreakB: {
      value: new THREE.Vector4(
        streaks?.intensity ?? 0,
        streaks?.fadeAlong[0] ?? 0,
        streaks?.fadeAlong[1] ?? 1,
        0,
      ),
    },
    uStreakCol: { value: new THREE.Color(streaks?.color ?? "#ffffff") },
    uCreaseOn: { value: creases ? 1 : 0 },
    uCrease: {
      value: new THREE.Vector3(
        creases?.frequency ?? 0,
        creases?.depth ?? 0,
        creases?.alongStart ?? 0,
      ),
    },
    uScreenOn: { value: tone ? 1 : 0 },
    uScreenPitch: { value: tone?.pitch ?? 0.05 },
    uScreenWorld: { value: tone?.space === "world" ? 1 : 0 },
    uScreenCol: { value: new THREE.Color(tone?.color ?? "#ffffff") },
    uSymFill: { value: new THREE.Color(symbol?.fill ?? "#ffffff") },
    uSymOutline: { value: new THREE.Color(symbol?.outline ?? "#ffffff") },
    uSymHigh: { value: new THREE.Color(symbol?.highlight ?? "#ffffff") },
    uSymInk: { value: new THREE.Color(symbol?.ink ?? "#000000") },
    uSymHot: { value: new THREE.Color(symbol?.hot?.color ?? "#ffffff") },
    uSymHotI: { value: symbol?.hot?.intensity ?? 0 },
    uSymHotA: { value: 0 },
    uSymbolSeed: { value: 0 },
  };
}

/** The same fields, re-read from the LIVE material every frame. */
function writeLineWork(
  uniforms: Record<string, IUniform>,
  material: Material,
  /** The layer's own 0..1 progress; the hot core's alpha track runs on it. */
  u: number,
) {
  const streaks = material.streaks;
  const creases = material.creases;
  const tone = material.screentone;
  const symbol = material.symbol;
  uniforms.uStreakOn.value = streaks ? 1 : 0;
  uniforms.uStreakRadiate.value = streaks?.radiate ? 1 : 0;
  (uniforms.uStreakA.value as THREE.Vector4).set(
    streaks?.frequency ?? 0,
    streaks?.pan ?? 0,
    streaks?.width ?? 0.03,
    streaks?.segmentation ?? 0,
  );
  (uniforms.uStreakB.value as THREE.Vector4).set(
    streaks?.intensity ?? 0,
    streaks?.fadeAlong[0] ?? 0,
    streaks?.fadeAlong[1] ?? 1,
    0,
  );
  (uniforms.uStreakCol.value as THREE.Color).set(streaks?.color ?? "#ffffff");
  uniforms.uCreaseOn.value = creases ? 1 : 0;
  (uniforms.uCrease.value as THREE.Vector3).set(
    creases?.frequency ?? 0,
    creases?.depth ?? 0,
    creases?.alongStart ?? 0,
  );
  uniforms.uScreenOn.value = tone ? 1 : 0;
  uniforms.uScreenPitch.value = tone?.pitch ?? 0.05;
  uniforms.uScreenWorld.value = tone?.space === "world" ? 1 : 0;
  (uniforms.uScreenCol.value as THREE.Color).set(tone?.color ?? "#ffffff");
  if (!symbol) {
    uniforms.uSymHotA.value = 0;
    return;
  }
  (uniforms.uSymFill.value as THREE.Color).set(symbol.fill);
  (uniforms.uSymOutline.value as THREE.Color).set(symbol.outline);
  (uniforms.uSymHigh.value as THREE.Color).set(symbol.highlight);
  (uniforms.uSymInk.value as THREE.Color).set(symbol.ink);
  if (symbol.hot) {
    (uniforms.uSymHot.value as THREE.Color).set(symbol.hot.color);
    uniforms.uSymHotI.value = symbol.hot.intensity;
    uniforms.uSymHotA.value = clamp01(curveAt(symbol.hot.alpha, u));
  } else {
    uniforms.uSymHotA.value = 0;
  }
}

const RAMP_KEY_MODES: Record<string, number> = {
  life: 0,
  layerTime: 1,
  surface: 2,
  height: 3,
  radial: 4,
  sprite: 5,
};

function rampKeyMode(material: Material) {
  return RAMP_KEY_MODES[material.ramp.space] ?? 0;
}

/**
 * material.ramp.blend as two uniforms: which space to mix in and how much of
 * it. Weight 0 (no blend) is the switch the fragment tests, so an unblended
 * ramp costs one comparison and nothing else.
 */
function rampBlendUniforms(material: Material) {
  const blend = material.ramp.blend;
  return {
    uRampBlendMode: { value: blend ? (RAMP_KEY_MODES[blend.space] ?? 0) : 0 },
    uRampBlendWeight: { value: blend ? blend.weight : 0 },
  };
}

function writeRampBlend(
  uniforms: Record<string, IUniform>,
  material: Material,
) {
  const blend = material.ramp.blend;
  uniforms.uRampBlendMode.value = blend
    ? (RAMP_KEY_MODES[blend.space] ?? 0)
    : 0;
  uniforms.uRampBlendWeight.value = blend ? blend.weight : 0;
}

/**
 * material.swirl.strength at layer-local progress `u`: how hard the polar
 * swirl bites, 0 straight noise and 1 a tight spiral. Sampled on the CPU so
 * every draw a swirl layer owns winds by the same amount on the same frame.
 */
export function swirlStrengthAt(material: Material, u: number) {
  const curve = material.swirl?.strength;
  if (!curve) return 1;
  return curveAt(curve, u);
}

/**
 * Metres of halo room a frame card carries outside its own bar. The rim's
 * widest skirt is an exponential, so the card has to be a few bar widths
 * bigger than the frame or the glow is cut off square.
 */
const FRAME_MARGIN = 4.4;

function frameMargin(geometry: GeometryV2) {
  return Math.max(0.25, geometry.thickness * FRAME_MARGIN);
}

/** material.sdfLine / material.beads / material.flow / material.swirl. */
function rimUniforms(material: Material, geometry: GeometryV2 | undefined) {
  const line = material.sdfLine;
  const beads = material.beads;
  const flow = material.flow;
  const swirl = material.swirl;
  const flowLayers = flow?.layers ?? [];
  return {
    uFrame: { value: geometry?.type === "frame" ? 1 : 0 },
    uFrameV: { value: geometry?.type === "frame" ? 1 : 0 },
    uFrameMargin: { value: geometry ? frameMargin(geometry) : 0 },
    uCorner: { value: geometry?.frame?.corner ?? 0 },
    uSdfN: { value: line?.halo.length ?? 0 },
    uSdfCore: { value: line?.core ?? 0 },
    uSdfSpine: { value: line?.spine ?? 0 },
    uSdfInnerOff: { value: line?.innerOffset ?? 0 },
    uSdfInnerW: { value: line?.innerWidth ?? 0 },
    uSdfHalo: {
      value: Array.from(
        { length: 3 },
        (_, i) =>
          new THREE.Vector2(
            line?.halo[i]?.falloff ?? 1,
            line?.halo[i]?.weight ?? 0,
          ),
      ),
    },
    uBeadOn: { value: beads ? 1 : 0 },
    uBeads: {
      value: new THREE.Vector3(
        beads?.count ?? 0,
        beads?.speed ?? 0,
        beads?.width ?? 0.05,
      ),
    },
    uFlowOn: { value: flow ? 1 : 0 },
    uFlowN: { value: flowLayers.length },
    // Layers in 0..3, their mix weights in 4..7: one array, one uniform buffer.
    uFlowLayer: {
      value: Array.from({ length: 8 }, (_, i) => {
        if (i >= 4) return new THREE.Vector4(flow?.mix[i - 4] ?? 0, 0, 0, 0);
        const l = flowLayers[i];
        return new THREE.Vector4(
          l?.scale ?? 1,
          l?.pan[0] ?? 0,
          l?.pan[1] ?? 0,
          l?.rotate ?? 0,
        );
      }),
    },
    uFlowCut: {
      value: new THREE.Vector3(
        flow?.threshold ?? 0,
        flow?.softness ?? 0.1,
        flow?.parallax ?? 0,
      ),
    },
    uSwirlOn: { value: swirl ? 1 : 0 },
    uSwirlBands: {
      value: new THREE.Vector4(
        swirl?.bands.arms ?? 0,
        swirl?.bands.wind ?? 0,
        swirl?.bands.width ?? 0.5,
        swirl?.bands.warp ?? 0,
      ),
    },
    uSwirlDetail: {
      value: new THREE.Vector4(
        swirl?.detail.arms ?? 0,
        swirl?.detail.wind ?? 0,
        swirl?.detail.warp ?? 0,
        swirl?.detail.contrast ?? 0,
      ),
    },
    uSwirlLobe: {
      value: new THREE.Vector3(
        swirl?.lobe.scale1 ?? 1,
        swirl?.lobe.scale2 ?? 1,
        swirl?.lobe.amount ?? 0,
      ),
    },
    uSwirlS: { value: 1 },
  };
}

/** Re-reads every rim/flow/swirl field off the LIVE material each frame. */
function writeRim(
  uniforms: Record<string, IUniform>,
  material: Material,
  geometry: GeometryV2 | undefined,
  u: number,
) {
  const line = material.sdfLine;
  if (line) {
    uniforms.uSdfCore.value = line.core;
    uniforms.uSdfSpine.value = line.spine;
    uniforms.uSdfInnerOff.value = line.innerOffset;
    uniforms.uSdfInnerW.value = line.innerWidth;
    uniforms.uSdfN.value = line.halo.length;
    const halo = uniforms.uSdfHalo.value as THREE.Vector2[];
    for (let i = 0; i < 3; i++)
      halo[i].set(line.halo[i]?.falloff ?? 1, line.halo[i]?.weight ?? 0);
  }
  if (material.beads)
    (uniforms.uBeads.value as THREE.Vector3).set(
      material.beads.count,
      material.beads.speed,
      material.beads.width,
    );
  if (material.flow) {
    const packed = uniforms.uFlowLayer.value as THREE.Vector4[];
    material.flow.layers.forEach((l, i) => {
      packed[i].set(l.scale, l.pan[0], l.pan[1], l.rotate);
      packed[4 + i].set(material.flow!.mix[i] ?? 0, 0, 0, 0);
    });
    uniforms.uFlowN.value = material.flow.layers.length;
    (uniforms.uFlowCut.value as THREE.Vector3).set(
      material.flow.threshold,
      material.flow.softness,
      material.flow.parallax,
    );
  }
  if (material.swirl) {
    (uniforms.uSwirlBands.value as THREE.Vector4).set(
      material.swirl.bands.arms,
      material.swirl.bands.wind,
      material.swirl.bands.width,
      material.swirl.bands.warp,
    );
    (uniforms.uSwirlDetail.value as THREE.Vector4).set(
      material.swirl.detail.arms,
      material.swirl.detail.wind,
      material.swirl.detail.warp,
      material.swirl.detail.contrast,
    );
    (uniforms.uSwirlLobe.value as THREE.Vector3).set(
      material.swirl.lobe.scale1,
      material.swirl.lobe.scale2,
      material.swirl.lobe.amount,
    );
  }
  uniforms.uSwirlS.value = swirlStrengthAt(material, u);
  if (geometry) {
    uniforms.uCorner.value = geometry.frame?.corner ?? 0;
    uniforms.uFrameMargin.value = frameMargin(geometry);
  }
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
    [`u${P}PlanarDrag`]: { value: emitter.forces.planarDrag },
    [`u${P}Interior`]: { value: emitter.shape.interiorFraction },
    [`u${P}AngleJitter`]: { value: emitter.shape.angleJitter },
    [`u${P}AngleBias`]: { value: emitter.shape.angleBias },
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
 * emitter.render.mode "flatStrip": one tapered lick per instance. `position`
 * carries (s along the lick 0..1, side -1..1, 0) and `uv` mirrors it, so the
 * vertex program can shape the lick without any per-instance buffer beyond the
 * ordinary particle attributes.
 */
function celStripGeometry(segments = 16) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    positions.push(t, -1, 0, t, 1, 0);
    uvs.push(t, 0, t, 1);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices,
  };
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
 * WebGPU binds at most eight vertex buffers per pipeline, and a particle draw
 * needs more per-instance fields than that once spawn sites, resolved events
 * and a sub-emitter's parent attributes are all in play. Every instance field
 * shares one interleaved buffer, so the draw costs one vertex buffer whatever
 * the emitter uses. The shader still sees ordinary named attributes.
 */
function instanceAttributes(
  count: number,
  fields: { name: string; items: number; data?: Float32Array }[],
  /** Instance i of the result reads source instance `source(i)`. */
  source: (index: number) => number = (index) => index,
) {
  const stride = fields.reduce((total, field) => total + field.items, 0);
  const array = new Float32Array(count * stride);
  const buffer = new THREE.InstancedInterleavedBuffer(array, stride, 1);
  const attributes: Record<string, THREE.InterleavedBufferAttribute> = {};
  const placed: { items: number; offset: number; data?: Float32Array }[] = [];
  let offset = 0;
  for (const field of fields) {
    placed.push({ items: field.items, offset, data: field.data });
    attributes[field.name] = new THREE.InterleavedBufferAttribute(
      buffer,
      field.items,
      offset,
    );
    offset += field.items;
  }
  /** Fill instance `i` from source instance `order(i)`. */
  const write = (order: (index: number) => number) => {
    for (const field of placed) {
      if (!field.data) continue;
      for (let i = 0; i < count; i++) {
        const from = order(i) * field.items;
        for (let k = 0; k < field.items; k++)
          array[i * stride + field.offset + k] = field.data[from + k] ?? 0;
      }
    }
    buffer.needsUpdate = true;
  };
  write(source);
  return { buffer, attributes, write, array, stride };
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
    parentLayer && parentLayer.kind === "particles"
      ? parentLayer.emitter!
      : null;
  const parentAttrs = parentEmitter
    ? makeAttributes(
        Math.max(1, Math.round(parentEmitter.count * density)),
        hashSeed(doc.seed, parentLayer!.id),
      )
    : null;

  const cel = emitter.render.mode === "flatStrip";
  // A sliver draws through its own vertex program on the same (s, side) strip
  // the cel lick uses: the silhouette is the strip, so there is no quad.
  const needle = emitter.render.mode === "sliver";
  const plane = cel || needle ? null : new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  if (plane) {
    geometry.index = plane.index;
    geometry.attributes.position = plane.attributes.position;
    geometry.attributes.uv = plane.attributes.uv;
  } else {
    const strip = celStripGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(strip.positions, 3),
    );
    geometry.setAttribute("uv", new THREE.BufferAttribute(strip.uvs, 2));
    geometry.setIndex(strip.indices);
  }
  // emitter.shape "layerInstances": the spawn sites come from the SOURCE
  // layer's own generator hash, computed once here and uploaded as instance
  // attributes. That keeps the burst closed form — nothing is read back out of
  // the source layer at draw time, so the two layers cannot disagree however
  // they are ordered.
  const sites = borrowedSites(doc, layer, count);
  // emitter.spawn.mode "event": the moment and the origin of the impact this
  // instance belongs to, resolved once from the paths (see events-v2.ts) and
  // uploaded as one attribute. Instance i takes event i % events.length, so a
  // SINGLE layer carries the debris of every impact in the document.
  const events =
    emitter.spawn.originsFromPath && emitter.spawn.mode === "event"
      ? pathEvents(doc, emitter.shape.pathId)
      : [];
  const packedEvents = new Float32Array(count * 4);
  for (let i = 0; events.length && i < count; i++) {
    const event = events[i % events.length];
    packedEvents[i * 4] = event.position[0];
    packedEvents[i * 4 + 1] = event.position[1];
    packedEvents[i * 4 + 2] = event.position[2];
    // Layer-LOCAL seconds, the domain every birth in the shader is in.
    packedEvents[i * 4 + 3] = event.time - layer.start;
  }
  // The CPU mirror runs in the same LAYER-LOCAL seconds the shader does.
  const localEvents = events.map((event) => ({
    position: event.position,
    time: event.time - layer.start,
  }));
  // One particle program covers every emitter: the branches that read the
  // optional fields are gated on uniforms, so they are always bound and simply
  // hold zeros when the layer borrows no sites and resolves no events.
  // aSub identifies which secondary bit an instance is (render.mode "sliver");
  // the primary draw is all zeros.
  const instanceFields = [
    { name: "aSeed", items: 4, data: Float32Array.from(attrs.seed) },
    { name: "aExtra", items: 4, data: Float32Array.from(attrs.extra) },
    { name: "aExtra2", items: 4, data: Float32Array.from(attrs.extra2) },
    { name: "aIndex", items: 1, data: Float32Array.from(attrs.index) },
    { name: "aSub", items: 1 },
    {
      name: "aSrcPos",
      items: 3,
      data: sites ? sites.positions : new Float32Array(count * 3),
    },
    {
      name: "aSrcDir",
      items: 3,
      data: sites ? sites.axes : new Float32Array(count * 3),
    },
    { name: "aEvent", items: 4, data: packedEvents },
  ];
  if (parentAttrs) {
    // A child instance inherits its parent's hashes, cycling if there are fewer
    // parents than children.
    const wrap = (data: Float32Array) => {
      const out = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const from = (i % parentAttrs.count) * 4;
        for (let k = 0; k < 4; k++) out[i * 4 + k] = data[from + k];
      }
      return out;
    };
    instanceFields.push(
      { name: "aPSeed", items: 4, data: wrap(parentAttrs.seed) },
      { name: "aPExtra", items: 4, data: wrap(parentAttrs.extra) },
      { name: "aPExtra2", items: 4, data: wrap(parentAttrs.extra2) },
    );
  }
  const instances = instanceAttributes(count, instanceFields);
  for (const [name, attribute] of Object.entries(instances.attributes))
    geometry.setAttribute(name, attribute);
  geometry.instanceCount = count;
  plane?.dispose();

  // spawn.mode "frontAnchored": the crescent whose tail front these instances
  // are born behind. Its arc is re-expressed in THIS layer's own space every
  // frame, so a track on either transform keeps the two in step.
  const frontSource =
    emitter.spawn.mode === "frontAnchored" && emitter.spawn.sourceLayerId
      ? (doc.layers.find((l) => l.id === emitter.spawn.sourceLayerId) ?? null)
      : null;
  const frontSpec = frontSource?.crescent ?? null;
  // The CPU mirror of that arc, for depth sorting and framing. The offset
  // between the two layer origins is enough here: bounds are a box, so the
  // sub-degree difference a rotation would add is below the trim anyway.
  const frontMirror =
    frontSource && frontSpec
      ? {
          tail: frontSpec.window.tail,
          span: Math.max(frontSource.end - frontSource.start, 1e-4),
          start: frontSource.start - layer.start,
          point: (sArc: number, out: THREE.Vector3) =>
            arcPoint(frontSpec, sArc, out).add(
              new THREE.Vector3()
                .fromArray(frontSource.transform.position)
                .sub(new THREE.Vector3().fromArray(layer.transform.position)),
            ),
        }
      : null;

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

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uSpan: { value: span },
    uTwinkleFreq: { value: emitter.render.twinkle?.frequency ?? 1 },
    uTwinkleDepth: { value: emitter.render.twinkle?.depth ?? 0 },
    uAnchorHead: { value: emitter.render.anchor === "head" ? 1 : 0 },
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
    ...smokeLightingUniforms(material.shading === "litSmoke"),
    uOpacity: { value: material.opacity },
    uRampKeyMode: { value: rampKeyMode(material) },
    ...rampBlendUniforms(material),
    uGroundY: { value: doc.environment.groundY },
    uHeightSpan: { value: material.ramp.heightSpan },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
    uProcedural: { value: proceduralIndex(material) },
    tDepth: { value: depth },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: CAMERA_NEAR },
    uFar: { value: CAMERA_FAR },
    uSoft: { value: material.softParticle },
    // render.mode "sliver": the needle's own shape, its retract and the short
    // secondary bits strung along it.
    uSliverLen: {
      value: new THREE.Vector2().fromArray(
        emitter.render.sliver?.length ?? [1, 1],
      ),
    },
    uSliverWide: {
      value: new THREE.Vector2().fromArray(
        emitter.render.sliver?.width ?? [0.1, 0.1],
      ),
    },
    uSliverCurve: { value: emitter.render.sliver?.curve ?? 0 },
    uSliverTaper: { value: emitter.render.sliver?.taper ?? 1.6 },
    uSliverJag: { value: emitter.render.sliver?.jaggedness ?? 0 },
    uRetractOn: { value: emitter.render.retract ? 1 : 0 },
    uRetractStart: { value: emitter.render.retract?.start ?? 0 },
    uRetractEnd: { value: emitter.render.retract?.end ?? 1 },
    uRetractTip: { value: emitter.render.retract?.from === "tip" ? 1 : 0 },
    uSecondary: { value: 0 },
    uSecLength: { value: emitter.render.secondary?.length ?? 0.2 },
    uSecAlong: {
      value: new THREE.Vector2().fromArray(
        emitter.render.secondary?.along ?? [0.2, 0.8],
      ),
    },
    // spawn.mode "frontAnchored": the source crescent's arc, in this layer's
    // own space, plus the tail curve (slot "T") whose inverse IS the birth.
    uFrontC: { value: new THREE.Vector3() },
    uFrontEx: { value: new THREE.Vector3(1, 0, 0) },
    uFrontEy: { value: new THREE.Vector3(0, 1, 0) },
    uFrontN: { value: new THREE.Vector3(0, 0, 1) },
    uFrontR: { value: frontSpec?.radius ?? 1 },
    uFrontPh0: { value: frontSpec?.phase ?? 0 },
    uFrontSweep: { value: frontSpec?.sweep ?? 0 },
    uFrontSpan: {
      value: frontSource
        ? Math.max(frontSource.end - frontSource.start, 1e-4)
        : 1,
    },
    uFrontStart: { value: frontSource ? frontSource.start - layer.start : 0 },
    ...curveUniforms("T", frontSpec?.window.tail ?? null),
    ...stripeUniforms(material),
    ...lineWorkUniforms(material),
    // material.flicker, and the flatStrip lick's own flipbook parameters.
    uFlicker: { value: 1 },
    uStripStep: { value: emitter.render.strip?.stepRate ?? 10 },
    uStripWave: { value: emitter.render.strip?.waviness ?? 0 },
    uPalettes: { value: emitter.render.strip?.palettes ?? 1 },
    uStripCount: { value: count },
    uStripLen: {
      value: new THREE.Vector2().fromArray(
        emitter.render.strip?.length ?? [1, 1],
      ),
    },
    uStripWide: {
      value: new THREE.Vector2().fromArray(
        emitter.render.strip?.width ?? [0.1, 0.1],
      ),
    },
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

  const shaderMaterial = createV2NodeMaterial(
    cel
      ? "strip"
      : needle
        ? "sliver"
        : parentEmitter
          ? "subParticle"
          : "particle",
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
  let trailUniforms: Record<string, IUniform> | null = null;
  if (trail) {
    const strip = trailStripGeometry(trail.segments);
    trailGeometry = new THREE.InstancedBufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(strip.positions, 3),
    );
    trailGeometry.setIndex(strip.indices);
    // The ribbon walks the very same instances as the sprite draw, so it shares
    // the one interleaved buffer rather than uploading a second copy.
    for (const [name, attribute] of Object.entries(instances.attributes))
      trailGeometry.setAttribute(name, attribute);
    trailGeometry.instanceCount = count;
    // The ribbon shares every uniform OBJECT with the sprite draw — one write
    // per frame moves both — except its ramp, which is its own so a trail can
    // be keyed head-to-tail while the sprite it trails is keyed on age.
    trailUniforms = {
      ...uniforms,
      ...rampUniforms(trail.ramp ?? material.ramp),
      uTrailRampMode: { value: trail.ramp?.space === "along" ? 1 : 0 },
    };
    trailMaterial = createV2NodeMaterial(
      parentEmitter ? "subTrail" : "trail",
      trailUniforms,
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

  // render.secondary: a SECOND draw of the same needle program over the same
  // instance attributes repeated `perInstance` times, with aSub telling each
  // copy which bit it is. One layer, so a bit can never drift off the ray it
  // belongs to — it re-derives that ray from the very same hashes.
  let secondaryGeometry: THREE.InstancedBufferGeometry | null = null;
  let secondaryMaterial: V2NodeMaterial | null = null;
  const secondary = needle ? emitter.render.secondary : null;
  if (secondary && secondary.perInstance > 0) {
    const per = secondary.perInstance;
    const total = count * per;
    secondaryGeometry = new THREE.InstancedBufferGeometry();
    secondaryGeometry.index = geometry.index;
    secondaryGeometry.attributes.position = geometry.attributes.position;
    secondaryGeometry.attributes.uv = geometry.attributes.uv;
    // Each secondary bit reads the same instance as the needle it belongs to,
    // plus its own aSub, out of one interleaved buffer of its own.
    const subs = new Float32Array(total);
    for (let i = 0; i < total; i++) subs[i] = (i % per) + 1;
    const secondaryInstances = instanceAttributes(
      total,
      instanceFields.map((field) =>
        field.name === "aSub" ? { ...field, data: subs } : field,
      ),
      (index) => Math.floor(index / per),
    );
    // aSub is per copy, not per needle, so it is written straight through.
    for (let i = 0; i < total; i++)
      (
        secondaryInstances.attributes.aSub as THREE.InterleavedBufferAttribute
      ).setX(i, subs[i]);
    for (const [name, attribute] of Object.entries(
      secondaryInstances.attributes,
    ))
      secondaryGeometry.setAttribute(name, attribute);
    secondaryGeometry.instanceCount = total;
    // A shallow copy: every IUniform object is shared, so the per-frame writes
    // reach both draws and only uSecondary differs.
    secondaryMaterial = createV2NodeMaterial(
      "sliver",
      { ...uniforms, uSecondary: { value: 1 } },
      {
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        ...blendingFor(material.blend),
      },
    );
    const bits = new THREE.Mesh(secondaryGeometry, secondaryMaterial);
    bits.name = `${layer.id}-secondary`;
    bits.frustumCulled = false;
    bits.renderOrder = index;
    group.add(bits);
  }

  /**
   * The source crescent's arc, re-expressed in THIS layer's own space. Both
   * transforms are live, so a track on either keeps the embers on the blade.
   */
  const writeFrontArc = (time: number) => {
    if (!frontSource || !frontSpec) return;
    const live = evaluateLayerV2(frontSource, time).layer;
    const spec = live.crescent!;
    const source = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(live.transform.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...live.transform.rotation),
      ),
      new THREE.Vector3().fromArray(live.transform.scale),
    );
    const here = evaluateLayerV2(layer, time).layer;
    const mine = new THREE.Matrix4()
      .compose(
        new THREE.Vector3().fromArray(here.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...here.transform.rotation),
        ),
        new THREE.Vector3().fromArray(here.transform.scale),
      )
      .invert();
    const relative = mine.multiply(source);
    const basis = arcFrame(spec);
    (uniforms.uFrontC.value as THREE.Vector3)
      .set(0, 0, 0)
      .applyMatrix4(relative);
    const rotation = new THREE.Matrix3().setFromMatrix4(relative);
    (uniforms.uFrontEx.value as THREE.Vector3)
      .copy(basis.ex)
      .applyMatrix3(rotation)
      .normalize();
    (uniforms.uFrontEy.value as THREE.Vector3)
      .copy(basis.ey)
      .applyMatrix3(rotation)
      .normalize();
    (uniforms.uFrontN.value as THREE.Vector3)
      .copy(basis.normal)
      .applyMatrix3(rotation)
      .normalize();
    uniforms.uFrontR.value = spec.radius;
    uniforms.uFrontPh0.value = spec.phase;
    uniforms.uFrontSweep.value = spec.sweep;
    writeCurve(uniforms, "T", spec.window.tail);
  };

  const sortable =
    emitter.render.sortMode === "byDistance" &&
    count <= SORT_LIMIT &&
    material.blend !== "additive";
  // Secondary sliver instances have their own buffer and are not reordered by
  // the primary draw's CPU sort. Export the actual policy rather than guessing
  // it from the document on the adapter side.
  for (const child of group.children) {
    const geometry = (child as THREE.Mesh).geometry;
    child.userData.avfxSort = sortable && geometry?.getAttribute("aSeed") === instances.attributes.aSeed
      ? "back-to-front-instances" : "authored-seed-order";
  }
  const order = Array.from({ length: count }, (_, i) => i);
  const depths = new Float32Array(count);
  const scratch = new THREE.Vector3();

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft:
      material.softParticle > 0 ||
      layer.tracks.some((track) => track.target === "material.softParticle") ||
      layer.overrides.some(
        (override) => override.target === "material.softParticle",
      ),
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
      applyLayerFrame(group, layer, live, camera);

      if (parentLayer) {
        // Where the parent layer's transform was, sampled over its own live
        // window, relative to where this layer is now: the sub-emitter's
        // origins ride the parent's motion instead of this layer's.
        const table = uniforms.uParentPath.value as THREE.Vector3[];
        const dt = uniforms.uPathDt.value as number;
        for (let i = 0; i < CURVE_KEYS; i++) {
          const local = i * dt;
          const at = evaluateLayerV2(parentLayer, parentLayer.start + local);
          table[i].fromArray(at.layer.transform.position).sub(group.position);
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
      writeRampBlend(uniforms, m);
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
      uniforms.uFlicker.value = flickerAt(m, age);
      writeStripes(uniforms, m);
      writeLineWork(uniforms, m, clamp01(age / span));
      if (e.render.strip) {
        uniforms.uStripStep.value = e.render.strip.stepRate;
        uniforms.uStripWave.value = e.render.strip.waviness;
        (uniforms.uStripLen.value as THREE.Vector2).fromArray(
          e.render.strip.length,
        );
        (uniforms.uStripWide.value as THREE.Vector2).fromArray(
          e.render.strip.width,
        );
      }
      (uniforms.uProcParams.value as THREE.Vector4).fromArray(
        m.proceduralParams,
      );
      if (e.trail) {
        uniforms.uSegments.value = e.trail.segments;
        uniforms.uSpacing.value = e.trail.spacing;
        if (trailUniforms) {
          writeRamp(trailUniforms, e.trail.ramp ?? m.ramp);
          trailUniforms.uTrailRampMode.value =
            e.trail.ramp?.space === "along" ? 1 : 0;
        }
      }
      if (e.render.sliver) {
        (uniforms.uSliverLen.value as THREE.Vector2).fromArray(
          e.render.sliver.length,
        );
        (uniforms.uSliverWide.value as THREE.Vector2).fromArray(
          e.render.sliver.width,
        );
        uniforms.uSliverCurve.value = e.render.sliver.curve;
        uniforms.uSliverTaper.value = e.render.sliver.taper;
        uniforms.uSliverJag.value = e.render.sliver.jaggedness;
      }
      if (e.render.retract) {
        uniforms.uRetractStart.value = e.render.retract.start;
        uniforms.uRetractEnd.value = e.render.retract.end;
      }
      writeFrontArc(time);
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
          localEvents,
          frontMirror,
        )
          ? point.dot(view)
          : -Infinity;
      }
      order.sort((a, b) => depths[a] - depths[b]);
      // Every instance field rides the same permutation — the spawn site and
      // the resolved event identify the instance as much as its seed does, so a
      // sorted draw that left them behind would tear the emitter apart.
      instances.write((index) => order[index]);
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
            localEvents,
            frontMirror,
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
      secondaryGeometry?.dispose();
      secondaryMaterial?.dispose();
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
export function bandGeometry(geometry: GeometryV2) {
  const band = geometry.band!;
  const radius = geometry.radius;
  const dTheta = Math.min(
    Math.PI * 0.9,
    geometry.thickness / Math.max(radius, 1e-3),
  );
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
  if (geometry.type === "band" && geometry.band) return bandGeometry(geometry);
  // A lattice layer IS the sphere its cells wrap; geometry.radius scales it.
  if (layer.material?.lattice)
    return new THREE.IcosahedronGeometry(
      1,
      Math.max(3, Math.min(6, Math.round(geometry.segments / 12))),
    );
  if (shell)
    // The shell's teardrop is analytic (see surfaceVertexV2): the sphere is the
    // parametric domain, not the silhouette.
    return new THREE.SphereGeometry(
      1,
      Math.min(128, geometry.segments),
      Math.min(64, geometry.radialSegments),
    );
  // A slab carries no real geometry: the quad is rebuilt in view space every
  // frame from uLength/uThickness and the projected layer axis. It has to be
  // tested BEFORE the bar kinds, because a slab is usually a `beam`.
  if (geometry.type === "slab") return new THREE.PlaneGeometry(2, 2);
  // A frame is a flat card whose bar is a per-pixel SDF, so the buffer is the
  // same unit quad the slab uses and the live size is applied in the vertex
  // shader: a track on geometry.length really resizes the doorway.
  if (geometry.type === "frame") return new THREE.PlaneGeometry(2, 2);
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
    if (ripple.origin) return new THREE.Vector4(...ripple.origin, ripple.time);
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
  depth: THREE.DepthTexture,
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

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uLayerU: { value: 0 },
    uFlipMode: {
      value: material.mask.flipbook
        ? material.mask.flipbook.mode === "life"
          ? 1
          : 2
        : 0,
    },
    uFlipFps: { value: material.mask.flipbook?.fps ?? 12 },
    uAtlasCols: { value: material.mask.flipbook?.cols ?? 1 },
    uAtlasRows: { value: material.mask.flipbook?.rows ?? 1 },
    uRampKeyMode: { value: rampSpace },
    ...rampBlendUniforms(material),
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
    ...smokeLightingUniforms(
      material.shading === "litSmoke",
      layer.kind === "sprite",
    ),
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
    // Origins in 0..3, their (speed, width, decay) in 4..7.
    uRipple: {
      value: [...rippleOrigins(ripples, doc.seed), ...rippleParams(ripples)],
    },
    uBand: { value: geometry.type === "band" && geometry.band ? 1 : 0 },
    uBandStripes: { value: geometry.band?.stripes ?? 1 },
    // material.stripes / material.flicker / geometry.slab.
    uFlicker: { value: 1 },
    // kind "reflection" overwrites these on the mirrored copy; an ordinary
    // draw leaves them at "not a reflection".
    uReflect: { value: 0 },
    uReflectTint: { value: new THREE.Color("#ffffff") },
    uReflectOpacity: { value: 1 },
    uReflectBlur: { value: 0 },
    ...lineWorkUniforms(material),
    ...stripeUniforms(material),
    ...slabUniforms(geometry),
    ...rimUniforms(material, geometry),
    tDepth: { value: depth },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: CAMERA_NEAR },
    uFar: { value: CAMERA_FAR },
    uSoft: { value: material.softParticle },
    ...rampUniforms(material.ramp),
    ...curveUniforms("C", material.erosion?.curve ?? null),
    ...curveUniforms("F", vertexNoise?.alongCurve ?? null),
  };

  // A band is real geometry sorting against a body, so it writes depth: without
  // it the far arc of the belt glows through the dome it is meant to go behind.
  const isBand = geometry.type === "band" && !!geometry.band;
  const isSlab = geometry.type === "slab" && !!geometry.slab;
  const isFrame = geometry.type === "frame";
  const shaderMaterial = createV2NodeMaterial("surface", uniforms, {
    transparent: true,
    depthWrite: isBand && material.blend === "alpha",
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
    // The arc ribbon, the analytic shell, the bolt and the band build themselves
    // at their own radius, so only transform.scale applies on top of them.
    // A slab builds itself in view space from uLength/uThickness, so only
    // transform.scale applies on top of it — the same as the four above.
    // A frame sizes itself in the vertex shader from the live geometry, the
    // same way the four above do, so only transform.scale applies on top of it.
    if (ribbon || shell || bolt || isBand || isSlab || isFrame)
      return out.set(1, 1, 1);
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
  if (
    !shell &&
    !ribbon &&
    !bolt &&
    !flatCard &&
    !isBand &&
    !isSlab &&
    !isFrame &&
    !material.lattice
  ) {
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
        // Same uniform OBJECTS as the base draw, so every per-frame write
        // reaches all three copies; only uChannel is its own.
        createV2NodeMaterial(
          "surface",
          { ...uniforms, uChannel: { value: channel } },
          {
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            ...blendingFor(material.blend),
          },
        ),
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
    soft:
      material.softParticle > 0 ||
      layer.tracks.some((track) => track.target === "material.softParticle") ||
      layer.overrides.some(
        (override) => override.target === "material.softParticle",
      ),
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
      applyLayerFrame(mesh, layer, live, camera);
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
      uniforms.uSoft.value = flags.softParticles ? m.softParticle : 0;
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
      (uniforms.uProcParams.value as THREE.Vector4).fromArray(
        m.proceduralParams,
      );
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
      writeRampBlend(uniforms, m);
      uniforms.uGroundY.value = doc.environment.groundY;
      uniforms.uHeightSpan.value = m.ramp.heightSpan;
      uniforms.uFlicker.value = flickerAt(m, age);
      writeLineWork(uniforms, m, u);
      writeStripes(uniforms, m);
      writeRim(uniforms, m, g, u);
      if (isSlab) writeSlab(uniforms, g);
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
        const origins = rippleOrigins(m.ripples, doc.seed);
        const params = rippleParams(m.ripples);
        (uniforms.uRipple.value as THREE.Vector4[]).forEach((v, i) =>
          v.copy(i < 4 ? origins[i] : params[i - 4]),
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
        for (const p of lightningBounds(g, boltSeed))
          push(p.applyMatrix4(matrix));
        return;
      }
      if (isFrame) {
        // The card, not the bar: the halo skirt really does reach the margin,
        // and a frame framed on its bar alone would have its glow cropped.
        const margin = frameMargin(g);
        const hx = g.radius + margin;
        const hy = g.length * 0.5 + margin;
        for (const x of [-hx, hx])
          for (const y of [-hy, hy])
            push(point.set(x, y, 0).applyMatrix4(matrix).clone());
        return;
      }
      if (isSlab) {
        // The bar is a billboard, so it has no depth of its own: it claims its
        // length along local +Z (from the origin, or about it) and its full
        // height across every lateral axis, which is the most any camera angle
        // can ever see of it.
        const half = g.thickness * 0.5;
        const base = g.slab?.anchor === "base";
        for (const z of base
          ? [0, g.length]
          : [-g.length * 0.5, g.length * 0.5])
          for (const x of [-half, half])
            for (const y of [-half, half])
              push(point.set(x, y, z).applyMatrix4(matrix).clone());
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
        // "lensFlare" and "radialRays" cut themselves off well inside the card
        // (the radial gate at RADIAL_CUTOFF of the half-size), and an
        // anisotropic flare uses only 1/anisotropy of the width. Claiming the
        // whole card would frame the camera on transparent corners: a 3.2 m
        // blade would ask for a 5.2 m square.
        const pattern = live.material!.procedural;
        const radial =
          layer.kind === "sprite" &&
          (pattern === "lensFlare" || pattern === "radialRays");
        const lit = radial ? RADIAL_CUTOFF : 1;
        const narrow =
          radial && pattern === "lensFlare"
            ? lit / Math.max(Math.abs(live.material!.proceduralParams[1]), 1)
            : lit;
        for (const x of [box.min.x * narrow, box.max.x * narrow])
          for (const y of [box.min.y * lit, box.max.y * lit])
            for (const z of [box.min.z, box.max.z])
              push(point.set(x, y, z).applyMatrix4(matrix).clone());
      }
    },
    dispose() {
      mesh.geometry.dispose();
      shaderMaterial.dispose();
      for (const copy of splitCopies)
        (copy.material as THREE.Material).dispose();
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
  // arrangement "path": the anchors sit on a DOCUMENT path, so the layer itself
  // is at the origin the same way a ribbon's is.
  const blobPath = findPath(doc, spec.pathId);
  const lobes = blobLobes(spec, blobPath);
  // An "orbit" ring is split by view depth every frame: the half currently
  // behind the centre draws first, smaller and dimmer, which is what gives a
  // tilted ring its oblique read.
  const orbiting = spec.arrangement === "orbit";
  const geometry = new THREE.IcosahedronGeometry(1, 3);
  const group = new THREE.Group();
  group.name = layer.id;

  const makeUniforms = (hull: boolean) => ({
    uTime: { value: 0 },
    uNoiseSpeed: { value: spec.bump.speed },
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
    uToonRamp: { value: material.toon?.colorSource === "ramp" ? 1 : 0 },
    uToonShadowScale: { value: material.toon?.shadowScale ?? 0.55 },
    uToonHighMix: { value: material.toon?.highlightMix ?? 0.35 },
    uLayerU: { value: 0 },
    uRampKeyMode: { value: rampKeyMode(material) },
    ...rampBlendUniforms(material),
    uGroundY: { value: doc.environment.groundY },
    uHeightSpan: { value: material.ramp.heightSpan },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 1 },
    uLightOn: { value: spec.lightFrom ? 1 : 0 },
    uLightPos: {
      value: new THREE.Vector3().fromArray(
        spec.lightFrom?.position ?? [0, 0, 0],
      ),
    },
    uLightFall: { value: spec.lightFrom?.falloff ?? 0 },
    ...rampUniforms(material.ramp),
  });

  // Every lobe is an instance of one draw. A cluster of ninety lobes used to be
  // ninety materials, and a material is a program: the document spent seconds
  // compiling the same shader over and over, and paid for the draw calls again
  // on every frame.
  const LOBE_FIELDS = [
    { name: "aLobeA", items: 4 }, // seed, amplitude, frequency, squash
    { name: "aLobeB", items: 4 }, // curl, taper, rotation, hull inflation
    { name: "aLobeC", items: 4 }, // lobe age, shade, alpha, unused
    { name: "aLobeP", items: 4 }, // centre in layer space, radius
  ];
  const build = (hull: boolean) => {
    const instances = instanceAttributes(lobes.length, LOBE_FIELDS);
    const instanced = new THREE.InstancedBufferGeometry();
    instanced.index = geometry.index;
    instanced.setAttribute("position", geometry.getAttribute("position"));
    for (const [name, attribute] of Object.entries(instances.attributes))
      instanced.setAttribute(name, attribute);
    instanced.instanceCount = 0;
    const uniforms = makeUniforms(hull);
    // Both blend states are built up front and the draw swaps between them. The
    // state is part of the pipeline, so switching it on a live material rebuilt
    // that pipeline at every loop boundary; two materials over one uniform
    // record are warmed together and cost nothing to swap.
    const state = (transparent: boolean) =>
      createV2NodeMaterial("blob", uniforms, {
        transparent,
        depthWrite: !transparent,
        depthTest: true,
        side: hull ? THREE.BackSide : THREE.FrontSide,
      });
    const opaque = state(false);
    const material = state(true);
    const mesh = new THREE.Mesh(instanced, opaque);
    mesh.frustumCulled = false;
    // The hull of a lobe always sits behind its own fill.
    mesh.renderOrder = index * 8 + (hull ? 0 : 1);
    group.add(mesh);
    return { instanced, instances, uniforms, opaque, material, mesh };
  };
  const hullDraw = build(true);
  const fillDraw = build(false);
  const parts = [hullDraw, fillDraw];
  const stride = LOBE_FIELDS.reduce((total, field) => total + field.items, 0);
  const drawOrder: number[] = [];
  const drawDepth: number[] = [];

  const span = Math.max(layer.end - layer.start, 1e-6);
  const lightPoint = new THREE.Vector3();
  const scratchLobe = new THREE.Vector3();
  const lobeStates: ReturnType<typeof lobeStateAt>[] = [];
  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    occluder: material.opaqueUntil !== null,
    // Just past the switch from the solid body to the fading one: the two
    // blend states are two pipelines, and the midpoint only reaches one.
    warmAt:
      material.opaqueUntil === null
        ? undefined
        : layer.start +
          (layer.end - layer.start) * Math.min(1, material.opaqueUntil + 0.05),
    update(time, flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const blob = live.blob!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      applyLayerFrame(group, layer, live, camera);
      group.updateMatrixWorld();
      // blob.lightFrom: a point the lobes are shaded toward. Following a layer
      // reads that layer's LIVE transform, so a ring lit by its own core keeps
      // its highlight where the core actually is.
      const lightFrom = blob.lightFrom;
      if (lightFrom) {
        lightPoint.fromArray(lightFrom.position);
        if (lightFrom.layerId) {
          const owner = doc.layers.find((l) => l.id === lightFrom.layerId);
          if (owner)
            lightPoint.fromArray(
              evaluateLayerV2(owner, time).layer.transform.position,
            );
        }
      }
      // The layer origin in view space: everything nearer the camera than this
      // is the near half of an orbit ring.
      const centreDepth = orbiting
        ? scratchLobe
            .set(0, 0, 0)
            .applyMatrix4(group.matrixWorld)
            .applyMatrix4(camera.matrixWorldInverse).z
        : 0;
      const outline = m.outline;
      const hullVisible = !!outline && flags.textures;
      hullDraw.mesh.visible = hullVisible;
      // Alive lobes only, ordered far to near: a cluster of translucent lobes
      // has to blend back to front, and the far half of an orbit ring has to
      // draw first whatever its authored order was.
      drawOrder.length = 0;
      drawDepth.length = 0;
      // The blend state is part of the pipeline, so it has to be a function of
      // the layer, not of whichever lobe happens to be mid-fade: taking it from
      // the lobes made it flicker frame to frame and rebuilt the pipeline about
      // a hundred times in five seconds of steady playback. material.opaqueUntil
      // is the authored switch, so the layer makes it once, on the layer's own
      // progress, and a layer that never claims to be opaque never writes
      // depth. The live opacity is not part of it: a track that crosses 1.0
      // would otherwise flip the pipeline with it.
      // Purely a function of the layer: material.opaqueUntil is the authored
      // switch from a solid body to a fading one, and taking it from whichever
      // lobe happened to be mid-fade made it flicker frame to frame.
      const fading = m.opaqueUntil === null || u >= m.opaqueUntil;
      for (let i = 0; i < lobes.length; i++) {
        const state = lobeStateAt(
          lobes[i],
          blob,
          age,
          span,
          m.opaqueUntil,
          blobPath,
        );
        if (!state.alive) continue;
        const depth = scratchLobe
          .fromArray(state.position)
          .applyMatrix4(group.matrixWorld)
          .applyMatrix4(camera.matrixWorldInverse).z;
        drawOrder.push(i);
        drawDepth[i] = depth;
        lobeStates[i] = state;
      }
      drawOrder.sort((a, b) => drawDepth[a] - drawDepth[b]);
      const fillArray = fillDraw.instances.array;
      const hullArray = hullDraw.instances.array;
      for (let slot = 0; slot < drawOrder.length; slot++) {
        const index = drawOrder[slot];
        const lobe = lobes[index];
        const state = lobeStates[index];
        // The far half of an orbit ring draws smaller and dimmer: a ring whose
        // two halves draw the same size reads as a flat annulus.
        let bias = 1;
        let shade = 1;
        if (orbiting) {
          const far = drawDepth[index] < centreDepth;
          bias = far ? 0.88 : 1.06;
          shade = far ? 0.58 : 1.02;
        }
        const radius = state.radius * bias;
        const alpha = state.alpha * m.opacity;
        const at = slot * stride;
        const amplitude = flags.textures
          ? lobe.amplitude * (blob.bump.amplitude / (spec.bump.amplitude || 1))
          : 0;
        for (const array of [fillArray, hullArray]) {
          array[at] = lobe.seed;
          array[at + 1] = amplitude;
          array[at + 2] = lobe.frequency;
          array[at + 3] = lobe.squash * (blob.squash / (spec.squash || 1));
          array[at + 4] = lobe.curl;
          array[at + 5] = lobe.taper;
          array[at + 6] = lobe.rot;
          array[at + 8] = state.age;
          array[at + 9] = shade;
          array[at + 10] = alpha;
          array[at + 12] = state.position[0];
          array[at + 13] = state.position[1];
          array[at + 14] = state.position[2];
          array[at + 15] = radius;
        }
        fillArray[at + 7] = 0;
        // A constant world-space line: the hull is inflated in the lobe's own
        // unit space, so the push has to be divided by the live radius.
        hullArray[at + 7] = outline
          ? outline.width / Math.max(radius, 0.12)
          : 0;
      }
      for (const draw of parts) {
        draw.instanced.instanceCount = drawOrder.length;
        draw.instances.buffer.needsUpdate = true;
      }
      // The blend state is part of the pipeline, so it switches once per layer
      // rather than once per lobe — and only when it actually changes. Forcing
      // the rebuild here instead of letting Three do it lazily made a lobe that
      // crosses the fade threshold recompile the pipeline on almost every
      // frame: a hundred pipelines in five seconds of steady playback.
      for (const draw of parts) {
        draw.mesh.material = fading ? draw.material : draw.opaque;
        const uniforms = draw.uniforms;
        uniforms.uTime.value = age;
        uniforms.uLayerU.value = u;
        uniforms.uNoiseSpeed.value = blob.bump.speed;
        uniforms.uRampKeyMode.value = rampKeyMode(m);
        writeRampBlend(uniforms as Record<string, IUniform>, m);
        uniforms.uHeightSpan.value = m.ramp.heightSpan;
        uniforms.uGroundY.value = doc.environment.groundY;
        uniforms.uUseToon.value = m.toon ? 1 : 0;
        uniforms.uLightOn.value = lightFrom ? 1 : 0;
        uniforms.uLightFall.value = lightFrom?.falloff ?? 0;
        (uniforms.uLightPos.value as THREE.Vector3).copy(lightPoint);
        writeRamp(uniforms as Record<string, IUniform>, m.ramp);
      }
      if (m.toon) {
        const uniforms = fillDraw.uniforms;
        (uniforms.uShadow.value as THREE.Color).set(m.toon.shadow);
        (uniforms.uBody.value as THREE.Color).set(m.toon.body);
        (uniforms.uHigh.value as THREE.Color).set(m.toon.highlight);
        (uniforms.uRimCol.value as THREE.Color).set(m.toon.highlight);
        (uniforms.uLight.value as THREE.Vector3).fromArray(m.toon.light);
        uniforms.uBandA.value = m.toon.thresholds[0];
        uniforms.uBandB.value = m.toon.thresholds[1];
        uniforms.uBands.value = m.toon.bands;
        uniforms.uRimPow.value = m.toon.rim.power;
        uniforms.uRimAmt.value = m.toon.rim.amount;
        uniforms.uToonRamp.value = m.toon.colorSource === "ramp" ? 1 : 0;
        uniforms.uToonShadowScale.value = m.toon.shadowScale;
        uniforms.uToonHighMix.value = m.toon.highlightMix;
      }
      if (outline)
        (hullDraw.uniforms.uShadow.value as THREE.Color).set(outline.color);
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
      const [lo, hi] = blobBounds(live.blob!, blobPath);
      for (const x of [lo.x, hi.x])
        for (const y of [lo.y, hi.y])
          for (const z of [lo.z, hi.z])
            push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      for (const draw of parts) {
        draw.instanced.dispose();
        draw.material.dispose();
        draw.opaque.dispose();
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
    // Six separate instance buffers plus position, normal and aAlong is nine,
    // one past WebGPU's limit. They share one interleaved buffer instead.
    const spikes = instanceAttributes(table.length, [
      { name: "aDir", items: 3, data: direction },
      { name: "aOrg", items: 3, data: origin },
      { name: "aLen", items: 1, data: length },
      { name: "aWid", items: 1, data: width },
      { name: "aT0", items: 1, data: start },
      { name: "aSeed", items: 1, data: seed },
    ]);
    for (const [name, attribute] of Object.entries(spikes.attributes))
      g.setAttribute(name, attribute);
    g.instanceCount = table.length;
    return g;
  };

  const makeUniforms = (hull: boolean): Record<string, IUniform> => ({
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
    const shader = createV2NodeMaterial("crystal", uniforms, {
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
      applyLayerFrame(group, layer, live, camera);
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
    const make = (
      color: string,
      dark: string,
      order: number,
      scale: number,
    ) => {
      const uniforms: Record<string, IUniform> = {
        uCol: { value: new THREE.Color(color) },
        uDark: { value: new THREE.Color(dark) },
        uOpacity: { value: 1 },
        uBlendMode: { value: blend },
        uSliverScale: { value: new THREE.Vector2(scale, scale) },
        uSliverOffset: { value: new THREE.Vector3() },
        uSliverRoll: { value: 0 },
      };
      const shader = createV2NodeMaterial("splash", uniforms, {
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
    // A sliver's backing and fill open at different moments.
    warmAll: true,
    trim: false,
    update(time, _flags, camera) {
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
      applyLayerFrame(group, layer, live, camera);
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

  const uniforms: Record<string, IUniform> = {
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

  const shaderMaterial = createV2NodeMaterial("ribbon", uniforms, {
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
    update(time, _flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const r = live.ribbon!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale);
      applyLayerFrame(mesh, layer, live, camera);
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
    const uniforms: Record<string, IUniform> = {
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
    const shader = createV2NodeMaterial("wireBurst", uniforms, {
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
    update(time, _flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const burst = live.wireBurst!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      applyLayerFrame(group, layer, live, camera);
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

// ---------------------------------------------------------------------------
// Arc layers
// ---------------------------------------------------------------------------

/**
 * The electrical cage: camera-facing ribbon polylines on helical paths around
 * the layer's own +Y axis. One instanced draw; the strip carries (u, side) and
 * the helix is swept in the vertex program from the live spec, so a track (or
 * layer.collapse) on arcs.radius or arcs.span re-shapes the cage without
 * rebuilding anything.
 *
 * Colour comes from arcs.coreColor/haloColor, never from material.ramp — the
 * filament and its sheath are two terms of one fragment, not two layers.
 */
function createArcsLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.arcs!;
  const geometry = buildArcsGeometry(spec);

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uHeight: { value: 1 },
    uWidthK: { value: 1 },
    uSpan: { value: spec.span },
    uWidth: { value: spec.width },
    // Two pixels at 720p through a 36-degree lens: below this an arc shimmers
    // into nothing at depth, which reads as a renderer fault, not as lightning.
    uMinWidth: { value: 0.0018 },
    uJitterAmp: { value: spec.jitter.amplitude },
    uJitterFreq: { value: spec.jitter.frequency },
    uJitterFold: { value: spec.jitter.fold },
    uSkip: { value: spec.blink.skipChance },
    uRadius: { value: new THREE.Vector2().fromArray(spec.radius) },
    uPitch: { value: new THREE.Vector2().fromArray(spec.pitch) },
    uPeriod: { value: new THREE.Vector2().fromArray(spec.blink.period) },
    uOnTime: { value: new THREE.Vector2().fromArray(spec.blink.onTime) },
    uCore: { value: new THREE.Color(spec.coreColor) },
    uHalo: { value: new THREE.Color(spec.haloColor) },
    uOpacity: { value: material.opacity },
    uFlicker: { value: 1 },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
  };

  const shaderMaterial = createV2NodeMaterial("arc", uniforms, {
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
    update(time, _flags, camera) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const a = live.arcs!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale);
      applyLayerFrame(mesh, layer, live, camera);
      uniforms.uTime.value = age;
      uniforms.uSpan.value = a.span;
      uniforms.uWidth.value = a.width;
      uniforms.uJitterAmp.value = a.jitter.amplitude;
      uniforms.uJitterFreq.value = a.jitter.frequency;
      uniforms.uJitterFold.value = a.jitter.fold;
      uniforms.uSkip.value = a.blink.skipChance;
      (uniforms.uRadius.value as THREE.Vector2).fromArray(a.radius);
      (uniforms.uPitch.value as THREE.Vector2).fromArray(a.pitch);
      (uniforms.uPeriod.value as THREE.Vector2).fromArray(a.blink.period);
      (uniforms.uOnTime.value as THREE.Vector2).fromArray(a.blink.onTime);
      (uniforms.uCore.value as THREE.Color).set(a.coreColor);
      (uniforms.uHalo.value as THREE.Color).set(a.haloColor);
      uniforms.uOpacity.value = m.opacity;
      uniforms.uFlicker.value = flickerAt(m, age);
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
      for (const corner of arcBounds(live.arcs!))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      shaderMaterial.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Streak-burst layers
// ---------------------------------------------------------------------------

/**
 * A screen-space fan of thin additive quads out of the layer origin. One
 * instanced draw whose whole shape is hashed per instance; the only per-frame
 * value is the grow envelope, sampled on the layer's own 0..1 progress.
 *
 * Screen space, not world: a burst read from a three-quarter camera has to fan
 * across the FRAME, and a world-space fan collapses to a line the moment the
 * camera is not square to it.
 */
function createStreakBurstLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.streakBurst!;
  const geometry = buildStreakGeometry(spec);

  const uniforms: Record<string, IUniform> = {
    uGrow: { value: 0 },
    uCurvature: { value: spec.curvature },
    uUpBias: { value: spec.upBias },
    uBundles: { value: spec.bundles },
    uBundleSpread: { value: spec.bundleSpread },
    uStagger: { value: spec.stagger },
    uLength: { value: new THREE.Vector2().fromArray(spec.length) },
    uWidth: { value: new THREE.Vector2().fromArray(spec.width) },
    uHueA: { value: new THREE.Color(spec.hues[0]) },
    uHueB: { value: new THREE.Color(spec.hues[1]) },
    uHueC: { value: new THREE.Color(spec.hues[2]) },
    uOpacity: { value: material.opacity },
    uFlicker: { value: 1 },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
  };

  const shaderMaterial = createV2NodeMaterial("streak", uniforms, {
    transparent: true,
    depthWrite: false,
    // The fan reads through whatever it crosses; a depth test against the body
    // it erupts out of would clip half of it away.
    depthTest: false,
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
    update(time, _flags, camera) {
      const { layer: live, visible, u } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const b = live.streakBurst!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale);
      applyLayerFrame(mesh, layer, live, camera);
      uniforms.uGrow.value = clamp01(sampleCurve(b.grow, u));
      uniforms.uCurvature.value = b.curvature;
      uniforms.uUpBias.value = b.upBias;
      uniforms.uBundleSpread.value = b.bundleSpread;
      uniforms.uStagger.value = b.stagger;
      (uniforms.uLength.value as THREE.Vector2).fromArray(b.length);
      (uniforms.uWidth.value as THREE.Vector2).fromArray(b.width);
      (uniforms.uHueA.value as THREE.Color).set(b.hues[0]);
      (uniforms.uHueB.value as THREE.Color).set(b.hues[1]);
      (uniforms.uHueC.value as THREE.Color).set(b.hues[2]);
      uniforms.uOpacity.value = m.opacity;
      uniforms.uFlicker.value = flickerAt(m, time - layer.start);
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
      for (const corner of streakBurstBounds(live.streakBurst!))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      shaderMaterial.dispose();
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
  /** Path events, for spawn.mode "event": the impacts this layer belongs to. */
  events: Array<{ position: [number, number, number]; time: number }> = [],
) {
  const { layer: live, visible } = evaluateLayerV2(layer, time);
  if (!visible) return;
  const emitter = live.emitter!;
  const shape = emitter.shape;
  if ((shape.type === "path" || shape.type === "pathLine") && path) {
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
  if (live.emitter!.velocity.mode === "alongPath" && path) {
    // A run along a path lives on the path too, however small the shape it
    // scatters from is.
    const origin = new THREE.Vector3().fromArray(live.transform.position);
    const margin = shape.radius + emitter.render.size[1] * 0.5;
    for (const point of pathBounds(path, 24)) {
      push(point.clone().add(origin).addScalar(margin));
      push(point.clone().add(origin).addScalar(-margin));
    }
    return;
  }
  if (emitter.spawn.mode === "event" && events.length) {
    // An event spawn happens AT the impacts, not at the layer origin: framing
    // on the origin would leave every burst outside the shot.
    const margin = shape.radius + emitter.render.size[1] * 0.5;
    for (const event of events) {
      const point = new THREE.Vector3().fromArray(event.position);
      push(point.clone().addScalar(margin));
      push(point.clone().addScalar(-margin));
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
    if (
      (shape.type === "ring" ||
        shape.type === "disc" ||
        shape.type === "orbit" ||
        shape.type === "radialFan" ||
        shape.type === "frame") &&
      axis.lengthSq() > 1e-10
    ) {
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
      const reach = axis.clone().normalize().multiplyScalar(shape.length);
      // A frame's own length is its HEIGHT across the axis, not a reach along
      // it: the strip stands in the plane the ring and the disc lie in.
      if (shape.type === "frame") {
        extent.add(
          new THREE.Vector3(
            Math.abs(reach.x),
            Math.abs(reach.y),
            Math.abs(reach.z),
          ).multiplyScalar(0.5),
        );
        extent.multiply(
          new THREE.Vector3(
            1 - Math.abs(axis.clone().normalize().x),
            1 - Math.abs(axis.clone().normalize().y),
            1 - Math.abs(axis.clone().normalize().z),
          ),
        );
      } else if (shape.type === "line") lean.copy(reach);
      // A radial fan lies in the plane across its axis and claims nothing along
      // it, the same way a ring and a disc do.
      else if (shape.type === "radialFan") extent.add(new THREE.Vector3());
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

// ---------------------------------------------------------------------------
// Camera-framed layers
// ---------------------------------------------------------------------------

/**
 * `layer.frame:"camera"`: the layer's local XY is re-based onto the camera's
 * right/up every frame, closed form from the camera, so everything the layer
 * lays out lives in the SCREEN plane. A 2D symbol burst read from a
 * three-quarter camera collapses to a line without it.
 *
 * Layers stay flat — this is a frame on one layer, never a parent group — so it
 * is applied after the ordinary transform, on top of whatever rotation the
 * layer already carries.
 */
function applyLayerFrame(
  object: THREE.Object3D,
  layer: LayerV2,
  live: LayerV2,
  camera: THREE.Camera,
) {
  if (layer.frame !== "camera") return;
  object.quaternion
    .copy(camera.quaternion)
    .multiply(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...live.transform.rotation),
      ),
    );
}

// ---------------------------------------------------------------------------
// Sheet layers
// ---------------------------------------------------------------------------

/**
 * The membranes of a water tail: curved, tapered, OPAQUE meshes on a hashed
 * multi-cadence schedule. Each sheet is its own mesh and its own draw (the
 * splash layer's shape), because every one of them carries a different curl and
 * bow and they have to intersect each other for real.
 *
 * Colour is material.toon — two cel bands against a fixed world light plus a
 * rim — never the ramp: a sheet is a lit surface, and a ramp keyed on age would
 * make the tail read as a gradient rather than as water.
 */
function createSheetsLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.sheets!;
  const sheets = sheetInstances(spec);
  const group = new THREE.Group();
  group.name = layer.id;
  const blend = BLEND_INDEX[material.blend] ?? 1;

  // Every sheet of a layer shares one material: only the sheet's own hash
  // differed, and it rides on the geometry instead. Their geometries are not
  // interchangeable — each sheet is its own ribbon — so this is one program and
  // one bind group for the layer rather than one of each per sheet.
  const uniforms: Record<string, IUniform> = {
    uShadow: { value: new THREE.Color(material.toon!.shadow) },
    uBody: { value: new THREE.Color(material.toon!.body) },
    uHigh: { value: new THREE.Color(material.toon!.highlight) },
    uRim: { value: new THREE.Color(material.toon!.shadow) },
    uLight: { value: new THREE.Vector3().fromArray(material.toon!.light) },
    uCam: { value: new THREE.Vector3() },
    uBands: { value: new THREE.Vector2().fromArray(material.toon!.thresholds) },
    uBandCount: { value: material.toon!.bands },
    uRimPow: { value: material.toon!.rim.power },
    uRimAmt: { value: material.toon!.rim.amount },
    uOpacity: { value: material.opacity },
    uTear: { value: 0 },
    uTearScale: { value: spec.tear?.scale ?? 3 },
    uBlendMode: { value: blend },
  };
  const shader = createV2NodeMaterial("sheet", uniforms, {
    transparent: material.blend !== "alpha",
    // Opaque and depth-writing: sheets intersect each other for real, which is
    // the whole reason a water tail is mesh and not particles.
    depthWrite: true,
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const parts = sheets.map((sheet) => {
    const geometry = sheetGeometry(sheet, spec);
    const vertices = geometry.getAttribute("position").count;
    geometry.setAttribute(
      "aSheetSeed",
      new THREE.BufferAttribute(new Float32Array(vertices).fill(sheet.hash), 1),
    );
    // The one value that genuinely varies per sheet per frame. It rides on the
    // geometry, which is this sheet's alone, so the layer keeps one material:
    // a few dozen floats a frame against a material and a pipeline per sheet.
    const ageAttribute = new THREE.BufferAttribute(
      new Float32Array(vertices),
      1,
    );
    geometry.setAttribute("aSheetAge", ageAttribute);
    const mesh = new THREE.Mesh(geometry, shader);
    mesh.frustumCulled = false;
    mesh.renderOrder = index;
    group.add(mesh);
    return { sheet, geometry, shader, uniforms, mesh, ageAttribute };
  });

  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    trim: false,
    // Opaque, so the soft-particle depth pre-pass has to see them.
    occluder: material.blend === "alpha",
    update(time, _flags, camera) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const spec_ = live.sheets!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      applyLayerFrame(group, layer, live, camera);
      // Nothing is born in the last fifth of the layer, so the tail thins out
      // instead of being cut off mid-flight.
      const until = (layer.end - layer.start) * 0.78;
      const axis = new THREE.Vector3().fromArray(spec_.flow).normalize();
      const across = orthoOf(axis, new THREE.Vector3());
      // Right-handed, or setFromRotationMatrix reads a mirror and every sheet
      // collapses to a sliver: X is the flow (the sheet's own length), Z is the
      // lateral axis and Y closes the frame.
      const up = new THREE.Vector3().crossVectors(across, axis).normalize();
      basis.makeBasis(axis, up, across);
      quaternion.setFromRotationMatrix(basis);
      for (const part of parts) {
        const state = sheetStateAt(part.sheet, spec_, age, until);
        part.mesh.visible = state.visible;
        if (!state.visible) continue;
        part.mesh.position
          .set(0, 0, 0)
          .addScaledVector(axis, state.position[0])
          .addScaledVector(across, state.position[1])
          .addScaledVector(up, state.position[2]);
        part.mesh.quaternion.copy(quaternion);
        part.mesh.rotateX(state.roll);
        part.mesh.rotateY(state.yaw);
        part.mesh.scale.setScalar(state.scale);
        // How far the torn border has eaten into this sheet, which is the one
        // thing that differs between two sheets of a layer at the same instant.
        (part.ageAttribute.array as Float32Array).fill(state.age01);
        part.ageAttribute.needsUpdate = true;
      }
      const u = uniforms;
      (u.uShadow.value as THREE.Color).set(m.toon!.shadow);
      (u.uBody.value as THREE.Color).set(m.toon!.body);
      (u.uHigh.value as THREE.Color).set(m.toon!.highlight);
      (u.uRim.value as THREE.Color).set(m.toon!.highlight);
      (u.uLight.value as THREE.Vector3).fromArray(m.toon!.light);
      (u.uBands.value as THREE.Vector2).fromArray(m.toon!.thresholds);
      u.uRimPow.value = m.toon!.rim.power;
      u.uRimAmt.value = m.toon!.rim.amount;
      u.uOpacity.value = m.opacity;
      // The base threshold; each sheet scales it by its own age in the shader.
      u.uTear.value = spec_.tear ? spec_.tear.threshold : 0;
      u.uTearScale.value = spec_.tear?.scale ?? 3;
      (u.uCam.value as THREE.Vector3).copy(camera.position);
    },
    bounds(time, push) {
      const { layer: live, visible } = evaluateLayerV2(layer, time);
      if (!visible) return;
      const axis = new THREE.Vector3().fromArray(live.sheets!.flow).normalize();
      const across = orthoOf(axis, new THREE.Vector3());
      const up = new THREE.Vector3().crossVectors(across, axis).normalize();
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(live.transform.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...live.transform.rotation),
        ),
        new THREE.Vector3().fromArray(live.transform.scale),
      );
      for (const corner of sheetsBounds(live.sheets!))
        push(
          new THREE.Vector3()
            .addScaledVector(axis, corner.x)
            .addScaledVector(across, corner.y)
            .addScaledVector(up, corner.z)
            .applyMatrix4(matrix),
        );
    },
    dispose() {
      for (const part of parts) part.geometry.dispose();
      shader.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Crescent layers
// ---------------------------------------------------------------------------

/**
 * The blade of a slash: one strip swept along an arc, drawn once per TONAL
 * copy. The copies share one geometry — the buffer carries (s, q) and nothing
 * else — and differ only in their scale, their radial offset, their time lead
 * and their four-stop ramp, which is what keeps a wide dark shadow, a saturated
 * body and a hot highlight locked to the same window.
 */
function createCrescentLayer(layer: LayerV2, index: number): LayerObject {
  const material = layer.material!;
  const spec = layer.crescent!;
  const geometry = buildCrescentGeometry();
  const group = new THREE.Group();
  group.name = layer.id;
  const frame = arcFrame(spec);

  const copies = spec.tonal.map((tonal, order) => {
    const stops = tonal.ramp;
    const at = (i: number) => stops[Math.min(i, stops.length - 1)];
    const uniforms: Record<string, IUniform> = {
      uEx: { value: frame.ex.clone() },
      uEy: { value: frame.ey.clone() },
      uN: { value: frame.normal.clone() },
      uR: { value: spec.radius },
      uPh0: { value: spec.phase },
      uSweep: { value: spec.sweep },
      uWmax: { value: spec.thickness.max },
      uPeakFrom: { value: spec.thickness.peakFrom },
      uTipPower: { value: spec.thickness.tipPower },
      uRootFade: { value: spec.thickness.rootFade },
      uScreenSpace: { value: spec.widthSpace === "screen" ? 1 : 0 },
      uHead: { value: 0 },
      uTail: { value: 0 },
      uScale: { value: tonal.scale },
      uRadOff: { value: tonal.radialOffset },
      uWiden: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: spec.seed * 0.0137 + order * 2.7 },
      uC0: { value: new THREE.Color(at(0).color) },
      uC1: { value: new THREE.Color(at(1).color) },
      uC2: { value: new THREE.Color(at(2).color) },
      uC3: { value: new THREE.Color(at(3).color) },
      uI: {
        value: new THREE.Vector4(
          at(0).intensity,
          at(1).intensity,
          at(2).intensity,
          at(3).intensity,
        ),
      },
      uBandT: {
        value: new THREE.Vector4(at(0).t, at(1).t, at(2).t, at(3).t),
      },
      uAlpha: { value: material.opacity },
      uTear: { value: 0 },
      uErode: { value: tonal.erode },
      uTipHot: { value: tonal.tipHot },
      uStreakOn: { value: spec.streaks ? 1 : 0 },
      uStreakFreq: { value: spec.streaks?.frequency ?? 0 },
      uStreakPan: { value: spec.streaks?.pan ?? 0 },
      uStreakI: { value: spec.streaks?.intensity ?? 0 },
      uStreakSeg: { value: spec.streaks?.segmentation ?? 0 },
      uStreakCol: { value: new THREE.Color(spec.streaks?.color ?? "#ffffff") },
      uVorScale: { value: spec.erosionFront.voronoi.scale },
      uSeamWidth: { value: spec.erosionFront.voronoi.seamWidth },
      uFrontWidth: { value: spec.erosionFront.width },
      uBlendMode: { value: BLEND_INDEX[tonal.blend] ?? 1 },
    };
    const shader = createV2NodeMaterial("crescent", uniforms, {
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...blendingFor(tonal.blend),
    });
    const mesh = new THREE.Mesh(geometry, shader);
    mesh.name = `${layer.id}-${order}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = index * 8 + order;
    group.add(mesh);
    return { tonal, uniforms, shader, mesh, order };
  });

  return {
    id: layer.id,
    source: layer,
    object: group,
    soft: false,
    // Each tonal copy carries its own blend mode and its own window.
    warmAll: true,
    trim: false,
    update(time, _flags, camera) {
      const { layer: live, visible, age, u } = evaluateLayerV2(layer, time);
      group.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const c = live.crescent!;
      group.position.fromArray(live.transform.position);
      group.rotation.set(...live.transform.rotation);
      group.scale.fromArray(live.transform.scale);
      applyLayerFrame(group, layer, live, camera);
      const basis = arcFrame(c);
      // The tear-away: how far the tail has caught up with the head, which is
      // what both the erosion threshold and the widening ride.
      const tear = clamp01(
        (sampleCrescentCurve(c.window.tail, u) - 0) /
          Math.max(sampleCrescentCurve(c.window.head, u), 1e-4),
      );
      for (const copy of copies) {
        const tonal = c.tonal[copy.order] ?? copy.tonal;
        const lead = clamp01(u + tonal.timeLead);
        const window = crescentWindowAt(c, lead);
        const smear = tonal.smear;
        const un = copy.uniforms;
        let alpha = m.opacity;
        if (smear) {
          // The smear is the same strip a few frames behind, additive and
          // faint: the motion blur of the sweep, alive only while it travels.
          const back = crescentWindowAt(c, clamp01(lead - smear.lag));
          window.head = back.head;
          window.tail = back.tail;
          alpha *=
            smear.opacity *
            smoothstep01(smear.window[0], smear.window[0] + 0.04, u) *
            (1 - smoothstep01(smear.window[1] - 0.12, smear.window[1], u));
        }
        (un.uEx.value as THREE.Vector3).copy(basis.ex);
        (un.uEy.value as THREE.Vector3).copy(basis.ey);
        (un.uN.value as THREE.Vector3).copy(basis.normal);
        un.uR.value = c.radius;
        un.uPh0.value = c.phase;
        un.uSweep.value = c.sweep;
        un.uWmax.value = c.thickness.max;
        un.uPeakFrom.value = c.thickness.peakFrom;
        un.uTipPower.value = c.thickness.tipPower;
        un.uRootFade.value = c.thickness.rootFade;
        un.uHead.value = Math.max(window.head, 1e-4);
        un.uTail.value = window.tail;
        un.uScale.value = tonal.scale;
        un.uRadOff.value = tonal.radialOffset;
        un.uTime.value = age;
        un.uTear.value = 0.9 * tear;
        un.uWiden.value = c.widen * tear;
        un.uErode.value = tonal.erode;
        un.uTipHot.value = tonal.tipHot;
        un.uAlpha.value = alpha * flickerAt(m, age);
        un.uFrontWidth.value = c.erosionFront.widthFollowsWindow
          ? Math.max(0.1, c.erosionFront.width * (window.head - window.tail))
          : c.erosionFront.width;
        un.uVorScale.value = c.erosionFront.voronoi.scale;
        un.uSeamWidth.value = c.erosionFront.voronoi.seamWidth;
        const stops = tonal.ramp;
        const at = (i: number) => stops[Math.min(i, stops.length - 1)];
        (un.uC0.value as THREE.Color).set(at(0).color);
        (un.uC1.value as THREE.Color).set(at(1).color);
        (un.uC2.value as THREE.Color).set(at(2).color);
        (un.uC3.value as THREE.Color).set(at(3).color);
        (un.uI.value as THREE.Vector4).set(
          at(0).intensity,
          at(1).intensity,
          at(2).intensity,
          at(3).intensity,
        );
        (un.uBandT.value as THREE.Vector4).set(
          at(0).t,
          at(1).t,
          at(2).t,
          at(3).t,
        );
        copy.mesh.visible =
          window.head > 0.002 && window.tail < 0.999 && alpha > 0.008;
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
      for (const corner of crescentBounds(live.crescent!))
        push(corner.applyMatrix4(matrix));
    },
    dispose() {
      geometry.dispose();
      for (const copy of copies) copy.shader.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Lick layers
// ---------------------------------------------------------------------------

/**
 * Flat cel flame strips peeling off a crescent's erosion front. They are
 * ANCHORED, not emitted: the anchor is wherever the source crescent's TAIL is
 * at this instant, so the licks appear in the order the blade tears without a
 * single time being written down twice.
 */
function createLicksLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
): LayerObject {
  const material = layer.material!;
  const spec = layer.licks!;
  const geometry = buildLicksGeometry(spec);
  const source = doc.layers.find((l) => l.id === spec.anchor.sourceLayerId);
  const span = Math.max(layer.end - layer.start, 1e-6);

  const uniforms: Record<string, IUniform> = {
    uAnchor: { value: new THREE.Vector3() },
    uTangent: { value: new THREE.Vector3(1, 0, 0) },
    uNormal: { value: new THREE.Vector3(0, 0, 1) },
    uDrift: { value: new THREE.Vector3().fromArray(spec.drift) },
    uLength: { value: new THREE.Vector2().fromArray(spec.length) },
    uWidth: { value: new THREE.Vector2().fromArray(spec.width) },
    uStagger: { value: new THREE.Vector2().fromArray(spec.stagger) },
    uLife: { value: new THREE.Vector2().fromArray(spec.life) },
    uTime: { value: 0 },
    uSpan: { value: span },
    uCurl: { value: spec.curl },
    uFlipHz: { value: spec.flipbookHz },
    uHot: { value: new THREE.Color(spec.colors[0]) },
    uBody: { value: new THREE.Color(spec.colors[1]) },
    uOpacity: { value: material.opacity },
    uBlendMode: { value: BLEND_INDEX[material.blend] ?? 0 },
  };
  const shader = createV2NodeMaterial("lick", uniforms, {
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...blendingFor(material.blend),
  });
  const mesh = new THREE.Mesh(geometry, shader);
  mesh.name = layer.id;
  mesh.frustumCulled = false;
  mesh.renderOrder = index;

  /** Where the source crescent's tail front is, in this layer's own space. */
  const anchorAt = (time: number) => {
    if (!source?.crescent) return null;
    const live = evaluateLayerV2(source, time);
    const c = live.layer.crescent!;
    const s = clamp01(
      sampleCrescentCurve(c.window.tail, live.u) + spec.anchor.offset,
    );
    const basis = arcFrame(c);
    const offset = new THREE.Vector3()
      .fromArray(live.layer.transform.position)
      .sub(new THREE.Vector3().fromArray(layer.transform.position));
    return {
      point: arcPoint(c, s).add(offset),
      tangent: arcTangent(c, s),
      normal: basis.normal,
    };
  };

  return {
    id: layer.id,
    source: layer,
    object: mesh,
    soft: false,
    trim: false,
    update(time, _flags, camera) {
      const { layer: live, visible, age } = evaluateLayerV2(layer, time);
      mesh.visible = visible;
      if (!visible) return;
      const m = live.material!;
      const l = live.licks!;
      mesh.position.fromArray(live.transform.position);
      mesh.rotation.set(...live.transform.rotation);
      mesh.scale.fromArray(live.transform.scale);
      applyLayerFrame(mesh, layer, live, camera);
      const anchor = anchorAt(time);
      if (anchor) {
        (uniforms.uAnchor.value as THREE.Vector3).copy(anchor.point);
        (uniforms.uTangent.value as THREE.Vector3).copy(anchor.tangent);
        (uniforms.uNormal.value as THREE.Vector3).copy(anchor.normal);
      }
      uniforms.uTime.value = age;
      uniforms.uCurl.value = l.curl;
      uniforms.uFlipHz.value = l.flipbookHz;
      (uniforms.uLength.value as THREE.Vector2).fromArray(l.length);
      (uniforms.uWidth.value as THREE.Vector2).fromArray(l.width);
      (uniforms.uStagger.value as THREE.Vector2).fromArray(l.stagger);
      (uniforms.uLife.value as THREE.Vector2).fromArray(l.life);
      (uniforms.uDrift.value as THREE.Vector3).fromArray(l.drift);
      (uniforms.uHot.value as THREE.Color).set(l.colors[0]);
      (uniforms.uBody.value as THREE.Color).set(l.colors[1]);
      uniforms.uOpacity.value = m.opacity * flickerAt(m, age);
    },
    bounds() {
      // A licks layer decorates the blade it peels off, and the blade already
      // claims the frame: claiming its own reach on top would pull the camera
      // back off the thing being decorated, the same way a reflection
      // contributes nothing.
    },
    dispose() {
      geometry.dispose();
      shader.dispose();
    },
  };
}

/** smoothstep, for the smear's own window. */
function smoothstep01(a: number, b: number, x: number) {
  const t = clamp01((x - a) / Math.max(b - a, 1e-6));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Reflection layers
// ---------------------------------------------------------------------------

/**
 * What a polished floor catches: the SOURCE layer's own mesh, built a second
 * time from the source layer's own spec, mirrored about environment.groundY
 * and squashed by `reflection.scale`.
 *
 * It draws the source's geometry and material rather than a copy of the
 * numbers, so a track on the source — its length, its reveal front, its flow
 * threshold — reaches the reflection on the same frame and the two can never
 * drift apart. The wash (the tint mix, the opacity and the depth fade) lives in
 * the fragment behind uReflect, so it costs one draw call and four uniforms.
 */
function createReflectionLayer(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
  textures: TextureCacheV2,
  depth: THREE.DepthTexture,
): LayerObject {
  const spec = layer.reflection!;
  const source = doc.layers.find((l) => l.id === spec.sourceLayerId)!;
  // The copy answers to the REFLECTION layer's own window and tracks, and to
  // the source's geometry and material.
  const mirrored: LayerV2 = {
    ...source,
    id: layer.id,
    start: layer.start,
    end: layer.end,
    role: layer.role,
    tracks: layer.tracks,
    overrides: layer.overrides,
    motion: layer.motion,
    jitter: layer.jitter,
    collapse: layer.collapse,
    window: null,
    reflection: undefined,
    material: {
      ...source.material!,
      // Never depth-writing and never an occluder: a reflection is a smear on
      // the floor, not a body other layers should sort against.
      blend: "alpha",
    },
  };
  const object = createMeshLayer(doc, mirrored, index, textures, depth);
  const mesh = object.object as THREE.Object3D;
  const groundY = doc.environment.groundY;
  const write = (node: THREE.Object3D) => {
    const material = (node as THREE.Mesh).material as V2NodeMaterial;
    if (!material?.uniforms?.uReflect) return;
    material.uniforms.uReflect.value = 1;
    (material.uniforms.uReflectTint.value as THREE.Color).set(spec.tint);
    material.uniforms.uReflectOpacity.value = spec.opacity;
    material.uniforms.uReflectBlur.value = spec.blur;
    material.depthWrite = false;
    // The floor is an opaque plane, so a copy mirrored under it would be depth
    // rejected outright. A reflection is a smear PAINTED on the floor: it skips
    // the depth test and draws just after the ground.
    material.depthTest = false;
    node.renderOrder = -5;
  };
  return {
    ...object,
    id: layer.id,
    source: layer,
    occluder: false,
    update(time, flags, camera) {
      object.update(time, flags, camera);
      mesh.traverse(write);
      // Mirror about the ground plane and squash TOWARD it: a point `h` above
      // the plane lands `h * scale` below it, so the copy stays anchored at the
      // contact instead of sliding away from it as it foreshortens.
      mesh.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return;
        node.position.y = groundY - (node.position.y - groundY) * spec.scale;
        node.scale.y *= -spec.scale;
      });
    },
    bounds() {
      // A reflection is always under something that already claims the frame,
      // and it hangs BELOW the ground plane: claiming it would pull the camera
      // down and back off the thing being reflected. It contributes nothing,
      // the same way a light's radius does not.
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

/** The one place a layer kind chooses its factory, so document installs and the
 * per-layer resource cache cannot disagree about what a kind builds. */
function buildLayerObject(
  doc: VfxDocumentV2,
  layer: LayerV2,
  index: number,
  textures: TextureCacheV2,
  depth: THREE.DepthTexture,
): LayerObject {
  switch (layer.kind) {
    case "light":
      return createLightLayer(layer);
    case "particles":
      return createParticleLayer(doc, layer, index, textures, depth);
    case "blob":
      return createBlobLayer(doc, layer, index);
    case "crystals":
      return createCrystalsLayer(doc, layer, index);
    case "splash":
      return createSplashLayer(layer, index);
    case "ribbon":
      return createRibbonLayer(doc, layer, index);
    case "wireBurst":
      return createWireBurstLayer(layer, index);
    case "arcs":
      return createArcsLayer(layer, index);
    case "streakBurst":
      return createStreakBurstLayer(layer, index);
    case "sheets":
      return createSheetsLayer(layer, index);
    case "crescent":
      return createCrescentLayer(layer, index);
    case "licks":
      return createLicksLayer(doc, layer, index);
    case "reflection":
      return createReflectionLayer(doc, layer, index, textures, depth);
    default:
      return createMeshLayer(doc, layer, index, textures, depth);
  }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** CPU-only export seam. Uses the production factories/evaluator but does not
 * create a renderer or issue image requests. The bundle writer owns asset I/O.
 * Call dispose even if serialization fails. Instance attributes should be read
 * before sample(), since the renderer may sort them for the reference camera.
 */
export function createV2ExportScene(input: VfxDocumentV2) {
  const doc = resolveEventWindows(applyStyle(validateDocumentV2(input)));
  const textures = new TextureCacheV2(true);
  const depth = new THREE.DepthTexture(1, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(doc.camera.fov, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  const objects: LayerObject[] = [];
  const dispose = () => {
    for (const object of objects) object.dispose();
    textures.dispose();
    depth.dispose();
    scene.clear();
  };
  try {
    doc.layers.forEach((layer, index) => {
      const object = buildLayerObject(doc, layer, index, textures, depth);
      objects.push(object);
      scene.add(object.object);
    });
  } catch (error) { dispose(); throw error; }
  return {
    document: doc, objects, camera,
    sample(time: number) {
      for (const object of objects) object.update(time, DEFAULT_FLAGS, camera);
      scene.updateMatrixWorld(true);
      updateSmokeLighting(scene, camera, doc.environment.ambient);
    },
    dispose,
  };
}

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
  private disposal?: Promise<void>;
  private preparedDocument?: VfxDocumentV2;
  private preparation?: Promise<void>;
  private warming = false;
  private preparationRevision = 0;
  private warmedObjects = new WeakSet<LayerObject>();
  private preparationStructure = "";
  private graphPrepared = false;
  private lastPreviewRequest = {
    time: 0,
    solo: undefined as string | undefined,
  };
  private deviceError: Error | null = null;
  private removeDeviceErrorListener?: () => void;
  private previewSample: {
    time: number;
    solo?: string;
    diagnostic: boolean;
  } | null = null;
  private width = 1280;
  private height = 720;

  constructor(
    readonly host: HTMLElement,
    private readonly options: { preview?: boolean } = {},
  ) {
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
        await this.renderer.dispose();
        return;
      }
      // WebGPU validation errors are asynchronous and do not throw from render().
      // Surface them through the preview's existing error/retry state instead of
      // continuing to present a black canvas when a particle pipeline is rejected.
      const device = (this.renderer.backend as unknown as { device: GPUDevice })
        .device;
      const onGpuError = (event: GPUUncapturedErrorEvent) => {
        if (!this.disposed)
          this.deviceError = new Error(
            `WebGPU rendering failed: ${event.error.message}`,
          );
      };
      device.addEventListener("uncapturederror", onGpuError);
      this.removeDeviceErrorListener = () =>
        device.removeEventListener("uncapturederror", onGpuError);
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
    this.post = createPostStack(this.renderer, this.scene, this.camera);
    this.resize();
  }

  setFeatureFlags(flags: Partial<FeatureFlagsV2>) {
    this.previewSample = null;
    this.preparationRevision++;
    this.preparedDocument = undefined;
    this.warmedObjects = new WeakSet();
    this.graphPrepared = false;
    const aa = this.flags.aa;
    this.flags = { ...this.flags, ...flags };
    if (this.doc)
      this.environment.apply(this.doc, this.scene, this.flags.ground);
    if (aa !== this.flags.aa) this.rebuildPost();
  }

  /** The runtime has one document contract: autov.lab/2. */
  setDocument(
    input: VfxDocumentV2,
    options: { preserveCamera?: boolean } = {},
  ) {
    if (this.disposed) return;
    this.previewSample = null;
    this.preparationRevision++;
    const doc = this.options.preview
      ? validateWorkspaceDocumentV2(input)
      : validateDocumentV2(input);
    // layer.window: a layer whose start is an event on a path is moved onto
    // that moment ONCE, here, so the renderer, the framing pass and the capture
    // path all read the same times.
    const nextDoc = resolveEventWindows(applyStyle(doc));
    const preserveCamera = options.preserveCamera && this.doc !== undefined;
    const previous = new Map(this.objects.map((object) => [object.id, object]));
    // Validation returns fresh objects. Compare content once per edit, including
    // every document value captured by layer factories and sub-emitter parents.
    const sharedKey = JSON.stringify([
      nextDoc.seed,
      nextDoc.duration,
      nextDoc.quality.particleDensity,
      nextDoc.post.motionBlur,
      nextDoc.textures,
    ]);
    const keys = new Map<string, string>();
    const created: LayerObject[] = [];
    let nextObjects: LayerObject[];
    try {
      // Keep hidden layers resident. Visibility is toggled frequently in the
      // editor, and disposing here used to make every unhide rebuild geometry
      // and compile its GPU pipelines again on the interaction's critical path.
      nextObjects = nextDoc.layers.map((layer, index) => {
        const parent = layer.emitter?.sub
          ? nextDoc.layers.find(
              (item) => item.id === layer.emitter!.sub!.parentLayerId,
            )
          : null;
        const key = JSON.stringify([
          sharedKey,
          index,
          layerBuildKey(layer),
          parent,
        ]);
        keys.set(layer.id, key);
        const existing = previous.get(layer.id);
        if (existing && this.objectKeys.get(layer.id) === key) return existing;
        const object = buildLayerObject(
          nextDoc,
          layer,
          index,
          this.textures,
          this.depthTarget.depthTexture!,
        );
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
      const updated = nextDoc.layers.find((layer) => layer.id === object.id)!;
      Object.assign(object.source, updated);
    }
    this.objects = nextObjects;
    this.objectKeys = keys;
    this.doc = nextDoc;
    // Only reuse preparation after it actually completed. A new edit arriving
    // between warm batches must not accidentally mark an unprepared scene ready.
    const structure = JSON.stringify([
      nextDoc.quality.aa,
      Boolean(nextDoc.post.glitch),
      nextDoc.environment,
      nextDoc.layers.filter((layer) => layer.kind === "light"),
      this.flags,
    ]);
    if (structure !== this.preparationStructure) {
      this.warmedObjects = new WeakSet();
      this.graphPrepared = false;
      this.preparationStructure = structure;
    }
    this.preparedDocument = undefined;
    const lights = this.objects
      .filter((o) => o.source.enabled && o.source.kind === "light")
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

  /** Shared by studio, showcases, capture and exported players. Concurrent
   * callers share one preparation job; edits supersede its next batch, never race it. */
  whenReady(): Promise<void> {
    this.preparation ??= this.prepareDocument().finally(() => {
      this.preparation = undefined;
    });
    return this.preparation;
  }

  private async prepareDocument() {
    await this.initialization;
    while (!this.disposed) {
      const revision = this.preparationRevision;
      await this.textures.whenReady();
      if (this.disposed) return;
      if (this.deviceError) throw this.deviceError;
      if (revision !== this.preparationRevision) continue;
      const doc = this.doc;
      if (!doc || this.preparedDocument === doc) return;
      await this.warmDocument(revision);
      if (this.disposed) return;
      if (revision !== this.preparationRevision) continue;
      if (this.deviceError) throw this.deviceError;
      this.preparedDocument = doc;
      this.previewSample = null;
      return;
    }
  }

  private async warmDocument(revision: number) {
    // Draw through the real post/depth graph: top-level scene compilation uses
    // a different render target and leaves playback variants unprepared.
    const pending = this.objects.filter(
      (object) => !this.warmedObjects.has(object),
    );
    if (!pending.length && this.graphPrepared) return;
    const canvas = this.renderer.domElement;
    // Preserve the last image while yielding: temporary warm frames must never
    // become a visible flash. The copy lives only for the preparation lifetime.
    const still = document.createElement("canvas");
    still.width = canvas.width;
    still.height = canvas.height;
    still.className = canvas.className;
    still.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    still.setAttribute("aria-hidden", "true");
    still.getContext("2d")?.drawImage(canvas, 0, 0);
    const visibility = canvas.style.visibility;
    canvas.style.visibility = "hidden";
    this.host.appendChild(still);
    this.warming = true;
    const target = this.renderer.getRenderTarget();
    const current = () =>
      !this.disposed && revision === this.preparationRevision;
    // A task boundary (not Promise.resolve) lets input and painting run. No
    // renderer operation is suspended across an await, so disposal/edit is safe.
    const yieldTask = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      await yieldTask();
      if (!current()) return;
      this.renderer.setSize(64, 64, false);
      // Keep the complete light set in every batch: hiding lights would create
      // a different shader variant than playback's scene.
      const lights = this.objects.filter(
        (object) => object.source.kind === "light",
      );
      const needsDepth =
        this.flags.softParticles && this.objects.some((object) => object.soft);
      for (const object of this.objects) {
        const layer = object.source;
        object.update(
          layer.start + (layer.end - layer.start) * 0.5,
          this.flags,
          this.camera,
        );
        object.object.visible = layer.kind === "light";
      }
      // Prepare the environment/post graph even for an empty workspace. The
      // real soft-particle prepass hides non-occluders, including point lights.
      // Matching that set avoids a second ground shader on the first soft frame.
      this.advanceFrame();
      if (needsDepth) {
        for (const light of lights) light.object.visible = false;
        this.renderer.setRenderTarget(this.depthTarget);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        for (const light of lights) light.object.visible = true;
      }
      this.renderer.setRenderTarget(null);
      if (this.flags.post) this.post.render();
      else this.renderer.render(this.scene, this.camera);
      await yieldTask();
      for (const object of pending) {
        for (const at of object.warmAt === undefined
          ? [undefined]
          : [undefined, object.warmAt]) {
          if (!current()) return;
          this.renderer.setSize(64, 64, false);
          this.advanceFrame();
          const layer = object.source;
          object.update(
            at ?? layer.start + (layer.end - layer.start) * 0.5,
            this.flags,
            this.camera,
          );
          object.object.visible = true;
          if (object.warmAll)
            object.object.traverse((node) => {
              node.visible = true;
            });
          // Warm occluders in their actual depth target, with the same lights.
          if (needsDepth && object.occluder) {
            for (const light of lights) light.object.visible = false;
            this.renderer.setRenderTarget(this.depthTarget);
            this.renderer.clear();
            this.renderer.render(this.scene, this.camera);
            for (const light of lights) light.object.visible = true;
          }
          this.renderer.setRenderTarget(null);
          if (this.flags.post) this.post.render();
          else this.renderer.render(this.scene, this.camera);
          object.object.visible = lights.includes(object);
          await yieldTask();
        }
        if (current()) this.warmedObjects.add(object);
      }
      if (current()) this.graphPrepared = true;
    } finally {
      still.remove();
      canvas.style.visibility = visibility;
      this.warming = false;
      if (!this.disposed) {
        this.renderer.setSize(this.width, this.height, false);
        this.renderer.setRenderTarget(target);
        this.previewSample = null;
        // Superseded work must not synchronously draw the replacement document.
        if (current())
          this.renderPreview(
            this.lastPreviewRequest.time,
            this.lastPreviewRequest.solo,
          );
      }
    }
  }

  private rebuildPost() {
    const doc = this.doc;
    const samples = doc && doc.quality.aa !== "none" && this.flags.aa ? 4 : 0;
    if (samples !== this.postSamples) {
      this.postSamples = samples;
      this.post.dispose();
      this.post = createPostStack(
        this.renderer,
        this.scene,
        this.camera,
        samples,
      );
    }
    if (doc)
      this.post.apply(doc, {
        post: this.flags.post,
        aa: this.flags.aa && !this.options.preview,
      });
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
        const emitterEvents =
          object.source.emitter!.spawn.originsFromPath &&
          object.source.emitter!.spawn.mode === "event"
            ? pathEvents(doc, object.source.emitter!.shape.pathId)
            : [];
        const spawn = boxOf(
          (time, push) =>
            spawnBoundsV2(
              object.source,
              time,
              push,
              emitterPath,
              emitterEvents,
            ),
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
  focus(
    area: { left: number; top: number; width: number; height: number },
    solo?: string,
    framing = 1,
  ) {
    if (!this.doc) return;
    const box = new THREE.Box3();
    for (const object of this.objects) {
      const layer = object.source;
      if (
        !layer.enabled ||
        layer.kind === "light" ||
        (solo && layer.id !== solo)
      )
        continue;
      for (let i = 0; i <= 48; i++)
        object.bounds(
          layer.start + ((layer.end - layer.start) * i) / 48,
          (point) => box.expandByPoint(point),
        );
    }
    if (box.isEmpty())
      box.setFromCenterAndSize(this.frame.center, new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(this.doc.camera.fov) / 2;
    const horizontal = Math.atan(
      (Math.tan(vertical) * area.width) / area.height,
    );
    const distance = Math.max(
      1,
      (sphere.radius * 1.12) / (Math.sin(Math.min(vertical, horizontal)) * Math.max(0.1, framing)),
    );
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (!direction.lengthSq())
      direction.copy(
        directionOf(this.doc.camera.azimuth, this.doc.camera.elevation),
      );
    // Flush pending damping before taking ownership of the new pose.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(sphere.center);
    this.controls.maxDistance = Math.max(60, distance * 2);
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(direction, distance);
    this.camera.fov = this.doc.camera.fov;
    this.camera.far = Math.max(this.camera.far, distance + sphere.radius * 2);
    this.camera.setViewOffset(
      area.width,
      area.height,
      -area.left,
      -area.top,
      this.width,
      this.height,
    );
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
      this.renderer.setPixelRatio(
        Math.min(
          globalThis.devicePixelRatio || 1,
          1.5,
          Math.sqrt(1_000_000 / (w * h)),
        ),
      );
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

  private renderSample(
    time: number,
    solo: string | undefined,
    diagnostic: boolean,
    skipUnchanged: boolean,
  ) {
    if (this.disposed || !this.doc || this.warming) return;
    if (this.deviceError) throw this.deviceError;
    if (!this.initialized)
      throw new Error("Await whenReady() before rendering a V2 document.");
    const cameraChanged = this.interactive && this.controls.update();
    // No emitter/light is alive and the camera has no authored motion: all
    // times in this interval produce the same environment image.
    const sampleTime =
      skipUnchanged &&
      !this.doc.camera.shake &&
      !this.doc.camera.pushIn &&
      !this.doc.layers.some(
        (layer) =>
          layer.enabled &&
          (!solo || layer.id === solo) &&
          time >= layer.start &&
          time < layer.end,
      )
        ? -Infinity
        : time;
    if (
      skipUnchanged &&
      !cameraChanged &&
      this.previewSample?.time === sampleTime &&
      this.previewSample.solo === solo &&
      this.previewSample.diagnostic === diagnostic
    )
      return;
    this.advanceFrame();
    const move = this.applyCameraMove(time);
    const doc = this.doc;
    for (const object of this.objects) {
      if (object.source.kind === "light") {
        object.update(time, this.flags, this.camera);
        if (!object.source.enabled || (solo && object.id !== solo))
          (object.object as THREE.PointLight).intensity = 0;
        continue;
      }
      if (
        !object.source.enabled ||
        (solo && object.id !== solo) ||
        time < object.source.start ||
        time >= object.source.end
      ) {
        object.object.visible = false;
        continue;
      }
      object.update(time, this.flags, this.camera);
    }
    this.environment.apply(doc, this.scene, this.flags.ground);
    // environment.groundPool: a pool that follows a layer reads that layer's
    // LIVE transform, so the floor light travels with a falling meteor without
    // a track of its own.
    const pools = doc.environment.groundPool ?? [];
    if (pools.length) {
      const u = clamp01(time / Math.max(doc.duration, 1e-4));
      this.environment.writePools(
        pools.map((pool) => {
          const centre = new THREE.Vector3().fromArray(pool.position);
          if (pool.followsLayerId) {
            const owner = this.objects.find(
              (o) => o.id === pool.followsLayerId,
            );
            if (owner)
              centre.fromArray(
                evaluateLayerV2(owner.source, time).layer.transform.position,
              );
          }
          return {
            centre,
            intensity: curveAt(pool.intensity, u),
          };
        }),
      );
    }
    updateSmokeLighting(this.scene, this.camera, doc.environment.ambient);
    this.renderer.toneMappingExposure = doc.post.exposure;
    this.post.apply(
      doc,
      {
        post: this.flags.post && !diagnostic,
        aa: this.flags.aa && !this.options.preview,
      },
      time,
    );

    if (
      this.flags.softParticles &&
      this.objects.some((o) => o.soft && o.object.visible)
    ) {
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
    if (this.disposed) return this.disposal;
    this.disposed = true;
    this.removeDeviceErrorListener?.();
    this.controls.dispose();
    this.disposeObjects();
    this.environment.dispose();
    this.post.dispose();
    this.textures.dispose();
    this.depthTarget.depthTexture?.dispose();
    this.depthTarget.dispose();
    this.disposal = this.initialized
      ? Promise.resolve(this.renderer.dispose())
      : this.initialization.catch(() => {});
    this.renderer.domElement.remove();
    return this.disposal;
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

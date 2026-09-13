import fireProjectileFixture from "../../../fixtures/v2/fire-projectile/document.json";
import type { RecipeId } from "./recipes";
import {
  type Curve,
  type Emitter,
  type GeometryV2,
  type LayerV2,
  type LightV2,
  type Material,
  type TrackV2,
  type VfxDocumentV2,
  defaultDocumentShell,
  defaultEmitter,
  defaultGeometry,
  defaultMaterial,
  validateDocumentV2,
} from "./schema-v2";

// ---------------------------------------------------------------------------
// autov.lab/2 construction recipes.
//
// Eight families, each with the knowledge the planner needs and one complete
// example document. The examples are STARTING POINTS, not finished look-dev:
// they exist so a candidate request always ships a valid, readable reference
// built from the same parts (ramps, erosion, library masks, a light, a decal,
// an environment grid).
//
// fire-projectile is the hand-tuned spike exemplar, imported from the fixture
// so there is exactly one copy of those numbers in the repository.
// ---------------------------------------------------------------------------

export const RECIPE_V2_IDS = [
  "fire-projectile",
  "smoke-burst",
  "lightning-impact",
  "fire-slash",
  "beam",
  "shield",
  "meteor-rain",
  "ice-blast",
] as const;
export type RecipeV2Id = (typeof RECIPE_V2_IDS)[number];

/**
 * The planner still chooses from the v1 recipe vocabulary (PlanSchema is shared
 * between both schemas), so every v1 id maps onto the nearest v2 family.
 */
export const V1_RECIPE_TO_V2: Record<RecipeId, RecipeV2Id> = {
  projectile: "fire-projectile",
  smoke: "smoke-burst",
  lightning: "lightning-impact",
  slash: "fire-slash",
  beam: "beam",
  // magic circles and portals are both standing energy constructs;
  // the shield family carries the dome/rim/sigil parts they need.
  magic: "shield",
  portal: "shield",
  // a shockwave is the ground half of a strike, without the bolt.
  shockwave: "lightning-impact",
  // water has no family of its own yet; ice-blast is the nearest
  // (cool palette, shard/mist secondaries, ground frost).
  water: "ice-blast",
};

// --- small builders --------------------------------------------------------

type Vec3 = [number, number, number];
type Stop = { t: number; color: string; intensity: number };

const curve = (
  keys: [number, number][],
  ease: Curve["ease"] = "smooth",
): Curve => ({ keys, ease });

/** Normalized direction, rounded so the unit-vector check has slack to spare. */
function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [
    Number((x / length).toFixed(6)),
    Number((y / length).toFixed(6)),
    Number((z / length).toFixed(6)),
  ];
}

type MaterialOptions = {
  blend?: Material["blend"];
  space?: Material["ramp"]["space"];
  stops: Stop[];
  displacementShift?: number;
  opacity?: number;
  mask?: string | null;
  maskOptions?: Partial<Material["mask"]>;
  noise?: {
    textureId: string;
    uvScale?: [number, number];
    uvPan?: [number, number];
    distortion?: number;
  };
  erosion?: Partial<NonNullable<Material["erosion"]>> & { curve: Curve };
  softParticle?: number;
  fresnel?: { power: number; strength: number };
  procedural?: Material["procedural"];
};

function mat(options: MaterialOptions): Material {
  const base = defaultMaterial();
  return {
    blend: options.blend ?? "additive",
    ramp: {
      space: options.space ?? "layerTime",
      stops: options.stops,
      displacementShift: options.displacementShift ?? 0,
    },
    opacity: options.opacity ?? 1,
    mask: {
      ...base.mask,
      textureId: options.mask ?? null,
      ...(options.maskOptions ?? {}),
    },
    noise: options.noise
      ? {
          textureId: options.noise.textureId,
          uvScale: options.noise.uvScale ?? [1, 1],
          uvPan: options.noise.uvPan ?? [0, -0.4],
          distortion: options.noise.distortion ?? 0,
          distortionPan: [0, 0],
        }
      : null,
    erosion: options.erosion
      ? {
          softness: 0.1,
          edgeWidth: 0.03,
          edgeColor: options.stops[0].color,
          edgeIntensity: 1.4,
          displacementProtect: 0,
          rimBias: 0,
          ...options.erosion,
        }
      : null,
    softParticle: options.softParticle ?? 0,
    fresnel: options.fresnel ?? null,
    procedural: options.procedural ?? "none",
  };
}

type GeometryOptions = Partial<
  Omit<GeometryV2, "vertexNoise" | "lightning">
> & {
  vertexNoise?: GeometryV2["vertexNoise"];
  lightning?: GeometryV2["lightning"];
};

function geo(options: GeometryOptions = {}): GeometryV2 {
  return { ...defaultGeometry(), ...options } as GeometryV2;
}

type EmitterOptions = {
  count?: number;
  shape?: Partial<Emitter["shape"]>;
  spawn?: Partial<Emitter["spawn"]>;
  velocity?: Partial<Emitter["velocity"]>;
  life?: [number, number];
  forces?: Partial<Emitter["forces"]>;
  render?: Partial<Emitter["render"]>;
  trail?: Emitter["trail"];
  sub?: Emitter["sub"];
};

function emit(options: EmitterOptions = {}): Emitter {
  const base = defaultEmitter();
  return {
    count: options.count ?? base.count,
    shape: { ...base.shape, ...(options.shape ?? {}) },
    spawn: { ...base.spawn, ...(options.spawn ?? {}) },
    velocity: { ...base.velocity, ...(options.velocity ?? {}) },
    life: options.life ?? base.life,
    forces: { ...base.forces, ...(options.forces ?? {}) },
    render: { ...base.render, ...(options.render ?? {}) },
    trail: options.trail ?? null,
    sub: options.sub ?? null,
  };
}

type LayerCommon = {
  id: string;
  name: string;
  role: LayerV2["role"];
  start: number;
  end: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  motion?: LayerV2["motion"];
  tracks?: TrackV2[];
};

function base(common: LayerCommon) {
  return {
    id: common.id,
    name: common.name,
    role: common.role,
    start: common.start,
    end: common.end,
    enabled: true,
    transform: {
      position: common.position ?? ([0, 0, 0] as Vec3),
      rotation: common.rotation ?? ([0, 0, 0] as Vec3),
      scale: common.scale ?? ([1, 1, 1] as Vec3),
    },
    motion: common.motion ?? null,
    tracks: common.tracks ?? [],
    overrides: [],
  };
}

const mesh = (
  common: LayerCommon & {
    kind: "ring" | "shell" | "trail" | "beam" | "sprite" | "decal";
    material: Material;
    geometry: GeometryV2;
  },
): LayerV2 => ({
  ...base(common),
  kind: common.kind,
  material: common.material,
  geometry: common.geometry,
});

const particles = (
  common: LayerCommon & { material: Material; emitter: Emitter },
): LayerV2 => ({
  ...base(common),
  kind: "particles",
  material: common.material,
  emitter: common.emitter,
});

const light = (common: LayerCommon & { light: LightV2 }): LayerV2 => ({
  ...base(common),
  kind: "light",
  light: common.light,
});

function document(
  shell: {
    name: string;
    description: string;
    seed: number;
    duration: number;
    impact: number;
    background: string;
    fog?: string;
    groundColor?: string;
    framing?: number;
    azimuth?: number;
    elevation?: number;
    bloom?: { strength: number; radius: number; threshold: number };
    exposure?: number;
    shake?: VfxDocumentV2["camera"]["shake"];
    pushIn?: VfxDocumentV2["camera"]["pushIn"];
    grade?: VfxDocumentV2["post"]["grade"];
    motionBlur?: number;
  },
  layers: LayerV2[],
): VfxDocumentV2 {
  const defaults = defaultDocumentShell(shell.name);
  return validateDocumentV2({
    ...defaults,
    name: shell.name,
    description: shell.description,
    seed: shell.seed,
    duration: shell.duration,
    impact: shell.impact,
    environment: {
      ...defaults.environment,
      groundColor: shell.groundColor ?? defaults.environment.groundColor,
      fog: { color: shell.fog ?? shell.background, density: 0.03 },
      background: shell.background,
    },
    camera: {
      ...defaults.camera,
      azimuth: shell.azimuth ?? defaults.camera.azimuth,
      elevation: shell.elevation ?? defaults.camera.elevation,
      framing: shell.framing ?? 0.58,
      shake: shell.shake ?? null,
      pushIn: shell.pushIn ?? null,
    },
    post: {
      ...defaults.post,
      bloom: shell.bloom ?? { strength: 0.5, radius: 0.42, threshold: 0.85 },
      exposure: shell.exposure ?? 1,
      grade: shell.grade ?? defaults.post.grade,
      motionBlur: shell.motionBlur ?? 0,
    },
    textures: [],
    layers,
  });
}

// Curves reused across the examples.
const risingAlpha = curve([
  [0, 0],
  [0.12, 1],
  [0.7, 0.8],
  [1, 0],
]);
const softSize = curve([
  [0, 0.55],
  [0.35, 1],
  [1, 0.85],
]);
const sparkSize = curve([
  [0, 0.6],
  [0.2, 1],
  [1, 0.2],
]);
const sparkAlpha = curve([
  [0, 0],
  [0.06, 1],
  [0.6, 1],
  [1, 0],
]);
const erosionCurve = curve([
  [0, 0],
  [0.3, 0.08],
  [1, 0.95],
]);
const curlEnvelope = curve([
  [0, 0],
  [0.25, 1],
  [1, 1],
]);

// --- examples --------------------------------------------------------------

function smokeBurst(): VfxDocumentV2 {
  return document(
    {
      name: "Smoke burst",
      description:
        "A grounded impact puff: a short flash, an expanding dust ring, a rising eroded smoke column with torn wisps behind it, staggered sparks and a scorch decal.",
      seed: 20731,
      duration: 3.2,
      impact: 0.3,
      background: "#16161a",
      groundColor: "#494852",
    },
    [
      mesh({
        id: "flash",
        name: "Contact flash",
        role: "impact",
        kind: "sprite",
        start: 0.3,
        end: 0.42,
        position: [0, 0.3, 0],
        material: mat({
          stops: [
            { t: 0, color: "#fff1d2", intensity: 4.2 },
            { t: 1, color: "#ffb066", intensity: 0.4 },
          ],
          mask: "mask-soft-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.55,
          length: 1.1,
          thickness: 0.01,
        }),
        tracks: [
          {
            target: "material.ramp.stops[0].intensity",
            keys: [
              [0, 4.2],
              [0.12, 0.2],
            ],
            ease: "outCubic",
          },
        ],
      }),
      mesh({
        id: "dust-ring",
        name: "Expanding dust ring",
        role: "impact",
        kind: "ring",
        start: 0.333,
        end: 1.1,
        position: [0, 0.04, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          blend: "alpha",
          stops: [
            { t: 0, color: "#cbb9a6", intensity: 1.4 },
            { t: 1, color: "#6b5f57", intensity: 0.35 },
          ],
          opacity: 0.75,
          mask: "ring-gradient-01",
          erosion: { curve: erosionCurve, softness: 0.14, edgeIntensity: 0.8 },
        }),
        geometry: geo({ type: "torus", radius: 0.4, thickness: 0.12 }),
        tracks: [
          {
            target: "geometry.radius",
            keys: [
              [0, 0.4],
              [0.35, 1.5],
              [0.767, 2.1],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 0.75],
              [0.767, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      particles({
        id: "smoke-column",
        name: "Rising smoke column",
        role: "primary",
        start: 0.45,
        end: 3.2,
        position: [0, 0.15, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#8e8496", intensity: 1.1 },
            { t: 0.45, color: "#635b70", intensity: 0.8 },
            { t: 1, color: "#2e2b38", intensity: 0.3 },
          ],
          opacity: 0.85,
          mask: "smoke-puff-01",
          maskOptions: { randomRotation: true },
          noise: { textureId: "noise-cloud-tile-01", uvScale: [1.4, 1.4] },
          erosion: {
            curve: erosionCurve,
            softness: 0.18,
            edgeWidth: 0.02,
            edgeIntensity: 0.5,
          },
          softParticle: 0.6,
        }),
        emitter: emit({
          count: 220,
          shape: { type: "disc", radius: 0.35, axis: unit(0, 1, 0) },
          spawn: { mode: "continuous", window: 0.9, rate: 90, duration: 1.5 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 0.4,
            speed: [0.7, 1.5],
          },
          life: [1.15, 2.3],
          forces: {
            gravity: [0, 0.18, 0],
            drag: 1.1,
            curl: {
              strength: 0.5,
              frequency: 1.4,
              speed: 0.8,
              envelope: curlEnvelope,
            },
          },
          render: {
            size: [0.42, 0.95],
            sizeCurve: curve([
              [0, 0.45],
              [0.5, 1],
              [1, 1.35],
            ]),
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.5, 0.5] },
          },
        }),
      }),
      particles({
        id: "smoke-wisps",
        name: "Torn trailing wisps",
        role: "secondary",
        start: 0.62,
        end: 3.2,
        position: [0, 0.35, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#6f6878", intensity: 0.7 },
            { t: 1, color: "#26232d", intensity: 0.2 },
          ],
          opacity: 0.6,
          mask: "smoke-wisp-01",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.22, edgeIntensity: 0.3 },
          softParticle: 0.8,
        }),
        emitter: emit({
          count: 90,
          shape: { type: "sphere", radius: 0.45 },
          spawn: { mode: "continuous", window: 1.2, rate: 40, duration: 1.8 },
          velocity: {
            mode: "cone",
            direction: unit(0.2, 1, 0.1),
            angle: 0.8,
            speed: [0.4, 1],
          },
          life: [1.6, 2.5],
          forces: {
            gravity: [0, 0.1, 0],
            drag: 1.4,
            wind: [0.15, 0, -0.05],
            curl: {
              strength: 0.8,
              frequency: 2,
              speed: 1,
              envelope: curlEnvelope,
            },
          },
          render: {
            size: [0.3, 0.7],
            sizeCurve: softSize,
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.8, 0.8] },
          },
        }),
      }),
      particles({
        id: "sparks",
        name: "Struck sparks",
        role: "secondary",
        start: 0.36,
        end: 1.35,
        position: [0, 0.12, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#ffe9b4", intensity: 4.5 },
            { t: 0.55, color: "#ff9a3c", intensity: 2.2 },
            { t: 1, color: "#8a2f14", intensity: 0.5 },
          ],
          mask: "spark-streak-01",
        }),
        emitter: emit({
          count: 140,
          shape: { type: "hemisphere", radius: 0.18, axis: unit(0, 1, 0) },
          spawn: { mode: "burst", window: 0.14 },
          velocity: { mode: "radial", speed: [2.2, 5.5], angle: 1.2 },
          life: [0.45, 0.95],
          forces: { gravity: [0, -6, 0], drag: 0.8 },
          render: {
            mode: "velocityStretch",
            stretch: 0.3,
            size: [0.05, 0.13],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
        }),
      }),
      particles({
        id: "ground-dust",
        name: "Ground dust skirt",
        role: "residue",
        start: 0.4,
        end: 2.6,
        position: [0, 0.06, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#a1968b", intensity: 0.8 },
            { t: 1, color: "#3b352f", intensity: 0.2 },
          ],
          opacity: 0.55,
          mask: "smoke-puff-03",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.2, edgeIntensity: 0.3 },
          softParticle: 1,
        }),
        emitter: emit({
          count: 110,
          shape: {
            type: "ring",
            radius: 0.5,
            innerRadius: 0.2,
            axis: unit(0, 1, 0),
          },
          spawn: { mode: "burst", window: 0.22 },
          velocity: { mode: "radial", speed: [1.2, 2.6], angle: 0.25 },
          life: [1, 1.9],
          forces: { gravity: [0, 0.05, 0], drag: 2.2 },
          render: {
            size: [0.3, 0.65],
            sizeCurve: curve([
              [0, 0.5],
              [1, 1.4],
            ]),
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.4, 0.4] },
          },
        }),
      }),
      mesh({
        id: "scorch",
        name: "Scorch decal",
        role: "residue",
        kind: "decal",
        start: 0.34,
        end: 3.2,
        position: [0, 0.01, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          blend: "alpha",
          stops: [
            { t: 0, color: "#4a3b34", intensity: 0.9 },
            { t: 1, color: "#2b2320", intensity: 0.5 },
          ],
          opacity: 0.6,
          mask: "scorch-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.9,
          length: 1.8,
          thickness: 0.01,
        }),
      }),
      light({
        id: "flash-light",
        name: "Impact light",
        role: "impact",
        start: 0.3,
        end: 1.2,
        position: [0, 0.4, 0],
        light: {
          color: "#ffc178",
          intensity: curve([
            [0, 14],
            [0.15, 4],
            [1, 0],
          ]),
          radius: 9,
          decay: 2,
        },
      }),
    ],
  );
}

function lightningImpact(): VfxDocumentV2 {
  return document(
    {
      name: "Lightning impact",
      description:
        "One decisive bolt: a short charge glow, a branched bolt with a narrower white core, an expanding ground ring, staggered sparks, thin smoke and a scorch decal.",
      seed: 9041,
      duration: 1.2,
      impact: 0.3,
      background: "#101018",
      bloom: { strength: 0.6, radius: 0.45, threshold: 0.75 },
    },
    [
      mesh({
        id: "charge",
        name: "Charge glow",
        role: "anticipation",
        kind: "sprite",
        start: 0.08,
        end: 0.3,
        position: [0, 1.6, 0],
        material: mat({
          stops: [
            { t: 0, color: "#9fd8ff", intensity: 0.5 },
            { t: 1, color: "#6fb4f2", intensity: 2.2 },
          ],
          opacity: 0.8,
          mask: "mask-soft-02",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.3,
          length: 0.6,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "bolt",
        name: "Bolt sheath",
        role: "primary",
        kind: "beam",
        start: 0.3,
        end: 0.52,
        position: [0, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#bfe6ff", intensity: 2.2 },
            { t: 1, color: "#3f7fd8", intensity: 1.1 },
          ],
          procedural: "solid",
        }),
        geometry: geo({
          type: "lightning",
          radius: 0.62,
          length: 2.2,
          thickness: 0.075,
          lightning: {
            points: 24,
            jitter: 0.8,
            branches: 3,
            branchDepth: 2,
            widthCurve: curve([
              [0, 1],
              [1, 0.35],
            ]),
            seedOffset: 17,
          },
        }),
        tracks: [
          {
            target: "material.opacity",
            keys: [
              [0, 1],
              [0.14, 1],
              [0.22, 0],
            ],
            ease: "outCubic",
          },
        ],
      }),
      mesh({
        id: "bolt-core",
        name: "Bolt white core",
        role: "primary",
        kind: "beam",
        start: 0.3,
        end: 0.47,
        position: [0, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#fdfdf6", intensity: 3.6 },
            { t: 1, color: "#cfe9ff", intensity: 2.2 },
          ],
          procedural: "solid",
        }),
        geometry: geo({
          type: "lightning",
          radius: 0.62,
          length: 2.2,
          thickness: 0.026,
          lightning: {
            points: 24,
            jitter: 0.8,
            branches: 0,
            branchDepth: 1,
            widthCurve: curve([
              [0, 1],
              [1, 0.4],
            ]),
            seedOffset: 17,
          },
        }),
      }),
      mesh({
        id: "ground-ring",
        name: "Ground discharge ring",
        role: "impact",
        kind: "ring",
        start: 0.333,
        end: 0.95,
        position: [0, 0.03, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#d7f0ff", intensity: 3 },
            { t: 1, color: "#2f6bc0", intensity: 0.4 },
          ],
          mask: "ring-soft-01",
        }),
        geometry: geo({ type: "torus", radius: 0.3, thickness: 0.07 }),
        tracks: [
          {
            target: "geometry.radius",
            keys: [
              [0, 0.3],
              [0.3, 1.5],
              [0.617, 2],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 1],
              [0.617, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      particles({
        id: "sparks",
        name: "Discharge sparks",
        role: "secondary",
        start: 0.36,
        end: 1,
        position: [0, 0.1, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#e8f6ff", intensity: 5 },
            { t: 0.5, color: "#7fc4ff", intensity: 2.4 },
            { t: 1, color: "#1f4c96", intensity: 0.4 },
          ],
          mask: "spark-streak-02",
        }),
        emitter: emit({
          count: 180,
          shape: { type: "hemisphere", radius: 0.15, axis: unit(0, 1, 0) },
          spawn: { mode: "burst", window: 0.1 },
          velocity: { mode: "radial", speed: [3, 7], angle: 1.1 },
          life: [0.35, 0.8],
          forces: { gravity: [0, -7, 0], drag: 0.6 },
          render: {
            mode: "velocityStretch",
            stretch: 0.45,
            size: [0.045, 0.12],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
          // Each spark drags its own analytic ribbon: vertex k is the spark's
          // own position at age - k*spacing, so the streak follows the arc.
          trail: {
            segments: 8,
            spacing: 0.022,
            widthCurve: curve([
              [0, 1],
              [1, 0],
            ]),
            textureId: null,
          },
        }),
      }),
      particles({
        id: "smoke",
        name: "Thin ozone smoke",
        role: "residue",
        start: 0.45,
        end: 1.2,
        position: [0, 0.2, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#7e8794", intensity: 0.7 },
            { t: 1, color: "#2a2f38", intensity: 0.2 },
          ],
          opacity: 0.5,
          mask: "smoke-wisp-02",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.2, edgeIntensity: 0.25 },
          softParticle: 0.8,
        }),
        emitter: emit({
          count: 60,
          shape: { type: "sphere", radius: 0.3 },
          spawn: { mode: "continuous", window: 0.4, rate: 60, duration: 0.5 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 0.6,
            speed: [0.5, 1.1],
          },
          life: [0.7, 1.3],
          forces: { gravity: [0, 0.2, 0], drag: 1.6 },
          render: {
            size: [0.25, 0.6],
            sizeCurve: softSize,
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.6, 0.6] },
          },
        }),
      }),
      mesh({
        id: "scorch",
        name: "Scorch decal",
        role: "residue",
        kind: "decal",
        start: 0.32,
        end: 1.2,
        position: [0, 0.01, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          blend: "alpha",
          stops: [
            { t: 0, color: "#3c3a45", intensity: 0.9 },
            { t: 1, color: "#24232b", intensity: 0.5 },
          ],
          opacity: 0.55,
          mask: "scorch-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.8,
          length: 1.6,
          thickness: 0.01,
        }),
      }),
      light({
        id: "strike-light",
        name: "Strike light",
        role: "impact",
        start: 0.3,
        end: 0.9,
        position: [0, 0.8, 0],
        light: {
          color: "#a8d8ff",
          intensity: curve([
            [0, 19],
            [0.1, 5],
            [1, 0],
          ]),
          radius: 12,
          decay: 2,
        },
      }),
    ],
  );
}

function fireSlash(): VfxDocumentV2 {
  return document(
    {
      name: "Fire slash",
      description:
        "An airborne diagonal slash: a brief gathering glow, a hot eroded crescent core with a wider dim body behind it, embers, stretched sparks and slow smoke. No ground contact.",
      seed: 3317,
      duration: 1.4,
      impact: 0.35,
      background: "#171214",
    },
    [
      mesh({
        id: "gather",
        name: "Gathering glow",
        role: "anticipation",
        kind: "sprite",
        start: 0.12,
        end: 0.35,
        position: [0.4, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#ffcf8e", intensity: 0.4 },
            { t: 1, color: "#ff8a3a", intensity: 2 },
          ],
          opacity: 0.8,
          mask: "mask-soft-03",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.28,
          length: 0.56,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "slash-core",
        name: "Slash core",
        role: "primary",
        kind: "trail",
        start: 0.35,
        end: 0.78,
        position: [0, 1.05, 0],
        rotation: [0, 0, -0.6],
        material: mat({
          space: "surface",
          stops: [
            { t: 0, color: "#fff3d6", intensity: 4 },
            { t: 0.4, color: "#ffab3d", intensity: 2.4 },
            { t: 1, color: "#c4361c", intensity: 0.8 },
          ],
          erosion: {
            curve: curve([
              [0, 0],
              [0.45, 0.1],
              [1, 0.92],
            ]),
            softness: 0.06,
            edgeWidth: 0.04,
            edgeColor: "#ffbd63",
            edgeIntensity: 2.2,
            rimBias: 0.2,
          },
          procedural: "flame",
        }),
        geometry: geo({
          type: "ribbon",
          radius: 1.5,
          length: 2.4,
          thickness: 0.1,
        }),
      }),
      mesh({
        id: "slash-body",
        name: "Slash body",
        role: "secondary",
        kind: "trail",
        start: 0.35,
        end: 0.95,
        position: [0, 1.05, 0],
        rotation: [0, 0, -0.6],
        material: mat({
          blend: "alpha",
          space: "surface",
          stops: [
            { t: 0, color: "#d97a2c", intensity: 1.1 },
            { t: 1, color: "#5c1f22", intensity: 0.35 },
          ],
          opacity: 0.7,
          noise: {
            textureId: "noise-streak-tile-01",
            uvScale: [2, 1.2],
            uvPan: [-0.6, 0],
          },
          erosion: {
            curve: erosionCurve,
            softness: 0.14,
            edgeWidth: 0.02,
            edgeColor: "#ff9a4a",
            edgeIntensity: 1,
          },
          procedural: "flame",
        }),
        geometry: geo({
          type: "ribbon",
          radius: 1.62,
          length: 2.4,
          thickness: 0.24,
        }),
      }),
      particles({
        id: "embers",
        name: "Embers along the arc",
        role: "secondary",
        start: 0.42,
        end: 1.15,
        position: [0, 1.05, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#ffdb9a", intensity: 3.2 },
            { t: 0.6, color: "#ff7a28", intensity: 1.6 },
            { t: 1, color: "#6d1d10", intensity: 0.4 },
          ],
          mask: "ember-01",
          maskOptions: { randomRotation: true },
        }),
        emitter: emit({
          count: 180,
          shape: {
            type: "line",
            axis: unit(0.82, 0.57, 0),
            length: 2.2,
            radius: 0.12,
          },
          spawn: { mode: "burst", window: 0.16 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 1,
            speed: [0.6, 1.8],
          },
          life: [0.55, 1.2],
          forces: {
            gravity: [0, -0.6, 0],
            drag: 1.3,
            curl: {
              strength: 0.6,
              frequency: 2,
              speed: 1.2,
              envelope: curlEnvelope,
            },
          },
          render: {
            size: [0.05, 0.14],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-1.5, 1.5] },
          },
        }),
      }),
      particles({
        id: "sparks",
        name: "Directional sparks",
        role: "secondary",
        start: 0.46,
        end: 1,
        position: [0, 1.05, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#fff0c9", intensity: 4.5 },
            { t: 1, color: "#a33a12", intensity: 0.5 },
          ],
          mask: "spark-streak-01",
        }),
        emitter: emit({
          count: 120,
          shape: {
            type: "line",
            axis: unit(0.82, 0.57, 0),
            length: 2,
            radius: 0.08,
          },
          spawn: { mode: "burst", window: 0.12 },
          velocity: {
            mode: "directional",
            direction: unit(0.7, 0.5, -0.2),
            angle: 0.5,
            speed: [3, 6.5],
          },
          life: [0.3, 0.7],
          forces: { gravity: [0, -4.5, 0], drag: 0.9 },
          render: {
            mode: "velocityStretch",
            stretch: 0.4,
            size: [0.04, 0.1],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
        }),
      }),
      particles({
        id: "smoke",
        name: "Slow smoke wake",
        role: "residue",
        start: 0.52,
        end: 1.4,
        position: [0, 1.05, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#7b6b70", intensity: 0.7 },
            { t: 1, color: "#2b2427", intensity: 0.2 },
          ],
          opacity: 0.55,
          mask: "smoke-wisp-01",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.22, edgeIntensity: 0.3 },
          softParticle: 0.8,
        }),
        emitter: emit({
          count: 70,
          shape: {
            type: "line",
            axis: unit(0.82, 0.57, 0),
            length: 2.1,
            radius: 0.2,
          },
          spawn: { mode: "continuous", window: 0.5, rate: 70, duration: 0.6 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 0.9,
            speed: [0.3, 0.9],
          },
          life: [0.8, 1.5],
          forces: { gravity: [0, 0.15, 0], drag: 1.8 },
          render: {
            size: [0.24, 0.6],
            sizeCurve: softSize,
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.5, 0.5] },
          },
        }),
      }),
      light({
        id: "slash-light",
        name: "Slash light",
        role: "primary",
        start: 0.35,
        end: 0.85,
        position: [0, 1.05, 0.2],
        light: {
          color: "#ff9c4a",
          intensity: curve([
            [0, 12],
            [0.25, 6],
            [1, 0],
          ]),
          radius: 8,
          decay: 2,
        },
      }),
    ],
  );
}

function beam(): VfxDocumentV2 {
  return document(
    {
      name: "Sustained beam",
      description:
        "A horizontal magenta beam: a charge sprite, a white energy-ribbon core with a saturated sheath, a muzzle flare, a far-end impact flare, sparks and a fading residue haze.",
      seed: 55210,
      duration: 3,
      impact: 0.6,
      background: "#14101a",
      bloom: { strength: 0.55, radius: 0.45, threshold: 0.8 },
    },
    [
      mesh({
        id: "charge",
        name: "Charge sprite",
        role: "anticipation",
        kind: "sprite",
        start: 0.35,
        end: 0.6,
        position: [1.4, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#ffb8e8", intensity: 0.5 },
            { t: 1, color: "#e44bb4", intensity: 2.6 },
          ],
          opacity: 0.85,
          mask: "mask-soft-02",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.26,
          length: 0.52,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "beam-core",
        name: "Beam core",
        role: "primary",
        kind: "beam",
        start: 0.6,
        end: 2.2,
        position: [0, 1.1, 0],
        rotation: [0, 0, 1.570796],
        material: mat({
          space: "surface",
          stops: [
            { t: 0, color: "#fef2fb", intensity: 3.4 },
            { t: 1, color: "#f06fd0", intensity: 2 },
          ],
          procedural: "energy-ribbon",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.09,
          length: 2.8,
          thickness: 0.05,
        }),
        tracks: [
          {
            target: "geometry.length",
            keys: [
              [0, 0.4],
              [0.25, 2.8],
              [1.6, 2.8],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 1],
              [1.3, 1],
              [1.6, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      mesh({
        id: "beam-sheath",
        name: "Beam sheath",
        role: "secondary",
        kind: "beam",
        start: 0.633,
        end: 2.35,
        position: [0, 1.1, 0],
        rotation: [0, 0, 1.570796],
        material: mat({
          space: "surface",
          stops: [
            { t: 0, color: "#c93ca6", intensity: 1.3 },
            { t: 1, color: "#5c1a56", intensity: 0.5 },
          ],
          opacity: 0.65,
          noise: {
            textureId: "noise-streak-tile-01",
            uvScale: [3, 1],
            uvPan: [-1.2, 0],
          },
          erosion: {
            curve: erosionCurve,
            softness: 0.18,
            edgeColor: "#ff8ce0",
            edgeIntensity: 0.9,
          },
        }),
        geometry: geo({
          type: "plane",
          radius: 0.22,
          length: 2.8,
          thickness: 0.12,
        }),
        tracks: [
          {
            target: "geometry.length",
            keys: [
              [0, 0.4],
              [0.25, 2.8],
              [1.717, 2.8],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 0.65],
              [1.4, 0.65],
              [1.717, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      mesh({
        id: "muzzle",
        name: "Muzzle flare",
        role: "impact",
        kind: "sprite",
        start: 0.6,
        end: 2.3,
        position: [1.4, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#fff0fa", intensity: 3.6 },
            { t: 1, color: "#d64fb0", intensity: 1 },
          ],
          mask: "mask-glow-cross-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.4,
          length: 0.8,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "far-flare",
        name: "Far endpoint flare",
        role: "impact",
        kind: "sprite",
        start: 0.7,
        end: 2.3,
        position: [-1.4, 1.1, 0],
        material: mat({
          stops: [
            { t: 0, color: "#ffd9f2", intensity: 2.8 },
            { t: 1, color: "#b93a98", intensity: 0.9 },
          ],
          opacity: 0.9,
          mask: "mask-soft-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.5,
          length: 1,
          thickness: 0.01,
        }),
      }),
      particles({
        id: "sparks",
        name: "Endpoint sparks",
        role: "secondary",
        start: 0.72,
        end: 2.6,
        position: [-1.4, 1.1, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#ffe6f8", intensity: 4.2 },
            { t: 1, color: "#8e2273", intensity: 0.5 },
          ],
          mask: "spark-streak-02",
        }),
        emitter: emit({
          count: 200,
          shape: { type: "sphere", radius: 0.14 },
          spawn: { mode: "continuous", window: 0.5, rate: 130, duration: 1.5 },
          velocity: {
            mode: "cone",
            direction: unit(-0.6, 0.7, 0),
            angle: 1,
            speed: [2, 4.5],
          },
          life: [0.3, 0.75],
          forces: { gravity: [0, -3.5, 0], drag: 1 },
          render: {
            mode: "velocityStretch",
            stretch: 0.35,
            size: [0.04, 0.1],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
          // textureId stays null: the library streak masks are multi-streak
          // sheets, and one sheet stretched over a ribbon reads as a worm.
          trail: {
            segments: 6,
            spacing: 0.016,
            widthCurve: curve([
              [0, 0.8],
              [1, 0],
            ]),
            textureId: null,
          },
        }),
      }),
      particles({
        id: "residue",
        name: "Residue haze",
        role: "residue",
        start: 0.78,
        end: 3,
        position: [0, 1.1, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#8b6f92", intensity: 0.7 },
            { t: 1, color: "#2a1f30", intensity: 0.2 },
          ],
          opacity: 0.45,
          mask: "smoke-wisp-02",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.24, edgeIntensity: 0.2 },
          softParticle: 1,
        }),
        emitter: emit({
          count: 80,
          shape: {
            type: "line",
            axis: unit(1, 0, 0),
            length: 2.6,
            radius: 0.18,
          },
          spawn: { mode: "continuous", window: 1, rate: 45, duration: 1.8 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 0.7,
            speed: [0.25, 0.7],
          },
          life: [1.1, 2],
          forces: { gravity: [0, 0.12, 0], drag: 1.7 },
          render: {
            size: [0.22, 0.55],
            sizeCurve: softSize,
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.4, 0.4] },
          },
        }),
      }),
      light({
        id: "beam-light",
        name: "Beam light",
        role: "primary",
        start: 0.6,
        end: 2.4,
        position: [0, 1.1, 0.3],
        light: {
          color: "#ff7ad4",
          intensity: curve([
            [0, 2],
            [0.12, 11],
            [0.85, 9],
            [1, 0],
          ]),
          radius: 10,
          decay: 2,
        },
      }),
    ],
  );
}

function shield(): VfxDocumentV2 {
  return document(
    {
      name: "Hex shield",
      description:
        "A standing energy construct: an anticipation ring, a hexagon-celled dome with a fresnel rim, a rotating ground sigil, drifting motes and a short spark flare at ignition.",
      seed: 8812,
      duration: 2.6,
      impact: 0.4,
      background: "#101620",
      // The camera eases in as the dome lights up; the grade cools the frame.
      pushIn: { from: 1.12, to: 0.94, start: 0.3, end: 1.6, ease: "smooth" },
      grade: { contrast: 1.08, saturation: 1.12, tint: "#dceaff", lift: 0.01 },
    },
    [
      mesh({
        id: "gather-ring",
        name: "Gathering ring",
        role: "anticipation",
        kind: "ring",
        start: 0.18,
        end: 0.45,
        position: [0, 0.05, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#7fd8ff", intensity: 0.6 },
            { t: 1, color: "#4aa6e8", intensity: 2.4 },
          ],
          mask: "ring-gradient-01",
        }),
        geometry: geo({ type: "torus", radius: 1.5, thickness: 0.05 }),
        tracks: [
          {
            target: "geometry.radius",
            keys: [
              [0, 1.5],
              [0.27, 1.05],
            ],
            ease: "outCubic",
          },
        ],
      }),
      mesh({
        id: "dome",
        name: "Hex dome",
        role: "primary",
        kind: "shell",
        start: 0.4,
        end: 2.2,
        position: [0, 0.02, 0],
        material: mat({
          stops: [
            { t: 0, color: "#bfe9ff", intensity: 1.6 },
            { t: 0.6, color: "#4f9fe0", intensity: 1 },
            { t: 1, color: "#24507f", intensity: 0.45 },
          ],
          opacity: 0.55,
          fresnel: { power: 2.4, strength: 1.1 },
          procedural: "hexagon",
        }),
        geometry: geo({
          type: "sphere",
          radius: 1.05,
          length: 2.1,
          thickness: 0.04,
        }),
        tracks: [
          {
            target: "material.opacity",
            keys: [
              [0, 0],
              [0.2, 0.62],
              [1.5, 0.5],
              [1.8, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      mesh({
        id: "rim",
        name: "Contact rim",
        role: "secondary",
        kind: "ring",
        start: 0.433,
        end: 2.2,
        position: [0, 0.04, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#9fdcff", intensity: 2.2 },
            { t: 1, color: "#2e6ba8", intensity: 0.8 },
          ],
          mask: "ring-soft-01",
        }),
        geometry: geo({ type: "torus", radius: 1.05, thickness: 0.06 }),
      }),
      mesh({
        id: "sigil",
        name: "Ground sigil",
        role: "secondary",
        kind: "decal",
        start: 0.45,
        end: 2.4,
        position: [0, 0.01, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#8fd0ff", intensity: 1.4 },
            { t: 1, color: "#3a74b4", intensity: 0.5 },
          ],
          opacity: 0.75,
          mask: "magic-sigil-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 1.2,
          length: 2.4,
          thickness: 0.01,
        }),
        tracks: [
          {
            target: "transform.rotation[2]",
            keys: [
              [0, 0],
              [1.95, 1.2],
            ],
            ease: "linear",
          },
        ],
      }),
      particles({
        id: "motes",
        name: "Drifting motes",
        role: "secondary",
        start: 0.5,
        end: 2.4,
        position: [0, 0.1, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#d8f2ff", intensity: 2.4 },
            { t: 1, color: "#3f7cb8", intensity: 0.4 },
          ],
          mask: "glitter-01",
          maskOptions: { randomRotation: true },
        }),
        emitter: emit({
          count: 160,
          shape: { type: "sphere", radius: 1, surfaceOnly: true },
          spawn: { mode: "continuous", window: 1.2, rate: 90, duration: 1.7 },
          velocity: {
            mode: "tangential",
            direction: unit(0, 1, 0),
            angle: 0.4,
            speed: [0.3, 0.8],
            inherit: 0,
            // A mote leaves quickly, then coasts: the curve is integrated in
            // closed form, so it stays a pure function of the particle's age.
            speedCurve: curve([
              [0, 1.6],
              [0.35, 0.8],
              [1, 0.25],
            ]),
          },
          life: [0.9, 1.8],
          forces: {
            gravity: [0, 0.15, 0],
            drag: 1.2,
            // The motes are dragged around the dome's vertical axis, strongest
            // near it and weaker out at the rim.
            vortex: { axis: unit(0, 1, 0), strength: 2.2, falloff: 0.8 },
          },
          render: {
            size: [0.05, 0.14],
            sizeCurve: softSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-1, 1] },
          },
        }),
      }),
      particles({
        id: "ignition-sparks",
        name: "Ignition sparks",
        role: "impact",
        start: 0.46,
        end: 1.15,
        position: [0, 0.08, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#eaf8ff", intensity: 4 },
            { t: 1, color: "#255d99", intensity: 0.4 },
          ],
          mask: "spark-dot-01",
        }),
        emitter: emit({
          count: 130,
          shape: {
            type: "ring",
            radius: 1.05,
            innerRadius: 0.9,
            axis: unit(0, 1, 0),
          },
          spawn: { mode: "burst", window: 0.12 },
          velocity: { mode: "radial", speed: [1.5, 3.6], angle: 0.8 },
          life: [0.35, 0.85],
          forces: { gravity: [0, -2.5, 0], drag: 1.4 },
          render: {
            size: [0.04, 0.1],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
        }),
      }),
      light({
        id: "shield-light",
        name: "Shield light",
        role: "primary",
        start: 0.4,
        end: 2.2,
        position: [0, 0.9, 0],
        light: {
          color: "#79c6ff",
          intensity: curve([
            [0, 3],
            [0.15, 9],
            [0.85, 7],
            [1, 0],
          ]),
          radius: 9,
          decay: 2,
        },
      }),
    ],
  );
}

function meteorRain(): VfxDocumentV2 {
  return document(
    {
      name: "Meteor impact",
      description:
        "A falling meteor and its landing: an eroded head with a fire trail, a short flash, an expanding shock ring, tumbling debris, long smoke and a scorch decal.",
      seed: 6104,
      duration: 2.8,
      impact: 0.9,
      background: "#150f10",
      // The landing punches the camera: trauma decays about 1.5/s from impact.
      shake: {
        amplitude: 0.16,
        frequency: 22,
        start: 0.9,
        end: 1.7,
        fade: 0.5,
      },
      motionBlur: 0.35,
    },
    [
      mesh({
        id: "meteor-head",
        name: "Meteor head",
        role: "primary",
        kind: "shell",
        start: 0,
        end: 0.95,
        position: [0, 0.35, 0],
        rotation: [0, 0, 0.35],
        motion: {
          keys: [
            [0, 2.6, 4.4, -1.6],
            [0.9, 0, 0, 0],
          ],
          ease: "linear",
        },
        material: mat({
          blend: "alpha",
          space: "surface",
          stops: [
            { t: 0, color: "#fff0c4", intensity: 2.6 },
            { t: 0.35, color: "#ff9a34", intensity: 1.6 },
            { t: 1, color: "#5a1d16", intensity: 0.5 },
          ],
          displacementShift: -0.3,
          noise: { textureId: "noise-cloud-tile-02", uvScale: [1.6, 1.6] },
          erosion: {
            curve: curve([
              [0, 0],
              [0.4, 0.05],
              [1, 0.9],
            ]),
            softness: 0.07,
            edgeWidth: 0.03,
            edgeColor: "#ffab5c",
            edgeIntensity: 2,
            displacementProtect: 0.4,
            rimBias: 0.15,
          },
          procedural: "flame",
        }),
        geometry: geo({
          type: "teardrop",
          radius: 0.36,
          length: 1.5,
          thickness: 0.06,
          vertexNoise: {
            amplitude: 0.3,
            frequency: 2.4,
            speed: 2.6,
            bias: [0, 1, 0],
            alongCurve: curve([
              [0, 0.05],
              [1, 1],
            ]),
          },
        }),
      }),
      particles({
        id: "fire-trail",
        name: "Fire trail",
        role: "primary",
        start: 0.06,
        end: 1.2,
        position: [0, 0.35, 0],
        motion: {
          keys: [
            [0, 2.6, 4.4, -1.6],
            [0.84, 0, 0, 0],
          ],
          ease: "linear",
        },
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#ffe3a8", intensity: 3.4 },
            { t: 0.45, color: "#ff7f2a", intensity: 1.8 },
            { t: 1, color: "#5c1a12", intensity: 0.4 },
          ],
          mask: "flame-tongue-01",
          maskOptions: { randomRotation: true },
          erosion: {
            curve: erosionCurve,
            softness: 0.12,
            edgeColor: "#ffb066",
            edgeIntensity: 1.6,
          },
        }),
        emitter: emit({
          count: 360,
          shape: { type: "sphere", radius: 0.22 },
          spawn: { mode: "continuous", window: 0.6, rate: 300, duration: 0.9 },
          velocity: {
            mode: "cone",
            direction: unit(-0.5, -0.8, 0.3),
            angle: 0.7,
            speed: [0.4, 1.4],
          },
          life: [0.35, 0.85],
          forces: {
            gravity: [0, 1.2, 0],
            drag: 2.2,
            curl: {
              strength: 0.7,
              frequency: 2.4,
              speed: 1.6,
              envelope: curlEnvelope,
            },
          },
          render: {
            size: [0.14, 0.42],
            sizeCurve: curve([
              [0, 0.6],
              [0.4, 1],
              [1, 0.5],
            ]),
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-1.2, 1.2] },
          },
        }),
      }),
      particles({
        id: "trail-embers",
        name: "Shed embers",
        role: "secondary",
        start: 0.06,
        end: 1.4,
        position: [0, 0.35, 0],
        motion: {
          keys: [
            [0, 2.6, 4.4, -1.6],
            [0.84, 0, 0, 0],
          ],
          ease: "linear",
        },
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#ffd79a", intensity: 3 },
            { t: 1, color: "#6b2410", intensity: 0.3 },
          ],
          mask: "ember-01",
        }),
        emitter: emit({
          count: 220,
          shape: { type: "point", radius: 0 },
          spawn: { mode: "continuous", window: 0.5, rate: 260, duration: 1.1 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 1.2,
            speed: [0.3, 1.1],
          },
          life: [0.3, 0.7],
          forces: { gravity: [0, -1.2, 0], drag: 1.4 },
          render: {
            size: [0.03, 0.09],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 0], speed: [0, 0] },
          },
          // Born from the fire trail itself: each ember starts where its
          // parent particle was partway along its own life.
          sub: {
            parentLayerId: "fire-trail",
            offset: [0.05, 0.3],
            mode: "alongPath",
            inheritVelocity: 0.45,
          },
        }),
      }),
      mesh({
        id: "impact-flash",
        name: "Impact flash",
        role: "impact",
        kind: "sprite",
        start: 0.9,
        end: 1.02,
        position: [0, 0.3, 0],
        material: mat({
          stops: [
            { t: 0, color: "#fff6e0", intensity: 5 },
            { t: 1, color: "#ffab5c", intensity: 0.5 },
          ],
          mask: "mask-soft-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.7,
          length: 1.4,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "shock-ring",
        name: "Shock ring",
        role: "impact",
        kind: "ring",
        start: 0.933,
        end: 1.75,
        position: [0, 0.04, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#ffd6a0", intensity: 2.6 },
            { t: 1, color: "#8a4a22", intensity: 0.4 },
          ],
          mask: "ring-gradient-01",
        }),
        geometry: geo({ type: "torus", radius: 0.35, thickness: 0.1 }),
        tracks: [
          {
            target: "geometry.radius",
            keys: [
              [0, 0.35],
              [0.35, 1.8],
              [0.817, 2.5],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 1],
              [0.817, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      particles({
        id: "debris",
        name: "Tumbling debris",
        role: "secondary",
        start: 0.96,
        end: 2.1,
        position: [0, 0.12, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#9a8172", intensity: 1.2 },
            { t: 1, color: "#3a2f29", intensity: 0.35 },
          ],
          mask: "debris-01",
          maskOptions: { randomRotation: true },
        }),
        emitter: emit({
          count: 150,
          shape: { type: "hemisphere", radius: 0.3, axis: unit(0, 1, 0) },
          spawn: { mode: "burst", window: 0.14 },
          velocity: { mode: "radial", speed: [2.4, 5.5], angle: 1 },
          life: [0.7, 1.3],
          forces: {
            gravity: [0, -7.5, 0],
            drag: 0.5,
            floor: { y: 0.02, softness: 0.3 },
          },
          render: {
            size: [0.06, 0.18],
            sizeCurve: curve([
              [0, 1],
              [1, 0.9],
            ]),
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-4, 4] },
          },
        }),
      }),
      particles({
        id: "smoke",
        name: "Impact smoke",
        role: "residue",
        start: 1.06,
        end: 2.8,
        position: [0, 0.18, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#8b8189", intensity: 0.9 },
            { t: 1, color: "#2b262c", intensity: 0.2 },
          ],
          opacity: 0.8,
          mask: "flipbook-smoke-8x8",
          maskOptions: {
            randomRotation: true,
            // One 8x8 sheet played once over each particle's life.
            flipbook: { cols: 8, rows: 8, mode: "life", fps: 24 },
          },
          erosion: { curve: erosionCurve, softness: 0.2, edgeIntensity: 0.4 },
          softParticle: 0.7,
        }),
        emitter: emit({
          count: 200,
          shape: { type: "disc", radius: 0.5, axis: unit(0, 1, 0) },
          spawn: { mode: "continuous", window: 0.8, rate: 110, duration: 1.4 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 0.55,
            speed: [0.6, 1.5],
          },
          life: [1.2, 2.2],
          forces: {
            gravity: [0, 0.2, 0],
            drag: 1.3,
            curl: {
              strength: 0.6,
              frequency: 1.5,
              speed: 0.9,
              envelope: curlEnvelope,
            },
          },
          render: {
            // A flipbook cell fills less of the quad than a single puff mask,
            // so the sizes are bigger than the same layer with a plain mask.
            size: [0.7, 1.7],
            sizeCurve: curve([
              [0, 0.5],
              [1, 1.4],
            ]),
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.5, 0.5] },
          },
        }),
      }),
      mesh({
        id: "scorch",
        name: "Crater scorch",
        role: "residue",
        kind: "decal",
        start: 0.94,
        end: 2.8,
        position: [0, 0.01, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          blend: "alpha",
          stops: [
            { t: 0, color: "#4c3a2f", intensity: 1 },
            { t: 1, color: "#2a211c", intensity: 0.5 },
          ],
          opacity: 0.7,
          mask: "scorch-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 1.1,
          length: 2.2,
          thickness: 0.01,
        }),
      }),
      light({
        id: "impact-light",
        name: "Impact light",
        role: "impact",
        start: 0.9,
        end: 1.9,
        position: [0, 0.5, 0],
        light: {
          color: "#ffb163",
          intensity: curve([
            [0, 18],
            [0.12, 6],
            [1, 0],
          ]),
          radius: 12,
          decay: 2,
        },
      }),
    ],
  );
}

function iceBlast(): VfxDocumentV2 {
  return document(
    {
      name: "Ice blast",
      description:
        "A ground freeze: a cold anticipation glow, an erupting crystal cluster, a frost ring, flying shards, a slow eroded mist and a frost decal.",
      seed: 47301,
      duration: 1.5,
      impact: 0.4,
      background: "#101820",
    },
    [
      mesh({
        id: "chill",
        name: "Cold anticipation glow",
        role: "anticipation",
        kind: "sprite",
        start: 0.17,
        end: 0.4,
        position: [0, 0.25, 0],
        material: mat({
          stops: [
            { t: 0, color: "#bfe8ff", intensity: 0.4 },
            { t: 1, color: "#6fb9e8", intensity: 1.8 },
          ],
          opacity: 0.8,
          mask: "mask-soft-02",
        }),
        geometry: geo({
          type: "plane",
          radius: 0.35,
          length: 0.7,
          thickness: 0.01,
        }),
      }),
      mesh({
        id: "crystals",
        name: "Crystal cluster",
        role: "primary",
        kind: "shell",
        start: 0.4,
        end: 1.35,
        position: [0, 0, 0],
        material: mat({
          blend: "alpha",
          space: "surface",
          stops: [
            { t: 0, color: "#eaf8ff", intensity: 1.5 },
            { t: 0.5, color: "#96cdea", intensity: 1 },
            { t: 1, color: "#3f7fa8", intensity: 0.5 },
          ],
          opacity: 0.9,
          fresnel: { power: 2, strength: 0.8 },
          procedural: "ice",
        }),
        geometry: geo({
          type: "crystal-cluster",
          radius: 0.9,
          length: 1.6,
          thickness: 0.22,
          segments: 32,
        }),
        tracks: [
          {
            target: "geometry.length",
            keys: [
              [0, 0.15],
              [0.28, 1.6],
              [0.95, 1.5],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 0.9],
              [0.7, 0.9],
              [0.95, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      mesh({
        id: "frost-ring",
        name: "Frost ring",
        role: "impact",
        kind: "ring",
        start: 0.433,
        end: 1.2,
        position: [0, 0.03, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          stops: [
            { t: 0, color: "#dcf4ff", intensity: 2.4 },
            { t: 1, color: "#3b7ba6", intensity: 0.4 },
          ],
          mask: "ring-soft-01",
        }),
        geometry: geo({ type: "torus", radius: 0.4, thickness: 0.07 }),
        tracks: [
          {
            target: "geometry.radius",
            keys: [
              [0, 0.4],
              [0.35, 1.6],
              [0.767, 2.1],
            ],
            ease: "outCubic",
          },
          {
            target: "material.opacity",
            keys: [
              [0, 1],
              [0.767, 0],
            ],
            ease: "smooth",
          },
        ],
      }),
      particles({
        id: "shards",
        name: "Flying shards",
        role: "secondary",
        start: 0.46,
        end: 1.25,
        position: [0, 0.15, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#eefaff", intensity: 3 },
            { t: 1, color: "#3c7ea8", intensity: 0.4 },
          ],
          mask: "ice-shard-01",
          maskOptions: { randomRotation: true },
        }),
        emitter: emit({
          count: 150,
          shape: { type: "hemisphere", radius: 0.25, axis: unit(0, 1, 0) },
          spawn: { mode: "burst", window: 0.12 },
          velocity: { mode: "radial", speed: [2, 4.8], angle: 1 },
          life: [0.4, 0.9],
          forces: { gravity: [0, -6, 0], drag: 0.7 },
          render: {
            size: [0.06, 0.16],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-3, 3] },
          },
        }),
      }),
      particles({
        id: "mist",
        name: "Cold mist",
        role: "residue",
        start: 0.5,
        end: 1.5,
        position: [0, 0.1, 0],
        material: mat({
          blend: "alpha",
          space: "life",
          stops: [
            { t: 0, color: "#a9c6d8", intensity: 0.8 },
            { t: 1, color: "#2c3a46", intensity: 0.2 },
          ],
          opacity: 0.5,
          mask: "smoke-puff-03",
          maskOptions: { randomRotation: true },
          erosion: { curve: erosionCurve, softness: 0.24, edgeIntensity: 0.3 },
          softParticle: 1,
        }),
        emitter: emit({
          count: 120,
          shape: { type: "disc", radius: 0.8, axis: unit(0, 1, 0) },
          spawn: { mode: "continuous", window: 0.5, rate: 120, duration: 0.7 },
          velocity: { mode: "radial", speed: [0.5, 1.2], angle: 0.2 },
          life: [0.8, 1.5],
          forces: { gravity: [0, 0.06, 0], drag: 2 },
          render: {
            size: [0.3, 0.75],
            sizeCurve: curve([
              [0, 0.5],
              [1, 1.3],
            ]),
            alphaCurve: risingAlpha,
            rotation: { initial: [0, 6.283185], speed: [-0.4, 0.4] },
          },
        }),
      }),
      particles({
        id: "glints",
        name: "Frost glints",
        role: "secondary",
        start: 0.52,
        end: 1.15,
        position: [0, 0.3, 0],
        material: mat({
          space: "life",
          stops: [
            { t: 0, color: "#f2fbff", intensity: 3.6 },
            { t: 1, color: "#4f8fb8", intensity: 0.4 },
          ],
          mask: "glitter-01",
          maskOptions: { randomRotation: true },
        }),
        emitter: emit({
          count: 90,
          shape: { type: "sphere", radius: 0.7 },
          spawn: { mode: "continuous", window: 0.4, rate: 90, duration: 0.55 },
          velocity: {
            mode: "cone",
            direction: unit(0, 1, 0),
            angle: 1.2,
            speed: [0.3, 0.9],
          },
          life: [0.35, 0.8],
          forces: { gravity: [0, -0.5, 0], drag: 1.5 },
          render: {
            size: [0.03, 0.09],
            sizeCurve: sparkSize,
            alphaCurve: sparkAlpha,
            rotation: { initial: [0, 6.283185], speed: [-2, 2] },
          },
        }),
      }),
      mesh({
        id: "frost-decal",
        name: "Frost decal",
        role: "residue",
        kind: "decal",
        start: 0.42,
        end: 1.5,
        position: [0, 0.01, 0],
        rotation: [-1.570796, 0, 0],
        material: mat({
          blend: "alpha",
          stops: [
            { t: 0, color: "#cfe8f5", intensity: 1 },
            { t: 1, color: "#6d93a8", intensity: 0.4 },
          ],
          opacity: 0.6,
          mask: "frost-01",
        }),
        geometry: geo({
          type: "plane",
          radius: 1.1,
          length: 2.2,
          thickness: 0.01,
        }),
      }),
      light({
        id: "ice-light",
        name: "Ice light",
        role: "impact",
        start: 0.4,
        end: 1.2,
        position: [0, 0.6, 0],
        light: {
          color: "#8fd0ff",
          intensity: curve([
            [0, 12],
            [0.2, 5],
            [1, 0],
          ]),
          radius: 9,
          decay: 2,
        },
      }),
    ],
  );
}

// --- registry --------------------------------------------------------------

export const RECIPES_V2: Record<
  RecipeV2Id,
  { name: string; subtitle: string; knowledge: string }
> = {
  "fire-projectile": {
    name: "Fire projectile",
    subtitle: "A shaped burning head with a streaming tail.",
    knowledge:
      'Build the head first: an eroded teardrop shell whose ramp uses space "surface" so the tip reads hot and the tail cools, with vertexNoise lobes biased to +Y and erosion.displacementProtect keeping the lobes intact. Stream two particle layers back along the tail (small pieces and a few large tears) with masks from the library and erosion on both. Add embers, velocity-stretched sparks, a purple-grey smoke plume that outlives the fire, a warm point light and a ground glow decal.',
  },
  "smoke-burst": {
    name: "Smoke burst",
    subtitle: "A grounded puff with a rising eroded column.",
    knowledge:
      "One short flash, a dust ring 33 ms later, then the column: a continuous emitter with wide life variance, a puff mask, erosion and gentle curl. Torn wisps start later, are darker, smaller and longer-lived than the column. Sparks and ground dust stay secondary. Keep the column connected to the emission point rather than floating as separate blobs.",
  },
  "lightning-impact": {
    name: "Lightning impact",
    subtitle: "One decisive bolt and its ground discharge.",
    knowledge:
      "A short charge glow, then one lightning geometry sheath plus a narrower white core sharing the same seedOffset so both follow one centerline. Branches only on the sheath. An expanding ground ring, stretched sparks, a thin ozone smoke and a scorch decal complete it. Never repeat the strike unless the prompt asks for more than one.",
  },
  "fire-slash": {
    name: "Fire slash",
    subtitle: "An airborne arc with a hot core and dim body.",
    knowledge:
      "Two ribbons: a thin hot core and a wider, dimmer, longer-lived body behind it, both with erosion and a scrolling noise. Embers and stretched sparks follow the same arc axis through a line emitter. Smoke last and slowest. The effect happens in the air, so use a light but no ground decal.",
  },
  beam: {
    name: "Sustained beam",
    subtitle: "Charge, extend, sustain, release.",
    knowledge:
      "Animate geometry.length during extension and keep the emission point anchored. A white energy-ribbon core with a saturated sheath reads better than several beam copies. Add a muzzle flare, a far endpoint flare, endpoint sparks and a residue haze that outlives the beam. Sustained effects may run longer than the 0.6-1.5 s hit budget.",
  },
  shield: {
    name: "Hex shield",
    subtitle: "A standing construct with a rim and a sigil.",
    knowledge:
      "A gathering ring contracts into the dome. The dome is a shell with the hexagon procedural, a fresnel rim and low opacity so the interior stays readable. Add a ground contact ring, a slowly rotating sigil decal, drifting motes on the dome surface and one short spark flare at ignition. Preserve negative space: never fill the dome.",
  },
  "meteor-rain": {
    name: "Meteor impact",
    subtitle: "A falling head, then the landing.",
    knowledge:
      "Give the head and its trail the same motion keys so they travel together, and land them exactly at impact. The landing is a short flash, an expanding shock ring, tumbling debris with a floor force, long-lived smoke and a scorch decal. The flash is the shortest layer; smoke and debris outlive it.",
  },
  "ice-blast": {
    name: "Ice blast",
    subtitle: "Erupting crystals with frost and mist.",
    knowledge:
      "Grow a crystal-cluster upward by animating geometry.length so the bases stay planted. Use the ice procedural with a near-white ramp and a blue tail plus fresnel. A frost ring, flying shards, a slow eroded mist and a frost decal complete it. Keep saturation moderate: an all-white blast loses the silhouette.",
  },
};

const EXAMPLES: Record<RecipeV2Id, () => VfxDocumentV2> = {
  "fire-projectile": () => validateDocumentV2(fireProjectileFixture),
  "smoke-burst": smokeBurst,
  "lightning-impact": lightningImpact,
  "fire-slash": fireSlash,
  beam,
  shield,
  "meteor-rain": meteorRain,
  "ice-blast": iceBlast,
};

/** The example document for a family. Always a fresh, validated copy. */
export function createPresetV2(id: RecipeV2Id): VfxDocumentV2 {
  return EXAMPLES[id]();
}

/**
 * A compact scale reference for the planner, which never sees the full example
 * document: the numbers a director has to commit to before parameters exist.
 */
export function exampleScaleSummary(id: RecipeV2Id) {
  const doc = createPresetV2(id);
  const meshes = doc.layers.filter((l) => l.geometry);
  const emitters = doc.layers.filter((l) => l.emitter);
  const lights = doc.layers.filter((l) => l.light);
  const round = (v: number) => Number(v.toFixed(2));
  return {
    family: id,
    duration: doc.duration,
    impact: doc.impact,
    layers: doc.layers.length,
    framing: doc.camera.framing,
    heroExtentUnits: round(
      Math.max(
        0,
        ...meshes.map((l) =>
          Math.max(l.geometry!.radius * 2, l.geometry!.length),
        ),
      ),
    ),
    particleCounts: emitters.map((l) => l.emitter!.count),
    particleSizes: emitters.map((l) => l.emitter!.render.size),
    lightIntensityPeak: lights.map((l) =>
      Math.max(...l.light!.intensity.keys.map((k) => k[1])),
    ),
    lightRadius: lights.map((l) => l.light!.radius),
    groundColor: doc.environment.groundColor,
    bloom: doc.post.bloom,
  };
}

/** The v2 family a planned v1 recipe id maps onto. */
export function recipeV2For(id: string): RecipeV2Id {
  return V1_RECIPE_TO_V2[id as RecipeId] ?? "fire-projectile";
}

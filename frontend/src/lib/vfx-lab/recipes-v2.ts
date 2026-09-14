import fireProjectileFixture from "../../../fixtures/v2/fire-projectile/document.json";
import smokeBurstFixture from "../../../fixtures/v2/smoke-burst/document.json";
import lightningImpactFixture from "../../../fixtures/v2/lightning-impact/document.json";
import fireSlashFixture from "../../../fixtures/v2/fire-slash/document.json";
import beamFixture from "../../../fixtures/v2/beam/document.json";
import shieldFixture from "../../../fixtures/v2/shield/document.json";
import iceBlastFixture from "../../../fixtures/v2/ice-blast/document.json";
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
// fire-projectile, smoke-burst, lightning-impact, fire-slash, beam, shield and
// ice-blast are hand-tuned exemplars, imported from their fixtures so there is
// exactly one copy of those numbers in the repository. Only meteor-rain is
// still built in code below.
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
    shading: "unlit",
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
      "A yellow glint anticipates the pop, then a thin accent ring snaps outward and a pink billow spreads at the base. The plume is three particle layers sharing one emission wave, each with a different puff mask, a different size band and a ramp in one broad tone \u2014 dark plum cores, a mid purple body, small light violet caps \u2014 so the lobes read as shaded shapes rather than a fuzzy cloud. Alpha blend, low erosion softness and a large-scale noise keep the silhouettes crisp. Wisps with the wisp masks and stronger erosion start as the plume tears, and everything is gone before the end. For continuous emission, slots recycle every count/rate seconds; choose a period at least as long as the longest life, distribute initial births with spawn.window, and set spawn.duration to the emission span. Keep the layer alive for the desired tail.",
  },
  "lightning-impact": {
    name: "Lightning impact",
    subtitle: "One decisive bolt and its ground discharge.",
    knowledge:
      "A short charge glow, then one lightning geometry sheath plus a narrower white core sharing the same seedOffset so both follow one centerline. Branches only on the sheath; keep jitter low so the core stays inside the sheath. Give the sheath a saturated ramp under the bloom threshold so it reads as a coloured glow rather than a white bar, and let the core alone bloom. An expanding ground ring, two spark populations (stretched streaks and dots), dark debris on gravity, a low spreading smoke and a ground-glow decal complete it. Never repeat the strike unless the prompt asks for more than one.",
  },
  "fire-slash": {
    name: "Fire slash",
    subtitle: "An airborne arc with a hot core and dim body.",
    knowledge:
      "A wind-up glow and an ignition flash sprite precede two full-circle ribbon geometries (length = 2π radians, radius = spatial radius) grown by animating transform.scale or geometry.radius; animate geometry.length only to change the swept angle: an additive hot core (leading edge) and a wider alpha-blended dim body (trailing edge), sharing one position/rotation so they read as one blade. Each ribbon drives per-stop material.erosion.curve.keys[i][1] tracks so the burn front advances stop by stop instead of eroding as a whole. A line emitter along the same arc axis throws curl-forced embers, velocity-stretched sparks and dot glints; alpha-blended, heavily eroded smoke trails last and longest. One orange point light lands it — no ground decal, since the sweep happens in the air.",
  },
  beam: {
    name: "Sustained beam",
    subtitle: "Charge, extend, sustain, release.",
    knowledge:
      "Converging-mote and glitter particles (negative radial speed) build the charge for ~1 s. The core is a plain, unmasked white beam; a saturated magenta sheath with scrolling noise and a tracked erosion.curve rides outside it, flanked by two thin energy-ribbon trails offset above/below the core for a braided look. geometry.length is tracked from near-zero to full reach on extend and back to zero on release, while material.opacity is held through the sustain by a flat multi-key track. Muzzle/endpoint flare sprites, a velocity-stretched spark trail and a yellow-green residue burst (particles + haze) that only starts after the core cuts off complete it, lit by two point lights.",
  },
  "meteor-rain": {
    name: "Meteor impact",
    subtitle: "A falling head, then the landing.",
    knowledge:
      "Give the head and its trail the same motion keys so they travel together, and land them exactly at impact. The landing is a short flash, an expanding shock ring, tumbling debris with a floor force, long-lived smoke and a scorch decal. The flash is the shortest layer; smoke and debris outlive it.",
  },
  shield: {
    name: "Hex shield",
    subtitle: "A standing construct with a rim and a sigil.",
    knowledge:
      "A ring emitter converges motes inward (negative radial speed) onto a rotating sigil decal before the dome snaps up with a radius/position overshoot. The dome is three stacked spherical shells — a plain fresnel shell plus a primary and a cross-weave secondary hexagon-procedural cell lattice — each pulsed over time by tracking its material.erosion.curve.keys per stop rather than eroding once. A base rim, an expanding base-shockwave decal and a burst of ignition sparks land the cast; tangential orbit-motes circle the dome under a vortex force, and two brief 'hit ripple' shells (same sphere geometry, erosion pulsed for ~0.5 s) simulate strikes mid-hold. Scattering motes and one light close it out.",
  },
  "ice-blast": {
    name: "Ice blast",
    subtitle: "Erupting crystals with frost and mist.",
    knowledge:
      "A frost decal and cold-pool glow ease in under a cold anticipation sprite before a crystal-cluster shell erupts by tracking transform.scale on all three axes through an overshoot-and-settle curve (not geometry.length), using the ice procedural, a blue-to-white surface ramp and fresnel. An expanding, thinning torus ring, a disc-shaped ground mist with a soft floor constraint, a two-burst mist eruption, hemisphere-burst ice shards and continuous sphere-emitted glitter fly outward on gravity and drag. A late burst of ground frost glints adds a final flourish near the base. One blue-white point light and the frost decal, already faded in before impact, tie it together.",
  },
};

const EXAMPLES: Record<RecipeV2Id, () => VfxDocumentV2> = {
  "fire-projectile": () => validateDocumentV2(fireProjectileFixture),
  "smoke-burst": () => validateDocumentV2(smokeBurstFixture),
  "lightning-impact": () => validateDocumentV2(lightningImpactFixture),
  "fire-slash": () => validateDocumentV2(fireSlashFixture),
  beam: () => validateDocumentV2(beamFixture),
  shield: () => validateDocumentV2(shieldFixture),
  "meteor-rain": meteorRain,
  "ice-blast": () => validateDocumentV2(iceBlastFixture),
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

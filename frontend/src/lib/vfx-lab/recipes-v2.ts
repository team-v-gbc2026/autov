import fireProjectileFixture from "../../../fixtures/v2/fire-projectile/document.json";
import smokeBurstFixture from "../../../fixtures/v2/smoke-burst/document.json";
import lightningImpactFixture from "../../../fixtures/v2/lightning-impact/document.json";
import fireSlashFixture from "../../../fixtures/v2/fire-slash/document.json";
import beamFixture from "../../../fixtures/v2/beam/document.json";
import shieldFixture from "../../../fixtures/v2/shield/document.json";
import iceBlastFixture from "../../../fixtures/v2/ice-blast/document.json";
import healingAuraFixture from "../../../fixtures/v2/healing-aura/document.json";
import glitchProjectileFixture from "../../../fixtures/v2/glitch-projectile/document.json";
import energyColumnFixture from "../../../fixtures/v2/energy-column/document.json";
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
// Ten families, each with the knowledge the planner needs and one complete
// example document. The examples are STARTING POINTS, not finished look-dev:
// they exist so a candidate request always ships a valid, readable reference
// built from the same parts (ramps, erosion, library masks, a light, a decal,
// an environment grid).
//
// Every family but meteor-rain is a hand-tuned exemplar, imported from its
// fixture so there is exactly one copy of those numbers in the repository.
// Only meteor-rain is still built in code below.
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
  "healing-aura",
  "glitch-projectile",
  "energy-column",
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

/**
 * The two families the v1 recipe vocabulary cannot name. `PlanSchema` is shared
 * between the schemas and the planner always answers with a v1 recipe id, so
 * rather than widening that vocabulary (which would change every v1 run's
 * prompt) the prompt itself routes: an aura/heal/buff prompt lands on
 * healing-aura and a glitch/digital/hologram prompt on glitch-projectile,
 * whichever v1 recipe the planner picked. `V1_RECIPE_TO_V2` stays total, so a
 * run with no prompt still resolves.
 */
export const FAMILY_KEYWORDS: Array<[RegExp, RecipeV2Id]> = [
  [/\baura\b|\bheal|\bbuff\b|restorat/i, "healing-aura"],
  [/glitch|digital|hologram/i, "glitch-projectile"],
  // A standing vertical construct: the v1 vocabulary has no name for it, so the
  // prompt routes it the same way aura and glitch are routed.
  [/column|overload|pillar|surge/i, "energy-column"],
];

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
  heightSpan?: number;
  toon?: Material["toon"];
  outline?: Material["outline"];
  opaqueUntil?: number | null;
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
  proceduralParams?: Material["proceduralParams"];
  rgbSplit?: Material["rgbSplit"];
  reveal?: Material["reveal"];
  lattice?: Material["lattice"];
  planeGlow?: Material["planeGlow"];
  ripples?: Material["ripples"];
  stripes?: Material["stripes"];
  flicker?: Material["flicker"];
};

function mat(options: MaterialOptions): Material {
  const base = defaultMaterial();
  return {
    blend: options.blend ?? "additive",
    ramp: {
      space: options.space ?? "layerTime",
      stops: options.stops,
      displacementShift: options.displacementShift ?? 0,
      heightSpan: options.heightSpan ?? 2,
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
    proceduralParams: options.proceduralParams ?? [0, 0, 0, 0],
    toon: options.toon ?? null,
    outline: options.outline ?? null,
    opaqueUntil: options.opaqueUntil ?? null,
    rgbSplit: options.rgbSplit ?? null,
    reveal: options.reveal ?? null,
    lattice: options.lattice ?? null,
    planeGlow: options.planeGlow ?? null,
    ripples: options.ripples ?? null,
    stripes: options.stripes ?? null,
    flicker: options.flicker ?? null,
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
  jitter?: LayerV2["jitter"];
  collapse?: LayerV2["collapse"];
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
    jitter: common.jitter ?? null,
    collapse: common.collapse ?? null,
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
      'Cel-shaded smoke is BLOB layers, never particle boards. A yellow star4 glint anticipates the pop; a small near-white blob "mound" of 3 lobes is the hot core; a purple "mound" of ~11 lobes (spread 1.0, height 2.3) wraps it and becomes the foot; a purple "column" of 12-13 levels (36-39 lobes, spread ~0.5, rise 10-14) shoots up out of it and leaves the top of the frame; a shorter second "column" pulse keeps a stalk standing while a pink "ring" of 8-10 billows (spread 1.4-1.6, radius 0.5-0.85) spreads around the base with the centre left open. A second pink "ring" with blob.comma set breaks off and hooks outward, and a purple "string" of 5 squashed wisps is the last thing alive. Every blob carries material.toon (3 bands against one fixed upper-left light), material.outline one step darker than its shadow tone, and material.opaqueUntil 0.75 so the lobes read as solid volumes with contour seams. A kind:"splash" fan of 8 flat grey slivers is thrown out as the pink lands. Finish with an additive softRadial base glow, a softRadial ground disc and one violet point light.',
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
      "A wind-up glow and an ignition flash sprite precede two full-circle ribbon geometries (radius = 2π) grown by animating transform.scale, not geometry.length: an additive hot core (leading edge) and a wider alpha-blended dim body (trailing edge), sharing one position/rotation so they read as one blade. Each ribbon drives per-stop material.erosion.curve.keys[i][1] tracks so the burn front advances stop by stop instead of eroding as a whole. A line emitter along the same arc axis throws curl-forced embers, velocity-stretched sparks and dot glints; alpha-blended, heavily eroded smoke trails last and longest. One orange point light lands it — no ground decal, since the sweep happens in the air.",
  },
  beam: {
    name: "Sustained beam",
    subtitle: "Charge, extend, sustain, release.",
    knowledge:
      'Four beats over 5 s: charge 0-1.0, extend 1.0-1.2, sustain to 3.5, extinguish to 4.0, residue to 5.0. Converging motes (a sphere emitter with NEGATIVE radial speed) and a growing softRadial ball build the charge at the muzzle. The body is THREE coaxial layers on one axis (rotation [0,-1.5708,0] fires at -X), all sharing one tracked geometry.length that snaps 0 to 6 on the extend and retracts from the far end on the shut-off: a geometry.type "slab" whose slab.tiers are a violet outer band, a magenta body and a pink inner band, hard-edged, which is the readable WIDTH of the beam; a cylinder sheath at radius 0.2 carrying two material.stripes sets at contrast 1 and a material.flicker at 10 Hz, which is the panning band pattern; and a white cylinder core at radius 0.05 with a nearly flat white ramp and one low-contrast stripe set, which is the only thing that blooms. Outside it, two emitter.render.mode "flatStrip" layers on a line emitter along the beam: 18 flame tongues with strip.palettes 2 (dark violet behind, lilac in front) at 0.8-2.4 long and 34 thin bright streak licks, both re-hashed on a 6-10 Hz flipbook step. The muzzle is a "lensFlare" sprite with a high anisotropy so it reads as a tall blade, plus a "radialRays" sprite. On shut-off a paths[] "line" along the beam carries a velocity.mode "alongPath" sparkle run and then an emitter.shape.type "pathLine" yellow-green residue scatter that twinkles and drifts. Two point lights and a ringFill ground pool land it.',
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
      'The shield is ONE sphere, not a stack. A kind:"shell" of radius 1.2 with its centre at y 1.25 (so the shell just clears the floor) carries material.lattice: 377 relaxed Voronoi cells, edgeWidth 0.2 over gapWidth 0.08, a mint tile over a pale-gold edge, lattice.pulse running outward from the crown on a hashed per-cell phase, and lattice.dissolve switching the cells off one by one from 70% of the layer. material.reveal mode "scan" lights those cells up from the crown down over the first 0.9 s — with `to` past 1, so the scan finishes early and the shell then holds. material.fresnel power 8 against a cream last ramp stop carries the silhouette where lattice.grazeFade drops the cells out; material.planeGlow draws the contact ring against the floor analytically; material.ripples are two great circles at 1.8 s and 2.7 s. Around it, a geometry.type "band" belt — real geometry, radius 1.22, width 0.28, geometry.band tilt 30 degrees and spin 0.754 rad/s, alpha blended so it sorts BEHIND the shell on its far arc — plus a wider additive halo band for the bloom. Converging star4 sparks fall onto the shell in the first second, a swirlRing gold ring and a ringFill cyan pool sit on the floor, and one cyan point light finishes it. No caster is ever in frame.',
  },
  "healing-aura": {
    name: "Healing aura",
    subtitle: "A sweep that lands as a ring, a column and sparkles.",
    knowledge:
      'Two document paths carry the whole effect: an "orbit" at hip height (radius ~0.82, wobble 0.12) and a flat "orbit" on the ground (radius ~0.78, wobble 0.055). One kind:"ribbon" of 5 strands sweeps the first over ~1.2 s with a window head curve that runs 0 to 1 and then keeps creeping, and its ribbon.morph blends it onto the ground ring as it settles, so the sweep and the ring are ONE layer, never two. Under it a kind:"decal" on the ground uses procedural "swirlRing" (proceduralParams = rim radius as a fraction of the card, strand half-width, wobble, rotation rate) with a tracked proceduralParams[0] that snaps the rim out from 72% to full, and a second decal under that uses "ringFill" for the soft pulsing interior. The vertical body is a kind:"beam" with geometry.type "cylinder", geometry.taper ~0.8, rotation [-1.5708,0,0], material.procedural "solid", a surface ramp that falls to intensity 0 at the top, fresnel and a panning noise, plus an erosion curve that only bites the top 40% so the glow tears into streaks instead of ending at a cap. Four-point sparkles are one particles layer with procedural "star4" and emitter.render.twinkle. Finish with a softRadial ground bounce and one green point light. No caster is ever in frame.',
  },
  "glitch-projectile": {
    name: "Glitch projectile",
    subtitle: "A digital dart on a Bezier arc, and its broken impact.",
    knowledge:
      'One "bezier" document path from the launch point through a lifted control point to the target carries the head, the trail and the hairlines, so nothing can drift apart. Fragments converge on the launch point first (a particles layer with NEGATIVE radial speed and layer.jitter). The head is a cone shell plus a star4 sprite, both driven by the same motion keys sampled off the already-eased Bezier and both carrying the same layer.jitter (frequency ~10, gate 0.85) so they break in the same stepped windows. The trail is a particles layer with emitter.shape.type "path" on the same path, emitter.spawn.mode "pathAnchored" with a headCurve that matches the head easing, render.mode "pathAligned" and render.twinkle: each dash is born as the head passes it, holds that spot and flickers out. A kind:"ribbon" of 3 hairline strands fills the window just behind the head. The hit is a softRadial flash, a kind:"wireBurst" of polygon outlines and spokes with material.rgbSplit and its own layer.jitter, and rectangular shards (procedural "solid") on ballistic paths. post.glitch fires for two frames at the hit. A dark smoke plume and rising cyan sparks clear by the end.',
  },
  "energy-column": {
    name: "Energy overload column",
    subtitle: "Intensify, erupt, sustain, reduce.",
    knowledge:
      'Four beats over 5 s: intensify 0-1.5, erupt 1.5-2.3, sustain to 3.5, reduce to 5.0. A plain dark cylinder (a kind:"beam" geometry.type "cylinder", radius 0.35, height 1.2, alpha blended and nearly black) is the housing the column rises out of; the document never describes the machine around it. The column is three coaxial layers standing on rotation [-1.5708,0,0] at y 0.3: a geometry.type "slab" with slab.anchor "base" and three hard tiers for the readable body width, a tapered cylinder shell at radius 0.34 with taper 0.7, and a white-gold core cylinder at radius 0.098. All three carry the SAME material.stripes segment ladder — about seven bands over the 4.5 m shaft, phase 0 so the bands run straight round the shaft like machine segments rather than breaking into filaments — and all three carry the SAME layer.collapse, which is what keeps them in step as the column reduces. A kind:"arcs" cage of 16-18 blinking helical wires wraps them, folded jitter so the wires kink instead of curling. The eruption at 1.5 s is a "lensFlare" sprite at head height whose geometry.radius snaps out on a track, a kind:"streakBurst" fan of 56 clumped orange/pink/pale-gold speed lines, ballistic sparks, alpha-blended dark debris chips, one thin expanding torus shock ring and a post.flash white-out of two frames at 1.85 s. A softRadial haze behind the column and a ringFill ground pool keep the frame from ever being black around it; two point lights finish it.',
  },
  "ice-blast": {
    name: "Ice blast",
    subtitle: "Erupting crystals with frost and mist.",
    knowledge:
      'Four beats: the sigil draws itself, the cluster erupts, it holds, it shatters. A kind:"decal" of radius 1.5 on the ground uses material.procedural "sigil" (proceduralParams [3 ring pairs, 64 rune cells, 16 spokes, gold rim]) with a radial material.reveal whose `to` overshoots 1 so the circle finishes drawing at the flash and then holds; a track on proceduralParams[3] pops the gold rim on that frame. Motes converge inward on a disc emitter with NEGATIVE radial speed, a star4 sprite glints and a ringFill decal flashes. The hero is a kind:"crystals" layer: 320 faceted spikes in 3 length groups over a 0.12-1.02 m band, elevation -31..82 degrees with upBias so the long ones stay above the horizon and the short ones stab downward, baseRadius 0.3, growth easeOutBack (duration 0.3, overshoot 1.7), material.outline for the dark separator hull between overlapping spikes, and crystals.collapse at the shatter. Around it: velocity-stretched chips orbiting a ring emitter, two counter-panning "smoke" decals with erosion for the chillfog, and a soft core sprite. The shatter is two particles layers whose emitter.shape.type is "layerInstances" pointing at the crystals layer, so every chip is born ON a spike and thrown along ITS axis, with emitter.forces.planarDrag settling the burst into a drifting disc over the floor. One cold point light flares at the eruption and again at the shatter.',
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
  "healing-aura": () => validateDocumentV2(healingAuraFixture),
  "glitch-projectile": () => validateDocumentV2(glitchProjectileFixture),
  "energy-column": () => validateDocumentV2(energyColumnFixture),
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
  const blobs = doc.layers.filter((l) => l.blob);
  const splashes = doc.layers.filter((l) => l.splash);
  const ribbons = doc.layers.filter((l) => l.ribbon);
  const bursts = doc.layers.filter((l) => l.wireBurst);
  const clusters = doc.layers.filter((l) => l.crystals);
  const lights = doc.layers.filter((l) => l.light);
  const round = (v: number) => Number(v.toFixed(2));
  return {
    family: id,
    duration: doc.duration,
    impact: doc.impact,
    layers: doc.layers.length,
    framing: doc.camera.framing,
    // A blob's silhouette is its cluster, not a primitive: measure the same way
    // the framing pass does, so a blob-built family reports a real hero extent
    // instead of 0 and the planner still commits to a scale.
    heroExtentUnits: round(
      Math.max(
        0,
        ...meshes.map((l) =>
          Math.max(l.geometry!.radius * 2, l.geometry!.length),
        ),
        ...blobs.map((l) =>
          Math.max(
            l.blob!.spread * 2 + l.blob!.radius[1] * 2,
            l.blob!.height + l.blob!.radius[1] * 2,
          ),
        ),
        // A cluster's silhouette is the furthest tip on either side of its own
        // centre, which is what the framing pass claims for it.
        ...clusters.map(
          (l) => (l.crystals!.baseRadius + l.crystals!.length[1]) * 2,
        ),
      ),
    ),
    particleCounts: emitters.map((l) => l.emitter!.count),
    particleSizes: emitters.map((l) => l.emitter!.render.size),
    blobs: blobs.map((l) => ({
      arrangement: l.blob!.arrangement,
      lobes: l.blob!.count,
      lobeRadius: l.blob!.radius,
      spread: l.blob!.spread,
      height: l.blob!.height,
      rise: l.blob!.rise,
      toon: !!l.material?.toon,
      outline: !!l.material?.outline,
    })),
    splashes: splashes.map((l) => ({
      slivers: l.splash!.count,
      length: l.splash!.length,
      width: l.splash!.width,
    })),
    ribbons: ribbons.map((l) => ({
      strands: l.ribbon!.strands.count,
      width: l.ribbon!.width,
      tail: l.ribbon!.window.tail,
      morphs: !!l.ribbon!.morph,
    })),
    crystals: clusters.map((l) => ({
      spikes: l.crystals!.count,
      length: l.crystals!.length,
      width: l.crystals!.width,
      baseRadius: l.crystals!.baseRadius,
      groups: l.crystals!.groups,
      collapses: !!l.crystals!.collapse,
      outline: !!l.material?.outline,
    })),
    wireBursts: bursts.map((l) => ({
      shapes: l.wireBurst!.shapes,
      radius: l.wireBurst!.radius,
      travel: l.wireBurst!.travel,
      spokes: l.wireBurst!.spokes,
    })),
    paths: doc.paths.map((p) => p.type),
    lightIntensityPeak: lights.map((l) =>
      Math.max(...l.light!.intensity.keys.map((k) => k[1])),
    ),
    lightRadius: lights.map((l) => l.light!.radius),
    groundColor: doc.environment.groundColor,
    bloom: doc.post.bloom,
  };
}

/**
 * The v2 family a planned v1 recipe id maps onto. When the user's prompt is
 * available it wins for the two families the v1 vocabulary cannot name — see
 * FAMILY_KEYWORDS.
 */
export function recipeV2For(id: string, prompt?: string): RecipeV2Id {
  if (prompt)
    for (const [pattern, family] of FAMILY_KEYWORDS)
      if (pattern.test(prompt)) return family;
  return V1_RECIPE_TO_V2[id as RecipeId] ?? "fire-projectile";
}

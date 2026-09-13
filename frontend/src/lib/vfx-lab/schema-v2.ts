import { z } from "zod";
import {
  MotionSchema,
  TextureAssetSchema,
  type NumericTarget,
  type TextureAsset,
} from "./schema";
import { TEXTURE_MANIFEST_V2 } from "./texture-manifest-v2";

// ---------------------------------------------------------------------------
// autov.lab/2 — declarative contract for the v2 VFX renderer.
//
// Same non-negotiables as v1: state = f(document, time, seed); documents stay
// engine independent; the schema is the only thing generation may fill in.
// Everything below is either a bounded number, a bounded enum or a bounded list.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION_V2 = "autov.lab/2" as const;

const scalar = (min: number, max: number) => z.number().min(min).max(max);
const integer = (min: number, max: number) =>
  z.number().int().min(min).max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const vec3 = z.tuple([scalar(-12, 12), scalar(-12, 12), scalar(-12, 12)]);
const unit3 = z.tuple([scalar(-1, 1), scalar(-1, 1), scalar(-1, 1)]);
const bias3 = z.tuple([scalar(0, 1), scalar(0, 1), scalar(0, 1)]);
const uv = z.tuple([scalar(-16, 16), scalar(-16, 16)]);
const uvScale = z.tuple([scalar(0.01, 16), scalar(0.01, 16)]);
const range = (min: number, max: number) =>
  z.tuple([scalar(min, max), scalar(min, max)]);
const TIME = 12;
const localTime = scalar(0, TIME);

export const KINDS_V2 = [
  "ring",
  "shell",
  "trail",
  "beam",
  "sprite",
  "particles",
  "decal",
  "light",
] as const;
// Kinds that draw a mesh and therefore carry `geometry`.
export const MESH_KINDS_V2 = [
  "ring",
  "shell",
  "trail",
  "beam",
  "sprite",
  "decal",
] as const;
export const BLEND_MODES_V2 = [
  "additive",
  "alpha",
  "premultiplied",
  "screen",
] as const;
export const RAMP_SPACES = ["life", "layerTime", "surface"] as const;
export const PROCEDURALS_V2 = [
  "none",
  "flame",
  "water",
  "hexagon",
  "smoke",
  "star",
  "solid",
  "portal",
  "water-streaks",
  "energy-ribbon",
  "ice",
  "sparkle",
] as const;
export const GEOMETRIES_V2 = [
  "auto",
  "plane",
  "teardrop",
  "cone",
  "crystal",
  "crystal-cluster",
  "torus",
  "ribbon",
  "streamer",
  "lightning",
  "cylinder",
  "disc",
  "sphere",
] as const;
export const EMITTER_SHAPES = [
  "point",
  "sphere",
  "hemisphere",
  "cone",
  "ring",
  "disc",
  "box",
  "line",
] as const;
export const SPAWN_MODES = ["burst", "continuous", "bursts"] as const;
export const VELOCITY_MODES = [
  "radial",
  "directional",
  "tangential",
  "cone",
] as const;
export const RENDER_MODES = [
  "billboard",
  "velocityStretch",
  "horizontal",
  "vertical",
] as const;
export const ROLES_V2 = [
  "anticipation",
  "primary",
  "impact",
  "secondary",
  "residue",
] as const;

/** Total instanced particles allowed across every particles layer. */
export const PARTICLE_BUDGET_V2 = 60000;
/** Minimum life max/min ratio before `lintDocumentV2` warns about uniform lifetimes. */
export const LIFE_VARIANCE_MIN = 1.35;
/** Below this a particles layer reads as a handful of dots rather than a volume. */
export const PARTICLE_COUNT_MIN = 30;
/** Darkest ground that still catches light from the effect (max sRGB channel). */
export const GROUND_CHANNEL_MIN = 0x3a;
/** A hero silhouette smaller than this disappears inside the framed shot. */
export const EFFECT_EXTENT_MIN = 1.5;

// --- curves and ramps ------------------------------------------------------

// Normalized domain 0..1; the meaning of the domain depends on the field
// (particle life, layer time, distance along a mesh axis, ...).
export const CurveSchema = z
  .object({
    keys: z
      .array(z.tuple([scalar(0, 1), scalar(-20, 20)]))
      .min(2)
      .max(8),
    ease: z.enum(["linear", "smooth"]),
  })
  .strict();

export const RampStopSchema = z
  .object({ t: scalar(0, 1), color: hex, intensity: scalar(0, 8) })
  .strict();

export const RampSchema = z
  .object({
    space: z.enum(RAMP_SPACES),
    stops: z.array(RampStopSchema).min(2).max(6),
    // Vertex displacement (mesh lobes) shifts the ramp key by this amount.
    displacementShift: scalar(-1, 1),
  })
  .strict();

// --- material --------------------------------------------------------------

export const AtlasSchema = z
  .object({
    cols: integer(1, 8),
    rows: integer(1, 8),
    tiles: integer(1, 64),
  })
  .strict();

export const FlipbookSchema = z
  .object({
    cols: integer(1, 16),
    rows: integer(1, 16),
    mode: z.enum(["life", "fps"]),
    fps: scalar(1, 60),
  })
  .strict();

export const MaskSchema = z
  .object({
    textureId: z.string().max(48).nullable(),
    uvScale,
    uvPan: uv,
    rotation: scalar(-Math.PI * 2, Math.PI * 2),
    randomRotation: z.boolean(),
    atlas: AtlasSchema.nullable(),
    flipbook: FlipbookSchema.nullable(),
  })
  .strict();

export const NoiseSchema = z
  .object({
    textureId: z.string().max(48).nullable(),
    uvScale,
    uvPan: uv,
    distortion: scalar(0, 0.5),
    distortionPan: uv,
  })
  .strict();

export const ErosionSchema = z
  .object({
    curve: CurveSchema,
    softness: scalar(0.01, 0.5),
    edgeWidth: scalar(0, 0.3),
    edgeColor: hex,
    edgeIntensity: scalar(0, 8),
    // High vertex displacement protects the surface from erosion (fat lobes).
    displacementProtect: scalar(0, 1),
    // Erode more at grazing angles, carving the silhouette instead of the body.
    rimBias: scalar(0, 1),
  })
  .strict();

export const FresnelSchema = z
  .object({ power: scalar(0.5, 8), strength: scalar(0, 2) })
  .strict();

export const MaterialSchema = z
  .object({
    blend: z.enum(BLEND_MODES_V2),
    ramp: RampSchema,
    opacity: scalar(0, 1),
    mask: MaskSchema,
    noise: NoiseSchema.nullable(),
    erosion: ErosionSchema.nullable(),
    softParticle: scalar(0, 2),
    fresnel: FresnelSchema.nullable(),
    procedural: z.enum(PROCEDURALS_V2),
  })
  .strict();

// --- emitter ---------------------------------------------------------------

export const EmitterShapeSchema = z
  .object({
    type: z.enum(EMITTER_SHAPES),
    axis: unit3,
    length: scalar(0, 12),
    radius: scalar(0, 12),
    innerRadius: scalar(0, 12),
    angle: scalar(0, Math.PI),
    size: vec3,
    surfaceOnly: z.boolean(),
    // Mirrors samples toward the positive axis (0 = symmetric, 1 = fully biased).
    bias: bias3,
  })
  .strict();

export const BurstSchema = z
  .object({ t: localTime, count: integer(1, 24000) })
  .strict();

export const SpawnSchema = z
  .object({
    mode: z.enum(SPAWN_MODES),
    window: scalar(0, 12),
    rate: scalar(0, 4000),
    duration: scalar(0, 12),
    bursts: z.array(BurstSchema).max(8),
  })
  .strict();

export const VelocitySchema = z
  .object({
    mode: z.enum(VELOCITY_MODES),
    speed: range(-20, 20),
    direction: unit3,
    angle: scalar(0, Math.PI),
    inherit: scalar(0, 1),
    speedCurve: CurveSchema.nullable(),
  })
  .strict();

export const CurlSchema = z
  .object({
    strength: scalar(0, 3),
    frequency: scalar(0.1, 8),
    speed: scalar(0, 4),
    envelope: CurveSchema,
  })
  .strict();

export const VortexSchema = z
  .object({
    axis: unit3,
    strength: scalar(-20, 20),
    falloff: scalar(0, 4),
  })
  .strict();

export const FloorSchema = z
  .object({ y: scalar(-4, 4), softness: scalar(0, 1) })
  .strict();

export const ForcesSchema = z
  .object({
    gravity: vec3,
    drag: scalar(0, 6),
    curl: CurlSchema.nullable(),
    vortex: VortexSchema.nullable(),
    wind: vec3,
    floor: FloorSchema.nullable(),
  })
  .strict();

export const ParticleRotationSchema = z
  .object({
    initial: range(-Math.PI * 2, Math.PI * 2),
    speed: range(-10, 10),
  })
  .strict();

export const ParticleRenderSchema = z
  .object({
    mode: z.enum(RENDER_MODES),
    stretch: scalar(0, 4),
    size: range(0.001, 8),
    sizeCurve: CurveSchema,
    alphaCurve: CurveSchema,
    // Alpha as a function of where along the spawn shape the particle was born.
    alphaAlongSpawn: CurveSchema.nullable(),
    rotation: ParticleRotationSchema,
    sortMode: z.enum(["none", "byDistance"]),
  })
  .strict();

export const TrailSchema = z
  .object({
    segments: integer(2, 16),
    spacing: scalar(0.005, 0.2),
    widthCurve: CurveSchema,
    textureId: z.string().max(48).nullable(),
  })
  .strict();

export const SubEmitterSchema = z
  .object({
    parentLayerId: z.string().max(48),
    offset: range(0, 12),
    mode: z.enum(["alongPath", "onDeath", "continuous"]),
    inheritVelocity: scalar(0, 1),
  })
  .strict();

export const EmitterSchema = z
  .object({
    count: integer(1, 24000),
    shape: EmitterShapeSchema,
    spawn: SpawnSchema,
    velocity: VelocitySchema,
    life: range(0.02, 12),
    forces: ForcesSchema,
    render: ParticleRenderSchema,
    trail: TrailSchema.nullable(),
    sub: SubEmitterSchema.nullable(),
  })
  .strict();

// --- geometry --------------------------------------------------------------

export const VertexNoiseSchema = z
  .object({
    amplitude: scalar(0, 0.5),
    frequency: scalar(0.2, 8),
    speed: scalar(0, 4),
    // Which side of the mesh the displacement pushes toward.
    bias: vec3,
    // Where along the mesh axis the displacement grows.
    alongCurve: CurveSchema,
  })
  .strict();

export const LightningSchema = z
  .object({
    points: integer(8, 64),
    jitter: scalar(0, 1),
    branches: integer(0, 6),
    branchDepth: integer(1, 2),
    widthCurve: CurveSchema,
    seedOffset: integer(0, 2147483647),
  })
  .strict();

export const GeometryV2Schema = z
  .object({
    type: z.enum(GEOMETRIES_V2),
    segments: integer(8, 256),
    radialSegments: integer(3, 64),
    radius: scalar(0.01, 8),
    length: scalar(0.01, 12),
    thickness: scalar(0.001, 3),
    vertexNoise: VertexNoiseSchema.nullable(),
    lightning: LightningSchema.nullable(),
  })
  .strict();

// --- layer -----------------------------------------------------------------

export const LightSchema = z
  .object({
    color: hex,
    intensity: CurveSchema,
    radius: scalar(0.5, 30),
    decay: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

export const TransformSchema = z
  .object({ position: vec3, rotation: vec3, scale: vec3 })
  .strict();

// v2 animation targets are dotted paths into the layer, e.g.
// "material.ramp.stops[0].intensity" or "emitter.velocity.speed[1]".
const TARGET_PATH = /^[a-z][a-zA-Z0-9]*((\.[a-zA-Z0-9]+)|(\[\d+\]))*$/;
const targetPath = z.string().min(1).max(64).regex(TARGET_PATH);

export const TrackV2Schema = z
  .object({
    target: targetPath,
    keys: z
      .array(z.tuple([localTime, z.number().min(-20).max(20)]))
      .min(2)
      .max(12),
    ease: z.enum(["linear", "smooth", "outCubic", "inQuad"]),
  })
  .strict();

export const OverrideV2Schema = z
  .object({
    target: targetPath,
    value: z.union([z.number(), hex]),
    start: localTime,
    end: localTime,
    fade: scalar(0, 1),
  })
  .strict();

export const LayerV2Schema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    name: z.string().min(1).max(80),
    role: z.enum(ROLES_V2),
    kind: z.enum(KINDS_V2),
    start: localTime,
    end: localTime,
    enabled: z.boolean(),
    transform: TransformSchema,
    motion: MotionSchema.nullable(),
    material: MaterialSchema.optional(),
    emitter: EmitterSchema.optional(),
    geometry: GeometryV2Schema.optional(),
    light: LightSchema.optional(),
    tracks: z.array(TrackV2Schema).max(16),
    overrides: z.array(OverrideV2Schema).max(64),
  })
  .strict();

// --- document --------------------------------------------------------------

export const QualitySchema = z
  .object({
    style: z.enum(["modern", "ps2", "ps1"]),
    particleDensity: scalar(0.1, 1),
    aa: z.enum(["none", "msaa", "msaa+smaa"]),
    softParticles: z.boolean(),
  })
  .strict();

export const EnvironmentSchema = z
  .object({
    ground: z.enum(["none", "grid", "plane"]),
    groundColor: hex,
    groundReflect: scalar(0, 1),
    groundY: scalar(-4, 0),
    fog: z.object({ color: hex, density: scalar(0, 0.2) }).strict(),
    background: hex,
  })
  .strict();

export const ShakeSchema = z
  .object({
    amplitude: scalar(0, 0.3),
    frequency: scalar(1, 40),
    start: localTime,
    end: localTime,
    fade: scalar(0, 1),
  })
  .strict();

export const PushInSchema = z
  .object({
    from: scalar(1, 2),
    to: scalar(0.5, 1),
    start: localTime,
    end: localTime,
    ease: z.enum(["linear", "smooth"]),
  })
  .strict();

export const CameraSchema = z
  .object({
    fov: scalar(20, 70),
    azimuth: scalar(-Math.PI, Math.PI),
    elevation: scalar(-1.5, 1.5),
    framing: scalar(0.3, 0.9),
    shake: ShakeSchema.nullable(),
    pushIn: PushInSchema.nullable(),
  })
  .strict();

export const PostSchema = z
  .object({
    bloom: z
      .object({
        strength: scalar(0, 2),
        radius: scalar(0, 1),
        threshold: scalar(0, 2),
      })
      .strict(),
    exposure: scalar(0.3, 2),
    grade: z
      .object({
        contrast: scalar(0.5, 1.5),
        saturation: scalar(0, 2),
        tint: hex,
        lift: scalar(-0.2, 0.2),
      })
      .strict(),
    vignette: scalar(0, 1),
    chromatic: scalar(0, 0.01),
    motionBlur: scalar(0, 1),
  })
  .strict();

export const DocumentV2Schema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION_V2),
    name: z.string().min(1).max(100),
    description: z.string().max(1500),
    seed: integer(0, 2147483647),
    duration: scalar(0.5, 12),
    impact: localTime,
    quality: QualitySchema,
    environment: EnvironmentSchema,
    camera: CameraSchema,
    post: PostSchema,
    textures: z.array(TextureAssetSchema).max(4).optional(),
    layers: z.array(LayerV2Schema).min(1).max(24),
  })
  .strict();

export type Curve = z.infer<typeof CurveSchema>;
export type Ramp = z.infer<typeof RampSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type Emitter = z.infer<typeof EmitterSchema>;
export type GeometryV2 = z.infer<typeof GeometryV2Schema>;
export type LightV2 = z.infer<typeof LightSchema>;
export type TrackV2 = z.infer<typeof TrackV2Schema>;
export type OverrideV2 = z.infer<typeof OverrideV2Schema>;
export type LayerV2 = z.infer<typeof LayerV2Schema>;
export type VfxDocumentV2 = z.infer<typeof DocumentV2Schema>;
export type KindV2 = (typeof KINDS_V2)[number];
export type { TextureAsset };

// ---------------------------------------------------------------------------
// Animation targets
// ---------------------------------------------------------------------------

/**
 * v1 numeric targets → v2 dotted paths. This is the mesh/default table; the
 * particles table below overrides the entries whose v2 home is the emitter.
 * Exported so the migrator and the refine layer agree on one vocabulary.
 */
export const V1_TARGET_MAP: Record<NumericTarget, string> = {
  radius: "geometry.radius",
  width: "geometry.thickness",
  length: "geometry.length",
  intensity: "material.ramp.stops[0].intensity",
  opacity: "material.opacity",
  speed: "geometry.vertexNoise.speed",
  turbulence: "geometry.vertexNoise.amplitude",
  erosion: "material.erosion.curve.keys[1][1]",
  spin: "transform.rotation[1]",
};

/** Overrides applied when the layer kind is `particles`. */
export const V1_PARTICLE_TARGET_MAP: Partial<Record<NumericTarget, string>> = {
  radius: "emitter.shape.radius",
  width: "emitter.render.size[0]",
  length: "emitter.shape.length",
  speed: "emitter.velocity.speed[1]",
  turbulence: "emitter.forces.curl.strength",
  spin: "emitter.render.rotation.speed[1]",
};

/** v1's only non-numeric target. */
export const V1_COLOR_TARGET = "material.ramp.stops[0].color";

export function mapV1Target(
  target: NumericTarget | "color",
  kind: string,
): string {
  if (target === "color") return V1_COLOR_TARGET;
  if (kind === "particles" && V1_PARTICLE_TARGET_MAP[target])
    return V1_PARTICLE_TARGET_MAP[target] as string;
  return V1_TARGET_MAP[target];
}

/**
 * Ranges for the targets this contract knows about. Unknown (but well-formed)
 * dotted paths are accepted without a range check, the same way the renderer
 * resolves them at run time.
 */
export const V2_TARGET_RANGES: Record<string, [number, number]> = {
  "transform.position[0]": [-12, 12],
  "transform.position[1]": [-12, 12],
  "transform.position[2]": [-12, 12],
  "transform.rotation[0]": [-10, 10],
  "transform.rotation[1]": [-10, 10],
  "transform.rotation[2]": [-10, 10],
  "transform.scale[0]": [-12, 12],
  "transform.scale[1]": [-12, 12],
  "transform.scale[2]": [-12, 12],
  "material.opacity": [0, 1],
  "material.softParticle": [0, 2],
  "material.ramp.displacementShift": [-1, 1],
  "material.ramp.stops[0].intensity": [0, 8],
  "material.ramp.stops[1].intensity": [0, 8],
  "material.ramp.stops[2].intensity": [0, 8],
  "material.ramp.stops[3].intensity": [0, 8],
  "material.ramp.stops[4].intensity": [0, 8],
  "material.ramp.stops[5].intensity": [0, 8],
  "material.erosion.curve.keys[0][1]": [-20, 20],
  "material.erosion.curve.keys[1][1]": [-20, 20],
  "material.erosion.edgeIntensity": [0, 8],
  "material.noise.distortion": [0, 0.5],
  "geometry.radius": [0.01, 8],
  "geometry.length": [0.01, 12],
  "geometry.thickness": [0.001, 3],
  "geometry.vertexNoise.amplitude": [0, 0.5],
  "geometry.vertexNoise.speed": [0, 4],
  "geometry.vertexNoise.frequency": [0.2, 8],
  "emitter.shape.radius": [0, 12],
  "emitter.shape.length": [0, 12],
  "emitter.shape.angle": [0, Math.PI],
  "emitter.velocity.speed[0]": [-20, 20],
  "emitter.velocity.speed[1]": [-20, 20],
  "emitter.forces.drag": [0, 6],
  "emitter.forces.curl.strength": [0, 3],
  "emitter.render.size[0]": [0.001, 8],
  "emitter.render.size[1]": [0.001, 8],
  "emitter.render.stretch": [0, 4],
  "emitter.render.rotation.speed[0]": [-10, 10],
  "emitter.render.rotation.speed[1]": [-10, 10],
  "light.radius": [0.5, 30],
};

const COLOR_TARGETS = new Set<string>([
  V1_COLOR_TARGET,
  "material.ramp.stops[1].color",
  "material.ramp.stops[2].color",
  "material.ramp.stops[3].color",
  "material.ramp.stops[4].color",
  "material.ramp.stops[5].color",
  "material.erosion.edgeColor",
  "light.color",
]);

export const BUILTIN_TEXTURE_IDS: ReadonlySet<string> = new Set(
  TEXTURE_MANIFEST_V2.map((entry) => entry.id),
);

// ---------------------------------------------------------------------------
// Semantic validation
// ---------------------------------------------------------------------------

export function isV2(doc: unknown): doc is VfxDocumentV2 {
  return (
    typeof doc === "object" &&
    doc !== null &&
    (doc as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION_V2
  );
}

function checkCurve(curve: Curve, label: string) {
  for (let i = 1; i < curve.keys.length; i++)
    if (curve.keys[i][0] <= curve.keys[i - 1][0])
      throw new Error(`Curve keys must ascend in time: ${label}`);
}

function checkUnit(axis: readonly number[], label: string) {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (Math.abs(length - 1) > 2e-3)
    throw new Error(`Axis must be a unit vector: ${label} (|v|=${length})`);
}

function checkRange(pair: readonly number[], label: string) {
  if (pair[0] > pair[1])
    throw new Error(`Range minimum must not exceed maximum: ${label}`);
}

function materialCurves(material: Material, label: string) {
  for (let i = 1; i < material.ramp.stops.length; i++)
    if (material.ramp.stops[i].t <= material.ramp.stops[i - 1].t)
      throw new Error(`Ramp stops must ascend: ${label}`);
  if (material.erosion) checkCurve(material.erosion.curve, `${label}/erosion`);
}

function emitterChecks(emitter: Emitter, label: string) {
  checkUnit(emitter.shape.axis, `${label}/shape.axis`);
  checkUnit(emitter.velocity.direction, `${label}/velocity.direction`);
  if (emitter.forces.vortex)
    checkUnit(emitter.forces.vortex.axis, `${label}/vortex.axis`);
  checkRange(emitter.velocity.speed, `${label}/velocity.speed`);
  checkRange(emitter.life, `${label}/life`);
  checkRange(emitter.render.size, `${label}/render.size`);
  checkRange(emitter.render.rotation.initial, `${label}/rotation.initial`);
  checkRange(emitter.render.rotation.speed, `${label}/rotation.speed`);
  if (emitter.sub) checkRange(emitter.sub.offset, `${label}/sub.offset`);
  if (emitter.shape.innerRadius > emitter.shape.radius)
    throw new Error(`Inner radius exceeds radius: ${label}`);
  if (emitter.velocity.speedCurve)
    checkCurve(emitter.velocity.speedCurve, `${label}/speedCurve`);
  if (emitter.forces.curl)
    checkCurve(emitter.forces.curl.envelope, `${label}/curl.envelope`);
  checkCurve(emitter.render.sizeCurve, `${label}/sizeCurve`);
  checkCurve(emitter.render.alphaCurve, `${label}/alphaCurve`);
  if (emitter.render.alphaAlongSpawn)
    checkCurve(emitter.render.alphaAlongSpawn, `${label}/alphaAlongSpawn`);
  if (emitter.trail) checkCurve(emitter.trail.widthCurve, `${label}/trail`);
  if (emitter.spawn.mode === "bursts" && emitter.spawn.bursts.length === 0)
    throw new Error(`Burst list is empty: ${label}`);
  for (let i = 1; i < emitter.spawn.bursts.length; i++)
    if (emitter.spawn.bursts[i].t <= emitter.spawn.bursts[i - 1].t)
      throw new Error(`Bursts must ascend in time: ${label}`);
}

export function validateOverrideV2(
  input: unknown,
  duration: number,
): OverrideV2 {
  const o = OverrideV2Schema.parse(input);
  if (o.start >= o.end || o.end > duration || o.fade > (o.end - o.start) / 2)
    throw new Error("Invalid edit window.");
  if (COLOR_TARGETS.has(o.target)) {
    if (typeof o.value !== "string")
      throw new Error("Color must be a hex string.");
  } else if (typeof o.value !== "number") {
    throw new Error("Numeric target requires a numeric value.");
  } else {
    const bounds = V2_TARGET_RANGES[o.target];
    if (bounds && (o.value < bounds[0] || o.value > bounds[1]))
      throw new Error(`Edit value outside supported range: ${o.target}`);
  }
  return o;
}

export function validateDocumentV2(input: unknown): VfxDocumentV2 {
  const doc = DocumentV2Schema.parse(input);
  if (doc.impact >= doc.duration)
    throw new Error("Impact must be before the end.");

  const assets = new Set<string>();
  for (const asset of doc.textures || []) {
    if (assets.has(asset.id)) throw new Error("Duplicate texture ID.");
    assets.add(asset.id);
  }
  const textureExists = (id: string) =>
    assets.has(id) || BUILTIN_TEXTURE_IDS.has(id);

  const ids = new Set<string>();
  const particleLayers = new Set<string>();
  let particles = 0;
  for (const layer of doc.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate layer: ${layer.id}`);
    ids.add(layer.id);
    if (layer.kind === "particles") particleLayers.add(layer.id);
  }

  for (const layer of doc.layers) {
    const label = layer.id;
    if (layer.start >= layer.end || layer.end > doc.duration)
      throw new Error(`Invalid interval: ${label}`);

    if (layer.kind === "light") {
      if (!layer.light) throw new Error(`Light layer needs light: ${label}`);
      if (layer.material || layer.emitter || layer.geometry)
        throw new Error(
          `Light layers carry no material, emitter or geometry: ${label}`,
        );
      checkCurve(layer.light.intensity, `${label}/light.intensity`);
    } else {
      if (layer.light)
        throw new Error(`Only light layers carry light: ${label}`);
      if (!layer.material) throw new Error(`Layer needs a material: ${label}`);
      materialCurves(layer.material, label);
      for (const id of [
        layer.material.mask.textureId,
        layer.material.noise?.textureId ?? null,
      ])
        if (id && !textureExists(id)) throw new Error(`Missing texture: ${id}`);
    }

    if (layer.kind === "particles") {
      if (!layer.emitter)
        throw new Error(`Particles layer needs an emitter: ${label}`);
      if (layer.geometry)
        throw new Error(
          `Particles use instanced billboards; drop geometry: ${label}`,
        );
      emitterChecks(layer.emitter, label);
      particles += layer.emitter.count;
      const trailTexture = layer.emitter.trail?.textureId;
      if (trailTexture && !textureExists(trailTexture))
        throw new Error(`Missing texture: ${trailTexture}`);
      const sub = layer.emitter.sub;
      if (sub) {
        if (sub.parentLayerId === layer.id)
          throw new Error(`Sub-emitter cannot target itself: ${label}`);
        if (!ids.has(sub.parentLayerId))
          throw new Error(`Missing sub-emitter parent: ${sub.parentLayerId}`);
        if (!particleLayers.has(sub.parentLayerId))
          throw new Error(
            `Sub-emitter parent must be a particles layer: ${sub.parentLayerId}`,
          );
      }
    } else if (layer.emitter) {
      throw new Error(`Only particles layers carry an emitter: ${label}`);
    }

    if (
      layer.geometry &&
      !(MESH_KINDS_V2 as readonly string[]).includes(layer.kind)
    )
      throw new Error(`Kind ${layer.kind} carries no geometry: ${label}`);
    if (
      !layer.geometry &&
      (MESH_KINDS_V2 as readonly string[]).includes(layer.kind)
    )
      throw new Error(`Mesh layer needs geometry: ${label}`);
    if (layer.geometry) {
      if (layer.geometry.vertexNoise)
        checkCurve(
          layer.geometry.vertexNoise.alongCurve,
          `${label}/vertexNoise`,
        );
      if (layer.geometry.lightning)
        checkCurve(layer.geometry.lightning.widthCurve, `${label}/lightning`);
    }

    if (layer.motion)
      for (let i = 0; i < layer.motion.keys.length; i++) {
        const t = layer.motion.keys[i][0];
        if (
          t > layer.end - layer.start + 1e-6 ||
          (i > 0 && t <= layer.motion.keys[i - 1][0])
        )
          throw new Error(`Invalid motion keys: ${label}`);
      }

    const targets = new Set<string>();
    for (const track of layer.tracks) {
      if (targets.has(track.target))
        throw new Error(`Duplicate track: ${label}/${track.target}`);
      targets.add(track.target);
      const bounds = V2_TARGET_RANGES[track.target];
      for (let i = 0; i < track.keys.length; i++) {
        const [t, v] = track.keys[i];
        if (
          t > layer.end - layer.start + 1e-6 ||
          (i > 0 && t <= track.keys[i - 1][0]) ||
          (bounds && (v < bounds[0] || v > bounds[1]))
        )
          throw new Error(
            `Invalid keyframe: ${label}/${track.target} key ${i}=[${t},${v}]; local time must be 0..${layer.end - layer.start}, strictly after the previous key${bounds ? `, and value ${bounds[0]}..${bounds[1]}` : ""}.`,
          );
      }
    }
    for (const o of layer.overrides) validateOverrideV2(o, doc.duration);
  }

  if (particles > PARTICLE_BUDGET_V2)
    throw new Error(
      `Particle budget exceeded (${PARTICLE_BUDGET_V2.toLocaleString("en-US")}).`,
    );
  if (!doc.layers.some((l) => l.enabled))
    throw new Error("At least one layer must be enabled.");
  return doc;
}

/**
 * Non-fatal quality warnings. Nothing here rejects a document; the lab surfaces
 * these to the author (and to the refine layer) as hints.
 */
export function lintDocumentV2(doc: VfxDocumentV2): string[] {
  const warnings: string[] = [];
  let particles = 0;
  const referenced = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.material?.mask.textureId)
      referenced.add(layer.material.mask.textureId);
    if (layer.material?.noise?.textureId)
      referenced.add(layer.material.noise.textureId);
    const emitter = layer.emitter;
    if (!emitter) continue;
    particles += emitter.count;
    const [min, max] = emitter.life;
    if (min > 0 && max / min < LIFE_VARIANCE_MIN)
      warnings.push(
        `${layer.id}: life variance ${(max / min).toFixed(2)} is below ${LIFE_VARIANCE_MIN}; particles will die in visible waves.`,
      );
    const [sizeMin, sizeMax] = emitter.render.size;
    if (sizeMax / sizeMin < 1.2)
      warnings.push(
        `${layer.id}: size range is nearly uniform; add a size hierarchy.`,
      );
    if (emitter.spawn.mode === "continuous" && emitter.spawn.rate <= 0)
      warnings.push(`${layer.id}: continuous emitter has a zero spawn rate.`);
  }
  if (particles > PARTICLE_BUDGET_V2 * 0.8)
    warnings.push(
      `Particle count ${particles} is within 20% of the ${PARTICLE_BUDGET_V2} budget.`,
    );
  for (const asset of doc.textures || [])
    if (!referenced.has(asset.id))
      warnings.push(`Texture ${asset.id} is embedded but never referenced.`);
  const drawable = doc.layers.filter((l) => l.enabled && l.kind !== "light");
  if (!drawable.length) warnings.push("No drawable layer is enabled.");

  // --- scale warnings ------------------------------------------------------
  // Nothing here is fatal: they describe a document that validates but renders
  // as a small, flat, unlit event inside the framed shot.
  for (const layer of doc.layers)
    if (
      layer.enabled &&
      layer.emitter &&
      layer.emitter.count < PARTICLE_COUNT_MIN
    )
      warnings.push(
        `${layer.id}: particle count ${layer.emitter.count} is below ${PARTICLE_COUNT_MIN}; the layer reads as a few dots instead of a volume.`,
      );
  // A single-layer document is a building block, not a composition, so only a
  // composed effect is expected to light its surroundings.
  if (
    drawable.length > 1 &&
    !doc.layers.some((l) => l.enabled && l.kind === "light")
  )
    warnings.push(
      "No light layer: nothing lights the ground, so the contact reads as a decal on black.",
    );
  if (doc.environment.ground !== "none") {
    const channels = [1, 3, 5].map((i) =>
      parseInt(doc.environment.groundColor.slice(i, i + 2), 16),
    );
    if (Math.max(...channels) < GROUND_CHANNEL_MIN)
      warnings.push(
        `Ground color ${doc.environment.groundColor} is near-black; it will not read as a lit surface.`,
      );
  }
  const extent = effectExtentV2(doc);
  if (extent < EFFECT_EXTENT_MIN)
    warnings.push(
      `Effect extent is about ${extent.toFixed(2)} units; a hero silhouette spans 2.5-4 units.`,
    );
  // The opposite failure: a tiny hero adrift in a large bounding volume. The
  // camera frames the whole animation, so the subject ends up filling a corner.
  const hero = Math.max(
    0,
    ...doc.layers
      .filter(
        (l) =>
          l.enabled &&
          (l.role === "primary" || l.role === "impact") &&
          l.geometry,
      )
      .map((l) => Math.max(l.geometry!.radius * 2, l.geometry!.length)),
  );
  // Measured without particle reach: a wide spark spray is a deliberate choice,
  // a hero mesh parked far from everything else is not.
  const staticExtent = effectExtentV2(doc, false);
  if (
    hero > 0 &&
    staticExtent > EFFECT_EXTENT_MIN &&
    hero < staticExtent * 0.35
  )
    warnings.push(
      `Largest primary mesh spans about ${hero.toFixed(2)} units inside a ${staticExtent.toFixed(2)}-unit shot; the camera will frame mostly empty space.`,
    );
  return warnings;
}

/**
 * Rough world-space extent of the drawable layers, in meters: the larger of the
 * biggest single layer and the spread between layer origins. It is a lint
 * heuristic, not the renderer's framing computation.
 */
export function effectExtentV2(
  doc: VfxDocumentV2,
  includeParticles = true,
): number {
  let size = 0;
  const origins: number[][] = [];
  for (const layer of doc.layers) {
    if (!layer.enabled || layer.kind === "light") continue;
    origins.push(layer.transform.position);
    if (layer.geometry) {
      const tracked = (target: string, fallback: number) => {
        const track = layer.tracks.find((t) => t.target === target);
        return track ? Math.max(...track.keys.map((k) => k[1])) : fallback;
      };
      size = Math.max(
        size,
        tracked("geometry.radius", layer.geometry.radius) * 2,
        tracked("geometry.length", layer.geometry.length),
      );
    }
    if (layer.emitter && includeParticles) {
      const shape = layer.emitter.shape;
      const reach =
        Math.max(0, layer.emitter.velocity.speed[1]) * layer.emitter.life[1];
      size = Math.max(
        size,
        shape.radius * 2,
        shape.length,
        reach + layer.emitter.render.size[1],
      );
    }
  }
  let spread = 0;
  for (const a of origins)
    for (const b of origins)
      spread = Math.max(
        spread,
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
      );
  return Math.max(size, spread);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultCurve(from = 0, to = 1): Curve {
  return {
    keys: [
      [0, from],
      [1, to],
    ],
    ease: "smooth",
  };
}

export function defaultMaterial(): Material {
  return {
    blend: "additive",
    ramp: {
      space: "life",
      stops: [
        { t: 0, color: "#8cdfff", intensity: 1.7 },
        { t: 1, color: "#3478e5", intensity: 0.85 },
      ],
      displacementShift: 0,
    },
    opacity: 1,
    mask: {
      textureId: null,
      uvScale: [1, 1],
      uvPan: [0, 0],
      rotation: 0,
      randomRotation: false,
      atlas: null,
      flipbook: null,
    },
    noise: null,
    erosion: null,
    softParticle: 0,
    fresnel: null,
    procedural: "none",
  };
}

export function defaultEmitter(): Emitter {
  return {
    count: 600,
    shape: {
      type: "sphere",
      axis: [0, 1, 0],
      length: 0,
      radius: 1,
      innerRadius: 0,
      angle: 0,
      size: [1, 1, 1],
      surfaceOnly: false,
      bias: [0, 0, 0],
    },
    spawn: {
      mode: "burst",
      window: 0.12,
      rate: 0,
      duration: 0,
      bursts: [],
    },
    velocity: {
      mode: "radial",
      speed: [1.2, 2],
      direction: [0, 1, 0],
      angle: Math.PI * 0.45,
      inherit: 0,
      speedCurve: null,
    },
    life: [0.72, 1.49],
    forces: {
      gravity: [0, -0.4, 0],
      drag: 1.5,
      curl: null,
      vortex: null,
      wind: [0, 0, 0],
      floor: null,
    },
    render: {
      mode: "billboard",
      stretch: 0,
      size: [0.08, 0.2],
      sizeCurve: defaultCurve(1, 1),
      alphaCurve: {
        keys: [
          [0, 0],
          [0.1, 1],
          [1, 0],
        ],
        ease: "smooth",
      },
      alphaAlongSpawn: null,
      rotation: { initial: [0, Math.PI * 2], speed: [-1, 1] },
      sortMode: "byDistance",
    },
    trail: null,
    sub: null,
  };
}

export function defaultGeometry(): GeometryV2 {
  return {
    type: "auto",
    segments: 64,
    radialSegments: 16,
    radius: 1,
    length: 2,
    thickness: 0.08,
    vertexNoise: null,
    lightning: null,
  };
}

export function defaultDocumentShell(
  name = "Untitled effect",
): Omit<VfxDocumentV2, "layers"> {
  return {
    schemaVersion: SCHEMA_VERSION_V2,
    name,
    description: "",
    seed: 41721,
    duration: 3,
    impact: 0.55,
    quality: {
      style: "modern",
      particleDensity: 1,
      aa: "msaa+smaa",
      softParticles: true,
    },
    environment: {
      ground: "grid",
      groundColor: "#4a4952",
      groundReflect: 0,
      groundY: 0,
      fog: { color: "#1b1a1f", density: 0.03 },
      background: "#1b1a1f",
    },
    camera: {
      fov: 32,
      azimuth: -0.55,
      elevation: 0.4,
      framing: 0.55,
      shake: null,
      pushIn: null,
    },
    post: {
      bloom: { strength: 0.45, radius: 0.4, threshold: 1.3 },
      exposure: 1,
      grade: { contrast: 1, saturation: 1, tint: "#ffffff", lift: 0 },
      vignette: 0.35,
      chromatic: 0.0025,
      motionBlur: 0,
    },
    textures: [],
  };
}

export function defaultsV2() {
  return {
    material: defaultMaterial(),
    emitter: defaultEmitter(),
    geometry: defaultGeometry(),
    shell: defaultDocumentShell(),
  };
}

// ---------------------------------------------------------------------------
// Wire schema — Structured Outputs uses homogeneous arrays; tuples remain in
// the validated runtime contract. Same approach as v1's DocumentWireSchema.
// ---------------------------------------------------------------------------

const num2 = z.array(z.number()).length(2);
const num3 = z.array(z.number()).length(3);
const num4 = z.array(z.number()).length(4);

export const CurveWireSchema = CurveSchema.extend({
  keys: z.array(num2).min(2).max(8),
});
export const MotionWireSchema = MotionSchema.extend({
  keys: z.array(num4).min(2).max(8),
});
export const RampWireSchema = RampSchema;
export const MaskWireSchema = MaskSchema.extend({
  uvScale: num2,
  uvPan: num2,
});
export const NoiseWireSchema = NoiseSchema.extend({
  uvScale: num2,
  uvPan: num2,
  distortionPan: num2,
});
export const ErosionWireSchema = ErosionSchema.extend({
  curve: CurveWireSchema,
});
export const MaterialWireSchema = MaterialSchema.extend({
  mask: MaskWireSchema,
  noise: NoiseWireSchema.nullable(),
  erosion: ErosionWireSchema.nullable(),
});
export const EmitterWireSchema = EmitterSchema.extend({
  shape: EmitterShapeSchema.extend({ axis: num3, size: num3, bias: num3 }),
  velocity: VelocitySchema.extend({
    speed: num2,
    direction: num3,
    speedCurve: CurveWireSchema.nullable(),
  }),
  life: num2,
  forces: ForcesSchema.extend({
    gravity: num3,
    wind: num3,
    curl: CurlSchema.extend({ envelope: CurveWireSchema }).nullable(),
    vortex: VortexSchema.extend({ axis: num3 }).nullable(),
  }),
  render: ParticleRenderSchema.extend({
    size: num2,
    sizeCurve: CurveWireSchema,
    alphaCurve: CurveWireSchema,
    alphaAlongSpawn: CurveWireSchema.nullable(),
    rotation: ParticleRotationSchema.extend({ initial: num2, speed: num2 }),
  }),
  trail: TrailSchema.extend({ widthCurve: CurveWireSchema }).nullable(),
  sub: SubEmitterSchema.extend({ offset: num2 }).nullable(),
});
export const GeometryV2WireSchema = GeometryV2Schema.extend({
  vertexNoise: VertexNoiseSchema.extend({
    bias: num3,
    alongCurve: CurveWireSchema,
  }).nullable(),
  lightning: LightningSchema.extend({
    widthCurve: CurveWireSchema,
  }).nullable(),
});
export const LayerV2WireSchema = LayerV2Schema.extend({
  transform: TransformSchema.extend({
    position: num3,
    rotation: num3,
    scale: num3,
  }),
  motion: MotionWireSchema.nullable(),
  material: MaterialWireSchema.nullable(),
  emitter: EmitterWireSchema.nullable(),
  geometry: GeometryV2WireSchema.nullable(),
  light: LightSchema.extend({ intensity: CurveWireSchema }).nullable(),
  tracks: z
    .array(TrackV2Schema.extend({ keys: z.array(num2).min(2).max(12) }))
    .max(16),
});
export const DocumentV2WireSchema = DocumentV2Schema.omit({
  textures: true,
}).extend({ layers: z.array(LayerV2WireSchema).min(1).max(24) });

export type VfxDocumentV2Wire = z.infer<typeof DocumentV2WireSchema>;

/**
 * Parse a Structured Outputs payload and re-validate it as a runtime document.
 * Kind-dependent slots arrive as explicit nulls on the wire and are dropped.
 */
export function fromWireV2(
  input: unknown,
  textures: TextureAsset[] = [],
): VfxDocumentV2 {
  const wire = DocumentV2WireSchema.parse(input);
  const layers = wire.layers.map((layer) => {
    const next: Record<string, unknown> = { ...layer };
    for (const slot of ["material", "emitter", "geometry", "light"])
      if (next[slot] === null) delete next[slot];
    return next;
  });
  return validateDocumentV2({ ...wire, layers, textures });
}

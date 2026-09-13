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
  // Cel-shaded lobe cluster (layer.blob) and flat splash slivers (layer.splash).
  // Neither carries `geometry` or `emitter`: each generates its own primitives
  // from its own spec object.
  "blob",
  "splash",
  // Multi-strand strip swept along a document path inside a moving window
  // (layer.ribbon) and a burst of polygon outlines (layer.wireBurst). Same
  // rule: their own spec object, never `geometry` or `emitter`.
  "ribbon",
  "wireBurst",
  // Instanced faceted crystal cluster (layer.crystals): the same rule again,
  // its own spec object and never `geometry` or `emitter`.
  "crystals",
] as const;
export const BLOB_ARRANGEMENTS = ["mound", "column", "ring", "string"] as const;
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
export const RAMP_SPACES = ["life", "layerTime", "surface", "height"] as const;
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
  // Billboard silhouettes with no atlas behind them: a thin four-point glint
  // and a plain soft radial ball. Same family as flame/smoke (a sprite outline),
  // not a surface pattern.
  "star4",
  "softRadial",
  // Flat-disc surface patterns driven by material.proceduralParams: the two
  // halves of a heal ground ring.
  "swirlRing",
  "ringFill",
  // A cast sigil: concentric rings, a band of hashed rune ticks, radial spokes
  // and a two-layer polar mist, all in one flat-card pattern.
  "sigil",
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
  // A spherical strip: a belt of angular width `thickness` at `radius`, tilted
  // and spun by geometry.band. Real geometry, so it sorts against a dome.
  "band",
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
  // Instances sit ON a document path (emitter.shape.pathId), at u = index /
  // (count - 1), scattered by shape.radius across the path frame.
  "path",
  // Instances are born AT another layer's generated instances (emitter.shape.
  // sourceLayerId): each particle inherits one crystal's position and axis, so
  // a shatter burst leaves the spikes it broke off instead of a bare sphere.
  "layerInstances",
] as const;
export const SPAWN_MODES = [
  "burst",
  "continuous",
  "bursts",
  // Instance i is born the moment emitter.spawn.headCurve passes its own u.
  "pathAnchored",
] as const;
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
  // Quad rolled to the screen-space tangent of its path: the dashes of a
  // path-anchored trail lie along the flight line instead of upright.
  "pathAligned",
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
/** Lobes one blob layer may generate; each is its own draw call plus a hull. */
export const BLOB_LOBE_BUDGET = 40;
/** A hero silhouette smaller than this disappears inside the framed shot. */
export const EFFECT_EXTENT_MIN = 1.5;
/** Named paths one document may declare; every path costs uniforms per layer. */
export const PATH_BUDGET_V2 = 6;
/** Strands one ribbon layer may sweep; each is its own tapered strip. */
export const RIBBON_STRAND_BUDGET = 6;

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

// --- paths -----------------------------------------------------------------
//
// A document may declare up to PATH_BUDGET_V2 named curves. They are pure
// functions of u in 0..1 (see paths-v2.ts for the evaluator, which is mirrored
// term for term in GLSL), so a ribbon window, a path-anchored emitter and a
// morph target all read the same geometry without any of them storing state.
//
//   orbit   a wobbling helix around `center`: u turns `turns` times, the ring
//           radius breathes by wobble.amplitude at wobble.frequency harmonics,
//           and the whole path rises `height` metres over the sweep. height 0
//           is a flat ring.
//   bezier  a quadratic Bezier from -> control -> to: a thrown arc.
export const PathIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

export const OrbitPathSchema = z
  .object({
    id: PathIdSchema,
    type: z.literal("orbit"),
    center: vec3,
    radius: scalar(0.01, 12),
    height: scalar(-12, 12),
    turns: scalar(0.05, 8),
    phase: scalar(-Math.PI * 2, Math.PI * 2),
    wobble: z
      .object({ amplitude: scalar(0, 3), frequency: scalar(0, 12) })
      .strict(),
  })
  .strict();

export const BezierPathSchema = z
  .object({
    id: PathIdSchema,
    type: z.literal("bezier"),
    from: vec3,
    control: vec3,
    to: vec3,
  })
  .strict();

export const PathV2Schema = z.discriminatedUnion("type", [
  OrbitPathSchema,
  BezierPathSchema,
]);

export const RampStopSchema = z
  .object({ t: scalar(0, 1), color: hex, intensity: scalar(0, 8) })
  .strict();

export const RampSchema = z
  .object({
    space: z.enum(RAMP_SPACES),
    stops: z.array(RampStopSchema).min(2).max(6),
    // Vertex displacement (mesh lobes) shifts the ramp key by this amount.
    displacementShift: scalar(-1, 1),
    // Metres the "height" space spans above environment.groundY: the key is
    // clamp((worldY - groundY)/heightSpan). Defaulted, not required, so
    // documents authored before the space existed still load.
    heightSpan: scalar(0.1, 12).default(2),
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

// Cel shading: a half-lambert N.L against a FIXED world light direction (never
// the document's light layers, which are point lights that move) posterised
// into 2 or 3 flat bands, plus a rim term. Set on a mesh or blob layer it
// REPLACES the ramp as the colour source; the ramp still keys erosion and the
// alpha it always keyed.
export const ToonSchema = z
  .object({
    bands: z.union([z.literal(2), z.literal(3)]),
    // Band edges on the half-lambert 0..1. 3 bands: shadow < a <= body < b <=
    // highlight. 2 bands: only `a` is read, shadow < a <= highlight.
    thresholds: range(0, 1),
    shadow: hex,
    body: hex,
    highlight: hex,
    // Unit vector TOWARD the light, in world space.
    light: unit3,
    rim: z
      .object({ power: scalar(0.5, 8), amount: scalar(0, 2) })
      .strict(),
  })
  .strict();

// Inverted-hull outline: the surface is drawn a second time with back faces
// only, inflated `width` metres along its recomputed normal, flat and unlit.
// Convention: `color` is DARKER than toon.shadow — the reference line is a dark
// crease between lobes, not a light rim (that is what toon.rim is for).
export const OutlineSchema = z
  .object({ width: scalar(0, 0.3), color: hex })
  .strict();

// Per-channel screen offset: the surface is drawn three times, each copy
// masked to one of R/G/B and pushed `offset` of the frame width apart (the
// copies sum back to the original at offset 0, so this is a true split, not a
// tint). `growth` multiplies the offset by the layer's own 0..1 progress, so a
// fragment separates further as it ages. Mesh kinds and wireBurst only —
// particles are one instanced draw and would triple the instance budget.
export const RgbSplitSchema = z
  .object({ offset: scalar(0, 0.08), growth: scalar(0, 4) })
  .strict();

// A travelling reveal front. `from` and `to` are the front's position at the
// start and the end of the layer's own 0..1 progress, in the mode's own key:
//   "radial"  distance from the layer origin as a fraction of the card's
//             half-size (0 centre, 1 rim) — the sigil drawing itself outward.
//   "scan"    (1 - objectY)/2 on a unit body (0 top, 1 bottom) — the shield
//             lattice lighting up cell by cell from the crown down.
// Values outside 0..1 are allowed and are how a reveal finishes early inside a
// longer layer: a front that has passed 1 leaves the whole surface revealed.
// `frontWidth` is the width of the bright leading band, in the same key.
export const RevealSchema = z
  .object({
    mode: z.enum(["radial", "scan"]),
    from: scalar(-8, 8),
    to: scalar(-8, 8),
    frontWidth: scalar(0, 1),
  })
  .strict();

// Spherical hex lattice. The cells are the Voronoi regions of a Lloyd-relaxed
// Fibonacci point set on the unit sphere — uniform, pole-free and seam-free,
// i.e. a Goldberg sphere with no authored mesh. The renderer generates and
// caches the sites by (cells, seed) and the fragment shader looks up the
// nearest two of them; `edgeWidth` and `gapWidth` are fractions of a cell's
// circumradius, so the wall weight is independent of `cells`.
export const LatticePulseSchema = z
  .object({ speed: scalar(0, 12), phaseJitter: scalar(0, 1) })
  .strict();

// Cells switch off one by one from `start` (a fraction of the layer's own 0..1
// progress); each cell's own delay is its hash times `stagger`, and `softness`
// is how long one cell takes to go.
export const LatticeDissolveSchema = z
  .object({
    start: scalar(0, 1),
    stagger: scalar(0, 2),
    softness: scalar(0.01, 1),
  })
  .strict();

export const LatticeSchema = z
  .object({
    cells: integer(60, 600),
    edgeWidth: scalar(0.01, 0.6),
    gapWidth: scalar(0, 0.4),
    tileColor: hex,
    edgeColor: hex,
    pulse: LatticePulseSchema,
    dissolve: LatticeDissolveSchema.nullable(),
    // At grazing angles the cells compress below a pixel and shimmer; below
    // this |N.V| the lattice fades out and the fresnel rim carries the edge.
    grazeFade: scalar(0.02, 1),
  })
  .strict();

// Analytic proximity glow against the ground plane: a soft ring of light where
// the surface comes closest to environment.groundY, from the fragment's own
// world height. No depth texture, so it costs nothing and cannot flicker.
export const PlaneGlowSchema = z
  .object({
    plane: z.literal("ground"),
    distance: scalar(0.01, 4),
    color: hex,
    intensity: scalar(0, 8),
  })
  .strict();

// An expanding great-circle ring on a shell: at layer-local `time` a ring is
// born at `origin` (a unit direction, or null for one hashed off the document
// seed and the ripple's index) and its great-circle radius grows at `speed`
// radians a second, `width` radians wide, its brightness decaying as
// exp(-decay * age). At most four; each is closed form, so a seek lands on the
// same rings playback would have drawn.
export const RippleSchema = z
  .object({
    time: localTime,
    origin: unit3.nullable(),
    speed: scalar(0, 8),
    width: scalar(0.01, 1.5),
    decay: scalar(0, 8),
  })
  .strict();

/** Ripples one material may carry; each costs a uniform slot per layer. */
export const RIPPLE_BUDGET_V2 = 4;

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
    // A generic vec4 every procedural may read; what each component means is
    // documented per pattern, and an unused component is simply ignored.
    //   swirlRing  [rim radius (0..1 of the card), strand half-width,
    //              wobble amplitude, rotation rate rad/s]
    //   ringFill   [fill radius (0..1 of the card), pulse rate rad/s,
    //              noise amount 0..1, edge softness 0..1]
    //   sigil      [ring pairs 1-6, rune cells around the band, radial spokes,
    //              gold rim 0..1]
    // Every other pattern ignores it today. Defaulted, so archived documents
    // load unchanged. The band is wide enough to carry a count (the sigil's
    // rune cells), not only a normalized weight.
    proceduralParams: z
      .tuple([
        scalar(-64, 64),
        scalar(-64, 64),
        scalar(-64, 64),
        scalar(-64, 64),
      ])
      .default([0, 0, 0, 0]),
    // The three cel-shading fields. All defaulted, not required: documents
    // authored before they existed load unchanged and render exactly as before.
    toon: ToonSchema.nullable().default(null),
    outline: OutlineSchema.nullable().default(null),
    // Fraction of the layer's (or the blob lobe's) life the surface stays
    // opaque and depth-writing; after it, alpha fades to 0 by the end. null =
    // the old behaviour (always transparent, never depth-writing).
    opaqueUntil: scalar(0, 1).nullable().default(null),
    rgbSplit: RgbSplitSchema.nullable().default(null),
    // The ice/shield vocabulary. All defaulted, so archived documents load
    // unchanged: a reveal front, a spherical hex lattice, an analytic ground
    // proximity glow and up to four great-circle ripples.
    reveal: RevealSchema.nullable().default(null),
    lattice: LatticeSchema.nullable().default(null),
    planeGlow: PlaneGlowSchema.nullable().default(null),
    ripples: z.array(RippleSchema).max(RIPPLE_BUDGET_V2).nullable().default(null),
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
    // Which document path shape "path" samples. Ignored by every other shape;
    // defaulted so archived documents load unchanged.
    pathId: PathIdSchema.nullable().default(null),
    // Which layer shape "layerInstances" borrows its spawn sites from. The
    // source must be a generator kind whose instances are hashed out of its own
    // spec (crystals, blob), so the sites are closed form and independent of
    // draw order. Ignored by every other shape.
    sourceLayerId: z.string().max(48).nullable().default(null),
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
    // "pathAnchored" only: where the head of the effect is along the path, as a
    // curve over the layer's own 0..1 progress. Instance i owns u = i/(count-1)
    // and is born the moment this curve passes it — the curve is inverted in
    // closed form, so the birth table is never stored. Must be non-decreasing.
    headCurve: CurveSchema.nullable().default(null),
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
    // Drag applied in XZ only: the horizontal travel settles onto an asymptote
    // while the vertical stays ballistic, so a burst of chips flies out, stops
    // spreading and drifts as a flat disc instead of coasting off screen.
    // Defaulted, so archived documents load unchanged.
    planarDrag: scalar(0, 6).default(0),
  })
  .strict();

export const ParticleRotationSchema = z
  .object({
    initial: range(-Math.PI * 2, Math.PI * 2),
    speed: range(-10, 10),
  })
  .strict();

// Per-particle alpha flicker on a phase hashed off the instance seed, so no
// two particles blink together. depth 0 is no flicker, 1 goes fully dark at the
// bottom of each cycle.
export const TwinkleSchema = z
  .object({ frequency: scalar(0.1, 40), depth: scalar(0, 1) })
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
    twinkle: TwinkleSchema.nullable().default(null),
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

export const BandSchema = z
  .object({
    tilt: scalar(-Math.PI, Math.PI),
    spin: scalar(-8, 8),
    stripes: integer(0, 64),
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
    // type "cylinder" only: the far end's radius as a fraction of the near
    // end's, so an upright glow tube narrows as it rises. 1 is a plain tube.
    // Baked into the mesh, so a track cannot animate it (neither can
    // wireBurst.radius, for the same reason). Defaulted, so archived documents
    // load unchanged.
    taper: scalar(0.05, 1).default(1),
    vertexNoise: VertexNoiseSchema.nullable(),
    lightning: LightningSchema.nullable(),
    // type "band" only: how the belt sits and turns. `tilt` leans it about +Z,
    // `spin` turns it about +Y at that many radians a second of layer time, and
    // `stripes` is how many bright bands run along it. Defaulted, so archived
    // documents load unchanged.
    band: BandSchema.nullable().default(null),
  })
  .strict();

// --- crystals ---------------------------------------------------------------
//
// An instanced faceted crystal cluster. Like blob and wireBurst it is a
// GENERATOR: the document says how the cluster is shaped and the renderer
// hashes every spike's direction, length, width, base offset and start time out
// of (crystals.seed, index). One elongated hex prism capped by a pyramid is
// built non-indexed, so every face is flat, and the whole cluster is one
// instanced draw (plus one more for material.outline's inverted hull).
export const CrystalDirectionSchema = z
  .object({
    // Degrees above the horizon the spikes may point, [min,max]. A negative
    // minimum lets the short ones stab downward into the ground.
    elevation: range(-90, 90),
    // Pulls the hashed elevation toward the top of the band, so the cluster
    // reads as an upward urchin rather than an even sphere of spikes.
    upBias: scalar(0, 1),
  })
  .strict();

// easeOutBack: a spike overshoots its length by `overshoot` and settles, over
// `duration` seconds from its own staggered start.
export const CrystalGrowthSchema = z
  .object({ duration: scalar(0.02, 4), overshoot: scalar(0, 3) })
  .strict();

// The shatter: from `start` (a fraction of the LAYER window, jittered per
// instance) each spike collapses to nothing over `duration` seconds.
export const CrystalCollapseSchema = z
  .object({ start: scalar(0, 1), duration: scalar(0.02, 4) })
  .strict();

// A narrow specular band sliding along each spike's axis.
export const CrystalGlintSchema = z
  .object({ frequency: scalar(0, 12), speed: scalar(0, 8) })
  .strict();

export const CrystalsSchema = z
  .object({
    count: integer(8, 400),
    seed: integer(0, 2147483647),
    direction: CrystalDirectionSchema,
    // Spike length and base width bands, in metres.
    length: range(0.05, 6),
    width: range(0.005, 1),
    // Metres the bases are pushed out from the cluster centre along their own
    // direction, so the cluster has a core instead of a single point.
    baseRadius: scalar(0, 4),
    // Length classes. Group 0 is the long spikes, the last group the short
    // ones; each group starts later than the one before it.
    groups: integer(1, 6),
    // Birth times over [startFrac,endFrac] of the LAYER window.
    stagger: range(0, 1),
    growth: CrystalGrowthSchema,
    collapse: CrystalCollapseSchema.nullable(),
    // The facet palette: tips run vivid, the body stays pale, the edges
    // (material.outline drives the dark separator hull) catch the light.
    tipColor: hex,
    faceColor: hex,
    edgeColor: hex,
    fresnelPower: scalar(0.5, 8),
    glint: CrystalGlintSchema,
  })
  .strict();

// --- blob ------------------------------------------------------------------
//
// A blob layer is a GENERATOR, never a hand-placed lobe list: the document says
// how the cluster is shaped and the renderer hashes every lobe's birth time,
// radius, base position, drift and life out of (blob.seed, lobe index). Each
// lobe is an icosphere whose radius is modulated by radius-space fbm (the
// "cauliflower" bumps), grown, lifted on a ballistic arc and shrunk away, all
// closed form in layer time.
//
// arrangement — what the cluster reads as:
//   "mound"  a base cluster: lobes fill a half-egg `spread` wide and `height`
//            tall, densest at the rim, the foot a column grows out of.
//   "column" a rising stack: paired lobes per level, spaced `spread` apart and
//            laddered up over `height`, each level rising further and starting
//            later, plus a fatter smoother lobe behind each pair so the fused
//            contour stays continuous. `rise` is the reach of the TOP level.
//   "ring"   billows around the base: two tiers of lobes on a ring of radius
//            `spread` in the XZ plane, drifting outward; the centre stays open.
//   "string" a thin vertical chain of wisps: alternating left/right, laddered
//            up over `height`, each shorter-lived and smaller than the last.
export const BlobBumpSchema = z
  .object({
    amplitude: scalar(0, 0.6),
    frequency: scalar(0.5, 8),
    speed: scalar(0, 4),
  })
  .strict();

// Comma deformation: taper one end of the lobe to a tail, then bend it round.
// `curl` is the maximum bend in radians per unit of lobe height (the sign and
// the tail's heading are derived per lobe so tails point away from the centre).
export const BlobCommaSchema = z
  .object({ curl: scalar(0, 2.5), taper: scalar(0, 0.9) })
  .strict();

export const BlobSchema = z
  .object({
    arrangement: z.enum(BLOB_ARRANGEMENTS),
    count: integer(2, 40),
    seed: integer(0, 2147483647),
    // Lobe radius band, in metres, before the grow/shrink envelope.
    radius: range(0.05, 3),
    // Lateral extent of the cluster (mound half-width, ring radius, column
    // pair spacing, string sway), in metres.
    spread: scalar(0, 8),
    // Vertical extent of the cluster at birth, in metres.
    height: scalar(0, 12),
    // Metres the top of the cluster travels up over one lobe life.
    rise: scalar(-12, 20),
    // Downward pull on that arc: y = rise*a - gravity*a*a/2.
    gravity: scalar(-20, 20),
    // Metres a lobe drifts outward from the cluster axis, on sqrt(a).
    drift: scalar(-8, 8),
    // Grow rate: a lobe reaches full radius after 1/grow of its life.
    grow: scalar(1, 12),
    // Birth times spread over [start,end] of the LAYER window, as fractions.
    stagger: range(0, 1),
    life: range(0.05, 12),
    // 1 = round, >1 stretched vertically, <1 squat.
    squash: scalar(0.3, 3),
    bump: BlobBumpSchema,
    comma: BlobCommaSchema.nullable(),
  })
  .strict();

// --- splash ----------------------------------------------------------------
//
// Flat, unlit, camera-facing slivers thrown outward from the layer origin: the
// grey shards that sell "something popped". Each sliver is drawn twice, a
// darker backing 14% larger behind the fill, exactly like the spike. Colour
// comes from splash.color / splash.backing, never from material.ramp.
export const SplashSchema = z
  .object({
    count: integer(1, 24),
    seed: integer(0, 2147483647),
    length: range(0.2, 8),
    width: scalar(0.02, 1.5),
    // Sideways bow of the sliver, in metres at the tip; sign is mirrored per side.
    curvature: scalar(0, 3),
    // 0 = clean edges, 1 = deeply notched.
    jaggedness: scalar(0, 1),
    // Angles from +Y the fan covers, in radians; mirrored to both sides.
    spread: range(0, Math.PI),
    color: hex,
    backing: hex,
    // All three are fractions of the LAYER window: grow, break off and fly
    // outward, fade out.
    scaleIn: range(0, 1),
    detach: range(0, 1),
    fade: range(0, 1),
  })
  .strict();

// --- ribbon ----------------------------------------------------------------
//
// A multi-strand strip swept along a document path, of which only the moving
// window [head - tail, head] is ever drawn: that window is what reads as
// TRAVELLING rather than merely present, and it is independent of the layer's
// own start/end (the layer window says when the ribbon exists, the head curve
// says where along the path it is).
//
// Colour comes from material.ramp keyed ACROSS the strip — ramp.space
// "surface" means stop t=0 is the core and t=1 the outer edge — multiplied by
// `core`, and is always drawn additively soft (a hot centre inside a wide
// halo), so one layer does both the core and the halo pass by construction.
export const RibbonWindowSchema = z
  .object({
    // Head position along the path, over the layer's own 0..1 progress. Values
    // above 1 keep sweeping (the path wraps), which is how a heal sweep keeps
    // a slow residual spin after its first wrap.
    head: CurveSchema,
    // Length of the drawn window, as a fraction of the path.
    tail: scalar(0.01, 2),
  })
  .strict();

export const RibbonStrandsSchema = z
  .object({
    count: integer(1, RIBBON_STRAND_BUDGET),
    // Metres the strands are spread apart across the path frame.
    spread: scalar(0, 1),
    // Per-strand width multiplier band (0 = every strand the same width).
    widthJitter: scalar(0, 1),
    // Per-strand phase offset along the path, as a fraction of the window.
    phaseJitter: scalar(0, 1),
  })
  .strict();

export const RibbonTaperSchema = z
  .object({
    // Fractions of the window that fade in at the tail and out at the head.
    head: scalar(0, 0.5),
    tail: scalar(0, 0.9),
  })
  .strict();

// Blend the whole sweep onto a second path as `curve` (over the layer's 0..1
// progress) rises from 0 to 1: the airborne heal sweep diving into the ground
// ring is one ribbon layer, not two.
export const RibbonMorphSchema = z
  .object({ pathId: PathIdSchema, curve: CurveSchema })
  .strict();

export const RibbonSchema = z
  .object({
    pathId: PathIdSchema,
    window: RibbonWindowSchema,
    strands: RibbonStrandsSchema,
    // Full width of one strand at its fattest, in metres.
    width: scalar(0.002, 1),
    taper: RibbonTaperSchema,
    morph: RibbonMorphSchema.nullable(),
    // "camera" keeps the strip facing the viewer (an energy strand);
    // "path" keeps it in the path's own normal plane (a flat banner).
    orientation: z.enum(["camera", "path"]),
    // Multiplier on the hot centre, over the ramp's own intensities.
    core: scalar(0, 8),
  })
  .strict();

// --- wireBurst -------------------------------------------------------------
//
// Angular polygon outlines plus straight spokes thrown out of the layer origin
// as LineSegments: the "the geometry itself shattered" tell of a digital
// impact. A generator, like blob and splash — every shape's plane, radius,
// vertex jitter and travel distance is hashed out of (seed, index).
export const WireBurstSchema = z
  .object({
    shapes: integer(4, 24),
    // Polygon side-count band, inclusive. [3,4] is triangles and quads.
    sides: z.tuple([integer(3, 8), integer(3, 8)]),
    // Radius band of an un-scaled outline, in metres.
    radius: scalar(0.05, 6),
    // Metres the furthest shape travels outward over the layer window.
    travel: scalar(0, 8),
    // Outline scale over the layer's own 0..1 progress.
    scale: CurveSchema,
    // Straight radial lines drawn alongside the outlines.
    spokes: integer(0, 24),
    seed: integer(0, 2147483647),
  })
  .strict();

// --- layer -----------------------------------------------------------------

// Stepped-hash positional jitter on ANY layer: the transform jumps by up to
// `amplitude` metres inside discrete 1/frequency windows, and only in the
// windows whose hash clears `gate` (gate 0 fires every window, 0.9 roughly one
// in ten). Closed form in layer time — floor(age * frequency) is the only
// state — so seek == play. `axis` constrains the jump to one direction; null
// jitters all three.
export const JitterSchema = z
  .object({
    frequency: scalar(0.5, 60),
    amplitude: scalar(0, 2),
    gate: scalar(0, 1),
    axis: unit3.nullable(),
  })
  .strict();

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
    // Applies to the layer transform, whatever the kind. Defaulted, so
    // archived documents load unchanged.
    jitter: JitterSchema.nullable().default(null),
    material: MaterialSchema.optional(),
    emitter: EmitterSchema.optional(),
    geometry: GeometryV2Schema.optional(),
    light: LightSchema.optional(),
    blob: BlobSchema.optional(),
    splash: SplashSchema.optional(),
    ribbon: RibbonSchema.optional(),
    wireBurst: WireBurstSchema.optional(),
    crystals: CrystalsSchema.optional(),
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
    // Hemisphere fill strength. 1 is the reference level the exemplar was lit
    // at; below ~0.6 the ground stops reading, above ~1.4 it flattens.
    // Defaulted, not required: documents authored before this field existed
    // still load, and load at exactly the level they were tuned at.
    ambient: scalar(0, 3).default(1),
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
    framing: scalar(0.3, 1.2),
    shake: ShakeSchema.nullable(),
    pushIn: PushInSchema.nullable(),
  })
  .strict();

// Time-gated screen glitch: horizontal band displacement, RGB split and block
// dropout, every one of them keyed on hash(floor(t * 20)) so a seek lands on
// exactly the frame playback would have drawn. `curve` is the strength over
// DOCUMENT time normalized to 0..1 — two hot frames at the hit and a short
// tail is the whole shape.
export const GlitchSchema = z
  .object({
    curve: CurveSchema,
    // Horizontal bands the frame is cut into for the displacement.
    bands: integer(2, 64),
    // Block grid the dropout is sampled on, [cols, rows].
    blockGrid: z.tuple([integer(2, 160), integer(2, 160)]),
    // Per-channel horizontal offset at full strength, as a fraction of width.
    split: scalar(0, 0.05),
    // How much harder the frame edges glitch than its centre (0 = uniform).
    edgeBias: scalar(0, 2),
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
    glitch: GlitchSchema.nullable().default(null),
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
    // Named curves layers reference by id (ribbon.pathId, ribbon.morph.pathId,
    // emitter.shape.pathId). Defaulted, so archived documents load unchanged.
    paths: z.array(PathV2Schema).max(PATH_BUDGET_V2).default([]),
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
export type Toon = z.infer<typeof ToonSchema>;
export type Outline = z.infer<typeof OutlineSchema>;
export type Blob = z.infer<typeof BlobSchema>;
export type BlobArrangement = (typeof BLOB_ARRANGEMENTS)[number];
export type Splash = z.infer<typeof SplashSchema>;
export type PathV2 = z.infer<typeof PathV2Schema>;
export type OrbitPath = z.infer<typeof OrbitPathSchema>;
export type BezierPath = z.infer<typeof BezierPathSchema>;
export type Ribbon = z.infer<typeof RibbonSchema>;
export type WireBurst = z.infer<typeof WireBurstSchema>;
export type Crystals = z.infer<typeof CrystalsSchema>;
export type Reveal = z.infer<typeof RevealSchema>;
export type Lattice = z.infer<typeof LatticeSchema>;
export type PlaneGlow = z.infer<typeof PlaneGlowSchema>;
export type Ripple = z.infer<typeof RippleSchema>;
export type Band = z.infer<typeof BandSchema>;
export type Jitter = z.infer<typeof JitterSchema>;
export type Twinkle = z.infer<typeof TwinkleSchema>;
export type RgbSplit = z.infer<typeof RgbSplitSchema>;
export type Glitch = z.infer<typeof GlitchSchema>;
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
  "material.opaqueUntil": [0, 1],
  "material.outline.width": [0, 0.3],
  "material.ramp.heightSpan": [0.1, 12],
  "material.toon.rim.amount": [0, 2],
  "blob.radius[0]": [0.05, 3],
  "blob.radius[1]": [0.05, 3],
  "blob.spread": [0, 8],
  "blob.height": [0, 12],
  "blob.rise": [-12, 20],
  "blob.gravity": [-20, 20],
  "blob.drift": [-8, 8],
  "blob.squash": [0.3, 3],
  "blob.bump.amplitude": [0, 0.6],
  "splash.width": [0.02, 1.5],
  "splash.length[0]": [0.2, 8],
  "splash.length[1]": [0.2, 8],
  "material.rgbSplit.offset": [0, 0.08],
  "material.proceduralParams[0]": [-64, 64],
  "material.proceduralParams[1]": [-64, 64],
  "material.proceduralParams[2]": [-64, 64],
  "material.proceduralParams[3]": [-64, 64],
  "jitter.amplitude": [0, 2],
  "jitter.gate": [0, 1],
  "ribbon.width": [0.002, 1],
  "ribbon.core": [0, 8],
  "ribbon.window.tail": [0.01, 2],
  "ribbon.strands.spread": [0, 1],
  "wireBurst.travel": [0, 8],
  "emitter.render.twinkle.depth": [0, 1],
  "emitter.render.twinkle.frequency": [0.1, 40],
  "emitter.forces.planarDrag": [0, 6],
  "crystals.length[0]": [0.05, 6],
  "crystals.length[1]": [0.05, 6],
  "crystals.width[0]": [0.005, 1],
  "crystals.width[1]": [0.005, 1],
  "crystals.baseRadius": [0, 4],
  "crystals.growth.overshoot": [0, 3],
  "crystals.fresnelPower": [0.5, 8],
  "material.reveal.from": [-8, 8],
  "material.reveal.to": [-8, 8],
  "material.reveal.frontWidth": [0, 1],
  "material.lattice.edgeWidth": [0.01, 0.6],
  "material.lattice.gapWidth": [0, 0.4],
  "material.lattice.grazeFade": [0.02, 1],
  "material.planeGlow.intensity": [0, 8],
  "material.planeGlow.distance": [0.01, 4],
  "geometry.band.tilt": [-Math.PI, Math.PI],
  "geometry.band.spin": [-8, 8],
};

const COLOR_TARGETS = new Set<string>([
  V1_COLOR_TARGET,
  "material.ramp.stops[1].color",
  "material.ramp.stops[2].color",
  "material.ramp.stops[3].color",
  "material.ramp.stops[4].color",
  "material.ramp.stops[5].color",
  "material.erosion.edgeColor",
  "material.outline.color",
  "material.toon.shadow",
  "material.toon.body",
  "material.toon.highlight",
  "splash.color",
  "splash.backing",
  "light.color",
  "crystals.tipColor",
  "crystals.faceColor",
  "crystals.edgeColor",
  "material.lattice.tileColor",
  "material.lattice.edgeColor",
  "material.planeGlow.color",
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
  if (material.toon) {
    checkRange(material.toon.thresholds, `${label}/toon.thresholds`);
    checkUnit(material.toon.light, `${label}/toon.light`);
  }
  // A ripple travels out from a direction on the unit sphere; null is the
  // renderer's own hashed one.
  for (const ripple of material.ripples ?? [])
    if (ripple.origin) checkUnit(ripple.origin, `${label}/ripples.origin`);
  if (material.lattice && material.lattice.gapWidth >= material.lattice.edgeWidth)
    throw new Error(
      `Lattice gap is not narrower than its edge, so no wall is drawn: ${label}`,
    );
}

function crystalChecks(crystals: Crystals, label: string) {
  checkRange(crystals.length, `${label}/crystals.length`);
  checkRange(crystals.width, `${label}/crystals.width`);
  checkRange(crystals.stagger, `${label}/crystals.stagger`);
  checkRange(
    crystals.direction.elevation,
    `${label}/crystals.direction.elevation`,
  );
}

function blobChecks(blob: Blob, label: string) {
  checkRange(blob.radius, `${label}/blob.radius`);
  checkRange(blob.stagger, `${label}/blob.stagger`);
  checkRange(blob.life, `${label}/blob.life`);
}

function splashChecks(splash: Splash, label: string) {
  for (const key of ["length", "spread", "scaleIn", "detach", "fade"] as const)
    checkRange(splash[key], `${label}/splash.${key}`);
}

function ribbonChecks(ribbon: Ribbon, label: string) {
  checkCurve(ribbon.window.head, `${label}/ribbon.window.head`);
  if (ribbon.morph) checkCurve(ribbon.morph.curve, `${label}/ribbon.morph.curve`);
  if (ribbon.taper.head + ribbon.taper.tail >= 1)
    throw new Error(
      `Ribbon tapers consume the whole window, leaving nothing lit: ${label}`,
    );
}

function wireBurstChecks(burst: WireBurst, label: string) {
  checkRange(burst.sides, `${label}/wireBurst.sides`);
  checkCurve(burst.scale, `${label}/wireBurst.scale`);
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
  if (emitter.spawn.headCurve) {
    checkCurve(emitter.spawn.headCurve, `${label}/spawn.headCurve`);
    // The birth table is the curve's inverse, so it has to be invertible.
    for (let i = 1; i < emitter.spawn.headCurve.keys.length; i++)
      if (emitter.spawn.headCurve.keys[i][1] < emitter.spawn.headCurve.keys[i - 1][1])
        throw new Error(`Head curve must not run backwards: ${label}`);
  }
  if (emitter.spawn.mode === "pathAnchored" && !emitter.spawn.headCurve)
    throw new Error(`Path-anchored spawn needs spawn.headCurve: ${label}`);
  if (emitter.shape.type === "path" && !emitter.shape.pathId)
    throw new Error(`Path emitter shape needs shape.pathId: ${label}`);
  if (emitter.shape.type === "layerInstances" && !emitter.shape.sourceLayerId)
    throw new Error(
      `Layer-instance emitter shape needs shape.sourceLayerId: ${label}`,
    );
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

  const paths = new Set<string>();
  for (const path of doc.paths) {
    if (paths.has(path.id)) throw new Error(`Duplicate path: ${path.id}`);
    paths.add(path.id);
  }
  const pathExists = (id: string, label: string) => {
    if (!paths.has(id)) throw new Error(`Missing path ${id}: ${label}`);
  };

  const assets = new Set<string>();
  for (const asset of doc.textures || []) {
    if (assets.has(asset.id)) throw new Error("Duplicate texture ID.");
    assets.add(asset.id);
  }
  const textureExists = (id: string) =>
    assets.has(id) || BUILTIN_TEXTURE_IDS.has(id);

  const ids = new Set<string>();
  const particleLayers = new Set<string>();
  // Kinds whose instances are hashed out of their own spec, so another layer
  // can borrow their sites without depending on draw order.
  const generatorLayers = new Set<string>();
  let particles = 0;
  for (const layer of doc.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate layer: ${layer.id}`);
    ids.add(layer.id);
    if (layer.kind === "particles") particleLayers.add(layer.id);
    if (layer.kind === "crystals" || layer.kind === "blob")
      generatorLayers.add(layer.id);
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
      if (layer.emitter.shape.pathId)
        pathExists(layer.emitter.shape.pathId, label);
      const source = layer.emitter.shape.sourceLayerId;
      if (source && layer.emitter.shape.type === "layerInstances") {
        if (source === layer.id)
          throw new Error(`Emitter cannot borrow its own instances: ${label}`);
        if (!generatorLayers.has(source))
          throw new Error(
            `Emitter source must be a crystals or blob layer: ${source}`,
          );
      }
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

    if (layer.kind === "blob") {
      if (!layer.blob) throw new Error(`Blob layer needs blob: ${label}`);
      blobChecks(layer.blob, label);
      if (layer.blob.count > BLOB_LOBE_BUDGET)
        throw new Error(
          `Blob lobe count exceeds ${BLOB_LOBE_BUDGET}: ${label}`,
        );
    } else if (layer.blob) {
      throw new Error(`Only blob layers carry blob: ${label}`);
    }
    if (layer.kind === "splash") {
      if (!layer.splash) throw new Error(`Splash layer needs splash: ${label}`);
      splashChecks(layer.splash, label);
    } else if (layer.splash) {
      throw new Error(`Only splash layers carry splash: ${label}`);
    }
    if (layer.kind === "ribbon") {
      if (!layer.ribbon) throw new Error(`Ribbon layer needs ribbon: ${label}`);
      ribbonChecks(layer.ribbon, label);
      pathExists(layer.ribbon.pathId, label);
      if (layer.ribbon.morph) pathExists(layer.ribbon.morph.pathId, label);
    } else if (layer.ribbon) {
      throw new Error(`Only ribbon layers carry ribbon: ${label}`);
    }
    if (layer.kind === "wireBurst") {
      if (!layer.wireBurst)
        throw new Error(`WireBurst layer needs wireBurst: ${label}`);
      wireBurstChecks(layer.wireBurst, label);
    } else if (layer.wireBurst) {
      throw new Error(`Only wireBurst layers carry wireBurst: ${label}`);
    }
    if (layer.kind === "crystals") {
      if (!layer.crystals)
        throw new Error(`Crystals layer needs crystals: ${label}`);
      crystalChecks(layer.crystals, label);
    } else if (layer.crystals) {
      throw new Error(`Only crystals layers carry crystals: ${label}`);
    }
    // The four surface features below read a real normal and a real world
    // position, which a billboard and the generated kinds do not have.
    if (layer.material && !(MESH_KINDS_V2 as readonly string[]).includes(layer.kind))
      for (const [name, value] of [
        ["lattice", layer.material.lattice],
        ["reveal", layer.material.reveal],
        ["planeGlow", layer.material.planeGlow],
        ["ripples", layer.material.ripples],
      ] as const)
        if (value)
          throw new Error(
            `material.${name} is for mesh layers (ring/shell/trail/beam/sprite/decal): ${label}`,
          );
    if (layer.jitter?.axis) checkUnit(layer.jitter.axis, `${label}/jitter.axis`);
    // A billboard has no surface normal of its own, so cel bands and an
    // inverted hull have nothing to shade or to inflate.
    if (layer.kind === "particles" && (layer.material?.toon || layer.material?.outline))
      throw new Error(
        `Particles are billboards and carry no toon or outline: ${label}`,
      );
    // One instanced draw cannot be split into three per-channel copies without
    // tripling the instance budget; the split is a mesh/wireBurst feature.
    if (layer.material?.rgbSplit && layer.kind === "particles")
      throw new Error(
        `material.rgbSplit is for mesh and wireBurst layers, not particles: ${label}`,
      );

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
      if (layer.geometry.type === "band" && !layer.geometry.band)
        throw new Error(`Band geometry needs geometry.band: ${label}`);
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
  // Above 1.0 the effect is wider than the frame; that is a deliberate crop for
  // an effect that cannot otherwise fill the shot, never a fix for a small one.
  if (doc.camera.framing > 1)
    warnings.push(
      `camera.framing ${doc.camera.framing.toFixed(2)} crops the effect; 0.6-1.0 is the normal range for a full-frame effect.`,
    );

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
    if (layer.blob) {
      const blob = layer.blob;
      // The generator's own volume, not where a lobe ends up: a column that
      // shoots out of frame is framed on the stack it grows from, the same way
      // a particle layer is framed on its spawn shape.
      size = Math.max(
        size,
        blob.spread * 2 + blob.radius[1] * 2,
        blob.height + blob.radius[1] * 2,
      );
    }
    if (layer.splash) size = Math.max(size, layer.splash.length[1] * 2);
    // A cluster spans the furthest tip on either side of its own centre.
    if (layer.crystals)
      size = Math.max(
        size,
        (layer.crystals.baseRadius + layer.crystals.length[1]) * 2,
      );
    if (layer.ribbon) {
      // The path the window slides along, not the window itself: a ribbon that
      // wraps a 0.8 m ring is a 1.6 m element however short its lit segment is.
      const path = doc.paths.find((p) => p.id === layer.ribbon!.pathId);
      if (path) size = Math.max(size, pathSpanV2(path));
    }
    if (layer.wireBurst)
      size = Math.max(
        size,
        (layer.wireBurst.radius +
          layer.wireBurst.travel +
          // A spoke reaches half again as far as an outline; see wire-burst-v2.
          layer.wireBurst.travel * 0.5) *
          2,
      );
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

/** Widest dimension of a path's own volume, in metres. Lint-only heuristic. */
function pathSpanV2(path: PathV2): number {
  if (path.type === "orbit")
    return Math.max(
      (path.radius + path.wobble.amplitude) * 2,
      Math.abs(path.height),
    );
  return Math.max(
    ...[0, 1, 2].map((axis) =>
      Math.max(path.from[axis], path.control[axis], path.to[axis]) -
      Math.min(path.from[axis], path.control[axis], path.to[axis]),
    ),
  );
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
      heightSpan: 2,
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
    proceduralParams: [0, 0, 0, 0],
    toon: null,
    outline: null,
    opaqueUntil: null,
    rgbSplit: null,
    reveal: null,
    lattice: null,
    planeGlow: null,
    ripples: null,
  };
}

export function defaultToon(): Toon {
  return {
    bands: 3,
    thresholds: [0.48, 0.74],
    shadow: "#2a1470",
    body: "#5a3ce0",
    highlight: "#a794f7",
    // Upper left, slightly toward the camera: the spike's fixed key light.
    light: [-0.474, 0.848, 0.236],
    rim: { power: 3, amount: 0.42 },
  };
}

export function defaultBlob(): Blob {
  return {
    arrangement: "mound",
    count: 11,
    seed: 1337,
    radius: [0.36, 0.54],
    spread: 1,
    height: 2.35,
    rise: 1.5,
    gravity: 0.6,
    drift: 0.18,
    grow: 6,
    stagger: [0, 0.13],
    life: [0.78, 0.78],
    squash: 1,
    bump: { amplitude: 0.16, frequency: 1.9, speed: 0.5 },
    comma: null,
  };
}

export function defaultSplash(): Splash {
  return {
    count: 8,
    seed: 4211,
    length: [1, 2.2],
    width: 0.3,
    curvature: 1.3,
    jaggedness: 0.5,
    spread: [0.66, 1.64],
    color: "#8a8a97",
    backing: "#40404c",
    scaleIn: [0, 0.16],
    detach: [0.35, 0.6],
    fade: [0.55, 0.85],
  };
}

export function defaultRibbon(): Ribbon {
  return {
    pathId: "orbit",
    window: {
      head: {
        keys: [
          [0, 0],
          [1, 1],
        ],
        ease: "smooth",
      },
      tail: 0.45,
    },
    strands: { count: 3, spread: 0.12, widthJitter: 0.45, phaseJitter: 0.1 },
    width: 0.13,
    taper: { head: 0.14, tail: 0.3 },
    morph: null,
    orientation: "camera",
    core: 1.5,
  };
}

export function defaultWireBurst(): WireBurst {
  return {
    shapes: 14,
    sides: [3, 4],
    radius: 0.55,
    travel: 1.1,
    scale: {
      keys: [
        [0, 0.35],
        [1, 1.35],
      ],
      ease: "smooth",
    },
    spokes: 10,
    seed: 7717,
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
      pathId: null,
      sourceLayerId: null,
    },
    spawn: {
      mode: "burst",
      window: 0.12,
      rate: 0,
      duration: 0,
      bursts: [],
      headCurve: null,
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
      planarDrag: 0,
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
      twinkle: null,
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
    taper: 1,
    vertexNoise: null,
    lightning: null,
    band: null,
  };
}

/** The ice spike's cluster, in the units the exemplar uses. */
export function defaultCrystals(): Crystals {
  return {
    count: 320,
    seed: 9173,
    direction: { elevation: [-30, 82], upBias: 0.45 },
    length: [0.12, 1.02],
    width: [0.03, 0.1],
    baseRadius: 0.3,
    groups: 3,
    stagger: [0, 0.16],
    growth: { duration: 0.3, overshoot: 1.7 },
    collapse: null,
    tipColor: "#13bbff",
    faceColor: "#9fd8ff",
    edgeColor: "#f2fcff",
    fresnelPower: 4,
    glint: { frequency: 3.4, speed: 1.15 },
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
      ambient: 1,
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
      glitch: null,
    },
    paths: [],
    textures: [],
  };
}

export function defaultsV2() {
  return {
    material: defaultMaterial(),
    emitter: defaultEmitter(),
    geometry: defaultGeometry(),
    blob: defaultBlob(),
    splash: defaultSplash(),
    ribbon: defaultRibbon(),
    wireBurst: defaultWireBurst(),
    crystals: defaultCrystals(),
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
// Structured Outputs needs every property required, so the wire copies drop the
// defaults and ask the model for the value.
export const RampWireSchema = RampSchema.extend({
  heightSpan: scalar(0.1, 12),
});
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
  ramp: RampWireSchema,
  mask: MaskWireSchema,
  noise: NoiseWireSchema.nullable(),
  erosion: ErosionWireSchema.nullable(),
  proceduralParams: num4,
  toon: ToonSchema.extend({ thresholds: num2, light: num3 }).nullable(),
  outline: OutlineSchema.nullable(),
  opaqueUntil: scalar(0, 1).nullable(),
  rgbSplit: RgbSplitSchema.nullable(),
  reveal: RevealSchema.nullable(),
  lattice: LatticeSchema.nullable(),
  planeGlow: PlaneGlowSchema.nullable(),
  ripples: z
    .array(RippleSchema.extend({ origin: num3.nullable() }))
    .max(RIPPLE_BUDGET_V2)
    .nullable(),
});
export const CrystalsWireSchema = CrystalsSchema.extend({
  direction: CrystalDirectionSchema.extend({ elevation: num2 }),
  length: num2,
  width: num2,
  stagger: num2,
});
export const RibbonWireSchema = RibbonSchema.extend({
  window: RibbonWindowSchema.extend({ head: CurveWireSchema }),
  morph: RibbonMorphSchema.extend({ curve: CurveWireSchema }).nullable(),
});
export const WireBurstWireSchema = WireBurstSchema.extend({
  sides: z.array(z.number().int()).length(2),
  scale: CurveWireSchema,
});
export const PathV2WireSchema = z.discriminatedUnion("type", [
  OrbitPathSchema.extend({ center: num3 }),
  BezierPathSchema.extend({ from: num3, control: num3, to: num3 }),
]);
export const BlobWireSchema = BlobSchema.extend({
  radius: num2,
  stagger: num2,
  life: num2,
});
export const SplashWireSchema = SplashSchema.extend({
  length: num2,
  spread: num2,
  scaleIn: num2,
  detach: num2,
  fade: num2,
});
export const EmitterWireSchema = EmitterSchema.extend({
  shape: EmitterShapeSchema.extend({
    axis: num3,
    size: num3,
    bias: num3,
    pathId: PathIdSchema.nullable(),
    sourceLayerId: z.string().max(48).nullable(),
  }),
  spawn: SpawnSchema.extend({ headCurve: CurveWireSchema.nullable() }),
  velocity: VelocitySchema.extend({
    speed: num2,
    direction: num3,
    speedCurve: CurveWireSchema.nullable(),
  }),
  life: num2,
  forces: ForcesSchema.extend({
    planarDrag: scalar(0, 6),
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
    twinkle: TwinkleSchema.nullable(),
  }),
  trail: TrailSchema.extend({ widthCurve: CurveWireSchema }).nullable(),
  sub: SubEmitterSchema.extend({ offset: num2 }).nullable(),
});
export const GeometryV2WireSchema = GeometryV2Schema.extend({
  taper: scalar(0.05, 1),
  band: BandSchema.nullable(),
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
  jitter: JitterSchema.extend({ axis: num3.nullable() }).nullable(),
  material: MaterialWireSchema.nullable(),
  emitter: EmitterWireSchema.nullable(),
  geometry: GeometryV2WireSchema.nullable(),
  light: LightSchema.extend({ intensity: CurveWireSchema }).nullable(),
  blob: BlobWireSchema.nullable(),
  splash: SplashWireSchema.nullable(),
  ribbon: RibbonWireSchema.nullable(),
  wireBurst: WireBurstWireSchema.nullable(),
  crystals: CrystalsWireSchema.nullable(),
  tracks: z
    .array(TrackV2Schema.extend({ keys: z.array(num2).min(2).max(12) }))
    .max(16),
});
// Measured cost of the "every key is required" wire contract, on the two live
// documents (11 and 10 layers): 15.3 kB / 12.8 kB minified, 40.4 kB / 31.0 kB
// at two-space indent, of which 88 / 84 keys are the explicit nulls this
// contract forces (trail, sub, flipbook, vortex, speedCurve, shake, pushIn,
// fresnel, noise, erosion, ...). Dropping them would save only 8.6% / 9.9% of
// the bytes, and Structured Outputs has no way to drop them: a property absent
// from `required` is rejected. So the contract stays as it is, and the output
// budget is sized for it instead — see maxOutput in api/local-vfx/route.ts,
// raised to 32000 after two beam candidates were truncated at 24000.
export const DocumentV2WireSchema = DocumentV2Schema.omit({
  textures: true,
}).extend({
  // Structured Outputs needs every property required, so the wire copy drops
  // the default and asks the model for the value.
  environment: EnvironmentSchema.extend({ ambient: scalar(0, 3) }),
  post: PostSchema.extend({
    glitch: GlitchSchema.extend({
      curve: CurveWireSchema,
      blockGrid: z.array(z.number().int()).length(2),
    }).nullable(),
  }),
  paths: z.array(PathV2WireSchema).max(PATH_BUDGET_V2),
  layers: z.array(LayerV2WireSchema).min(1).max(24),
});

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
    for (const slot of [
      "material",
      "emitter",
      "geometry",
      "light",
      "blob",
      "splash",
      "ribbon",
      "wireBurst",
      "crystals",
    ])
      if (next[slot] === null) delete next[slot];
    return next;
  });
  return validateDocumentV2({ ...wire, layers, textures });
}

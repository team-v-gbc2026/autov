import { z } from "zod";
import { GPU_BUDGET_V2, gpuCostV2 } from "./gpu-budget-v2";
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
/** Slack on a keyframe time, so a span that is a float subtraction still fits. */
const KEY_TIME_EPSILON = 1e-6;

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
  // Blinking helical arc ribbons around the layer's +Y axis (layer.arcs) and a
  // screen-space fan of thin quads out of the layer origin
  // (layer.streakBurst). Generators like the three above: their own spec
  // object, never `geometry` or `emitter`.
  "arcs",
  "streakBurst",
  // A flipped, washed copy of another mesh layer under the ground plane
  // (layer.reflection). It draws the SOURCE layer's own geometry and material,
  // so it can never drift out of step with what it reflects.
  "reflection",
  // Curved tapered opaque sheet meshes on a hashed multi-cadence schedule
  // (layer.sheets): the torn membranes of a water tail. Colour comes from
  // material.toon, not from material.ramp.
  "sheets",
  // The arc-window ribbon (layer.crescent): a strip swept along an arc whose
  // head and tail are two curves, drawn once per tonal copy, with a Voronoi
  // erosion front eating the tail. The blade of a slash.
  "crescent",
  // Flat cel flame strips anchored to a crescent's erosion front
  // (layer.licks), re-hashed on a flipbook step.
  "licks",
] as const;
export const BLOB_ARRANGEMENTS = [
  "mound",
  "column",
  "ring",
  "string",
  // Lobes on a plane ring band orbiting the layer's own centre, and lobes
  // anchored at fixed parameters of a document path. Both need a field the
  // other arrangements do not: see BlobSchema.
  "orbit",
  "path",
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
export const RAMP_SPACES = [
  "life",
  "layerTime",
  "surface",
  "height",
  // Distance from the layer centre over geometry.radius (0 centre, 1 rim):
  // the centre-to-haze palette of a swirl disc.
  "radial",
  // The particle's OWN quad: 0 at the bottom (the tail of a velocity-stretched
  // sprite), 1 at the top (its head). One particle carries the whole gradient,
  // so a population is never one flat colour however many of them there are.
  "sprite",
] as const;
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
  // Two more billboard silhouettes, both with a radial cutoff so the card's own
  // rectangle can never show: an anamorphic lens flare (core, ghosts, the two
  // lens streaks and soft spikes) and a fan of hashed radial rays. Both also
  // supply the ramp key themselves, radially: stop t=0 is the hot core and t=1
  // the outer halo.
  "lensFlare",
  "radialRays",
  // A polar-swirl disc (material.swirl refines it) and the tapered speed-line
  // cap of a velocity-stretched sprite. The first is a surface pattern on a
  // disc, the second a billboard silhouette anchored at its leading point.
  "swirlDisc",
  "teardropStreak",
  // Drawn SYMBOLS: flat graphic glyphs with a fill, a thick outline and (for
  // the star) a hot inner copy, all read off material.symbol rather than off
  // the ramp. They are billboard silhouettes like star4/softRadial, but unlike
  // every other pattern they are opaque shapes with an ink line, which is what
  // a cartoon impact is made of.
  //   starSolid  [points, inner ratio, outline width, hot core ratio]
  //              (the existing "star" is the thin 5-point pointed glint; this
  //              is the solid, outlined, screentoned one)
  //   face       [expression count, outline width, ear size, muzzle 0..1]
  //   heart      [outline width, -, -, -]
  //   crescent   [outline width, bite offset, -, -]
  //   cloudLobe  [lobes, lobe radius, -, -]
  //   bolt       [width, taper, -, -]
  "starSolid",
  "face",
  "heart",
  "crescent",
  "cloudLobe",
  "bolt",
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
  // A view-space billboard whose long axis is pinned to the layer's local +Z:
  // `length` runs along that axis, `thickness` is its FULL height across it,
  // and geometry.slab tiers it into hard-edged bands. The readable body of a
  // beam and of an energy column.
  "slab",
  // A rounded-rectangle frame strip: `length` is its height, `radius` its
  // half-width and `thickness` the bar width, with geometry.frame exposing a
  // normalised perimeter coordinate the reveal, the stripes and the beads all
  // run along. The doorway of a portal.
  "frame",
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
  // Instances SCATTER along a document path at hashed u (not at i/(count-1)),
  // spread across the path frame by shape.radius: the residue left lying along
  // a line after a beam has shut off, rather than an ordered row.
  "pathLine",
  // The perimeter of a rectangle of half-extent (shape.radius, shape.length/2)
  // in the emitter's own XY plane, with shape.interiorFraction of the
  // population scattered INSIDE it instead: a portal's edge-biased sparks.
  "frame",
  // A ring band between shape.innerRadius and shape.radius in the plane
  // perpendicular to shape.axis: the orbit lane dark flecks ride.
  "orbit",
  // An evenly spaced radial fan in the plane across shape.axis: instance i sits
  // at shape.innerRadius along heading 2*PI*i/count, jittered by
  // shape.angleJitter and leaned by shape.angleBias. The burst of slivers a
  // slash throws at the end of its sweep.
  "radialFan",
] as const;
export const SPAWN_MODES = [
  "burst",
  "continuous",
  "bursts",
  // Instance i is born the moment emitter.spawn.headCurve passes its own u.
  "pathAnchored",
  // Instance i is born at the moment its own path's head reaches the end (the
  // impact), staggered inside spawn.window. See spawn.originsFromPath.
  "event",
  // The instance owns a hashed parameter along a crescent layer's arc
  // (spawn.sourceLayerId) and is born the moment that crescent's TAIL front
  // passes it, taking the arc point as its origin. The embers a tearing blade
  // leaves behind it, in the order the tear happens.
  "frontAnchored",
] as const;
export const VELOCITY_MODES = [
  "radial",
  "directional",
  "tangential",
  "cone",
  // The particle does not fly: it RUNS along emitter.shape.pathId. The shared
  // head envelope is velocity.speedCurve sampled on the LAYER's own 0..1
  // progress, and velocity.speed is re-read as the per-particle lag band in
  // path units, so u = clamp(head - lag). shape.radius still scatters it.
  "alongPath",
  // The particle CIRCLES the emitter axis at its own spawn radius: angular
  // speed is velocity.speed[1] * r^-0.5 (so the inner lane laps the outer one),
  // plus a small out-of-plane bob hashed per instance.
  "orbit",
] as const;
export const RENDER_MODES = [
  "billboard",
  "velocityStretch",
  "horizontal",
  "vertical",
  // Quad rolled to the screen-space tangent of its path: the dashes of a
  // path-anchored trail lie along the flight line instead of upright.
  "pathAligned",
  // A tapered flat cel "lick" instead of a quad: the instance is drawn as a
  // strip trailing back along the emitter axis in view space, its length,
  // width, lateral offset and waviness re-hashed on floor(t * strip.stepRate)
  // so the set jumps like a flipbook instead of sliding. See emitter.render.
  "flatStrip",
  // A tapered, jagged-edged SLIVER (emitter.render.sliver) drawn in the screen
  // plane, rooted at the instance and pointing along its own heading: the star
  // lines of a cartoon impact and the radial needles of a slash burst. It is
  // the splash sliver's silhouette on an instanced draw, which is why it is a
  // render MODE and not a geometry type — particles carry no geometry.
  "sliver",
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
/**
 * Layer kinds whose hero is a MESH VOLUME rather than a particle spray. A
 * particle hero is framed loosely on purpose — the spray reaches well past the
 * spawn shape, and tightening the camera crops the sparks. A blob column, a
 * crystal cluster, a blade, a rim or a ribbon is the whole silhouette: framed
 * at the particle-era 0.45-0.7 it renders as a model on a table.
 */
export const MESH_HERO_KINDS_V2 = new Set([
  "blob",
  "crystals",
  "crescent",
  "ribbon",
]);
/** Layers that are dressing, never the thing the camera is framing. */
export const HERO_EXCLUDED_KINDS = new Set([
  "light",
  "decal",
  "splash",
  "reflection",
]);
/**
 * Framing a mesh-hero document is AUTHORED at: the band every such exemplar
 * sits in, and what the guide asks for.
 */
export const MESH_HERO_FRAMING_MIN = 0.85;
/**
 * Framing below which a mesh hero is certainly wrong, which is what the lint
 * warns on. It is lower than the authored band on purpose: the portal exemplar
 * frames its 1.6 x 2.4 doorway at 0.80, and a lint that fires on an accepted
 * exemplar teaches the model to distrust the lint. Everything the live runs
 * actually got wrong (0.65 on a three-metre plume) is well below it.
 */
export const MESH_HERO_FRAMING_LINT = 0.8;
/** Named paths one document may declare; every path costs uniforms per layer. */
export const PATH_BUDGET_V2 = 6;
/** Strands one ribbon layer may sweep; each is its own tapered strip. */
export const RIBBON_STRAND_BUDGET = 6;
/** Sheets one layer may generate; each is its own curved mesh and draw call. */
export const SHEET_BUDGET_V2 = 48;
/** Size classes one sheets layer may declare; each carries its own cadence. */
export const SHEET_CLASS_BUDGET_V2 = 3;
/** Tonal copies one crescent may stack; each is a full strip draw. */
export const CRESCENT_TONAL_BUDGET_V2 = 4;
/** Cel licks one layer may peel off a front; each is its own instanced strip. */
export const LICK_BUDGET_V2 = 24;

// --- curves and ramps ------------------------------------------------------

// Normalized domain 0..1; the meaning of the domain depends on the field
// (particle life, layer time, distance along a mesh axis, ...).
// Declarative, bounded formulas. They compile exactly to the existing piecewise
// curve evaluator, so CPU integration and GPU playback share one representation.
// Only `start` is common to every kind: a constant needs nothing else, ramp and
// smooth need `end`, and envelope alone reads `peak`/`attack`/`release`. The
// unused fields stay optional so a model-authored `{kind:"ramp",start,end}` is
// not rejected for omitting the envelope terms.
export const CurveFormulaSchema = z
  .object({
    kind: z.enum(["constant", "ramp", "smooth", "envelope"]),
    start: scalar(-20, 20),
    // nullable as well as optional: the structured-output contract sent to the
    // model accepts null but not absent keys.
    end: scalar(-20, 20).nullable().optional(),
    peak: scalar(-20, 20).nullable().optional(),
    attack: scalar(0.001, 0.499).nullable().optional(),
    release: scalar(0.501, 0.999).nullable().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.kind !== "constant" && f.end == null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: `${f.kind} needs end` });
    if (f.kind === "envelope")
      for (const key of ["peak", "attack", "release"] as const)
        if (f[key] == null)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `envelope needs ${key}` });
  });
export type CurveFormula = z.infer<typeof CurveFormulaSchema>;
export function compileCurveFormula(f: CurveFormula): { keys: [number, number][]; ease: "linear" | "smooth" } {
  const end = f.end ?? f.start;
  if (f.kind === "constant") return { keys: [[0, f.start], [1, f.start]], ease: "linear" };
  if (f.kind === "envelope") {
    const peak = f.peak ?? end, attack = f.attack ?? 0.25, release = f.release ?? 0.75;
    return { keys: [[0, f.start], [attack, peak], [release, peak], [1, end]], ease: "smooth" };
  }
  return { keys: [[0, f.start], [1, end]], ease: f.kind === "smooth" ? "smooth" : "linear" };
}

export const CurveSchema = z
  .object({
    formula: CurveFormulaSchema.nullable().optional(),
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
//   line    a straight segment from -> to: a beam's own axis, which the shut-off
//           sparkle run and the residual scatter both read.
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

export const LinePathSchema = z
  .object({
    id: PathIdSchema,
    type: z.literal("line"),
    from: vec3,
    to: vec3,
  })
  .strict();

export const PathV2Schema = z.discriminatedUnion("type", [
  OrbitPathSchema,
  BezierPathSchema,
  LinePathSchema,
]);

export const RampStopSchema = z
  .object({ t: scalar(0, 1), color: hex, intensity: scalar(0, 8) })
  .strict();

// A SECOND key space mixed into the ramp key: key = mix(primary, secondary,
// weight). One ramp then answers to two things at once — "rises while turning
// blue to green (height) and fades with age (life)" is one ramp, not two
// layers — which is the cheapest way out of a population that reads as one
// flat colour.
export const RampBlendSchema = z
  .object({
    space: z.enum(RAMP_SPACES),
    weight: scalar(0, 1),
  })
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
    // Defaulted, so documents authored before the blend existed still load.
    blend: RampBlendSchema.nullable().default(null),
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
    // Where the BODY band's colour comes from. "fixed" is the original three
    // flat hexes. "ramp" takes the body colour from material.ramp, evaluated at
    // the fragment in the ramp's own space (height, radial, life, layerTime,
    // plus material.ramp.blend), and derives the other two bands from it:
    //   shadow    = body * shadowScale, nudged toward toon.shadow
    //   highlight = mix(body, toon.highlight, highlightMix)
    // so the cluster still posterises into the same bands while the base colour
    // grades continuously across height or radius. It is the fix for a lobe
    // population that reads as two or three flat tones — used gently, it keeps
    // the banded look and only stops the bands being CONSTANT.
    // All three defaulted, so documents authored before it existed still load.
    colorSource: z.enum(["fixed", "ramp"]).default("fixed"),
    shadowScale: scalar(0, 1).default(0.55),
    highlightMix: scalar(0, 1).default(0.35),
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
//   "perimeter" the frame's own perimeter coordinate (0 at bottom-centre, 1 at
//             top-centre, mirrored in x) — a doorway drawing itself up both
//             sides at once. geometry.type "frame" only.
// Values outside 0..1 are allowed and are how a reveal finishes early inside a
// longer layer: a front that has passed 1 leaves the whole surface revealed.
// `frontWidth` is the width of the bright leading band, in the same key.
export const RevealSchema = z
  .object({
    mode: z.enum(["radial", "scan", "perimeter"]),
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

// Hard panning bands keyed on the layer's ALONG coordinate (vAlong x the
// geometry's own length, so `frequency` is bands per metre and a beam that
// extends does not squash its stripes).
//
// `phase` is how far each circumferential RING is offset from its neighbours,
// hashed off the ring index: 0 runs the bands straight round the body — a
// machine segment ladder — and 1 breaks them into independent filaments that
// read as energy rather than as a barcode painted on a cylinder.
//
// `contrast` is how much of the surface the bands take over: the largest
// contrast across the list is the mix weight, so a core at 0.2 keeps a solid
// body with a hint of motion and a sheath at 1.0 is nothing but bands.
export const StripeSchema = z
  .object({
    frequency: scalar(0, 64),
    speed: scalar(-40, 40),
    phase: scalar(0, 1),
    // 0 = a soft sine swell, 1 = an edge about a hundredth of a band wide.
    sharpness: scalar(0, 1),
    contrast: scalar(0, 2),
  })
  .strict();

/** Stripe sets one material may carry; each costs two uniform slots. */
export const STRIPE_BUDGET_V2 = 3;

// Hashed STEP flicker on the layer's own intensity: the multiplier is constant
// inside each 1/rate window and re-hashed on floor(layerTime * rate), which is
// what reads as an unstable arc rather than the breathing a sine pulse gives.
// The multiplier stays centred on 1 (1 - amount/2 .. 1 + amount/2).
export const FlickerSchema = z
  .object({ rate: scalar(0.5, 60), amount: scalar(0, 1) })
  .strict();


// --- frame rim -------------------------------------------------------------
//
// The double-line rim look, read off the signed distance to the frame's own
// rounded rectangle (or to a ring's circle): a solid bar, a hot spine down the
// middle of it, a thinner parallel line inside it, and up to three exponential
// halo skirts around the lot.
//
// Colour comes from material.ramp, sampled at four fixed keys so one ramp
// carries the whole rim: 0 is the SPINE, 0.22 the CORE bar, 0.45 the INNER
// line and 1 the HALO. Every distance is in metres.
export const SdfHaloSchema = z
  .object({ falloff: scalar(0.002, 2), weight: scalar(0, 2) })
  .strict();

/** Halo skirts one rim may carry; each is one exponential in the fragment. */
export const SDF_HALO_BUDGET_V2 = 3;

export const SdfLineSchema = z
  .object({
    // Weight of the solid bar itself (geometry.thickness wide).
    core: scalar(0, 2),
    // Gaussian half-width of the hot centre line, in metres. 0 is no spine.
    spine: scalar(0, 0.5),
    // Metres inside the centreline the thinner parallel line sits, and its own
    // gaussian half-width. A width of 0 is no inner line.
    innerOffset: scalar(0, 1),
    innerWidth: scalar(0, 0.5),
    halo: z.array(SdfHaloSchema).max(SDF_HALO_BUDGET_V2),
  })
  .strict();

// Travelling brightness beads running the perimeter (or the ring): `count`
// gaussian bumps at hashed offsets, sliding at `speed` perimeters a second,
// `width` of the perimeter wide. They brighten the rim; they never draw alone.
export const BeadsSchema = z
  .object({
    count: integer(0, 8),
    speed: scalar(-4, 4),
    width: scalar(0.005, 0.4),
  })
  .strict();

// --- flow ------------------------------------------------------------------
//
// A multi-layer panning noise SURFACE: up to four value-noise fields at their
// own scale, pan and rotation, mixed by `mix` (weights, normalised), then cut
// into patches by `threshold`/`softness`. Set on a material it REPLACES
// material.noise as the surface field, and a ramp of space "surface" is keyed
// by the resulting mask instead of by the along coordinate — so stop t=0 is
// the open surface and t=1 the patch that covers it.
//
// `parallax` offsets the SLOWEST layer by the view direction, which is the
// whole reason a flat card reads as having an interior behind it.
export const FlowLayerSchema = z
  .object({
    scale: scalar(0.05, 32),
    pan: uv,
    rotate: scalar(-Math.PI, Math.PI),
  })
  .strict();

/** Noise layers one flow may stack; each is one value-noise fetch per pixel. */
export const FLOW_LAYER_BUDGET_V2 = 4;

export const FlowSchema = z
  .object({
    layers: z.array(FlowLayerSchema).min(1).max(FLOW_LAYER_BUDGET_V2),
    mix: z.array(scalar(0, 1)).min(1).max(FLOW_LAYER_BUDGET_V2),
    threshold: scalar(0, 1),
    softness: scalar(0.001, 1),
    parallax: scalar(0, 0.5),
  })
  .strict();

// --- swirl -----------------------------------------------------------------
//
// The polar-swirl disc (material.procedural "swirlDisc"): angle is sheared by
// twist/(distance + eps) so a noise field becomes spiral bands, an explicitly
// wound log spiral makes the ARMS read, and a second, tighter, independently
// wound spiral shades the bands from inside.
//
// material.proceduralParams is the disc's base shape, [twist, spin (turns a
// second), inflow (how fast the sampled radius creeps outward), arms]; the
// fields below refine it. `strength` is the swirl envelope over the layer's own
// 0..1 progress: 0 is straight noise, 1 a tight spiral, so a reveal winds it up
// and a dissipate unwinds it.
export const SwirlBandsSchema = z
  .object({
    // Arms the band mask draws. Overrides proceduralParams[3] when set above 0.
    arms: scalar(0, 12),
    // How hard the arms wind with log(distance).
    wind: scalar(0, 6),
    // Width of the lit part of one arm, as a fraction of its period.
    width: scalar(0.02, 1),
    // How much the noise wiggles the arms off a perfect spiral.
    warp: scalar(0, 4),
  })
  .strict();

export const SwirlDetailSchema = z
  .object({
    arms: scalar(0, 24),
    wind: scalar(0, 8),
    warp: scalar(0, 12),
    // How hard the detail spiral darkens the troughs it cuts.
    contrast: scalar(0, 2),
  })
  .strict();

// The cauliflower edge: two noise octaves at these scales, mixed in at
// `amount`, which is what breaks the mask's rim into lobes instead of a circle.
export const SwirlLobeSchema = z
  .object({
    scale1: scalar(0.1, 12),
    scale2: scalar(0.1, 24),
    amount: scalar(0, 2),
  })
  .strict();

export const SwirlSchema = z
  .object({
    bands: SwirlBandsSchema,
    detail: SwirlDetailSchema,
    lobe: SwirlLobeSchema,
    strength: CurveSchema,
  })
  .strict();

// --- surface line work -----------------------------------------------------
//
// Two fields that draw ON the ramp key rather than replacing it, both meant for
// a closed body (a shell, a teardrop): thin hard bands, and a second, higher
// frequency field that darkens narrow creases.
//
// `radiate` is the difference between rings and speed lines: false runs the
// bands round the body at `frequency` per unit of the along coordinate (a
// ripple ladder), true keys them on the ANGULAR coordinate so they radiate back
// from the nose, which is what reads as a skin of flowing water rather than as
// a barcode. `segmentation` breaks each band into pieces with a second noise
// field, so a line is a crease and not a painted ring; `fadeAlong` is the band
// of the along coordinate they live in.
export const StreaksSchema = z
  .object({
    space: z.literal("surface"),
    frequency: scalar(0, 32),
    // Bands a second the pattern pans, along the coordinate it keys on.
    pan: scalar(-8, 8),
    // Half-width of one band, in the key's own units.
    width: scalar(0.001, 0.3),
    // 0 = unbroken lines, up to 8 = chopped into short segments.
    segmentation: scalar(0, 8),
    color: hex,
    intensity: scalar(0, 8),
    // The band of the along coordinate the streaks live in.
    fadeAlong: range(0, 1),
    radiate: z.boolean(),
  })
  .strict();

// A second, higher-frequency surface field that MULTIPLIES the ramp colour
// down inside its troughs: the narrow dark folds that make a smooth body read
// as a faceted one. `alongStart` is where along the axis the creases begin, so
// a nose stays clean.
export const CreasesSchema = z
  .object({
    frequency: scalar(0, 32),
    depth: scalar(0, 1),
    alongStart: scalar(0, 1),
  })
  .strict();

// A comic halftone lattice inside whatever the material draws. `pitch` is the
// cell size — in WORLD metres for space "world" (so the dots keep their size as
// the shape scales, which is what a printed screen does) or in UV for "uv".
export const ScreentoneSchema = z
  .object({
    pitch: scalar(0.002, 0.5),
    color: hex,
    space: z.enum(["world", "uv"]),
  })
  .strict();

// Colours for the drawn-symbol procedurals (starSolid, face, heart, crescent,
// cloudLobe, bolt). A symbol is a fill inside an ink outline, so it does not
// take its colour from the ramp the way every other pattern does: two flat
// hexes and, for the star, a hot inner copy on its own alpha track over the
// layer's own 0..1 progress — which is how the flash can cut while the outlined
// shell keeps reading.
export const SymbolSchema = z
  .object({
    fill: hex,
    outline: hex,
    // A lighter accent used for the lit side of a face and for ear inners.
    highlight: hex,
    // Ink: eyes, mouths, the dark side of a glyph.
    ink: hex,
    hot: z
      .object({ color: hex, intensity: scalar(0, 8), alpha: CurveSchema })
      .strict()
      .nullable(),
  })
  .strict();
export const SHADING_MODES_V2 = ["unlit", "litSmoke"] as const;

export const MaterialSchema = z
  .object({
    shading: z.enum(SHADING_MODES_V2).default("unlit"),
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
    // The beam/column vocabulary. Both defaulted, so archived documents load
    // unchanged: panning hard bands along the layer's axis, and a hashed step
    // flicker on its intensity.
    stripes: z
      .array(StripeSchema)
      .max(STRIPE_BUDGET_V2)
      .nullable()
      .default(null),
    flicker: FlickerSchema.nullable().default(null),
    // The portal/vortex vocabulary. All defaulted, so archived documents load
    // unchanged: the double-line rim and its beads on a frame or a ring, the
    // multi-layer panning flow surface, and the polar swirl of a disc.
    sdfLine: SdfLineSchema.nullable().default(null),
    beads: BeadsSchema.nullable().default(null),
    flow: FlowSchema.nullable().default(null),
    swirl: SwirlSchema.nullable().default(null),
    // The water/playful vocabulary. All defaulted, so archived documents load
    // unchanged: hard surface bands and creases on a closed body, a halftone
    // lattice, and the two flat colours a drawn symbol is made of.
    streaks: StreaksSchema.nullable().default(null),
    creases: CreasesSchema.nullable().default(null),
    screentone: ScreentoneSchema.nullable().default(null),
    symbol: SymbolSchema.nullable().default(null),
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
    // Shape "frame" only: the fraction of the population scattered INSIDE the
    // rectangle instead of on its perimeter. 0 is a pure rim spray.
    interiorFraction: scalar(0, 1).default(0),
    // Shape "radialFan" only: how far each heading may wander off its even
    // slot, and how hard the fan leans. `angleBias` both compresses the fan
    // (an even ring reads as a clock face) and rotates it, so a positive bias
    // is a burst thrown upward. Defaulted, so archived documents load
    // unchanged.
    angleJitter: scalar(0, Math.PI).default(0),
    angleBias: scalar(-1, 1).default(0),
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
    // Spawn mode "event": every instance is born at the moment a path's head
    // reaches the END of that path, and takes the path's end point as its
    // ORIGIN. With emitter.shape.pathId set, every instance uses that one path;
    // with it null, instance i takes document path i % paths.length, so one
    // layer covers every impact in the document. The stagger inside the event
    // is spawn.window, hashed per instance. Defaulted, so archived documents
    // load unchanged.
    originsFromPath: z.boolean().default(false),
    // Spawn mode "frontAnchored": the crescent layer whose tail front the
    // instances are born behind. Instance i owns a hashed parameter s along
    // that crescent's arc and is born when the tail curve reaches s, at the arc
    // point — so the embers appear in the order the blade tears, with no time
    // table anywhere. Defaulted, so archived documents load unchanged.
    sourceLayerId: z.string().max(48).nullable().default(null),
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

// render.mode "flatStrip": the instance is a tapered flat cel lick trailing
// back along the emitter's own axis in view space, not a quad. Its length,
// width, lateral offset inside emitter.shape.radius and its wave are all
// re-hashed on floor(layerTime * stepRate), so the whole set JUMPS on a
// flipbook step instead of sliding — which is what separates a hand-drawn lick
// from a stretched sprite.
//
// `palettes` 2 splits the population by instance parity: the even instances
// take ramp stop t=0 and the odd ones t=1, and because they are one instanced
// draw in index order the odd (light) licks always land in front of the even
// (dark) ones. `palettes` 1 draws them all at stop t=0.
export const StripSchema = z
  .object({
    length: range(0.05, 8),
    width: range(0.02, 3),
    waviness: scalar(0, 1),
    stepRate: scalar(0, 60),
    palettes: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

// render.mode "sliver": the instance is a flat, tapered, jagged-edged needle in
// the screen plane, rooted at its own position and pointing along its heading —
// the splash sliver's silhouette on an instanced draw. `curve` is the sideways
// bow at the tip as a fraction of the length (its sign is hashed per instance),
// `taper` the exponent of the (1-t) width falloff (high = a fat root and a
// needle tip) and `jaggedness` the depth of the hashed notches on each edge.
export const SliverRenderSchema = z
  .object({
    length: range(0.05, 8),
    width: range(0.005, 1),
    curve: scalar(0, 1),
    taper: scalar(0.2, 4),
    jaggedness: scalar(0, 1),
  })
  .strict();

// The retract a star line does instead of fading: over [start,end] of the
// particle's own life the sliver's INNER end travels outward while its length
// collapses, so the ray shortens from the middle of the burst outward and the
// core stays readable. `from` picks which end is eaten.
export const RetractSchema = z
  .object({
    start: scalar(0, 1),
    end: scalar(0, 1),
    from: z.enum(["root", "tip"]),
  })
  .strict();

// Short secondary sparks strung along each sliver: `perInstance` extra needles
// per instance, `length` of one of them as a fraction of its parent's, scattered
// over `along` of the parent's own length. One extra instanced draw, not a
// second layer, so they can never drift off the ray they belong to.
export const SecondarySchema = z
  .object({
    perInstance: integer(0, 4),
    length: scalar(0.01, 1),
    along: range(0, 1),
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
    twinkle: TwinkleSchema.nullable().default(null),
    // render.mode "flatStrip" only. Defaulted, so archived documents load
    // unchanged.
    strip: StripSchema.nullable().default(null),
    // Where the quad sits relative to the instance position. "center" is the
    // ordinary billboard; "head" puts the LEADING point of a
    // velocity-stretched sprite at the instance, so the card trails behind it —
    // which is what a speed-line cap needs (the tip is the meteor, the streak
    // is where it has been). Defaulted, so archived documents load unchanged.
    anchor: z.enum(["center", "head"]).default("center"),
    // render.mode "sliver" only, plus the two things a sliver does that a quad
    // cannot. All defaulted, so archived documents load unchanged.
    sliver: SliverRenderSchema.nullable().default(null),
    retract: RetractSchema.nullable().default(null),
    secondary: SecondarySchema.nullable().default(null),
  })
  .strict();

/**
 * A ribbon trail's own colour. "along" runs the key down the ribbon — 0 at the
 * head (the particle itself), 1 at the tail — so a streamer can be hot where it
 * is being drawn and cold where it is dying; "life" keys it on the particle's
 * age exactly as the sprite does. Without it the trail borrows material.ramp
 * keyed on life, and the whole ribbon is one colour at any instant.
 */
export const TRAIL_RAMP_SPACES = ["along", "life"] as const;
export const TrailRampSchema = z
  .object({
    space: z.enum(TRAIL_RAMP_SPACES),
    stops: z.array(RampStopSchema).min(2).max(6),
  })
  .strict();

export const TrailSchema = z
  .object({
    segments: integer(2, 16),
    spacing: scalar(0.005, 0.2),
    // Width down the ribbon, sampled at the same 0 head -> 1 tail key the
    // "along" ramp uses: a taper to 0 is what stops a trail reading as a bar.
    widthCurve: CurveSchema,
    textureId: z.string().max(48).nullable(),
    // Defaulted, so documents authored before the trail ramp existed still load.
    ramp: TrailRampSchema.nullable().default(null),
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

// geometry.type "slab": the body of a beam or of an energy column, as a
// view-space billboard whose LONG axis is the layer's local +Z projected to the
// screen. It never shears when the axis tilts away from the camera and it never
// turns edge-on, which is exactly what a real tube does at a grazing angle.
//
// The tiers are what make it read as a BAR: each is a hard-edged band at its own
// half-height (metres from the axis, so they are authored in the same units as
// geometry.thickness/2), with an edge 8% of that height wide. A gaussian slab of
// the same width reads as fog. They are listed OUTERMOST FIRST: each later tier
// paints over the one before it, so the last entry is the hot inner core.
export const SlabTierSchema = z
  .object({ height: scalar(0.001, 6), color: hex, intensity: scalar(0, 8) })
  .strict();

/** Tiers one slab may carry; each is three smoothsteps in the fragment. */
export const SLAB_TIER_BUDGET_V2 = 4;

export const SlabSchema = z
  .object({
    // "center" spans -length/2 .. +length/2 about the layer origin; "base"
    // spans 0 .. length along +Z from it (an upright column stands on it).
    anchor: z.enum(["center", "base"]),
    tiers: z.array(SlabTierSchema).min(1).max(SLAB_TIER_BUDGET_V2),
    // The far end's height as a fraction of the near end's; 1 is a plain bar.
    taper: scalar(0.05, 1),
  })
  .strict();

// geometry.type "frame": a rounded-rectangle strip standing in the layer's own
// XY plane. geometry.length is its HEIGHT, geometry.radius its HALF-WIDTH and
// geometry.thickness the width of the bar itself; `corner` is the corner round
// in metres. The strip exposes a normalised PERIMETER coordinate — 0 at
// bottom-centre, 1 at top-centre, mirrored in x — which material.reveal
// (mode "perimeter"), material.stripes and material.beads all run along, so a
// doorway draws itself up both sides at once from one field.
export const FrameSchema = z
  .object({
    corner: scalar(0, 1),
    perimeterOrigin: z.literal("bottom"),
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
    // type "slab" only: how the billboard bar is anchored and tiered.
    // Defaulted, so archived documents load unchanged.
    slab: SlabSchema.nullable().default(null),
    // type "frame" only: the corner round and where the perimeter coordinate
    // starts. Defaulted, so archived documents load unchanged.
    frame: FrameSchema.nullable().default(null),
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

// --- arcs ------------------------------------------------------------------
//
// Camera-facing ribbon polylines on helical paths around the layer's own +Y
// axis: the electrical cage around an overloading column. A GENERATOR like
// crystals and wireBurst — every arc's radius, pitch, height, span and phase are
// hashed out of (arcs.seed, index) AND out of its own blink cycle index, so no
// two flashes of the same arc trace the same wire.
//
// Nothing accumulates: the cycle index is floor((layerTime - offset) / period),
// which is what makes a seek land inside exactly the blink playback was in.
export const ArcJitterSchema = z
  .object({
    // How far the wire wanders off its helix, as a fraction of the radius.
    amplitude: scalar(0, 3),
    // Harmonics of the wander along the arc; higher is a busier wire.
    frequency: scalar(0.5, 64),
    // 0 = the wire curls smoothly, 1 = the noise is folded (|n|) so it KINKS.
    fold: scalar(0, 1),
  })
  .strict();

export const ArcBlinkSchema = z
  .object({
    // Seconds between one arc's blinks, hashed inside the band.
    period: range(0.02, 4),
    // Seconds it stays lit inside that period, hashed inside the band.
    onTime: range(0.01, 2),
    // Fraction of cycles dropped outright, so the set never finds a rhythm.
    skipChance: scalar(0, 1),
  })
  .strict();

export const ArcsSchema = z
  .object({
    count: integer(1, 64),
    // Helix radius band, in metres.
    radius: range(0.02, 8),
    // Turns one arc makes over its own span.
    pitch: range(0, 6),
    // Metres of height the population covers: bases spread over the lower 74%
    // of it and each arc runs 18-55% of it upward from its own base.
    span: scalar(0.05, 12),
    jitter: ArcJitterSchema,
    blink: ArcBlinkSchema,
    // Full ribbon width in metres. The renderer also enforces a minimum
    // screen-space width, so a thin arc never drops below a visible line.
    width: scalar(0.002, 0.4),
    // The filament and the sheath around it. An arcs layer takes its colour
    // from these, never from material.ramp.
    coreColor: hex,
    haloColor: hex,
    seed: integer(0, 2147483647),
  })
  .strict();

// --- streakBurst -----------------------------------------------------------
//
// A screen-space fan of thin additive quads leaving the layer origin: the
// radial speed lines of an eruption. A generator again — heading, length,
// width, curvature, hue and stagger are hashed out of (seed, index).
//
// The fan CLUMPS: `bundles` headings are hashed first and every streak picks one
// and scatters inside `bundleSpread` radians of it, because an even fan reads as
// a lens star rather than as a burst.
export const StreakBurstSchema = z
  .object({
    count: integer(4, 200),
    length: range(0.1, 12),
    width: range(0.005, 1),
    // Sideways bow at the tip, as a fraction of the streak's own length.
    curvature: scalar(0, 1),
    // Added to the heading's screen-space y before it is renormalized: the
    // burst leans up (or, negative, down).
    upBias: scalar(-1, 1),
    bundles: integer(1, 16),
    bundleSpread: scalar(0, 2),
    // Fraction of the grow envelope the latest streak lags behind the first.
    stagger: scalar(0, 1),
    // Radial spread over the LAYER's own 0..1 progress.
    grow: CurveSchema,
    // Three hues hashed per streak, so the burst is a spread not one colour.
    hues: z.tuple([hex, hex, hex]),
    seed: integer(0, 2147483647),
  })
  .strict();

// --- collapse --------------------------------------------------------------
//
// One retraction applied UNIFORMLY to a layer, so every part of a composite
// column (shell, slab, core, arcs) shrinks in step instead of each carrying its
// own tracks and drifting apart. From `start` (layer-local seconds) over
// `duration`, the two curves give a height factor along the layer's own axis and
// a width factor across it:
//
//   mesh kinds   geometry.length x= height; geometry.radius/thickness x= width
//   arcs         arcs.span x= height; arcs.radius x= width
//   everything   transform.scale x= (width, height, width)
//   else
//
// anchor is "base": the layer keeps its position, so a body authored with its
// base at the layer origin retracts from the TOP. That is the only anchor there
// is, and it is what "reduce the column" means.
export const CollapseSchema = z
  .object({
    start: localTime,
    duration: scalar(0.02, 12),
    heightCurve: CurveSchema,
    widthCurve: CurveSchema,
    anchor: z.literal("base"),
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
//   "orbit"  lobes on a ring BAND in the layer's own XY plane, between radius
//            `height` (the inner edge) and `spread` (the outer one), each
//            orbiting at an angular speed proportional to r^-0.65 so the inner
//            lane laps the outer one. `rise` is re-read as the angular speed at
//            the outer edge in radians a second, and `drift` as the
//            out-of-plane bob.
//            Sizes are hashed inside blob.radius, and the half of the ring
//            currently FURTHER from the camera is drawn first, smaller and
//            dimmer, which is what gives a tilted ring its oblique read.
//   "path"   lobes anchored at fixed parameters of blob.pathId: anchor k owns
//            u = (k + 0.55)/anchors and its `perAnchor` lobes are born the
//            moment blob.head passes it, then drift back along the path, up,
//            and across it. Slot 0 of each anchor is the CORE lobe — smaller
//            bumps, a wider radius — and the rest are the ragged shell around
//            it. blob.retract then pulls the trail in from one end.
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
    // Metres the top of the cluster travels up over one lobe life. On an
    // "orbit" it is the angular speed at the outer edge (radians a second); on
    // a "path" it is how far a lobe lifts off the path over its own life.
    rise: scalar(-12, 20),
    // Downward pull on that arc: y = rise*a - gravity*a*a/2.
    gravity: scalar(-20, 20),
    // Metres a lobe drifts outward from the cluster axis, on sqrt(a). On an
    // "orbit" it is the out-of-plane bob; on a "path" it is how far a lobe
    // drifts BACK along the path from the anchor it was born at.
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
    // arrangement "path" only: the curve the anchors sit on, how many lobes
    // each anchor carries and where the head is along the path over the
    // layer's own 0..1 progress (an anchor is born the moment the head passes
    // it). All defaulted, so archived documents load unchanged.
    pathId: PathIdSchema.nullable().default(null),
    head: CurveSchema.nullable().default(null),
    perAnchor: integer(1, 4).default(1),
    // arrangement "path" only: the tail retracts from `from` to `to` of the
    // LAYER's own 0..1 progress, and `alongBias` decides from which end —
    // 0 shrinks the whole trail together, 1 eats it from the start of the path
    // (the sky) toward the end (the ground).
    retract: z
      .object({
        from: scalar(0, 1),
        to: scalar(0, 1),
        alongBias: scalar(0, 2),
      })
      .strict()
      .nullable()
      .default(null),
    // A fake point light the lobes are shaded toward, instead of the parallel
    // world light material.toon carries: `layerId` follows another layer's
    // live transform, `position` is a fixed point, and brightness falls off as
    // 1/(1 + (distance * falloff)^2). Defaulted, so archived documents load
    // unchanged.
    lightFrom: z
      .object({
        layerId: z.string().max(48).nullable(),
        position: vec3,
        falloff: scalar(0, 4),
      })
      .strict()
      .nullable()
      .default(null),
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

// --- reflection ------------------------------------------------------------
//
// A flipped, washed copy of another MESH layer under the ground plane: what a
// polished floor catches. The reflection draws the source layer's own geometry
// and material, mirrored about environment.groundY, so it can never drift out
// of step with what it reflects — a reflection layer carries no geometry and no
// material of its own.
//
// `scale` squashes the copy vertically (a wet floor foreshortens what it
// reflects), `blur` fades it with depth below the plane, `opacity` is the
// overall wash and `tint` the colour it is mixed toward.
export const ReflectionSchema = z
  .object({
    sourceLayerId: z.string().max(48),
    axis: z.literal("y"),
    scale: scalar(0.05, 1),
    blur: scalar(0, 1),
    opacity: scalar(0, 1),
    tint: hex,
  })
  .strict();

// --- sheets ----------------------------------------------------------------
//
// Curved, tapered, OPAQUE membranes streaming off a body: the tail of a water
// projectile is mesh, never particles, because water reads as smooth surfaces
// and rounded volumes. A generator like blob and splash — every sheet's size,
// curl, heading, undulation and tumble is hashed out of (sheets.seed, index) —
// with one thing none of the others have: a MULTI-CADENCE schedule.
//
// Each size class carries its own `period`, and the births inside a class are
// spread evenly across it (slot k of n is born at (k + hash) * period/n). That
// is the whole trick: a slot's period has to exceed its own life or the re-fire
// clips the piece before it can travel, and one shared cadence would either
// clip the long sheets or leave the near collar sparse. Two or three cadences
// give uniform coverage at every t with nothing cut short.
//
// Colour comes from material.toon (two bands against a fixed world light, plus
// a rim), never from material.ramp: a sheet is a lit surface. Sheets depth-write
// and are drawn DoubleSide, so they intersect each other for real.
/** The drawn-symbol patterns: the ones material.symbol colours. */
export const SYMBOL_PROCEDURALS: ReadonlySet<string> = new Set([
  "starSolid",
  "face",
  "heart",
  "crescent",
  "cloudLobe",
  "bolt",
]);

export const SheetClassSchema = z
  .object({
    // Share of the population this class takes (weights are normalised).
    weight: scalar(0.01, 1),
    // Multipliers on the layer's own length, width and speed bands.
    length: scalar(0.1, 4),
    width: scalar(0.1, 4),
    speed: scalar(0.05, 4),
    // Seconds one sheet of this class lives, in absolute time.
    life: scalar(0.05, 8),
    // Seconds between two firings of one SLOT of this class. It must exceed
    // the class's own life or the re-fire clips the sheet.
    period: scalar(0.05, 12),
  })
  .strict();

// A low-frequency noise threshold on the sheet's own UV that eats its border,
// so the crescent silhouette is ragged instead of cut with scissors.
export const SheetTearSchema = z
  .object({ scale: scalar(0.2, 12), threshold: scalar(0, 1) })
  .strict();

export const SheetsSchema = z
  .object({
    count: integer(1, SHEET_BUDGET_V2),
    // Bands, in metres, before the per-class multipliers.
    length: range(0.05, 4),
    width: range(0.02, 3),
    // Radians the sheet wraps around its own long axis: 0 is a flat strip,
    // ~1.5 a half tube. It is what stops a membrane reading as a card.
    curl: range(0, 4),
    // Shallow arc along the length as a fraction of it, so the sheet is a
    // crescent rather than a straight strip. The sign is hashed per sheet.
    bow: scalar(0, 0.6),
    // Exponent of the sin() width profile: 1 is a lens, below 1 a blunt ribbon.
    taper: scalar(0.1, 2),
    classes: z.array(SheetClassSchema).min(1).max(SHEET_CLASS_BUDGET_V2),
    // Where along the layer's own +Z a sheet starts, in metres. Negative is
    // still INSIDE the head, which is what makes a membrane emerge from it.
    spawn: z
      .object({ axisFrom: scalar(-4, 4), axisTo: scalar(-4, 4) })
      .strict(),
    // Unit heading the sheets stream along, in the layer's own space.
    flow: unit3,
    // Metres a second, before the per-class multiplier.
    speed: range(0, 12),
    // The lateral swim: amplitude in metres at `frequency` hertz, hashed phase.
    undulation: z
      .object({ amplitude: scalar(0, 1), frequency: scalar(0, 12) })
      .strict(),
    // Radians a second the sheet rolls about the flow axis.
    tumble: scalar(0, 8),
    // Seconds a sheet takes to reach full size, and the fraction of its own
    // life over which it shrinks away again.
    scaleIn: scalar(0.001, 2),
    shrinkOut: scalar(0.01, 1),
    tear: SheetTearSchema.nullable(),
    seed: integer(0, 2147483647),
  })
  .strict();

// --- crescent ---------------------------------------------------------------
//
// The blade of a slash: a strip swept along an ARC, of which only the window
// [tail, head] is drawn, with a thickness profile that peaks a little behind
// the live tip. Head and tail are two independent curves over the layer's own
// 0..1 progress, so the sweep (head runs, tail holds) and the tear-away (tail
// catches up) are one layer and one field.
//
// The arc lives in the layer's own XY plane, leaned by `planeTilt` about its
// own +X: seen from an elevated oblique camera a circle in that plane projects
// to an ellipse, which is what turns a 200-degree arc into a banana instead of
// a "C".
//
// It is drawn once per TONAL copy — a wide dark shadow behind, the saturated
// body, a hot highlight inside it — each at its own scale, radial offset and
// time lead. One copy may carry a `smear`: the same strip a few frames behind,
// additive and faint, which is the motion blur of the sweep.
export const CrescentWindowSchema = z
  .object({ head: CurveSchema, tail: CurveSchema })
  .strict();

export const CrescentThicknessSchema = z
  .object({
    // Fattest FULL thickness, in metres (the erosion eats ~20% of it).
    max: scalar(0.01, 3),
    // How far behind the live tip the profile peaks, in arc parameter.
    peakFrom: scalar(0.01, 2),
    // Exponent of the razor rise at the leading tip; low is sharper.
    tipPower: scalar(0.05, 4),
    // Arc parameter over which the trailing end tapers back to nothing.
    rootFade: scalar(0.005, 1),
  })
  .strict();

// A copy of the strip. `ramp` is read ACROSS it, outer edge to inner: stop t=0
// is the hot outer rim, the middle stops the saturated body, the last the dark
// underside.
export const CrescentSmearSchema = z
  .object({
    // Fraction of the layer the copy lags behind the live window.
    lag: scalar(0, 1),
    opacity: scalar(0, 1),
    // The band of the layer's own 0..1 progress the smear exists in.
    window: range(0, 1),
  })
  .strict();

export const CrescentTonalSchema = z
  .object({
    scale: scalar(0.05, 3),
    // Metres the copy is pushed outward (positive) or inward across the strip.
    radialOffset: scalar(-2, 2),
    // Fraction of the layer this copy's window leads (positive) or lags.
    timeLead: scalar(-0.5, 0.5),
    blend: z.enum(["additive", "alpha", "premultiplied"]),
    ramp: z.array(RampStopSchema).min(2).max(4),
    // Erosion threshold for this copy: a wider copy behind survives longer.
    erode: scalar(0, 1),
    // How hard the leading tip runs over the ramp's own first stop.
    tipHot: scalar(0, 4),
    smear: CrescentSmearSchema.nullable(),
  })
  .strict();

// The tail does not fade, it is EATEN: Voronoi cells behind the front are
// removed, so the strip breaks into tongues. `width` is how far behind the
// front the eating reaches, in arc parameter; `widthFollowsWindow` scales it
// with the live window so a short window does not lose its whole tail at once.
export const CrescentErosionSchema = z
  .object({
    width: scalar(0.01, 2),
    widthFollowsWindow: z.boolean(),
    voronoi: z
      .object({ scale: scalar(0.5, 40), seamWidth: scalar(0, 0.5) })
      .strict(),
  })
  .strict();

export const CrescentSchema = z
  .object({
    radius: scalar(0.05, 8),
    // Signed: the sign is which way round the circle the head travels, and it
    // is what decides whether the banana bulges up or down once the plane is
    // leaned. A magnitude under 0.05 rad draws nothing.
    sweep: scalar(-Math.PI * 2, Math.PI * 2),
    // Where on the circle the tail end sits, in radians.
    phase: scalar(-Math.PI * 2, Math.PI * 2),
    // Lean of the arc plane about the layer's own +X.
    planeTilt: scalar(-Math.PI, Math.PI),
    window: CrescentWindowSchema,
    thickness: CrescentThicknessSchema,
    // "screen" builds the across axis from the camera, so the blade never goes
    // edge-on; "surface" keeps it in the arc plane, which is a flat banner.
    widthSpace: z.enum(["screen", "surface"]),
    tonal: z.array(CrescentTonalSchema).min(1).max(CRESCENT_TONAL_BUDGET_V2),
    erosionFront: CrescentErosionSchema,
    // The flow lines running along the blade. Reuses the surface streak spec;
    // `radiate` is ignored here (a strip has no nose to radiate from).
    streaks: StreaksSchema.nullable(),
    // How much the strip widens and flutters as the tear-away grows.
    widen: scalar(0, 2),
    seed: integer(0, 2147483647),
  })
  .strict();

// --- licks -----------------------------------------------------------------
//
// Flat, hard-edged cel flame strips peeling off a crescent's erosion front:
// two flat colour bands and no gradient, re-hashed on a flipbook step so the
// shape JUMPS rather than slides — which is the whole difference between a
// drawn lick and a stretched sprite.
//
// They are ANCHORED, not emitted: `anchor.sourceLayerId` names the crescent and
// `follow` is "erosionFront", so a lick sits where that crescent's tail is at
// this instant, offset along the arc by `anchor.offset`.
export const LicksSchema = z
  .object({
    count: integer(1, LICK_BUDGET_V2),
    length: range(0.02, 4),
    width: range(0.01, 2),
    // Sideways curl of the strip as a fraction of its own length.
    curl: scalar(0, 1),
    // Shape re-hash rate, in hertz of layer time. 0 holds one shape.
    flipbookHz: scalar(0, 60),
    anchor: z
      .object({
        sourceLayerId: z.string().max(48),
        follow: z.literal("erosionFront"),
        offset: scalar(-1, 1),
      })
      .strict(),
    // Metres a second the lick drifts once it has peeled off, in layer space.
    drift: vec3,
    // Births spread over [from,to] of the LAYER window, and how long one lasts.
    stagger: range(0, 1),
    life: range(0.02, 8),
    // The hot half and the body half of the two-band cel fill.
    colors: z.tuple([hex, hex]),
    seed: integer(0, 2147483647),
  })
  .strict();

// --- event windows ---------------------------------------------------------
//
// A layer whose start is an EVENT rather than a clock time: `at` names a path
// and a position along it, and the layer starts the moment that path's head
// reaches it. The head is whichever layer drives that path (a blob's
// blob.head, a path-anchored emitter's spawn.headCurve or a ribbon's
// window.head), so a flash, a ring and a debris burst follow the thing that
// caused them without any of them carrying a hard-coded time.
//
// layer.start is then read as an OFFSET from that moment and layer.end keeps
// the layer's authored duration. A window that cannot be resolved (no path, no
// head) leaves the layer's authored start and end alone.
export const LayerWindowSchema = z
  .object({
    at: z.object({ pathId: PathIdSchema, u: scalar(0, 1) }).strict(),
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

// Volume-conserving squash and stretch: the named axis breathes by
// +-`amplitude` at `frequency` hertz of LAYER time and the two cross axes take
// the inverse square root of it, so the body keeps its volume instead of
// pumping. It multiplies transform.scale, which is how it reaches every kind
// with no per-kind branch anywhere.
export const SquashSchema = z
  .object({
    axis: z.enum(["x", "y", "z"]),
    amplitude: scalar(0, 0.6),
    frequency: scalar(0, 12),
  })
  .strict();

export const TransformSchema = z
  .object({
    position: vec3,
    rotation: vec3,
    scale: vec3,
    // Defaulted, so archived documents load unchanged.
    squash: SquashSchema.nullable().default(null),
  })
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
    // One uniform retraction of the whole layer, whatever the kind. Defaulted,
    // so archived documents load unchanged.
    collapse: CollapseSchema.nullable().default(null),
    // The layer's start is an event on a path rather than a clock time.
    // Defaulted, so archived documents load unchanged.
    window: LayerWindowSchema.nullable().default(null),
    // "camera" re-bases the layer's local XY onto the camera's right/up every
    // frame, closed form from the camera, so everything the layer lays out —
    // symbols, an emitter's own shape, a spray fan — lives in the SCREEN plane
    // instead of in world space. A 2D symbol burst read from a three-quarter
    // camera collapses to a line without it. Layers stay flat: this is a frame
    // on one layer, never a parent group. Defaulted, so archived documents load
    // unchanged.
    frame: z.enum(["camera"]).nullable().default(null),
    material: MaterialSchema.optional(),
    emitter: EmitterSchema.optional(),
    geometry: GeometryV2Schema.optional(),
    light: LightSchema.optional(),
    blob: BlobSchema.optional(),
    splash: SplashSchema.optional(),
    ribbon: RibbonSchema.optional(),
    wireBurst: WireBurstSchema.optional(),
    crystals: CrystalsSchema.optional(),
    arcs: ArcsSchema.optional(),
    streakBurst: StreakBurstSchema.optional(),
    reflection: ReflectionSchema.optional(),
    sheets: SheetsSchema.optional(),
    crescent: CrescentSchema.optional(),
    licks: LicksSchema.optional(),
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

// Analytic pools of light in the ground shader: the footprint a portal, a
// column or a falling meteor throws on the floor, without a real light and
// without a decal. Each pool sits at `position`, or follows the live transform
// of `followsLayerId`; `shape` is a disc or a rectangle of half-extent
// (radius * anisotropy, radius); `intensity` is a curve over the DOCUMENT's own
// 0..1 progress.
export const GroundPoolSchema = z
  .object({
    followsLayerId: z.string().max(48).nullable(),
    position: vec3,
    shape: z.enum(["disc", "rect"]),
    radius: scalar(0.05, 12),
    // Half-extent across the pool as a multiple of `radius`; 1 is round.
    anisotropy: scalar(0.05, 8),
    color: hex,
    intensity: CurveSchema,
  })
  .strict();

/** Ground pools one document may declare; each is one gaussian per pixel. */
export const GROUND_POOL_BUDGET_V2 = 6;

// A screen-space vignette card behind EVERYTHING, including the ground: the
// blue wash a cartoon impact is drawn on. `center` is in 0..1 screen
// coordinates, `aspect` stretches the falloff horizontally and `topFalloff`
// darkens the ceiling, which is what keeps the card from reading as a flat
// gradient. It is not lit and it is not fogged; it is the paper.
export const BackdropSchema = z
  .object({
    mode: z.literal("radial"),
    hot: hex,
    cold: hex,
    center: z.tuple([scalar(0, 1), scalar(0, 1)]),
    aspect: scalar(0.1, 4),
    topFalloff: scalar(0, 1),
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
    // Analytic pools in the ground shader. Defaulted, so archived documents
    // load unchanged.
    groundPool: z
      .array(GroundPoolSchema)
      .max(GROUND_POOL_BUDGET_V2)
      .nullable()
      .default(null),
    // The screen-space card behind everything. Defaulted, so archived
    // documents load unchanged.
    backdrop: BackdropSchema.nullable().default(null),
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

// A full-screen ADDITIVE wash: the near white-out at an eruption. `curve` is the
// strength over DOCUMENT time normalized to 0..1 (the same domain post.glitch
// uses), `vignette` darkens it toward the frame edges so the flash still has a
// centre. Two or three frames is the whole shape; anything longer reads as a
// blown exposure rather than as an event.
export const FlashSchema = z
  .object({ curve: CurveSchema, color: hex, vignette: scalar(0, 1) })
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
    flash: FlashSchema.nullable().default(null),
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
export type LinePath = z.infer<typeof LinePathSchema>;
export type Arcs = z.infer<typeof ArcsSchema>;
export type StreakBurst = z.infer<typeof StreakBurstSchema>;
export type Collapse = z.infer<typeof CollapseSchema>;
export type Slab = z.infer<typeof SlabSchema>;
export type Stripe = z.infer<typeof StripeSchema>;
export type Flicker = z.infer<typeof FlickerSchema>;
export type Strip = z.infer<typeof StripSchema>;
export type Flash = z.infer<typeof FlashSchema>;
export type Ribbon = z.infer<typeof RibbonSchema>;
export type WireBurst = z.infer<typeof WireBurstSchema>;
export type Crystals = z.infer<typeof CrystalsSchema>;
export type Reveal = z.infer<typeof RevealSchema>;
export type Lattice = z.infer<typeof LatticeSchema>;
export type PlaneGlow = z.infer<typeof PlaneGlowSchema>;
export type Ripple = z.infer<typeof RippleSchema>;
export type Band = z.infer<typeof BandSchema>;
export type Jitter = z.infer<typeof JitterSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type SdfLine = z.infer<typeof SdfLineSchema>;
export type Beads = z.infer<typeof BeadsSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Swirl = z.infer<typeof SwirlSchema>;
export type Reflection = z.infer<typeof ReflectionSchema>;
export type Sheets = z.infer<typeof SheetsSchema>;
export type SheetClass = z.infer<typeof SheetClassSchema>;
export type Crescent = z.infer<typeof CrescentSchema>;
export type CrescentTonal = z.infer<typeof CrescentTonalSchema>;
export type Licks = z.infer<typeof LicksSchema>;
export type Streaks = z.infer<typeof StreaksSchema>;
export type Creases = z.infer<typeof CreasesSchema>;
export type Screentone = z.infer<typeof ScreentoneSchema>;
export type SymbolStyle = z.infer<typeof SymbolSchema>;
export type Squash = z.infer<typeof SquashSchema>;
export type SliverRender = z.infer<typeof SliverRenderSchema>;
export type Backdrop = z.infer<typeof BackdropSchema>;
export type LayerWindow = z.infer<typeof LayerWindowSchema>;
export type GroundPool = z.infer<typeof GroundPoolSchema>;
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
  "geometry.slab.taper": [0.05, 1],
  "geometry.slab.tiers[0].height": [0.001, 6],
  "geometry.slab.tiers[1].height": [0.001, 6],
  "geometry.slab.tiers[2].height": [0.001, 6],
  "geometry.slab.tiers[3].height": [0.001, 6],
  "geometry.slab.tiers[0].intensity": [0, 8],
  "geometry.slab.tiers[1].intensity": [0, 8],
  "geometry.slab.tiers[2].intensity": [0, 8],
  "geometry.slab.tiers[3].intensity": [0, 8],
  "material.stripes[0].frequency": [0, 64],
  "material.stripes[0].speed": [-40, 40],
  "material.stripes[0].contrast": [0, 2],
  "material.stripes[1].frequency": [0, 64],
  "material.stripes[1].speed": [-40, 40],
  "material.stripes[1].contrast": [0, 2],
  "material.stripes[2].contrast": [0, 2],
  "material.flicker.amount": [0, 1],
  "material.flicker.rate": [0.5, 60],
  "emitter.render.strip.waviness": [0, 1],
  "emitter.render.strip.stepRate": [0, 60],
  "arcs.radius[0]": [0.02, 8],
  "arcs.radius[1]": [0.02, 8],
  "arcs.span": [0.05, 12],
  "arcs.width": [0.002, 0.4],
  "arcs.jitter.amplitude": [0, 3],
  "arcs.blink.skipChance": [0, 1],
  "streakBurst.length[0]": [0.1, 12],
  "streakBurst.length[1]": [0.1, 12],
  "streakBurst.width[0]": [0.005, 1],
  "streakBurst.width[1]": [0.005, 1],
  "streakBurst.curvature": [0, 1],
  "streakBurst.upBias": [-1, 1],
  "streakBurst.bundleSpread": [0, 2],
  "material.sdfLine.core": [0, 2],
  "material.sdfLine.spine": [0, 0.5],
  "material.sdfLine.innerWidth": [0, 0.5],
  "material.sdfLine.halo[0].weight": [0, 2],
  "material.sdfLine.halo[1].weight": [0, 2],
  "material.sdfLine.halo[2].weight": [0, 2],
  "material.beads.speed": [-4, 4],
  "material.beads.width": [0.005, 0.4],
  "material.flow.threshold": [0, 1],
  "material.flow.softness": [0.001, 1],
  "material.flow.parallax": [0, 0.5],
  "material.swirl.bands.width": [0.02, 1],
  "material.swirl.bands.wind": [0, 6],
  "material.swirl.detail.contrast": [0, 2],
  "material.swirl.lobe.amount": [0, 2],
  "geometry.frame.corner": [0, 1],
  "blob.perAnchor": [1, 4],
  "reflection.opacity": [0, 1],
  "reflection.scale": [0.05, 1],
  "transform.squash.amplitude": [0, 0.6],
  "transform.squash.frequency": [0, 12],
  "material.streaks.intensity": [0, 8],
  "material.streaks.frequency": [0, 32],
  "material.streaks.width": [0.001, 0.3],
  "material.creases.depth": [0, 1],
  "material.screentone.pitch": [0.002, 0.5],
  "material.symbol.hot.intensity": [0, 8],
  "emitter.render.sliver.length[0]": [0.05, 8],
  "emitter.render.sliver.length[1]": [0.05, 8],
  "emitter.render.sliver.width[0]": [0.005, 1],
  "emitter.render.sliver.width[1]": [0.005, 1],
  "emitter.render.retract.start": [0, 1],
  "emitter.render.retract.end": [0, 1],
  "emitter.shape.angleJitter": [0, Math.PI],
  "emitter.shape.angleBias": [-1, 1],
  "sheets.speed[0]": [0, 12],
  "sheets.speed[1]": [0, 12],
  "sheets.undulation.amplitude": [0, 1],
  "sheets.tumble": [0, 8],
  "sheets.bow": [0, 0.6],
  "crescent.radius": [0.05, 8],
  "crescent.sweep": [-Math.PI * 2, Math.PI * 2],
  "crescent.thickness.max": [0.01, 3],
  "crescent.widen": [0, 2],
  "crescent.erosionFront.width": [0.01, 2],
  "crescent.tonal[0].erode": [0, 1],
  "crescent.tonal[1].erode": [0, 1],
  "crescent.tonal[2].erode": [0, 1],
  "crescent.tonal[3].erode": [0, 1],
  "licks.curl": [0, 1],
  "licks.flipbookHz": [0, 60],
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
  "arcs.coreColor",
  "arcs.haloColor",
  "geometry.slab.tiers[0].color",
  "geometry.slab.tiers[1].color",
  "geometry.slab.tiers[2].color",
  "geometry.slab.tiers[3].color",
  "reflection.tint",
  "material.streaks.color",
  "material.screentone.color",
  "material.symbol.fill",
  "material.symbol.outline",
  "material.symbol.highlight",
  "material.symbol.ink",
  "material.symbol.hot.color",
  "licks.colors[0]",
  "licks.colors[1]",
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
  if (curve.formula) Object.assign(curve, compileCurveFormula(curve.formula));
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
  // A stripe set with no frequency is a constant, which only dims the layer.
  for (const stripe of material.stripes ?? [])
    if (stripe.contrast > 0 && stripe.frequency <= 0)
      throw new Error(
        `Stripe has contrast but no frequency, so it only dims the layer: ${label}`,
      );
  if (material.lattice && material.lattice.gapWidth >= material.lattice.edgeWidth)
    throw new Error(
      `Lattice gap is not narrower than its edge, so no wall is drawn: ${label}`,
    );
  // One weight per noise layer: a mix the flow cannot apply is a silent typo.
  if (material.flow) {
    if (material.flow.mix.length !== material.flow.layers.length)
      throw new Error(
        `material.flow needs one mix weight per layer: ${label}`,
      );
    if (material.flow.mix.every((w) => w <= 0))
      throw new Error(`material.flow mixes to nothing: ${label}`);
  }
  if (material.swirl) checkCurve(material.swirl.strength, `${label}/swirl.strength`);
  // A rim with no bar, no spine, no inner line and no halo draws nothing.
  if (
    material.sdfLine &&
    material.sdfLine.core <= 0 &&
    material.sdfLine.spine <= 0 &&
    material.sdfLine.innerWidth <= 0 &&
    !material.sdfLine.halo.some((h) => h.weight > 0)
  )
    throw new Error(`material.sdfLine has no lit term: ${label}`);
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

function arcChecks(arcs: Arcs, label: string) {
  checkRange(arcs.radius, `${label}/arcs.radius`);
  checkRange(arcs.pitch, `${label}/arcs.pitch`);
  checkRange(arcs.blink.period, `${label}/arcs.blink.period`);
  checkRange(arcs.blink.onTime, `${label}/arcs.blink.onTime`);
  // An arc that is lit for longer than its own cycle never blinks, which is the
  // one thing this kind exists to do.
  if (arcs.blink.onTime[0] >= arcs.blink.period[1])
    throw new Error(
      `Arc on-time is never shorter than its period, so nothing blinks: ${label}`,
    );
}

function streakBurstChecks(burst: StreakBurst, label: string) {
  checkRange(burst.length, `${label}/streakBurst.length`);
  checkRange(burst.width, `${label}/streakBurst.width`);
  checkCurve(burst.grow, `${label}/streakBurst.grow`);
}

function blobChecks(blob: Blob, label: string) {
  checkRange(blob.radius, `${label}/blob.radius`);
  checkRange(blob.stagger, `${label}/blob.stagger`);
  checkRange(blob.life, `${label}/blob.life`);
  if (blob.arrangement === "path") {
    if (!blob.pathId)
      throw new Error(`A "path" blob needs blob.pathId: ${label}`);
    if (!blob.head)
      throw new Error(
        `A "path" blob needs blob.head, the head's position along the path: ${label}`,
      );
    checkCurve(blob.head, `${label}/blob.head`);
    for (let i = 1; i < blob.head.keys.length; i++)
      if (blob.head.keys[i][1] < blob.head.keys[i - 1][1])
        throw new Error(`Blob head curve must not run backwards: ${label}`);
  } else if (blob.pathId || blob.head) {
    throw new Error(
      `blob.pathId and blob.head are for arrangement "path" only: ${label}`,
    );
  }
  if (blob.arrangement === "orbit" && blob.height >= blob.spread)
    throw new Error(
      `An "orbit" blob needs blob.height (the inner radius) under blob.spread (the outer one): ${label}`,
    );
  if (blob.retract && blob.retract.from > blob.retract.to)
    throw new Error(`blob.retract runs backwards: ${label}`);
}

function sheetChecks(sheets: Sheets, label: string) {
  for (const key of ["length", "width", "curl", "speed"] as const)
    checkRange(sheets[key], `${label}/sheets.${key}`);
  checkUnit(sheets.flow, `${label}/sheets.flow`);
  // A slot re-fires every `period`, so a class whose life outlives its own
  // cadence is clipped mid-flight — which is exactly the failure the two-cadence
  // schedule exists to avoid.
  for (const [i, cls] of sheets.classes.entries())
    if (cls.life > cls.period)
      throw new Error(
        `Sheet class ${i} lives longer than its own period, so every sheet is clipped: ${label}`,
      );
}

function crescentChecks(crescent: Crescent, label: string) {
  if (Math.abs(crescent.sweep) < 0.05)
    throw new Error(`Crescent sweep is too small to draw an arc: ${label}`);
  checkCurve(crescent.window.head, `${label}/crescent.window.head`);
  checkCurve(crescent.window.tail, `${label}/crescent.window.tail`);
  for (const [i, tonal] of crescent.tonal.entries()) {
    for (let k = 1; k < tonal.ramp.length; k++)
      if (tonal.ramp[k].t <= tonal.ramp[k - 1].t)
        throw new Error(`Crescent tonal ${i} ramp stops must ascend: ${label}`);
    if (tonal.smear) checkRange(tonal.smear.window, `${label}/crescent.tonal[${i}].smear.window`);
  }
  // The tail must never overtake the head: a window that inverts draws nothing,
  // and the erosion front would run backwards through its own tongues. Sampled
  // at the union of both key sets, because a tail that crosses a held head
  // between its own keys is exactly the case a tail-keys-only check misses.
  const head = crescent.window.head.keys;
  const tail = crescent.window.tail.keys;
  for (const t of [...head, ...tail].map((k) => k[0]))
    if (sampleMonotone(tail, t) > sampleMonotone(head, t) + 1e-6)
      throw new Error(
        `Crescent tail overtakes its head at u=${t}, so the window inverts: ${label}`,
      );
}

function licksChecks(licks: Licks, label: string) {
  checkRange(licks.length, `${label}/licks.length`);
  checkRange(licks.width, `${label}/licks.width`);
  checkRange(licks.stagger, `${label}/licks.stagger`);
  checkRange(licks.life, `${label}/licks.life`);
}

/** Piecewise-linear read of a curve's keys; the tail/head comparison only. */
function sampleMonotone(keys: readonly (readonly [number, number])[], x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (x <= keys[i][0]) {
      const f = (x - keys[i - 1][0]) / Math.max(keys[i][0] - keys[i - 1][0], 1e-6);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * f;
    }
  return keys[keys.length - 1][1];
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
  if (
    (emitter.shape.type === "path" || emitter.shape.type === "pathLine") &&
    !emitter.shape.pathId
  )
    throw new Error(`Path emitter shape needs shape.pathId: ${label}`);
  // A run along a path needs both the path to run on and the shared head
  // envelope that moves it; neither has a sensible default.
  if (emitter.velocity.mode === "alongPath") {
    if (!emitter.shape.pathId)
      throw new Error(`velocity.mode "alongPath" needs shape.pathId: ${label}`);
    if (!emitter.velocity.speedCurve)
      throw new Error(
        `velocity.mode "alongPath" needs velocity.speedCurve as the head envelope: ${label}`,
      );
  }
  if (emitter.render.mode === "flatStrip") {
    if (!emitter.render.strip)
      throw new Error(`render.mode "flatStrip" needs render.strip: ${label}`);
    checkRange(emitter.render.strip.length, `${label}/render.strip.length`);
    checkRange(emitter.render.strip.width, `${label}/render.strip.width`);
  } else if (emitter.render.strip) {
    throw new Error(
      `render.strip is for render.mode "flatStrip" only: ${label}`,
    );
  }
  if (emitter.render.mode === "sliver") {
    if (!emitter.render.sliver)
      throw new Error(`render.mode "sliver" needs render.sliver: ${label}`);
    checkRange(emitter.render.sliver.length, `${label}/render.sliver.length`);
    checkRange(emitter.render.sliver.width, `${label}/render.sliver.width`);
  } else if (emitter.render.sliver) {
    throw new Error(
      `render.sliver is for render.mode "sliver" only: ${label}`,
    );
  }
  // A retract that runs backwards never finishes; a secondary spark can only
  // ride a sliver, because there is nothing else for it to be strung along.
  if (emitter.render.retract && emitter.render.retract.start >= emitter.render.retract.end)
    throw new Error(`render.retract runs backwards: ${label}`);
  if (emitter.render.secondary) {
    checkRange(emitter.render.secondary.along, `${label}/render.secondary.along`);
    if (emitter.render.mode !== "sliver")
      throw new Error(
        `render.secondary is for render.mode "sliver" only: ${label}`,
      );
  }
  // A ring band with no width is a circle, which shape "ring" already is.
  if (
    emitter.shape.type === "orbit" &&
    emitter.shape.innerRadius >= emitter.shape.radius
  )
    throw new Error(
      `An "orbit" emitter needs shape.innerRadius under shape.radius: ${label}`,
    );
  if (emitter.velocity.mode === "orbit" && emitter.shape.type !== "orbit")
    throw new Error(
      `velocity.mode "orbit" needs emitter.shape.type "orbit": ${label}`,
    );
  if (emitter.spawn.mode === "event" && !emitter.spawn.originsFromPath)
    throw new Error(
      `spawn.mode "event" needs spawn.originsFromPath: the event IS the path's end: ${label}`,
    );
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

const WorkspaceDocumentV2Schema = DocumentV2Schema.extend({
  layers: z.array(LayerV2Schema).max(24),
});

/** Editor state may be empty or have every emitter hidden. Generation still
 * uses validateDocumentV2 and its stricter nonempty-effect contract.
 */
export function validateWorkspaceDocumentV2(input: unknown): VfxDocumentV2 {
  return validateDocumentV2(input, { workspace: true });
}

export function validateDocumentV2(input: unknown, options: { workspace?: boolean } = {}): VfxDocumentV2 {
  const doc = (options.workspace ? WorkspaceDocumentV2Schema : DocumentV2Schema).parse(input);
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
  const meshLayers = new Set<string>();
  // Kinds whose instances are hashed out of their own spec, so another layer
  // can borrow their sites without depending on draw order.
  const generatorLayers = new Set<string>();
  const crescentLayers = new Set<string>();
  let particles = 0;
  for (const layer of doc.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate layer: ${layer.id}`);
    ids.add(layer.id);
    if (layer.kind === "particles") particleLayers.add(layer.id);
    if (layer.kind === "crystals" || layer.kind === "blob")
      generatorLayers.add(layer.id);
    if (layer.kind === "crescent") crescentLayers.add(layer.id);
    if ((MESH_KINDS_V2 as readonly string[]).includes(layer.kind))
      meshLayers.add(layer.id);
  }
  // A ground pool may follow any layer's live transform.
  for (const pool of doc.environment.groundPool ?? []) {
    checkCurve(pool.intensity, `environment.groundPool/${pool.followsLayerId ?? "fixed"}`);
    if (pool.followsLayerId && !ids.has(pool.followsLayerId))
      throw new Error(`Missing ground pool layer: ${pool.followsLayerId}`);
  }

  for (const layer of doc.layers) {
    const label = layer.id;
    if (layer.start >= layer.end || layer.end > doc.duration)
      throw new Error(`Invalid interval: ${label}`);

    // An event window only means anything when the path it names exists.
    if (layer.window) pathExists(layer.window.at.pathId, label);

    if (layer.kind === "reflection") {
      if (!layer.reflection)
        throw new Error(`Reflection layer needs reflection: ${label}`);
      if (layer.material || layer.emitter || layer.geometry)
        throw new Error(
          `A reflection draws its SOURCE layer's geometry and material: ${label}`,
        );
      if (layer.reflection.sourceLayerId === layer.id)
        throw new Error(`A reflection cannot reflect itself: ${label}`);
      if (!meshLayers.has(layer.reflection.sourceLayerId))
        throw new Error(
          `Reflection source must be a mesh layer (ring/shell/trail/beam/sprite/decal): ${layer.reflection.sourceLayerId}`,
        );
    } else if (layer.reflection) {
      throw new Error(`Only reflection layers carry reflection: ${label}`);
    }

    if (layer.kind === "light") {
      if (!layer.light) throw new Error(`Light layer needs light: ${label}`);
      if (layer.material || layer.emitter || layer.geometry)
        throw new Error(
          `Light layers carry no material, emitter or geometry: ${label}`,
        );
      checkCurve(layer.light.intensity, `${label}/light.intensity`);
    } else if (layer.kind !== "reflection") {
      if (layer.light)
        throw new Error(`Only light layers carry light: ${label}`);
      if (!layer.material) throw new Error(`Layer needs a material: ${label}`);
      if (layer.material.shading === "litSmoke" && layer.kind !== "particles" &&
          !(MESH_KINDS_V2 as readonly string[]).includes(layer.kind))
        throw new Error(`litSmoke is supported on particles and mesh kinds only: ${label}`);
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
      // A front-anchored spawn is born behind a real blade, so the blade has
      // to exist: the birth IS that crescent's tail curve, inverted.
      if (layer.emitter.spawn.mode === "frontAnchored") {
        const front = layer.emitter.spawn.sourceLayerId;
        if (!front)
          throw new Error(
            `spawn.mode "frontAnchored" needs spawn.sourceLayerId: ${label}`,
          );
        if (!crescentLayers.has(front))
          throw new Error(`Front-anchored spawn source must be a crescent layer: ${front}`);
      }
      const source = layer.emitter.shape.sourceLayerId;
      if (source && layer.emitter.shape.type === "layerInstances") {
        if (source === layer.id)
          throw new Error(`Emitter cannot borrow its own instances: ${label}`);
        if (!generatorLayers.has(source))
          throw new Error(
            `Emitter source must be a crystals or blob layer: ${source}`,
          );
      }
      // An event spawn with no path of its own spreads across every document
      // path, so there has to be at least one.
      if (
        layer.emitter.spawn.originsFromPath &&
        !layer.emitter.shape.pathId &&
        doc.paths.length === 0
      )
        throw new Error(
          `spawn.originsFromPath with no shape.pathId needs document paths: ${label}`,
        );
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
      if (layer.blob.pathId) pathExists(layer.blob.pathId, label);
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
    if (layer.kind === "arcs") {
      if (!layer.arcs) throw new Error(`Arcs layer needs arcs: ${label}`);
      arcChecks(layer.arcs, label);
    } else if (layer.arcs) {
      throw new Error(`Only arcs layers carry arcs: ${label}`);
    }
    if (layer.kind === "streakBurst") {
      if (!layer.streakBurst)
        throw new Error(`StreakBurst layer needs streakBurst: ${label}`);
      streakBurstChecks(layer.streakBurst, label);
    } else if (layer.streakBurst) {
      throw new Error(`Only streakBurst layers carry streakBurst: ${label}`);
    }
    if (layer.kind === "sheets") {
      if (!layer.sheets) throw new Error(`Sheets layer needs sheets: ${label}`);
      sheetChecks(layer.sheets, label);
    } else if (layer.sheets) {
      throw new Error(`Only sheets layers carry sheets: ${label}`);
    }
    if (layer.kind === "crescent") {
      if (!layer.crescent)
        throw new Error(`Crescent layer needs crescent: ${label}`);
      crescentChecks(layer.crescent, label);
    } else if (layer.crescent) {
      throw new Error(`Only crescent layers carry crescent: ${label}`);
    }
    if (layer.kind === "licks") {
      if (!layer.licks) throw new Error(`Licks layer needs licks: ${label}`);
      licksChecks(layer.licks, label);
      if (!crescentLayers.has(layer.licks.anchor.sourceLayerId))
        throw new Error(
          `Licks must follow a crescent layer: ${layer.licks.anchor.sourceLayerId}`,
        );
    } else if (layer.licks) {
      throw new Error(`Only licks layers carry licks: ${label}`);
    }
    // A sheet takes its colour from the cel bands, never from the ramp.
    if (layer.kind === "sheets" && !layer.material?.toon)
      throw new Error(`A sheets layer needs material.toon: ${label}`);
    // The two drawn-symbol fields only mean anything to a symbol pattern.
    if (
      layer.material?.symbol &&
      !SYMBOL_PROCEDURALS.has(layer.material.procedural)
    )
      throw new Error(
        `material.symbol needs a drawn-symbol procedural (starSolid/face/heart/crescent/cloudLobe/bolt): ${label}`,
      );
    if (
      SYMBOL_PROCEDURALS.has(layer.material?.procedural ?? "none") &&
      !layer.material?.symbol
    )
      throw new Error(
        `A drawn-symbol procedural needs material.symbol for its fill and outline: ${label}`,
      );
    if (layer.material?.symbol?.hot)
      checkCurve(layer.material.symbol.hot.alpha, `${label}/symbol.hot.alpha`);
    if (layer.collapse) {
      checkCurve(layer.collapse.heightCurve, `${label}/collapse.heightCurve`);
      checkCurve(layer.collapse.widthCurve, `${label}/collapse.widthCurve`);
      if (layer.collapse.start > layer.end - layer.start + KEY_TIME_EPSILON)
        throw new Error(
          `Collapse starts after the layer ends, so it never runs: ${label}`,
        );
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
    // The perimeter key exists only on a frame strip.
    if (
      layer.material?.reveal?.mode === "perimeter" &&
      layer.geometry?.type !== "frame"
    )
      throw new Error(
        `material.reveal mode "perimeter" needs geometry.type "frame": ${label}`,
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
      if (layer.geometry.type === "slab" && !layer.geometry.slab)
        throw new Error(`Slab geometry needs geometry.slab: ${label}`);
      if (layer.geometry.type === "frame" && !layer.geometry.frame)
        throw new Error(`Frame geometry needs geometry.frame: ${label}`);
      // A corner round wider than the bar's own half-extent inverts the strip.
      if (
        layer.geometry.frame &&
        layer.geometry.frame.corner >
          Math.min(layer.geometry.radius, layer.geometry.length * 0.5)
      )
        throw new Error(
          `Frame corner is wider than the frame itself: ${label}`,
        );
      // Outermost first: a tier wider than the one before it would be painted
      // over by it and never show.
      for (let i = 1; i < (layer.geometry.slab?.tiers.length ?? 0); i++)
        if (
          layer.geometry.slab!.tiers[i].height >=
          layer.geometry.slab!.tiers[i - 1].height
        )
          throw new Error(
            `Slab tiers must narrow, outermost first: ${label} tier ${i}`,
          );
    }

    if (layer.motion)
      for (let i = 0; i < layer.motion.keys.length; i++) {
        const t = layer.motion.keys[i][0];
        if (
          t > layer.end - layer.start + KEY_TIME_EPSILON ||
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
          t > layer.end - layer.start + KEY_TIME_EPSILON ||
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
  if (!options.workspace && !doc.layers.some((l) => l.enabled))
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
    // A flatStrip lick and a sliver take their size from render.strip /
    // render.sliver, which are bands of their own; render.size is only the
    // sizeCurve's carrier there.
    if (
      emitter.render.mode !== "flatStrip" &&
      emitter.render.mode !== "sliver" &&
      sizeMax / sizeMin < 1.2
    )
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
  // The framing rule that came out of the particle era (0.45-0.7, "roughly half
  // the frame") is wrong for a document whose biggest thing is a mesh volume:
  // there is no spray reaching past it, so at 0.65 the hero sits in the middle
  // of an empty shot. The exemplars that carry one all frame at 0.85-1.0.
  const meshHero = meshHeroLayerV2(doc);
  if (meshHero && doc.camera.framing < MESH_HERO_FRAMING_LINT)
    warnings.push(
      `camera.framing ${doc.camera.framing.toFixed(2)} is below ${MESH_HERO_FRAMING_LINT} while the largest layer (${meshHero.id}, ${meshHero.kind}) is a mesh hero; raise framing to 0.85-1.0 and copy the family exemplar's camera block (fov, elevation, azimuth) unless the prompt asks for a different angle.`,
    );

  // --- scale warnings ------------------------------------------------------
  // Nothing here is fatal: they describe a document that validates but renders
  // as a small, flat, unlit event inside the framed shot.
  for (const layer of doc.layers)
    if (
      layer.enabled &&
      layer.emitter &&
      // A flatStrip lick, a sliver and a drawn symbol are all drawn SHAPES, not
      // motes: six faces IS the population, and sixty would read as wallpaper.
      layer.emitter.render.mode !== "flatStrip" &&
      layer.emitter.render.mode !== "sliver" &&
      !SYMBOL_PROCEDURALS.has(layer.material?.procedural ?? "none") &&
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
  // What the document costs the GPU. A generated document combines kinds in
  // ways no exemplar does, and the renderer's cost is draw calls, distinct
  // programs and instances rather than layer count.
  const cost = gpuCostV2(doc);
  for (const [key, ceiling] of Object.entries(GPU_BUDGET_V2))
    if (cost[key as keyof typeof cost] > ceiling)
      warnings.push(
        `document: ${cost[key as keyof typeof cost]} ${key} exceeds the GPU budget of ${ceiling}.`,
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
    size = Math.max(size, layerExtentV2(layer, doc, includeParticles));
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

/**
 * One layer's own world-space extent in metres, by whichever spec object it
 * carries. Split out of `effectExtentV2` so the lint can also ask WHICH layer is
 * the biggest thing in the shot, which is what decides how the camera frames it.
 */
export function layerExtentV2(
  layer: LayerV2,
  doc: VfxDocumentV2,
  includeParticles = true,
): number {
  let size = 0;
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
  // A cage of arcs spans its own helix; a streak fan spans its longest ray.
  if (layer.arcs)
    size = Math.max(
      size,
      layer.arcs.radius[1] * (1 + layer.arcs.jitter.amplitude) * 2,
      layer.arcs.span,
    );
  if (layer.streakBurst)
    size = Math.max(size, layer.streakBurst.length[1] * 2);
  // A tail of sheets reaches as far as the fastest class travels in its own
  // life, plus the sheet itself; the blade of a crescent spans its own arc.
  if (layer.sheets) {
    const fastest = Math.max(...layer.sheets.classes.map((c) => c.speed * c.life));
    size = Math.max(
      size,
      layer.sheets.speed[1] * fastest + layer.sheets.length[1],
    );
  }
  if (layer.crescent)
    size = Math.max(size, layer.crescent.radius * 2);
  if (layer.licks) size = Math.max(size, layer.licks.length[1] * 2);
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
  return size;
}

/**
 * The biggest drawable layer in the document, when that layer is a mesh hero —
 * a blob cluster, a crystal burst, a blade, a swept ribbon or an SDF frame rim.
 * `null` when the shot is led by particles or by an ordinary primitive, which is
 * what the older 0.45-0.7 framing band was measured on.
 */
export function meshHeroLayerV2(doc: VfxDocumentV2): LayerV2 | null {
  // Dressing is excluded before size is measured: a ground decal and a flat
  // splash accent are both routinely the widest thing in the document and
  // neither is what the camera is framing. Roles narrow it the rest of the way
  // — the hero is what carries the effect, not the residue behind it.
  const candidates = doc.layers.filter(
    (l) =>
      l.enabled &&
      !HERO_EXCLUDED_KINDS.has(l.kind) &&
      (l.role === "primary" || l.role === "impact"),
  );
  let best: LayerV2 | null = null;
  let bestExtent = 0;
  for (const layer of candidates) {
    const extent = layerExtentV2(layer, doc);
    if (extent <= bestExtent) continue;
    bestExtent = extent;
    best = layer;
  }
  if (!best) return null;
  return MESH_HERO_KINDS_V2.has(best.kind) || best.geometry?.frame
    ? best
    : null;
}

/** Widest dimension of a path's own volume, in metres. Lint-only heuristic. */
function pathSpanV2(path: PathV2): number {
  if (path.type === "orbit")
    return Math.max(
      (path.radius + path.wobble.amplitude) * 2,
      Math.abs(path.height),
    );
  const points =
    path.type === "line"
      ? [path.from, path.to]
      : [path.from, path.control, path.to];
  return Math.max(
    ...[0, 1, 2].map(
      (axis) =>
        Math.max(...points.map((p) => p[axis])) -
        Math.min(...points.map((p) => p[axis])),
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
    shading: "unlit",
    blend: "additive",
    ramp: {
      space: "life",
      stops: [
        { t: 0, color: "#8cdfff", intensity: 1.7 },
        { t: 1, color: "#3478e5", intensity: 0.85 },
      ],
      displacementShift: 0,
      heightSpan: 2,
      blend: null,
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
    stripes: null,
    flicker: null,
    sdfLine: null,
    beads: null,
    flow: null,
    swirl: null,
    streaks: null,
    creases: null,
    screentone: null,
    symbol: null,
  };
}

/** The portal spike's rim: a bar, a hot spine, an inner line and three skirts. */
export function defaultSdfLine(): SdfLine {
  return {
    core: 0.78,
    spine: 0.02,
    innerOffset: 0.098,
    innerWidth: 0.018,
    halo: [
      { falloff: 0.05, weight: 0.62 },
      { falloff: 0.155, weight: 0.2 },
      { falloff: 0.48, weight: 0.055 },
    ],
  };
}

/** The portal spike's interior: three panning octaves plus a fine fourth. */
export function defaultFlow(): Flow {
  return {
    layers: [
      { scale: 1.6, pan: [0.048, 0.086], rotate: 0 },
      { scale: 3.4, pan: [-0.115, 0.052], rotate: 0.5236 },
      { scale: 6.6, pan: [0.072, -0.131], rotate: 0 },
      { scale: 13.5, pan: [-0.05, 0.21], rotate: 0 },
    ],
    mix: [0.48, 0.3, 0.16, 0.06],
    threshold: 0.36,
    softness: 0.27,
    parallax: 0.05,
  };
}

/** The vortex spike's disc, in the units the exemplar uses. */
export function defaultSwirl(): Swirl {
  return {
    bands: { arms: 3, wind: 1.85, width: 0.5, warp: 1.4 },
    detail: { arms: 7, wind: 2.75, warp: 6.2, contrast: 0.62 },
    lobe: { scale1: 2, scale2: 4, amount: 0.82 },
    strength: defaultCurve(0, 1),
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
    colorSource: "fixed",
    shadowScale: 0.55,
    highlightMix: 0.35,
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
    pathId: null,
    head: null,
    perAnchor: 1,
    retract: null,
    lightFrom: null,
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
      interiorFraction: 0,
      angleJitter: 0,
      angleBias: 0,
    },
    spawn: {
      mode: "burst",
      window: 0.12,
      rate: 0,
      duration: 0,
      bursts: [],
      headCurve: null,
      originsFromPath: false,
      sourceLayerId: null,
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
      strip: null,
      anchor: "center",
      sliver: null,
      retract: null,
      secondary: null,
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
    slab: null,
    frame: null,
  };
}

/** The portal spike's doorway: 1.6 x 2.4 with a 0.06 corner. */
export function defaultFrame(): Frame {
  return { corner: 0.06, perimeterOrigin: "bottom" };
}

/** The beam spike's body: a violet outer tier, a magenta body, a pink core. */
export function defaultSlab(): Slab {
  return {
    anchor: "center",
    tiers: [
      { height: 0.62, color: "#5719b8", intensity: 0.34 },
      { height: 0.275, color: "#c705e6", intensity: 0.56 },
      { height: 0.125, color: "#ff6ef0", intensity: 0.42 },
    ],
    taper: 1,
  };
}

/** The column spike's cage, in the units the exemplar uses. */
export function defaultArcs(): Arcs {
  return {
    count: 12,
    radius: [0.26, 0.52],
    pitch: [0.4, 1.8],
    span: 3.1,
    jitter: { amplitude: 0.7, frequency: 9, fold: 1 },
    blink: {
      period: [0.18, 0.38],
      onTime: [0.07, 0.15],
      skipChance: 0.26,
    },
    width: 0.028,
    coreColor: "#dff4ff",
    haloColor: "#ffb020",
    seed: 6131,
  };
}

/** The column spike's eruption fan. */
export function defaultStreakBurst(): StreakBurst {
  return {
    count: 56,
    length: [1.5, 4],
    width: [0.03, 0.08],
    curvature: 0.2,
    upBias: 0.42,
    bundles: 7,
    bundleSpread: 0.48,
    stagger: 0.22,
    grow: defaultCurve(0, 1),
    hues: ["#ff8a2a", "#ff4a8a", "#ffd27a"],
    seed: 2313,
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
      groundColor: "#484b4e",
      groundReflect: 0,
      ambient: 1,
      groundY: 0,
      fog: { color: "#282a2c", density: 0.045 },
      background: "#282a2c",
      groundPool: null,
      backdrop: null,
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
      flash: null,
    },
    paths: [],
    textures: [],
  };
}

/** The water spike's tail: twenty membranes in three classes on two cadences. */
export function defaultSheets(): Sheets {
  return {
    count: 20,
    length: [0.42, 1.36],
    width: [0.21, 0.52],
    curl: [1.05, 2.2],
    bow: 0.16,
    taper: 0.55,
    classes: [
      { weight: 0.34, length: 1, width: 1, speed: 1, life: 1.02, period: 1.2 },
      { weight: 0.33, length: 1.3, width: 1.25, speed: 1.1, life: 1.08, period: 1.2 },
      { weight: 0.33, length: 1.8, width: 1.5, speed: 1.6, life: 1.95, period: 2.55 },
    ],
    spawn: { axisFrom: -0.2, axisTo: 0.26 },
    flow: [0, 0, 1],
    speed: [0.82, 1.9],
    undulation: { amplitude: 0.12, frequency: 0.7 },
    tumble: 1.7,
    scaleIn: 0.1,
    shrinkOut: 0.12,
    tear: { scale: 3.4, threshold: 0.24 },
    seed: 5171,
  };
}

/** The slash spike's blade: R 1.5, a 200-degree sweep, three tonal copies. */
export function defaultCrescent(): Crescent {
  return {
    radius: 1.5,
    sweep: 3.4907,
    phase: -1.746,
    planeTilt: 0.32,
    window: {
      head: { keys: [[0, 0], [0.1, 0], [0.22, 1], [1, 1]], ease: "smooth" },
      tail: { keys: [[0, 0], [0.22, 0], [0.5, 1], [1, 1]], ease: "smooth" },
    },
    thickness: { max: 0.52, peakFrom: 0.4, tipPower: 0.35, rootFade: 0.26 },
    widthSpace: "screen",
    tonal: [
      {
        scale: 1.2,
        radialOffset: -0.135,
        timeLead: -0.013,
        blend: "alpha",
        erode: 0.16,
        tipHot: 0,
        ramp: [
          { t: 0, color: "#c93a09", intensity: 1 },
          { t: 0.25, color: "#7a1a08", intensity: 1 },
          { t: 0.68, color: "#4e0f03", intensity: 1 },
          { t: 1, color: "#240401", intensity: 1 },
        ],
        smear: null,
      },
      {
        scale: 1,
        radialOffset: 0,
        timeLead: 0,
        blend: "alpha",
        erode: 0.1,
        tipHot: 0.18,
        ramp: [
          { t: 0, color: "#ffeeb8", intensity: 0.86 },
          { t: 0.25, color: "#ff7a1a", intensity: 1 },
          { t: 0.68, color: "#ff3c10", intensity: 1 },
          { t: 1, color: "#8e1e05", intensity: 1 },
        ],
        smear: null,
      },
      {
        scale: 0.52,
        radialOffset: 0.085,
        timeLead: 0.013,
        blend: "additive",
        erode: 0.26,
        tipHot: 0.85,
        ramp: [
          { t: 0, color: "#fff6d6", intensity: 0.48 },
          { t: 0.25, color: "#ffc25c", intensity: 0.24 },
          { t: 0.68, color: "#ff7c1c", intensity: 0.12 },
          { t: 1, color: "#c03806", intensity: 0.03 },
        ],
        smear: null,
      },
    ],
    erosionFront: {
      width: 0.4,
      widthFollowsWindow: true,
      voronoi: { scale: 9, seamWidth: 0.1 },
    },
    streaks: {
      space: "surface",
      frequency: 9,
      pan: 1.9,
      width: 0.06,
      segmentation: 2,
      color: "#ffb040",
      intensity: 0.7,
      fadeAlong: [0, 1],
      radiate: false,
    },
    widen: 0.42,
    seed: 3301,
  };
}

/** The slash spike's eight peeling licks. */
export function defaultLicks(): Licks {
  return {
    count: 8,
    length: [0.32, 0.78],
    width: [0.14, 0.4],
    curl: 0.22,
    flipbookHz: 10,
    anchor: { sourceLayerId: "blade", follow: "erosionFront", offset: 0.03 },
    drift: [0, 0.3, 0],
    stagger: [0.2, 0.38],
    life: [0.28, 0.58],
    colors: ["#ffc457", "#ff6412"],
    seed: 8117,
  };
}

/** The playful spike's blue vignette. */
export function defaultBackdrop(): Backdrop {
  return {
    mode: "radial",
    hot: "#3d8ada",
    cold: "#0c2a55",
    center: [0.5, 0.46],
    aspect: 1.1,
    topFalloff: 0.4,
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
    arcs: defaultArcs(),
    streakBurst: defaultStreakBurst(),
    slab: defaultSlab(),
    frame: defaultFrame(),
    sdfLine: defaultSdfLine(),
    flow: defaultFlow(),
    swirl: defaultSwirl(),
    sheets: defaultSheets(),
    crescent: defaultCrescent(),
    licks: defaultLicks(),
    backdrop: defaultBackdrop(),
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
  blend: RampBlendSchema.nullable(),
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
  // Defaulted like MaterialSchema: a wire payload that omits it is unlit, not invalid.
  shading: z.enum(SHADING_MODES_V2).default("unlit"),
  mask: MaskWireSchema,
  noise: NoiseWireSchema.nullable(),
  erosion: ErosionWireSchema.nullable(),
  proceduralParams: num4,
  toon: ToonSchema.extend({
    thresholds: num2,
    light: num3,
    colorSource: z.enum(["fixed", "ramp"]),
    shadowScale: scalar(0, 1),
    highlightMix: scalar(0, 1),
  }).nullable(),
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
  stripes: z.array(StripeSchema).max(STRIPE_BUDGET_V2).nullable(),
  flicker: FlickerSchema.nullable(),
  sdfLine: SdfLineSchema.nullable(),
  beads: BeadsSchema.nullable(),
  flow: FlowSchema.extend({
    layers: z.array(FlowLayerSchema.extend({ pan: num2 })).min(1).max(FLOW_LAYER_BUDGET_V2),
  }).nullable(),
  swirl: SwirlSchema.extend({ strength: CurveWireSchema }).nullable(),
  streaks: StreaksSchema.extend({ fadeAlong: num2 }).nullable(),
  creases: CreasesSchema.nullable(),
  screentone: ScreentoneSchema.nullable(),
  symbol: SymbolSchema.extend({
    hot: z
      .object({ color: hex, intensity: scalar(0, 8), alpha: CurveWireSchema })
      .strict()
      .nullable(),
  }).nullable(),
});

export const SheetsWireSchema = SheetsSchema.extend({
  length: num2,
  width: num2,
  curl: num2,
  speed: num2,
  flow: num3,
  tear: SheetTearSchema.nullable(),
});
export const CrescentWireSchema = CrescentSchema.extend({
  window: CrescentWindowSchema.extend({
    head: CurveWireSchema,
    tail: CurveWireSchema,
  }),
  tonal: z
    .array(
      CrescentTonalSchema.extend({
        smear: CrescentSmearSchema.extend({ window: num2 }).nullable(),
      }),
    )
    .min(1)
    .max(CRESCENT_TONAL_BUDGET_V2),
  streaks: StreaksSchema.extend({ fadeAlong: num2 }).nullable(),
});
export const LicksWireSchema = LicksSchema.extend({
  length: num2,
  width: num2,
  stagger: num2,
  life: num2,
  drift: num3,
  colors: z.array(hex).length(2),
});
export const ArcsWireSchema = ArcsSchema.extend({
  radius: num2,
  pitch: num2,
  blink: ArcBlinkSchema.extend({ period: num2, onTime: num2 }),
});
export const StreakBurstWireSchema = StreakBurstSchema.extend({
  length: num2,
  width: num2,
  grow: CurveWireSchema,
  hues: z.array(hex).length(3),
});
export const CollapseWireSchema = CollapseSchema.extend({
  heightCurve: CurveWireSchema,
  widthCurve: CurveWireSchema,
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
  LinePathSchema.extend({ from: num3, to: num3 }),
]);
export const BlobWireSchema = BlobSchema.extend({
  radius: num2,
  stagger: num2,
  life: num2,
  pathId: PathIdSchema.nullable(),
  head: CurveWireSchema.nullable(),
  perAnchor: integer(1, 4),
  retract: z
    .object({
      from: scalar(0, 1),
      to: scalar(0, 1),
      alongBias: scalar(0, 2),
    })
    .strict()
    .nullable(),
  lightFrom: z
    .object({
      layerId: z.string().max(48).nullable(),
      position: num3,
      falloff: scalar(0, 4),
    })
    .strict()
    .nullable(),
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
    interiorFraction: scalar(0, 1),
    angleJitter: scalar(0, Math.PI),
    angleBias: scalar(-1, 1),
  }),
  spawn: SpawnSchema.extend({
    headCurve: CurveWireSchema.nullable(),
    originsFromPath: z.boolean(),
    sourceLayerId: z.string().max(48).nullable(),
  }),
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
    strip: StripSchema.extend({ length: num2, width: num2 }).nullable(),
    anchor: z.enum(["center", "head"]),
    sliver: SliverRenderSchema.extend({ length: num2, width: num2 }).nullable(),
    retract: RetractSchema.nullable(),
    secondary: SecondarySchema.extend({ along: num2 }).nullable(),
  }),
  trail: TrailSchema.extend({
    widthCurve: CurveWireSchema,
    ramp: TrailRampSchema.nullable(),
  }).nullable(),
  sub: SubEmitterSchema.extend({ offset: num2 }).nullable(),
});
export const GeometryV2WireSchema = GeometryV2Schema.extend({
  taper: scalar(0.05, 1),
  band: BandSchema.nullable(),
  slab: SlabSchema.nullable(),
  frame: FrameSchema.nullable(),
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
    squash: SquashSchema.nullable(),
  }),
  motion: MotionWireSchema.nullable(),
  jitter: JitterSchema.extend({ axis: num3.nullable() }).nullable(),
  collapse: CollapseWireSchema.nullable(),
  window: LayerWindowSchema.nullable(),
  material: MaterialWireSchema.nullable(),
  emitter: EmitterWireSchema.nullable(),
  geometry: GeometryV2WireSchema.nullable(),
  light: LightSchema.extend({ intensity: CurveWireSchema }).nullable(),
  blob: BlobWireSchema.nullable(),
  splash: SplashWireSchema.nullable(),
  ribbon: RibbonWireSchema.nullable(),
  wireBurst: WireBurstWireSchema.nullable(),
  crystals: CrystalsWireSchema.nullable(),
  arcs: ArcsWireSchema.nullable(),
  streakBurst: StreakBurstWireSchema.nullable(),
  reflection: ReflectionSchema.nullable(),
  sheets: SheetsWireSchema.nullable(),
  crescent: CrescentWireSchema.nullable(),
  licks: LicksWireSchema.nullable(),
  frame: z.enum(["camera"]).nullable(),
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
  environment: EnvironmentSchema.extend({
    ambient: scalar(0, 3),
    groundPool: z
      .array(GroundPoolSchema.extend({ position: num3, intensity: CurveWireSchema }))
      .max(GROUND_POOL_BUDGET_V2)
      .nullable(),
    backdrop: BackdropSchema.extend({ center: num2 }).nullable(),
  }),
  post: PostSchema.extend({
    glitch: GlitchSchema.extend({
      curve: CurveWireSchema,
      blockGrid: z.array(z.number().int()).length(2),
    }).nullable(),
    flash: FlashSchema.extend({ curve: CurveWireSchema }).nullable(),
  }),
  paths: z.array(PathV2WireSchema).max(PATH_BUDGET_V2),
  layers: z.array(LayerV2WireSchema).min(1).max(24),
});

export type VfxDocumentV2Wire = z.infer<typeof DocumentV2WireSchema>;

/** The window a layer keeps when a clamped end would otherwise invert it. */
const MIN_LAYER_SPAN = 0.01;

/** The bound a track value carries when V2_TARGET_RANGES names no range. */
const TRACK_VALUE_RANGE: readonly [number, number] = [-20, 20];

/**
 * The property names the contract spells `range(min, max)` and checkRange reads
 * as `[min, max]`. Every one of them arrives on the wire as a bare pair of
 * numbers, and no other two-number field in the document carries any of these
 * names — the rest are pans, UV scales, grids, centres and curve keys, whose
 * order means something else and which are left alone.
 */
const RANGE_PAIR_KEYS = new Set([
  "along",
  "curl",
  "detach",
  "elevation",
  "fade",
  "initial",
  "life",
  "length",
  "offset",
  "onTime",
  "period",
  "pitch",
  "radius",
  "scaleIn",
  "sides",
  "size",
  "speed",
  "spread",
  "stagger",
  "thresholds",
  "width",
  "window",
]);

const isNumberPair = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

/**
 * Put a backwards range the right way round, in place. A model that writes a
 * speed of [6, 2] has said what it means — the layer is refused today over the
 * order of two numbers it already chose, and reading them the other way round
 * is the only thing the pair can mean.
 */
function orderRangePairs(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(orderRangePairs);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (RANGE_PAIR_KEYS.has(key) && isNumberPair(child)) {
      if (child[0] > child[1]) child.reverse();
    } else orderRangePairs(child);
  }
}

const clampTo = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(Math.max(value, min), max);

/**
 * Saturate the near-misses a generated document arrives with, instead of
 * refusing the whole document over one number. A keyframe value a little past
 * its target's range, a key past the end of its own layer and a layer running
 * past the document's end are each a single value the renderer would have
 * clamped anyway, and losing a generation to one of them costs the user the
 * effect. Nothing else is touched, so a document broken in a way a clamp cannot
 * express is still rejected with the message that says why — including a track
 * whose keys the clamp would collapse, which is put back as it was authored.
 */
export function clampWireDocumentV2(
  input: VfxDocumentV2Wire,
): VfxDocumentV2Wire {
  const wire = structuredClone(input);
  orderRangePairs(wire);
  return {
    ...wire,
    layers: wire.layers.map((layer) => {
      const end = Math.min(layer.end, wire.duration);
      const start =
        layer.start < end ? layer.start : Math.max(0, end - MIN_LAYER_SPAN);
      const span = end - start;
      // A key pulled back onto the one before it says nothing that key does not
      // already say, so it goes rather than break the ascending contract.
      const inSpan = (keys: number[][]) => {
        const kept: number[][] = [];
        for (const key of keys) {
          // The validator's own slack, so a key only a float's width past the
          // span is left exactly as the model wrote it.
          const at = key[0] > span + KEY_TIME_EPSILON ? span : key[0];
          if (kept.length && at <= kept[kept.length - 1][0]) continue;
          kept.push([at, ...key.slice(1)]);
        }
        return kept.length >= 2 ? kept : keys;
      };
      return {
        ...layer,
        start,
        end,
        motion: layer.motion && {
          ...layer.motion,
          keys: inSpan(layer.motion.keys),
        },
        tracks: layer.tracks.map((track) => {
          const bounds = V2_TARGET_RANGES[track.target] ?? TRACK_VALUE_RANGE;
          return {
            ...track,
            keys: inSpan(track.keys.map(([t, v]) => [t, clampTo(v, bounds)])),
          };
        }),
      };
    }),
  };
}

/**
 * Parse a Structured Outputs payload and re-validate it as a runtime document.
 * Kind-dependent slots arrive as explicit nulls on the wire and are dropped.
 * Out-of-range track values and overlong windows are clamped on the way in:
 * every caller — studio authoring, the local run, a refine proposal — wants the
 * same near-miss saturated rather than the generation thrown away.
 */
export function fromWireV2(
  input: unknown,
  textures: TextureAsset[] = [],
): VfxDocumentV2 {
  const wire = clampWireDocumentV2(DocumentV2WireSchema.parse(input));
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
      "arcs",
      "streakBurst",
      "reflection",
      "sheets",
      "crescent",
      "licks",
    ])
      if (next[slot] === null) delete next[slot];
    return next;
  });
  return validateDocumentV2({ ...wire, layers, textures });
}

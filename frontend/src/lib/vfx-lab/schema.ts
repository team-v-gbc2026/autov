import { z } from "zod";

export const KINDS = [
  "ring",
  "shell",
  "trail",
  "beam",
  "sprite",
  "particles",
  "decal",
] as const;
export const NUMERIC = [
  "radius",
  "width",
  "length",
  "intensity",
  "opacity",
  "speed",
  "turbulence",
  "erosion",
  "spin",
] as const;
export const RANGES: Record<(typeof NUMERIC)[number], [number, number]> = {
  radius: [0.01, 8],
  width: [0.001, 3],
  length: [0.01, 12],
  intensity: [0, 8],
  opacity: [0, 1],
  speed: [-8, 8],
  turbulence: [0, 2],
  erosion: [0, 1],
  spin: [-10, 10],
};
const scalar = (min: number, max: number) => z.number().min(min).max(max);
const vec3 = z.tuple([scalar(-12, 12), scalar(-12, 12), scalar(-12, 12)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const ParamsSchema = z
  .object({
    position: vec3,
    rotation: vec3,
    color: hex,
    secondaryColor: hex,
    radius: scalar(0.01, 8),
    width: scalar(0.001, 3),
    length: scalar(0.01, 12),
    intensity: scalar(0, 8),
    opacity: scalar(0, 1),
    speed: scalar(-8, 8),
    turbulence: scalar(0, 2),
    erosion: scalar(0, 1),
    spin: scalar(-10, 10),
    arc: scalar(0.05, Math.PI * 2),
    count: z.number().int().min(1).max(16000),
    life: scalar(0.05, 10),
    emission: scalar(0, 6),
    spread: scalar(0, 1),
    gravity: scalar(-12, 12),
    drag: scalar(0, 6),
    blend: z.enum(["additive", "normal"]),
  })
  .strict();
export const TrackSchema = z
  .object({
    target: z.enum(NUMERIC),
    keys: z
      .array(z.tuple([scalar(0, 12), z.number()]))
      .min(2)
      .max(12),
    ease: z.enum(["linear", "smooth", "outCubic", "inQuad"]),
  })
  .strict();
export const OverrideSchema = z
  .object({
    target: z.enum([...NUMERIC, "color"]),
    value: z.union([z.number(), hex]),
    start: scalar(0, 12),
    end: scalar(0, 12),
    fade: scalar(0, 1),
  })
  .strict();
export const GEOMETRIES = ["auto", "plane", "teardrop", "cone", "crystal", "torus", "ribbon", "lightning"] as const;
export const SURFACES = ["default", "flame", "water", "hexagon", "smoke", "star", "solid", "portal"] as const;
export const MotionSchema = z.object({
  // Local seconds, then XYZ offsets in meters from params.position.
  keys: z.array(z.tuple([scalar(0, 12), scalar(-12, 12), scalar(-12, 12), scalar(-12, 12)])).min(2).max(8),
  ease: z.enum(["linear", "smooth"]),
}).strict();
export const TextureAssetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  data: z.string().max(3_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  prompt: z.string().max(2500),
  model: z.string().max(100),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TextureAsset = z.infer<typeof TextureAssetSchema>;
export const LayerSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    name: z.string().min(1).max(80),
    role: z.enum(["anticipation", "primary", "impact", "secondary", "residue"]),
    kind: z.enum(KINDS),
    start: scalar(0, 12),
    end: scalar(0, 12),
    enabled: z.boolean(),
    params: ParamsSchema,
    geometry: z.enum(GEOMETRIES).nullable().optional(),
    surface: z.enum(SURFACES).nullable().optional(),
    motion: MotionSchema.nullable().optional(),
    textureId: z.string().max(48).nullable().optional(),
    tracks: z.array(TrackSchema).max(12),
    overrides: z.array(OverrideSchema).max(64),
  })
  .strict();
export const DocumentSchema = z
  .object({
    schemaVersion: z.literal("autov.lab/1"),
    name: z.string().min(1).max(100),
    description: z.string().max(1500),
    seed: z.number().int().min(0).max(2147483647),
    duration: scalar(0.5, 12),
    impact: scalar(0, 12),
    layers: z.array(LayerSchema).min(1).max(18),
    textures: z.array(TextureAssetSchema).max(2).optional(),
    post: z
      .object({
        bloom: scalar(0, 2),
        exposure: scalar(0.3, 2),
        background: hex,
      })
      .strict(),
  })
  .strict();
export type VfxDocument = z.infer<typeof DocumentSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Params = z.infer<typeof ParamsSchema>;
export type Override = z.infer<typeof OverrideSchema>;
export type NumericTarget = (typeof NUMERIC)[number];
export function validateDocument(input: unknown): VfxDocument {
  const doc = DocumentSchema.parse(input);
  if (doc.impact >= doc.duration)
    throw new Error("Impact must be before the end.");
  const assets = new Set<string>();
  for (const asset of doc.textures || []) {
    if (assets.has(asset.id)) throw new Error("Duplicate texture ID.");
    assets.add(asset.id);
  }
  const ids = new Set<string>();
  let particles = 0;
  for (const layer of doc.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate layer: ${layer.id}`);
    ids.add(layer.id);
    if (layer.textureId && !assets.has(layer.textureId)) throw new Error(`Missing texture: ${layer.textureId}`);
    if (layer.kind === "particles" && layer.textureId) throw new Error("Generated textures require a surface layer.");
    if (layer.kind === "particles" && layer.geometry && layer.geometry !== "auto") throw new Error("Particles use instanced billboards; use a surface layer for meshes.");
    if (layer.motion) for (let i = 0; i < layer.motion.keys.length; i++) {
      const t = layer.motion.keys[i][0];
      if (t > layer.end - layer.start + 1e-6 || (i > 0 && t <= layer.motion.keys[i-1][0])) throw new Error(`Invalid motion keys: ${layer.id}`);
    }
    if (layer.start >= layer.end || layer.end > doc.duration)
      throw new Error(`Invalid interval: ${layer.id}`);
    if (layer.kind === "particles") particles += layer.params.count;
    const targets = new Set<string>();
    for (const track of layer.tracks) {
      if (targets.has(track.target))
        throw new Error(`Duplicate track: ${layer.id}/${track.target}`);
      targets.add(track.target);
      const [lo, hi] = RANGES[track.target];
      for (let i = 0; i < track.keys.length; i++) {
        const [t, v] = track.keys[i];
        if (
          t > layer.end - layer.start + 1e-6 ||
          v < lo ||
          v > hi ||
          (i > 0 && t <= track.keys[i - 1][0])
        )
          throw new Error(`Invalid keyframe: ${layer.id}/${track.target}`);
      }
    }
    for (const o of layer.overrides) validateOverride(o, doc.duration);
  }
  if (particles > 48000) throw new Error("Particle budget exceeded (48,000).");
  if (!doc.layers.some((l) => l.enabled))
    throw new Error("At least one layer must be enabled.");
  return doc;
}
// Generation must provide something drawable, rather than transparent placeholders.
// Editing/import may intentionally contain invisible layers, so this is a generation-only gate.
export function validateGeneratedDocument(input: unknown): VfxDocument {
  const doc = validateDocument(input);
  const peak = (layer: Layer, target: "opacity" | "intensity") => {
    const track = layer.tracks.find((t) => t.target === target);
    return track
      ? Math.max(...track.keys.map((k) => k[1]))
      : layer.params[target];
  };
  if (
    !doc.layers.some(
      (l) => l.enabled && peak(l, "opacity") > 0 && peak(l, "intensity") > 0,
    )
  )
    throw new Error(
      "Generated document has no visible energy. Replace transparent placeholders with the complete planned effect.",
    );
  return doc;
}
export function validateOverride(input: unknown, duration: number): Override {
  const o = OverrideSchema.parse(input);
  if (o.start >= o.end || o.end > duration || o.fade > (o.end - o.start) / 2)
    throw new Error("Invalid edit window.");
  if (o.target === "color") {
    if (typeof o.value !== "string")
      throw new Error("Color must be a hex string.");
  } else {
    const [lo, hi] = RANGES[o.target];
    if (typeof o.value !== "number" || o.value < lo || o.value > hi)
      throw new Error("Edit value outside supported range.");
  }
  return o;
}
// Structured Outputs uses homogeneous arrays; tuples remain in the validated runtime contract.
export const DocumentWireSchema = DocumentSchema.omit({ textures: true }).extend({
  layers: z
    .array(
      LayerSchema.extend({
        geometry: z.enum(GEOMETRIES).nullable(),
        surface: z.enum(SURFACES).nullable(),
        motion: MotionSchema.extend({ keys: z.array(z.array(z.number()).length(4)).min(2).max(8) }).nullable(),
        textureId: z.string().max(48).nullable(),
        params: ParamsSchema.extend({
          position: z.array(z.number()).length(3),
          rotation: z.array(z.number()).length(3),
        }),
        tracks: z
          .array(
            TrackSchema.extend({
              keys: z.array(z.array(z.number()).length(2)).min(2).max(12),
            }),
          )
          .max(12),
      }),
    )
    .min(1)
    .max(18),
});

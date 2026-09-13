// ---------------------------------------------------------------------------
// UI bridge — projects an autov.lab/2 document onto the product timeline's
// `VfxUiDocument` dialect and writes the UI's edits back into the v2 document.
//
// The v2 document is the source of truth. `projectToUi` is a pure projection
// used for rendering the emitter timeline, rows, controls and chat; every
// mutation the UI can express goes back through `applyLayerPatch`,
// `applyEnvironment`, `applyDuration` or `addLayer`, which return a NEW,
// validated v2 document (and the previous one when a write would be invalid, so
// an out-of-range drag can never throw into React).
//
// The projection is deliberately lossy: the six UI parameters are a curated
// view over a much larger contract. What each one reads and writes, per layer
// kind, is the table below. Everything the UI cannot express is preserved
// untouched.
//
//   UI parameter | particles                      | mesh kinds (ring, shell,
//                |                                | trail, beam, sprite, decal)
//                |                                |                      | light
//   -------------+--------------------------------+----------------------+---------------------
//   Intensity    | max material.ramp.stops[].intensity (0..8)             | max light.intensity
//                | (all stops scale by the same ratio)                    | key (0..20), all
//                |                                                        | keys scale by ratio
//   Radius       | emitter.shape.radius (0..12)    | geometry.radius      | light.radius
//                |                                 | (0.01..8)            | (0.5..30)
//   Opacity      | material.opacity (0..1)         | material.opacity     | — (no material)
//   Speed        | max |emitter.velocity.speed|    | geometry.vertexNoise | —
//                | (0..20), both ends scale        | .speed (0..4)        |
//   Turbulence   | emitter.forces.curl.strength    | geometry.vertexNoise | —
//                | (0..3)                          | .amplitude (0..0.5)  |
//   Erosion      | max material.erosion.curve key  | same                 | —
//                | (0..1); 0 when erosion is null  |                      |
//   color        | material.ramp.stops[0].color    | same                 | light.color
//   secondary    | material.ramp.stops[last].color | same                 | — (mirrors color)
//   blend        | material.blend                  | same                 | —
//
// Radius picks `emitter.shape.radius` for particles and `geometry.radius` for
// meshes to stay on the vocabulary the repo already uses for the same idea
// (`V1_TARGET_MAP` / `V1_PARTICLE_TARGET_MAP` in schema-v2.ts), so a UI edit and
// a generated scoped edit move the same number.
//
// Writes that have no meaning for a kind leave the document unchanged: Opacity,
// Speed, Turbulence, Erosion, blend and secondaryColor on a light layer, and
// Speed/Turbulence on a mesh layer are documented no-ops. Turbulence and Erosion
// do create the optional sub-object they drive (`forces.curl`,
// `geometry.vertexNoise`, `material.erosion`) when raised above zero from a
// layer that has none, because the slider is otherwise dead.
// ---------------------------------------------------------------------------

import {
  defaultDocumentShell,
  V2_TARGET_RANGES,
  defaultCurve,
  defaultEmitter,
  defaultMaterial,
  validateDocumentV2,
  type LayerV2,
  type VfxDocumentV2,
} from "./schema-v2";
import {
  PARAMETER_NAMES,
  type ParameterName,
  type VfxLayer,
  type VfxUiDocument,
} from "@/components/vfx-studio/ui-model";

type Range = readonly [number, number];

const RAMP_INTENSITY: Range = V2_TARGET_RANGES["material.ramp.stops[0].intensity"];
const LIGHT_INTENSITY: Range = [0, 20];
const PARTICLE_RADIUS: Range = V2_TARGET_RANGES["emitter.shape.radius"];
const MESH_RADIUS: Range = V2_TARGET_RANGES["geometry.radius"];
const LIGHT_RADIUS: Range = V2_TARGET_RANGES["light.radius"];
const OPACITY: Range = V2_TARGET_RANGES["material.opacity"];
const PARTICLE_SPEED: Range = [0, V2_TARGET_RANGES["emitter.velocity.speed[1]"][1]];
const NOISE_SPEED: Range = V2_TARGET_RANGES["geometry.vertexNoise.speed"];
const CURL: Range = V2_TARGET_RANGES["emitter.forces.curl.strength"];
const NOISE_AMPLITUDE: Range = V2_TARGET_RANGES["geometry.vertexNoise.amplitude"];
const EROSION: Range = [0, 1];
const BLOOM: Range = [0, 2];
const EXPOSURE: Range = [0.3, 2];

/** Longest document the v2 contract accepts. */
export const MAX_DURATION_V2 = 12;
export const MIN_DURATION_V2 = 0.5;
/** Longest document name the v2 contract accepts. */
export const MAX_DOCUMENT_NAME = 100;
const FALLBACK_COLOR = "#ffb23e";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** A v2 value inside `range` as the 0–100 the UI slider shows. */
function toUi(value: number, range: Range) {
  const [min, max] = range;
  if (!Number.isFinite(value) || max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** The inverse of `toUi`. */
function fromUi(value: number, range: Range) {
  const [min, max] = range;
  return clamp(min + (clamp(value, 0, 100) / 100) * (max - min), min, max);
}

// --- projection ------------------------------------------------------------

function rampStops(layer: LayerV2) {
  return layer.material?.ramp.stops ?? [];
}

function erosionLevel(layer: LayerV2) {
  const curve = layer.material?.erosion?.curve;
  if (!curve) return 0;
  return Math.max(0, ...curve.keys.map(([, v]) => v));
}

function layerIntensity(layer: LayerV2) {
  if (layer.kind === "light" && layer.light)
    return toUi(
      Math.max(0, ...layer.light.intensity.keys.map(([, v]) => v)),
      LIGHT_INTENSITY,
    );
  const stops = rampStops(layer);
  if (!stops.length) return 0;
  return toUi(Math.max(...stops.map((stop) => stop.intensity)), RAMP_INTENSITY);
}

function layerRadius(layer: LayerV2) {
  if (layer.kind === "light" && layer.light)
    return toUi(layer.light.radius, LIGHT_RADIUS);
  if (layer.kind === "particles" && layer.emitter)
    return toUi(layer.emitter.shape.radius, PARTICLE_RADIUS);
  if (layer.geometry) return toUi(layer.geometry.radius, MESH_RADIUS);
  return 0;
}

function layerSpeed(layer: LayerV2) {
  if (layer.kind === "particles" && layer.emitter)
    return toUi(
      Math.max(...layer.emitter.velocity.speed.map(Math.abs)),
      PARTICLE_SPEED,
    );
  const noise = layer.geometry?.vertexNoise;
  return noise ? toUi(noise.speed, NOISE_SPEED) : 0;
}

function layerTurbulence(layer: LayerV2) {
  if (layer.kind === "particles" && layer.emitter)
    return toUi(layer.emitter.forces.curl?.strength ?? 0, CURL);
  const noise = layer.geometry?.vertexNoise;
  return noise ? toUi(noise.amplitude, NOISE_AMPLITUDE) : 0;
}

function projectParameters(layer: LayerV2): Record<ParameterName, number> {
  return {
    Intensity: layerIntensity(layer),
    Radius: layerRadius(layer),
    Opacity: toUi(layer.material?.opacity ?? 0, OPACITY),
    Speed: layerSpeed(layer),
    Turbulence: layerTurbulence(layer),
    Erosion: toUi(erosionLevel(layer), EROSION),
  };
}

function projectLayer(layer: LayerV2): VfxLayer {
  const stops = rampStops(layer);
  const color = stops[0]?.color ?? layer.light?.color ?? FALLBACK_COLOR;
  return {
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    start: layer.start,
    end: layer.end,
    enabled: layer.enabled,
    color,
    secondaryColor: stops.length ? stops[stops.length - 1].color : color,
    blend:
      layer.material && (layer.material.blend === "alpha" ||
        layer.material.blend === "premultiplied")
        ? "normal"
        : "additive",
    parameters: projectParameters(layer),
    edits: layer.overrides.map((override, index) => ({
      id: `${layer.id}-override-${index + 1}`,
      prompt: `${override.target} → ${override.value}`,
      start: override.start,
      end: override.end,
    })),
  };
}

/** The empty-timeline projection: no emitters, main's default environment. */
export function emptyUiDocument(): VfxUiDocument {
  return {
    name: "Untitled",
    duration: 3,
    layers: [],
    environment: { bloom: 64, exposure: 48 },
  };
}

/**
 * Pure projection of a v2 document onto the UI dialect. Never routed through
 * `normalizeVfxDocument` — that rejects an empty layer list, which is exactly
 * the state a fresh workspace is in.
 */
export function projectToUi(doc: VfxDocumentV2 | null): VfxUiDocument {
  if (!doc) return emptyUiDocument();
  return {
    name: doc.name,
    duration: doc.duration,
    layers: doc.layers.map(projectLayer),
    // Rounded: main's environment strip renders these numbers verbatim next to
    // an integer-step slider.
    environment: {
      bloom: Math.round(toUi(doc.post.bloom.strength, BLOOM)),
      exposure: Math.round(toUi(doc.post.exposure, EXPOSURE)),
    },
  };
}

// --- inverse writes --------------------------------------------------------

/**
 * Smallest relative scale a write may apply. Dragging a slider to zero must not
 * flatten a ramp or a curve to all-zeros: that erases the shape irreversibly,
 * so the far-left end of the slider keeps 1% of it and the shape comes back
 * proportionally when the slider is raised again.
 */
const SHAPE_FLOOR = 0.01;

/** Scale a set of numbers so their maximum becomes `target`, keeping shape. */
function scaleToMax(values: number[], target: number, range: Range): number[] {
  const current = Math.max(...values);
  if (current > 1e-9) {
    const factor = Math.max(target / current, SHAPE_FLOOR);
    return values.map((value) => clamp(value * factor, range[0], range[1]));
  }
  return values.map(() => clamp(target, range[0], range[1]));
}

function writeIntensity(layer: LayerV2, ui: number) {
  if (layer.kind === "light" && layer.light) {
    const target = fromUi(ui, LIGHT_INTENSITY);
    const scaled = scaleToMax(
      layer.light.intensity.keys.map(([, v]) => v),
      target,
      LIGHT_INTENSITY,
    );
    layer.light.intensity.keys = layer.light.intensity.keys.map(
      ([t], index) => [t, scaled[index]] as [number, number],
    );
    return;
  }
  const stops = layer.material?.ramp.stops;
  if (!stops?.length) return;
  const scaled = scaleToMax(
    stops.map((stop) => stop.intensity),
    fromUi(ui, RAMP_INTENSITY),
    RAMP_INTENSITY,
  );
  stops.forEach((stop, index) => {
    stop.intensity = scaled[index];
  });
}

function writeRadius(layer: LayerV2, ui: number) {
  if (layer.kind === "light" && layer.light)
    layer.light.radius = fromUi(ui, LIGHT_RADIUS);
  else if (layer.kind === "particles" && layer.emitter)
    layer.emitter.shape.radius = fromUi(ui, PARTICLE_RADIUS);
  else if (layer.geometry) layer.geometry.radius = fromUi(ui, MESH_RADIUS);
}

function writeSpeed(layer: LayerV2, ui: number) {
  if (layer.kind === "particles" && layer.emitter) {
    const speed = layer.emitter.velocity.speed;
    const target = fromUi(ui, PARTICLE_SPEED);
    const current = Math.max(Math.abs(speed[0]), Math.abs(speed[1]));
    if (current > 1e-9) {
      // The slider carries magnitude only; each end keeps its own sign, so an
      // inward (negative) emitter stays inward and speed[0] <= speed[1] holds.
      const factor = Math.max(target / current, SHAPE_FLOOR);
      layer.emitter.velocity.speed = speed.map((value) =>
        clamp(value * factor, -PARTICLE_SPEED[1], PARTICLE_SPEED[1]),
      ) as [number, number];
    } else {
      layer.emitter.velocity.speed = [0, target];
    }
    return;
  }
  const noise = layer.geometry?.vertexNoise;
  // Mesh motion without vertex noise has no speed to move; a layer that has it
  // keeps the same target the v1→v2 map used.
  if (noise) noise.speed = fromUi(ui, NOISE_SPEED);
}

function writeTurbulence(layer: LayerV2, ui: number) {
  if (layer.kind === "particles" && layer.emitter) {
    const strength = fromUi(ui, CURL);
    const forces = layer.emitter.forces;
    if (forces.curl) forces.curl.strength = strength;
    else if (strength > 0)
      forces.curl = {
        strength,
        frequency: 1.6,
        speed: 1,
        envelope: defaultCurve(1, 1),
      };
    return;
  }
  if (!layer.geometry) return;
  const amplitude = fromUi(ui, NOISE_AMPLITUDE);
  if (layer.geometry.vertexNoise) layer.geometry.vertexNoise.amplitude = amplitude;
  else if (amplitude > 0)
    layer.geometry.vertexNoise = {
      amplitude,
      frequency: 2,
      speed: 1,
      bias: [0, 1, 0],
      alongCurve: defaultCurve(0, 1),
    };
}

function writeErosion(layer: LayerV2, ui: number) {
  const material = layer.material;
  if (!material) return;
  const target = fromUi(ui, EROSION);
  if (!material.erosion) {
    if (target <= 0) return;
    material.erosion = {
      curve: {
        keys: [
          [0, 0],
          [1, target],
        ],
        ease: "smooth",
      },
      softness: 0.1,
      edgeWidth: 0,
      edgeColor: material.ramp.stops[0]?.color ?? FALLBACK_COLOR,
      edgeIntensity: 0,
      displacementProtect: 0,
      rimBias: 0,
    };
    return;
  }
  const keys = material.erosion.curve.keys;
  const scaled = scaleToMax(
    keys.map(([, v]) => v),
    target,
    EROSION,
  );
  material.erosion.curve.keys = keys.map(
    ([t], index) => [t, scaled[index]] as [number, number],
  );
}

const WRITERS: Record<ParameterName, (layer: LayerV2, ui: number) => void> = {
  Intensity: writeIntensity,
  Radius: writeRadius,
  Opacity: (layer, ui) => {
    if (layer.material) layer.material.opacity = fromUi(ui, OPACITY);
  },
  Speed: writeSpeed,
  Turbulence: writeTurbulence,
  Erosion: writeErosion,
};

/**
 * Rescale everything keyed on layer-local time when the layer's span changes,
 * so tracks and motion keys stay inside `end - start` and strictly ascending.
 */
function retime(layer: LayerV2, start: number, end: number) {
  const oldSpan = Math.max(layer.end - layer.start, 1e-6);
  const newSpan = Math.max(end - start, 1e-6);
  layer.start = start;
  layer.end = end;
  if (newSpan >= oldSpan) return;
  const factor = newSpan / oldSpan;
  for (const track of layer.tracks)
    track.keys = track.keys.map(([t, v]) => [t * factor, v] as [number, number]);
  if (layer.motion)
    layer.motion.keys = layer.motion.keys.map(
      ([t, ...rest]) => [t * factor, ...rest] as [number, number, number, number],
    );
}

/** Keep a layer, its keyframes and its edit windows inside `duration`. */
function fitToDuration(layer: LayerV2, duration: number) {
  const start = clamp(layer.start, 0, Math.max(0, duration - 0.01));
  const end = clamp(layer.end, start + 0.01, duration);
  retime(layer, start, end);
  layer.overrides = layer.overrides.flatMap((override) => {
    const oStart = clamp(override.start, 0, Math.max(0, duration - 0.01));
    const oEnd = clamp(override.end, oStart + 0.01, duration);
    if (oEnd <= oStart) return [];
    return [
      {
        ...override,
        start: oStart,
        end: oEnd,
        fade: Math.min(override.fade, (oEnd - oStart) / 2),
      },
    ];
  });
}

/**
 * Validate `next`, or fall back to `previous`. The UI sliders are continuous;
 * a write that lands outside the contract must never throw into React.
 */
function commit(next: VfxDocumentV2, previous: VfxDocumentV2): VfxDocumentV2 {
  try {
    const valid = validateDocumentV2(next);
    // A documented no-op keeps the previous object identity, so the preview
    // does not reinstall a document that did not actually change.
    return JSON.stringify(valid) === JSON.stringify(previous) ? previous : valid;
  } catch (error) {
    console.warn(
      "[ui-bridge] rejected an edit that would invalidate the document:",
      error instanceof Error ? error.message : error,
    );
    return previous;
  }
}

/**
 * Write exactly what the timeline and emitter controls can change back into the
 * v2 document. Anything not in `patch` — and anything the layer's kind cannot
 * express — is left untouched.
 */
export function applyLayerPatch(
  doc: VfxDocumentV2,
  layerId: string,
  patch: Partial<VfxLayer>,
): VfxDocumentV2 {
  const next = structuredClone(doc);
  const layer = next.layers.find((item) => item.id === layerId);
  if (!layer) return doc;

  if (patch.start !== undefined || patch.end !== undefined) {
    const limit = Math.min(next.duration, MAX_DURATION_V2);
    const start = clamp(patch.start ?? layer.start, 0, limit - 0.01);
    const end = clamp(patch.end ?? layer.end, start + 0.01, limit);
    retime(layer, start, end);
  }
  if (patch.enabled !== undefined) layer.enabled = patch.enabled;
  if (patch.color !== undefined) {
    if (layer.light) layer.light.color = patch.color;
    else if (layer.material) layer.material.ramp.stops[0].color = patch.color;
  }
  if (patch.secondaryColor !== undefined && layer.material) {
    const stops = layer.material.ramp.stops;
    stops[stops.length - 1].color = patch.secondaryColor;
  }
  if (patch.blend !== undefined && layer.material) {
    const current = layer.material.blend;
    // Keep `screen` / `premultiplied` when the UI re-selects the bucket they
    // already project into, so the projection stays idempotent.
    if (patch.blend === "additive" && current !== "screen")
      layer.material.blend = "additive";
    if (patch.blend === "normal" && current !== "premultiplied")
      layer.material.blend = "alpha";
  }
  if (patch.parameters)
    for (const name of PARAMETER_NAMES) {
      const value = patch.parameters[name];
      if (typeof value === "number" && Number.isFinite(value))
        WRITERS[name](layer, value);
    }
  return commit(next, doc);
}

export function applyEnvironment(
  doc: VfxDocumentV2,
  patch: { bloom?: number; exposure?: number },
): VfxDocumentV2 {
  const next = structuredClone(doc);
  if (patch.bloom !== undefined)
    next.post.bloom.strength = fromUi(patch.bloom, BLOOM);
  if (patch.exposure !== undefined)
    next.post.exposure = fromUi(patch.exposure, EXPOSURE);
  return commit(next, doc);
}

export function applyDuration(
  doc: VfxDocumentV2,
  seconds: number,
): VfxDocumentV2 {
  const duration = clamp(
    Number.isFinite(seconds) ? seconds : doc.duration,
    MIN_DURATION_V2,
    MAX_DURATION_V2,
  );
  const next = structuredClone(doc);
  next.duration = duration;
  next.impact = clamp(next.impact, 0, Math.max(0, duration - 0.01));
  for (const layer of next.layers) fitToDuration(layer, duration);
  return commit(next, doc);
}

/** A v2 id: lower-case, starts with a letter, dashes allowed. */
function emitterId(index: number, taken: Set<string>) {
  let id = `emitter-${index}`;
  let suffix = index;
  while (taken.has(id)) id = `emitter-${++suffix}`;
  return id;
}

/**
 * A minimal particles layer built from the schema defaults, so main's
 * "Add emitter" button keeps working on a v2 document.
 */
export function addLayer(doc: VfxDocumentV2, index: number): VfxDocumentV2 {
  const next = structuredClone(doc);
  const number = index + 1;
  const id = emitterId(number, new Set(next.layers.map((layer) => layer.id)));
  const start = clamp(index * 0.12, 0, Math.max(0, next.duration - 0.5));
  const layer: LayerV2 = {
    id,
    name: `Emitter ${number}`,
    role: "secondary",
    kind: "particles",
    start,
    end: clamp(
      start + Math.max(0.4, next.duration * 0.45),
      start + 0.01,
      next.duration,
    ),
    enabled: true,
    transform: {
      position: [0, 0.6, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    motion: null,
    material: defaultMaterial(),
    emitter: defaultEmitter(),
    tracks: [],
    overrides: [],
  };
  next.layers = [...next.layers, layer];
  const result = commit(next, doc);
  // commit falls back to `doc` when the result is invalid. Callers select the
  // new emitter by index, so a fallback that has no layers at all — the shell
  // createDocument starts from — must fail loudly instead of handing back a
  // document the caller will index into.
  if (result.layers.length <= doc.layers.length)
    throw new Error("This effect cannot take another emitter.");
  return result;
}

/**
 * A one-emitter v2 document, for "Add emitter" on an empty timeline. The
 * contract requires at least one layer, so there is no layerless document to
 * start from.
 */
export function createDocument(name = "Untitled effect"): VfxDocumentV2 {
  const shell = defaultDocumentShell(documentName(name));
  return addLayer({ ...shell, layers: [] } as VfxDocumentV2, 0);
}

/** The contract caps a document name at 100 characters; projects allow 120. */
export function documentName(name: string) {
  const trimmed = name.trim().slice(0, MAX_DOCUMENT_NAME).trim();
  return trimmed || "Untitled effect";
}


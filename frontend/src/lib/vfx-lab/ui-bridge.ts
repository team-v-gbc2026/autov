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
//                | blob.radius[1] / splash.length[1] / ribbon.width /
//                | wireBurst.radius / crystals.length[1] / arcs.radius[1] /
//                | streakBurst.length[1] / sheets.length[1] / crescent.radius /
//                | licks.length[1] on the generated kinds,
//                | scaled as a band so the population keeps its size hierarchy
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
  validateWorkspaceDocumentV2,
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
const RIBBON_WIDTH: Range = V2_TARGET_RANGES["ribbon.width"];
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
  // A generated kind has no geometry: its "radius" is the lobe band's top and
  // the sliver band's top, the numbers that set how big the thing reads.
  if (layer.blob) return toUi(layer.blob.radius[1], MESH_RADIUS);
  if (layer.splash) return toUi(layer.splash.length[1], MESH_RADIUS);
  // A ribbon's "radius" is its strand width; a burst's is how far it throws.
  if (layer.ribbon) return toUi(layer.ribbon.width, RIBBON_WIDTH);
  if (layer.wireBurst) return toUi(layer.wireBurst.radius, MESH_RADIUS);
  // A crystal cluster's "radius" is the longest spike it grows.
  if (layer.crystals) return toUi(layer.crystals.length[1], MESH_RADIUS);
  // An arc cage's "radius" is its helix band; a streak fan's is its reach.
  if (layer.arcs) return toUi(layer.arcs.radius[1], MESH_RADIUS);
  if (layer.streakBurst) return toUi(layer.streakBurst.length[1], MESH_RADIUS);
  // A tail of sheets reads at its longest membrane, a blade at its own arc and
  // a lick layer at its longest strip.
  if (layer.sheets) return toUi(layer.sheets.length[1], MESH_RADIUS);
  if (layer.crescent) return toUi(layer.crescent.radius, MESH_RADIUS);
  if (layer.licks) return toUi(layer.licks.length[1], MESH_RADIUS);
  if (layer.geometry) return toUi(layer.geometry.radius, MESH_RADIUS);
  // A reflection has no size of its own: it draws its source's geometry, and
  // reflection.scale is how far the floor foreshortens it.
  if (layer.reflection) return toUi(layer.reflection.scale * 2, MESH_RADIUS);
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
    Opacity: toUi(
      layer.material?.opacity ?? layer.reflection?.opacity ?? 0,
      OPACITY,
    ),
    Speed: layerSpeed(layer),
    Turbulence: layerTurbulence(layer),
    Erosion: toUi(erosionLevel(layer), EROSION),
  };
}

function layerCurves(layer: LayerV2): NonNullable<VfxLayer["curves"]> {
  const result: NonNullable<VfxLayer["curves"]> = [];
  const add = (path: string, label: string, domain: string, value: import("./schema-v2").Curve | null | undefined) => {
    if (value) result.push({ path, label, domain, value });
  };
  add("material.erosion.curve", "Erosion", layer.emitter ? "Particle lifetime" : "Layer lifetime", layer.material?.erosion?.curve);
  add("light.intensity", "Light intensity", "Layer lifetime", layer.light?.intensity);
  add("emitter.render.sizeCurve", "Particle size", "Particle lifetime", layer.emitter?.render.sizeCurve);
  add("emitter.render.alphaCurve", "Particle opacity", "Particle lifetime", layer.emitter?.render.alphaCurve);
  add("emitter.velocity.speedCurve", "Speed multiplier", "Particle lifetime", layer.emitter?.velocity.speedCurve);
  add("emitter.forces.curl.envelope", "Turbulence envelope", "Particle lifetime", layer.emitter?.forces.curl?.envelope);
  add("emitter.render.alphaAlongSpawn", "Opacity along spawn", "Spawn position", layer.emitter?.render.alphaAlongSpawn);
  add("emitter.trail.widthCurve", "Trail width", "Trail length", layer.emitter?.trail?.widthCurve);
  add("geometry.vertexNoise.alongCurve", "Displacement", "Mesh axis", layer.geometry?.vertexNoise?.alongCurve);
  add("geometry.lightning.widthCurve", "Lightning width", "Beam length", layer.geometry?.lightning?.widthCurve);
  add("blob.head", "Path head", "Layer lifetime", layer.blob?.head);
  add("ribbon.window.head", "Ribbon head", "Layer lifetime", layer.ribbon?.window.head);
  add("ribbon.morph.curve", "Path morph", "Layer lifetime", layer.ribbon?.morph?.curve);
  add("wireBurst.scale", "Wire burst scale", "Layer lifetime", layer.wireBurst?.scale);
  add("streakBurst.grow", "Streak growth", "Layer lifetime", layer.streakBurst?.grow);
  add("crescent.window.head", "Blade head", "Layer lifetime", layer.crescent?.window.head);
  add("crescent.window.tail", "Blade tail", "Layer lifetime", layer.crescent?.window.tail);
  add("material.swirl.strength", "Swirl strength", "Layer lifetime", layer.material?.swirl?.strength);
  add("material.symbol.hot.alpha", "Symbol hot core", "Layer lifetime", layer.material?.symbol?.hot?.alpha);
  add("collapse.heightCurve", "Collapse height", "Collapse progress", layer.collapse?.heightCurve);
  add("collapse.widthCurve", "Collapse width", "Collapse progress", layer.collapse?.widthCurve);
  add("emitter.spawn.headCurve", "Spawn head", "Layer lifetime", layer.emitter?.spawn.headCurve);
  return result;
}

function projectLayer(layer: LayerV2): VfxLayer {
  const stops = rampStops(layer);
  const color =
    stops[0]?.color ?? layer.light?.color ?? layer.reflection?.tint ?? FALLBACK_COLOR;
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
    curves: layerCurves(layer),
    keyframes: [
      ...layer.tracks.map(track => ({
        target: track.target,
        ease: track.ease,
        keys: track.keys,
        timeScale: "seconds" as const,
      })),
      ...(layer.motion ? [0, 1, 2].map(component => ({
        target: `motion.position[${component}]`,
        label: "Position",
        domain: "Layer time",
        ease: layer.motion!.ease,
        keys: layer.motion!.keys.map(key => [key[0], key[component + 1]] as [number, number]),
        timeScale: "seconds" as const,
      })) : []),
      ...layerCurves(layer).map(curve => ({
        target: curve.path,
        label: curve.label,
        domain: curve.domain,
        ease: curve.value.ease,
        keys: curve.value.keys,
        timeScale: "normalized" as const,
      })),
    ],
    sourceTransform: layer.transform,
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
    delete layer.light.intensity.formula;
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
  else if (layer.blob) {
    // Scale the whole band, keeping its shape, so a cluster never collapses
    // into one uniform lobe size.
    const target = Math.min(3, Math.max(0.05, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.blob.radius[1], 1e-6);
    layer.blob.radius = [
      clamp(layer.blob.radius[0] * factor, 0.05, 3),
      target,
    ];
  } else if (layer.splash) {
    const target = Math.min(8, Math.max(0.2, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.splash.length[1], 1e-6);
    layer.splash.length = [
      clamp(layer.splash.length[0] * factor, 0.2, 8),
      target,
    ];
  } else if (layer.ribbon) {
    layer.ribbon.width = fromUi(ui, RIBBON_WIDTH);
  } else if (layer.crystals) {
    // The band, not one number: spikes that all grow to the same length read as
    // a mace, not as ice.
    const target = Math.min(6, Math.max(0.05, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.crystals.length[1], 1e-6);
    layer.crystals.length = [
      clamp(layer.crystals.length[0] * factor, 0.05, 6),
      target,
    ];
  } else if (layer.arcs) {
    const target = fromUi(ui, MESH_RADIUS);
    const factor = target / Math.max(layer.arcs.radius[1], 1e-6);
    layer.arcs.radius = [
      clamp(layer.arcs.radius[0] * factor, 0.02, 8),
      clamp(target, 0.02, 8),
    ];
    layer.arcs.span = clamp(layer.arcs.span * factor, 0.05, 12);
  } else if (layer.streakBurst) {
    const target = fromUi(ui, MESH_RADIUS);
    const factor = target / Math.max(layer.streakBurst.length[1], 1e-6);
    layer.streakBurst.length = [
      clamp(layer.streakBurst.length[0] * factor, 0.1, 12),
      clamp(target, 0.1, 12),
    ];
  } else if (layer.sheets) {
    // The band, not one number: sheets that are all the same length read as a
    // comb rather than as a tail.
    const target = Math.min(4, Math.max(0.05, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.sheets.length[1], 1e-6);
    layer.sheets.length = [clamp(layer.sheets.length[0] * factor, 0.05, 4), target];
  } else if (layer.crescent) {
    const target = Math.min(8, Math.max(0.05, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.crescent.radius, 1e-6);
    layer.crescent.radius = target;
    layer.crescent.thickness.max = clamp(
      layer.crescent.thickness.max * factor,
      0.01,
      3,
    );
  } else if (layer.licks) {
    const target = Math.min(4, Math.max(0.02, fromUi(ui, MESH_RADIUS)));
    const factor = target / Math.max(layer.licks.length[1], 1e-6);
    layer.licks.length = [clamp(layer.licks.length[0] * factor, 0.02, 4), target];
  } else if (layer.wireBurst) {
    // The band, not one number: a burst whose outlines grow without flying
    // further just turns into a solid ball.
    const target = fromUi(ui, MESH_RADIUS);
    const factor = target / Math.max(layer.wireBurst.radius, 1e-6);
    layer.wireBurst.radius = clamp(target, 0.05, 6);
    layer.wireBurst.travel = clamp(layer.wireBurst.travel * factor, 0, 8);
  } else if (layer.geometry) layer.geometry.radius = fromUi(ui, MESH_RADIUS);
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
  delete material.erosion.curve.formula;
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
  if (Math.abs(newSpan - oldSpan) < 1e-9) return;
  const factor = newSpan / oldSpan;
  if (layer.emitter) {
    const { emitter } = layer;
    emitter.life = emitter.life.map(value => clamp(value * factor, 0.02, 12)) as [number, number];
    emitter.spawn.window = clamp(emitter.spawn.window * factor, 0, 12);
    emitter.spawn.duration = clamp(emitter.spawn.duration * factor, 0, 12);
    emitter.spawn.bursts = emitter.spawn.bursts.map(burst => ({
      ...burst,
      t: clamp(burst.t * factor, 0, 12),
    }));
  }
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
    const valid = validateWorkspaceDocumentV2(next);
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
  if (patch.color !== undefined && layer.light) layer.light.color = patch.color;
  if (layer.material && ((patch.color !== undefined && patch.color !== layer.material.ramp.stops[0].color) ||
    (patch.secondaryColor !== undefined && patch.secondaryColor !== layer.material.ramp.stops[layer.material.ramp.stops.length - 1].color))) {
    const stops = layer.material.ramp.stops;
    const first = stops[0], last = stops[stops.length - 1];
    const primary = patch.color ?? first.color;
    const secondary = patch.secondaryColor ?? last.color;
    const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    const from = channels(primary), to = channels(secondary);
    // The two UI colors describe the whole ramp, including authored interior stops.
    // Keep sampling positions and HDR intensity so editing hue preserves timing/brightness.
    for (const stop of stops) {
      const t = last.t === first.t ? 0 : (stop.t - first.t) / (last.t - first.t);
      stop.color = `#${from.map((value, index) => Math.round(value + (to[index] - value) * t).toString(16).padStart(2, "0")).join("")}`;
    }
    first.color = primary;
    last.color = stops.length === 1 ? (patch.color ?? patch.secondaryColor ?? primary) : secondary;
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
  if (patch.curves) {
    const allowed = new Set(layerCurves(layer).map(curve => curve.path));
    for (const curve of patch.curves) {
      if (!allowed.has(curve.path)) continue;
      const parts = curve.path.split(".");
      let owner = layer as unknown as Record<string, unknown>;
      for (const part of parts.slice(0, -1)) owner = owner[part] as Record<string, unknown>;
      owner[parts[parts.length - 1]] = structuredClone(curve.value);
    }
  }
  if (patch.parameters)
    for (const name of PARAMETER_NAMES) {
      const value = patch.parameters[name];
      if (typeof value === "number" && Number.isFinite(value) && value !== projectParameters(layer)[name])
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
      squash: null,
    },
    motion: null,
    jitter: null,
    frame: null,
    collapse: null,
    window: null,
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
 * A one-emitter document satisfying the generation contract.
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

/** The workspace exists before its first emitter. Validation returns a detached
 * document so renderer/evaluation mutations cannot alias editor state.
 */
export function createWorkspaceDocument(name = "Untitled effect"): VfxDocumentV2 {
  return validateWorkspaceDocumentV2({ ...defaultDocumentShell(documentName(name)), layers: [] });
}

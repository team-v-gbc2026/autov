// ---------------------------------------------------------------------------
// Eight global, effect-agnostic knobs over a v2 document.
//
// Every knob is a multiplier applied to the *base* document, never to the
// previous result: `applyKnobs(base, k)` is a pure function, so a knob vector
// is a complete description of a candidate and re-applying the same vector is
// a no-op. That is what makes the finite-difference Jacobian in calibrate-v2
// meaningful — each column is the response to one coordinate of one point, not
// to a path through parameter space.
//
// The knobs are chosen so that they move screen features (area, occupancy,
// luminance percentiles, edge density) without changing what the effect *is*:
// no layer is added or removed, no kind or topology changes, camera and
// exposure and seed are untouched. Values are clamped into the schema's own
// ranges on the way out, so the result always validates.
// ---------------------------------------------------------------------------

import { MESH_KINDS_V2, type VfxDocumentV2 } from "./schema-v2";

export const KNOB_NAMES = [
  "particleCount",
  "particleSize",
  "particleOpacity",
  "particleLife",
  "meshScale",
  "rampIntensity",
  "lightIntensity",
  "dissipationStretch",
  // Directional knobs. The eight above can only make an effect bigger, brighter
  // or longer-lived — they cannot change its silhouette, which is what the
  // shape features in features-v2.ts measure.
  "verticalStretch",
  "spreadScale",
  // Playback stretch. Everything else changes what a frame looks like; this
  // changes when frames happen, which is the only way to move the rendered
  // activity curve onto the reference's envelope.
  "timeScale",
] as const;

export type KnobName = (typeof KNOB_NAMES)[number];
export type KnobVector = number[];

/** Default multiplicative box. Two octaves either way. */
export const KNOB_MIN = 0.25;
export const KNOB_MAX = 4;

/**
 * Per-knob box. Time is the exception: a document stretched or squeezed by more
 * than 2x is a different effect, not a calibrated one, and the schema's own
 * 12 s ceiling would clip it anyway.
 */
export const KNOB_BOUNDS: Record<KnobName, [number, number]> = {
  particleCount: [KNOB_MIN, KNOB_MAX],
  particleSize: [KNOB_MIN, KNOB_MAX],
  particleOpacity: [KNOB_MIN, KNOB_MAX],
  particleLife: [KNOB_MIN, KNOB_MAX],
  meshScale: [KNOB_MIN, KNOB_MAX],
  rampIntensity: [KNOB_MIN, KNOB_MAX],
  lightIntensity: [KNOB_MIN, KNOB_MAX],
  dissipationStretch: [KNOB_MIN, KNOB_MAX],
  verticalStretch: [KNOB_MIN, KNOB_MAX],
  spreadScale: [KNOB_MIN, KNOB_MAX],
  timeScale: [0.5, 2],
};

/** The same box in the log space the optimizer searches. */
export const LOG_KNOB_BOUNDS = KNOB_NAMES.map(
  (name) => [Math.log(KNOB_BOUNDS[name][0]), Math.log(KNOB_BOUNDS[name][1])] as [number, number],
);

/** How far a document's duration may be extended to fit a time stretch. */
export const MAX_DURATION_GROWTH = 1.5;
/** Schema ceiling on any document time. */
const TIME_CEILING = 12;

/** A particles layer below this reads as a handful of dots, not a volume. */
export const MIN_PARTICLE_COUNT = 8;

export const IDENTITY_KNOBS: KnobVector = KNOB_NAMES.map(() => 1);

const MESH_KINDS: ReadonlySet<string> = new Set(MESH_KINDS_V2);

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function clampKnobs(knobs: readonly number[]): KnobVector {
  if (knobs.length !== KNOB_NAMES.length)
    throw new Error(`Expected ${KNOB_NAMES.length} knobs, got ${knobs.length}`);
  return knobs.map((k, i) => {
    const [lo, hi] = KNOB_BOUNDS[KNOB_NAMES[i]];
    return Number.isFinite(k) ? clamp(k, lo, hi) : 1;
  });
}

export const toLogKnobs = (knobs: readonly number[]) =>
  clampKnobs(knobs).map(Math.log);

export const fromLogKnobs = (log: readonly number[]) =>
  clampKnobs(log.map(Math.exp));

/** Widest log box across all knobs, for callers that need a single range. */
export const LOG_BOUNDS: [number, number] = [
  Math.min(...LOG_KNOB_BOUNDS.map((b) => b[0])),
  Math.max(...LOG_KNOB_BOUNDS.map((b) => b[1])),
];

export function knobRecord(knobs: readonly number[]): Record<KnobName, number> {
  return Object.fromEntries(
    KNOB_NAMES.map((name, i) => [name, knobs[i]]),
  ) as Record<KnobName, number>;
}

export interface ApplyOptions {
  /**
   * Document time K11 scales about — the base document's own measured activity
   * peak. Measured once per calibration run and held fixed, so `applyKnobs`
   * stays a pure function of (base, knobs, pivot) and the Jacobian's time
   * column keeps meaning the same thing at every probe.
   */
  pivot?: number;
}

/**
 * Apply a knob vector to `base` and return a new document. `base` is never
 * mutated and the result is deterministic in (base, knobs, options).
 */
export function applyKnobs(
  base: VfxDocumentV2,
  knobs: readonly number[],
  options: ApplyOptions = {},
): VfxDocumentV2 {
  const [
    kCount,
    kSize,
    kOpacity,
    kLife,
    kMeshScale,
    kRamp,
    kLight,
    kStretch,
    kVertical,
    kSpread,
    kTime,
  ] = clampKnobs(knobs);
  const doc = structuredClone(base) as VfxDocumentV2;
  const impact = doc.impact;

  for (const layer of doc.layers) {
    const emitter = layer.emitter;
    if (emitter) {
      // K1 — particle count. Rounded, floored, and applied to every spawn
      // channel so continuous and burst emitters scale together.
      emitter.count = clamp(
        Math.round(emitter.count * kCount),
        MIN_PARTICLE_COUNT,
        24000,
      );
      emitter.spawn.rate = clamp(emitter.spawn.rate * kCount, 0, 4000);
      for (const burst of emitter.spawn.bursts)
        burst.count = clamp(Math.round(burst.count * kCount), 1, 24000);

      // K2 — particle size.
      emitter.render.size = [
        clamp(emitter.render.size[0] * kSize, 0.001, 8),
        clamp(emitter.render.size[1] * kSize, 0.001, 8),
      ];

      // K4 — particle life.
      emitter.life = [
        clamp(emitter.life[0] * kLife, 0.02, 12),
        clamp(emitter.life[1] * kLife, 0.02, 12),
      ];

      // K3 — particle opacity. Particle layers only; mesh brightness is K6's.
      if (layer.material)
        layer.material.opacity = clamp(layer.material.opacity * kOpacity, 0, 1);

      // K9 — vertical stretch, particle half: tilt the launch direction and
      // the forces toward (or away from) the vertical. The direction is a unit
      // vector, so it is re-normalized rather than simply scaled.
      if (kVertical !== 1) {
        const d = emitter.velocity.direction;
        const tilted: [number, number, number] = [d[0], d[1] * kVertical, d[2]];
        const length = Math.hypot(...tilted);
        if (length > 1e-6)
          emitter.velocity.direction = tilted.map((v) =>
            clamp(v / length, -1, 1),
          ) as [number, number, number];
        emitter.forces.gravity[1] = clamp(
          emitter.forces.gravity[1] * kVertical,
          -12,
          12,
        );
        emitter.forces.wind[1] = clamp(emitter.forces.wind[1] * kVertical, -12, 12);
      }

      // K10 — spread: how wide the cone opens and how large a region the
      // emitter samples from.
      if (kSpread !== 1) {
        emitter.velocity.angle = clamp(
          emitter.velocity.angle * kSpread,
          0,
          Math.PI,
        );
        emitter.shape.radius = clamp(emitter.shape.radius * kSpread, 0, 12);
        emitter.shape.innerRadius = clamp(
          Math.min(emitter.shape.innerRadius * kSpread, emitter.shape.radius),
          0,
          12,
        );
      }
    }

    // K5 — mesh scale: the transform and the primitive's own dimensions, so a
    // library mesh grows instead of only being stretched.
    if (MESH_KINDS.has(layer.kind)) {
      layer.transform.scale = layer.transform.scale.map((v) =>
        clamp(v * kMeshScale, -12, 12),
      ) as [number, number, number];
      // K9 — vertical stretch, mesh half: the y axis only, so the silhouette
      // changes proportion instead of only size.
      layer.transform.scale[1] = clamp(
        layer.transform.scale[1] * kVertical,
        -12,
        12,
      );
      if (layer.geometry) {
        layer.geometry.radius = clamp(
          layer.geometry.radius * kMeshScale,
          0.01,
          8,
        );
        layer.geometry.length = clamp(
          layer.geometry.length * kMeshScale,
          0.01,
          12,
        );
      }
    }

    // K5/K9 — the generated kinds: a blob's cluster dimensions and a splash's
    // slivers scale with meshScale, and verticalStretch reaches only the blob's
    // vertical shape (height, reach, squash) the same way it reaches a mesh's
    // y scale. Lobe counts and the arrangement are topology, not scale, so the
    // knob space never touches them.
    if (layer.blob) {
      const b = layer.blob;
      b.radius = [
        clamp(b.radius[0] * kMeshScale, 0.05, 3),
        clamp(b.radius[1] * kMeshScale, 0.05, 3),
      ];
      b.spread = clamp(b.spread * kMeshScale, 0, 8);
      b.height = clamp(b.height * kMeshScale * kVertical, 0, 12);
      b.rise = clamp(b.rise * kMeshScale * kVertical, -12, 20);
      b.gravity = clamp(b.gravity * kMeshScale * kVertical, -20, 20);
      b.drift = clamp(b.drift * kMeshScale, -8, 8);
      b.squash = clamp(b.squash * kVertical, 0.3, 3);
      b.life = [
        clamp(b.life[0] * kLife, 0.05, 12),
        clamp(b.life[1] * kLife, 0.05, 12),
      ];
    }
    if (layer.splash) {
      const sp = layer.splash;
      sp.length = [
        clamp(sp.length[0] * kMeshScale, 0.2, 8),
        clamp(sp.length[1] * kMeshScale, 0.2, 8),
      ];
      sp.width = clamp(sp.width * kMeshScale, 0.02, 1.5);
    }
    // A crystal cluster scales by how long and how fat its spikes are and how
    // far their bases sit out; verticalStretch reaches only the length, so the
    // cluster changes proportion the way a mesh's y scale does. The count, the
    // groups and the elevation band are topology, so the knob space never
    // touches them.
    if (layer.crystals) {
      const c = layer.crystals;
      c.length = [
        clamp(c.length[0] * kMeshScale * kVertical, 0.05, 6),
        clamp(c.length[1] * kMeshScale * kVertical, 0.05, 6),
      ];
      c.width = [
        clamp(c.width[0] * kMeshScale, 0.005, 1),
        clamp(c.width[1] * kMeshScale, 0.005, 1),
      ];
      c.baseRadius = clamp(c.baseRadius * kMeshScale, 0, 4);
    }
    // A ribbon's size is its strand width and how far the strands sit apart;
    // its path is the effect's geometry and belongs to the document, so
    // meshScale deliberately does not move it. verticalStretch has nothing to
    // reach: the strip has no axis of its own.
    if (layer.ribbon) {
      const r = layer.ribbon;
      r.width = clamp(r.width * kMeshScale, 0.002, 1);
      r.strands.spread = clamp(r.strands.spread * kMeshScale, 0, 1);
    }
    // A burst scales by how big its outlines are and how far they fly; the
    // shape and spoke counts are topology, so the knob space never moves them.
    if (layer.wireBurst) {
      const w = layer.wireBurst;
      w.radius = clamp(w.radius * kMeshScale, 0.05, 6);
      w.travel = clamp(w.travel * kMeshScale, 0, 8);
    }

    // K6 — ramp intensity, every layer that has a ramp.
    if (layer.material)
      for (const stop of layer.material.ramp.stops)
        stop.intensity = clamp(stop.intensity * kRamp, 0, 8);

    // K7 — light intensity curves.
    if (layer.light)
      layer.light.intensity.keys = layer.light.intensity.keys.map(
        ([t, v]) => [t, clamp(v * kLight, -20, 20)] as [number, number],
      );
  }

  // K8 — dissipation stretch. Layers that outlive the impact keep their start
  // and have their span multiplied; the document's duration is the ceiling, so
  // a stretch never invents time the renderer would not play, and a layer's own
  // keyframes are its floor, so a shrink never orphans a track key.
  if (kStretch !== 1)
    for (const layer of doc.layers) {
      if (!(layer.end > impact)) continue;
      const span = Math.max(layer.end - layer.start, 1e-4);
      const keyed = Math.max(
        0,
        ...layer.tracks.flatMap((track) => track.keys.map(([t]) => t)),
        ...(layer.motion ? layer.motion.keys.map(([t]) => t) : []),
      );
      layer.end = clamp(
        layer.start + span * kStretch,
        Math.min(doc.duration, layer.start + Math.max(1e-3, keyed)),
        doc.duration,
      );
    }

  // K11 — time scale. A playback stretch about the document's measured peak:
  // every scheduled time (layer windows, spawn and burst timing, particle life,
  // keyframes, overrides, camera moves) is scaled by the same factor, so the
  // shape of the effect is untouched and only its rate changes. The pivot is
  // held fixed for a whole calibration run, so this stays a pure function.
  //
  // Scaling about the peak necessarily moves the lead-in as well as the tail —
  // that is the point: the rise is half of what the reference envelope pins
  // down. Velocities are per-second and are deliberately not rescaled, so a
  // slower document also travels further; that is a real side effect, visible
  // to the features, not a hidden one.
  if (kTime !== 1) {
    const pivot = clamp(options.pivot ?? doc.impact, 0, doc.duration);
    const ceiling = Math.min(
      TIME_CEILING,
      Math.max(doc.duration, base.duration * MAX_DURATION_GROWTH),
    );
    const at = (t: number) => clamp(pivot + (t - pivot) * kTime, 0, ceiling);
    const local = (t: number) => clamp(t * kTime, 0, TIME_CEILING);

    // Pass one: the new schedule, and how long the document has to be to play it.
    const windows = doc.layers.map((layer) => ({
      start: at(layer.start),
      end: at(layer.end),
    }));
    const latest = windows.reduce((max, w) => Math.max(max, w.end), 0);
    doc.duration = clamp(Math.max(latest, MIN_LAYER_SPAN), 0.5, ceiling);
    doc.impact = clamp(at(doc.impact), 0, doc.duration - 1e-3);

    // Pass two: write it back, fitting every local time into the span it
    // actually has. Clamping alone is not enough — the schema wants strictly
    // ascending keys, and a stretched track squeezed back under the document's
    // ceiling can collide.
    doc.layers.forEach((layer, index) => {
      const end = clamp(windows[index].end, MIN_LAYER_SPAN, doc.duration);
      const layerStart = clamp(
        Math.min(windows[index].start, end - MIN_LAYER_SPAN),
        0,
        Math.max(0, end - MIN_LAYER_SPAN),
      );
      layer.start = layerStart;
      layer.end = end;
      const usable = end - layerStart;

      for (const track of layer.tracks)
        track.keys = fitKeyTimes(
          track.keys.map(([t, v]) => [local(t), v] as [number, number]),
          usable,
        );
      if (layer.motion)
        layer.motion.keys = fitKeyTimes(
          layer.motion.keys.map(
            ([t, ...rest]) => [local(t), ...rest] as [number, number, number, number],
          ),
          usable,
        );
      for (const override of layer.overrides) {
        override.start = clamp(at(override.start), 0, doc.duration);
        override.end = clamp(
          Math.max(at(override.end), override.start),
          0,
          doc.duration,
        );
      }
      if (layer.emitter) {
        const e = layer.emitter;
        e.spawn.window = local(e.spawn.window);
        e.spawn.duration = local(e.spawn.duration);
        for (const burst of e.spawn.bursts) burst.t = local(burst.t);
        e.life = [
          clamp(e.life[0] * kTime, 0.02, 12),
          clamp(e.life[1] * kTime, 0.02, 12),
        ];
      }
    });

    for (const move of [doc.camera.shake, doc.camera.pushIn]) {
      if (!move) continue;
      move.start = clamp(at(move.start), 0, doc.duration);
      move.end = clamp(Math.max(at(move.end), move.start), 0, doc.duration);
    }
  }

  return doc;
}

/** Shortest layer a time stretch may produce; twelve keys still fit inside it. */
const MIN_LAYER_SPAN = 0.02;
const KEY_EPSILON = 1e-4;

/**
 * Fit keyframe times into `[0, usable]`, keeping them strictly ascending. Each
 * key is pushed past its predecessor and pulled back far enough from the end
 * that every key still to come has room, which is what the schema checks.
 */
function fitKeyTimes<T extends [number, ...number[]]>(keys: T[], usable: number): T[] {
  const span = Math.max(usable, (keys.length - 1) * KEY_EPSILON);
  const out: T[] = [];
  keys.forEach((key, index) => {
    const previous = out[index - 1]?.[0] ?? -KEY_EPSILON;
    const headroom = span - (keys.length - 1 - index) * KEY_EPSILON;
    const t = Math.max(
      0,
      Math.min(Math.max(key[0], previous + KEY_EPSILON), headroom),
    );
    out.push([t, ...key.slice(1)] as T);
  });
  return out;
}

/** Layers the renderer will actually draw — the structure guard's subject. */
export function visibleLayerCount(doc: VfxDocumentV2) {
  return doc.layers.filter((l) => l.enabled && l.end > l.start).length;
}

import {
  type Layer,
  type NumericTarget,
  type Params,
  type VfxDocument,
} from "./schema";
import {
  type Curve,
  type Emitter,
  type GeometryV2,
  type LayerV2,
  type Material,
  type TrackV2,
  type VfxDocumentV2,
  defaultDocumentShell,
  isV2,
  mapV1Target,
  validateDocumentV2,
} from "./schema-v2";

export {
  V1_TARGET_MAP,
  V1_PARTICLE_TARGET_MAP,
  mapV1Target,
} from "./schema-v2";

// ---------------------------------------------------------------------------
// autov.lab/1 → autov.lab/2.
//
// v1 documents are a flat bag of scalars per layer; v2 splits the same
// information into material / emitter / geometry. The upgrade is lossless for
// everything v1 could express and fills the rest with neutral defaults, so an
// upgraded document renders as close to its v1 self as the v2 renderer allows.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 6) => Number(v.toFixed(digits));
/** Round first, then clamp, so rounding can never push a value past a bound. */
const fit = (v: number, lo: number, hi: number) => clamp(round(v), lo, hi);

/** v1 surfaces that have no v2 procedural of their own fall back to "none". */
const SURFACE_MAP: Record<string, Material["procedural"]> = {
  default: "none",
  "circle-eyes": "none",
  flame: "flame",
  water: "water",
  hexagon: "hexagon",
  smoke: "smoke",
  star: "star",
  solid: "solid",
  portal: "portal",
  "water-streaks": "water-streaks",
  "energy-ribbon": "energy-ribbon",
  ice: "ice",
  sparkle: "sparkle",
};

/**
 * Value conversions that accompany a target rename. A v1 track keeps its shape
 * but its values move into the v2 field's range (e.g. turbulence 0..2 becomes
 * a 0..0.5 vertex-noise amplitude).
 */
const TARGET_CONVERT: Record<
  string,
  Partial<Record<NumericTarget, (v: number) => number>>
> = {
  mesh: {
    speed: (v) => clamp(Math.abs(v) / 2, 0, 4),
    turbulence: (v) => clamp(v * 0.25, 0, 0.5),
    spin: (v) => clamp(v, -10, 10),
  },
  particles: {
    turbulence: (v) => clamp(v * 1.5, 0, 3),
    width: (v) => clamp(v, 0.001, 8),
    length: (v) => clamp(v, 0, 12),
    radius: (v) => clamp(v, 0, 12),
  },
};

function convertTargetValue(
  target: NumericTarget,
  kind: string,
  value: number,
): number {
  const table = TARGET_CONVERT[kind === "particles" ? "particles" : "mesh"];
  const convert = table[target];
  return round(convert ? convert(value) : value);
}

function constantCurve(value: number): Curve {
  return {
    keys: [
      [0, round(value)],
      [1, round(value)],
    ],
    ease: "linear",
  };
}

function buildMaterial(layer: Layer, animated: Set<NumericTarget>): Material {
  const p = layer.params;
  // The single v1 intensity lands on the first ramp stop (that is also where
  // V1_TARGET_MAP points an "intensity" track). The second stop keeps a
  // proportional falloff so a dark v1 layer stays dark after the upgrade.
  const stops = [
    { t: 0, color: p.color, intensity: round(p.intensity) },
    {
      t: 1,
      color: p.secondaryColor,
      intensity: fit(p.intensity * 0.5, 0, 8),
    },
  ];
  const wantsErosion = p.erosion > 0 || animated.has("erosion");
  return {
    blend: p.blend === "normal" ? "alpha" : "additive",
    ramp: {
      space: layer.kind === "particles" ? "life" : "layerTime",
      stops,
      displacementShift: 0,
      heightSpan: 2,
    },
    opacity: p.opacity,
    mask: {
      textureId: layer.textureId ?? null,
      uvScale: [1, 1],
      uvPan: [0, 0],
      rotation: 0,
      randomRotation: layer.kind === "particles",
      atlas: null,
      flipbook: null,
    },
    noise: null,
    erosion: wantsErosion
      ? {
          curve: constantCurve(clamp(p.erosion, 0, 1)),
          softness: 0.12,
          edgeWidth: 0,
          edgeColor: p.color,
          edgeIntensity: 0,
          displacementProtect: 0,
          rimBias: 0,
        }
      : null,
    softParticle: 0,
    fresnel: null,
    procedural: SURFACE_MAP[layer.surface ?? "default"] ?? "none",
    proceduralParams: [0, 0, 0, 0],
    // v1 had no cel shading, no opaque phase and no channel split; an upgraded
    // layer keeps the v2 defaults so it renders exactly as it did before.
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
  };
}

function buildGeometry(layer: Layer, animated: Set<NumericTarget>): GeometryV2 {
  const p = layer.params;
  const wantsNoise =
    p.turbulence > 0 || animated.has("turbulence") || animated.has("speed");
  return {
    type: layer.geometry ?? "auto",
    segments: 64,
    radialSegments: 16,
    radius: clamp(p.radius, 0.01, 8),
    length: clamp(p.length, 0.01, 12),
    thickness: clamp(p.width, 0.001, 3),
    taper: 1,
    vertexNoise: wantsNoise
      ? {
          amplitude: fit(p.turbulence * 0.25, 0, 0.5),
          frequency: 1.5,
          speed: fit(Math.abs(p.speed) / 2, 0, 4),
          bias: [0, 0, 0],
          alongCurve: {
            keys: [
              [0, 0],
              [1, 1],
            ],
            ease: "smooth",
          },
        }
      : null,
    lightning:
      layer.geometry === "lightning"
        ? {
            points: 24,
            jitter: 0.4,
            branches: 2,
            branchDepth: 1,
            widthCurve: {
              keys: [
                [0, 1],
                [1, 0.3],
              ],
              ease: "smooth",
            },
            seedOffset: 0,
          }
        : null,
    band: null,
    slab: null,
    frame: null,
  };
}

function buildEmitter(params: Params, animated: Set<NumericTarget>): Emitter {
  // v1 emitted a single burst over `emission` seconds from a sphere of
  // `radius`, radially at `speed` with a `spread` cone and one fixed lifetime.
  const speedHi = params.speed;
  const speedLo = params.speed * (1 - clamp(params.spread, 0, 1));
  const wantsCurl = params.turbulence > 0 || animated.has("turbulence");
  const size: [number, number] = [
    fit(params.width, 0.001, 8),
    fit(params.width * 2.5, 0.001, 8),
  ];
  return {
    count: params.count,
    shape: {
      type: "sphere",
      axis: [0, 1, 0],
      length: 0,
      radius: fit(params.radius, 0, 12),
      innerRadius: 0,
      angle: 0,
      size: [1, 1, 1],
      surfaceOnly: false,
      bias: [0, 0, 0],
      pathId: null,
      sourceLayerId: null,
      interiorFraction: 0,
    },
    spawn: {
      mode: "burst",
      window: fit(params.emission, 0, 12),
      rate: 0,
      duration: 0,
      bursts: [],
      headCurve: null,
      originsFromPath: false,
    },
    velocity: {
      mode: "radial",
      speed: [
        fit(Math.min(speedLo, speedHi), -20, 20),
        fit(Math.max(speedLo, speedHi), -20, 20),
      ],
      direction: [0, 1, 0],
      angle: fit(params.spread * Math.PI, 0, Math.PI),
      inherit: 0,
      speedCurve: null,
    },
    // v1 lifetimes were uniform; ±35% variance stops the whole population
    // from dying on the same frame.
    life: [
      fit(params.life * 0.65, 0.02, 12),
      fit(params.life * 1.35, 0.02, 12),
    ],
    forces: {
      gravity: [0, fit(params.gravity, -12, 12), 0],
      drag: clamp(params.drag, 0, 6),
      curl: wantsCurl
        ? {
            strength: fit(params.turbulence * 1.5, 0, 3),
            frequency: 1.6,
            speed: 1.2,
            envelope: {
              keys: [
                [0, 0],
                [0.25, 1],
                [1, 1],
              ],
              ease: "smooth",
            },
          }
        : null,
      vortex: null,
      wind: [0, 0, 0],
      floor: null,
      planarDrag: 0,
    },
    render: {
      mode: "billboard",
      stretch: 0,
      size,
      sizeCurve: {
        keys: [
          [0, 1],
          [1, 1],
        ],
        ease: "linear",
      },
      alphaCurve: {
        keys: [
          [0, 0],
          [0.1, 1],
          [1, 0],
        ],
        ease: "smooth",
      },
      alphaAlongSpawn: null,
      rotation: {
        initial: [0, round(Math.PI * 2)],
        speed: [
          fit(-Math.abs(params.spin), -10, 10),
          fit(Math.abs(params.spin), -10, 10),
        ],
      },
      sortMode: "byDistance",
      twinkle: null,
      strip: null,
      anchor: "center",
    },
    trail: null,
    sub: null,
  };
}

function upgradeLayer(layer: Layer): LayerV2 {
  const animated = new Set<NumericTarget>(layer.tracks.map((t) => t.target));
  for (const o of layer.overrides)
    if (o.target !== "color") animated.add(o.target);
  const particles = layer.kind === "particles";
  const tracks: TrackV2[] = [];
  const seen = new Set<string>();
  for (const track of layer.tracks) {
    const target = mapV1Target(track.target, layer.kind);
    if (seen.has(target)) continue;
    seen.add(target);
    tracks.push({
      target,
      keys: track.keys.map(
        ([t, v]) =>
          [t, convertTargetValue(track.target, layer.kind, v)] as [
            number,
            number,
          ],
      ),
      ease: track.ease,
    });
  }
  const overrides = layer.overrides.map((o) => ({
    target: mapV1Target(o.target, layer.kind),
    value:
      typeof o.value === "number"
        ? convertTargetValue(o.target as NumericTarget, layer.kind, o.value)
        : o.value,
    start: o.start,
    end: o.end,
    fade: o.fade,
  }));
  const next: LayerV2 = {
    id: layer.id,
    name: layer.name,
    role: layer.role,
    kind: layer.kind,
    start: layer.start,
    end: layer.end,
    enabled: layer.enabled,
    transform: {
      position: [...layer.params.position],
      rotation: [...layer.params.rotation],
      scale: [1, 1, 1],
    },
    motion: layer.motion ?? null,
    jitter: null,
    collapse: null,
    window: null,
    material: buildMaterial(layer, animated),
    tracks,
    overrides,
  };
  if (particles) next.emitter = buildEmitter(layer.params, animated);
  else next.geometry = buildGeometry(layer, animated);
  return next;
}

/**
 * Upgrade a v1 document to autov.lab/2. Idempotent: a v2 document is returned
 * unchanged. No layers are invented — in particular no implicit light layer.
 */
export function upgradeDocument(
  input: VfxDocument | VfxDocumentV2,
): VfxDocumentV2 {
  if (isV2(input)) return input;
  const v1 = input as VfxDocument;
  const shell = defaultDocumentShell(v1.name);
  const doc: VfxDocumentV2 = {
    ...shell,
    name: v1.name,
    description: v1.description,
    seed: v1.seed,
    duration: v1.duration,
    impact: v1.impact,
    environment: {
      ...shell.environment,
      fog: { color: v1.post.background, density: 0.03 },
      background: v1.post.background,
    },
    post: {
      ...shell.post,
      bloom: {
        strength: clamp(v1.post.bloom, 0, 2),
        radius: 0.4,
        threshold: 1,
      },
      exposure: clamp(v1.post.exposure, 0.3, 2),
      vignette: 0.25,
      chromatic: 0,
    },
    textures: v1.textures ? structuredClone(v1.textures) : [],
    layers: v1.layers.map(upgradeLayer),
  };
  return validateDocumentV2(doc);
}

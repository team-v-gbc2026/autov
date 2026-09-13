import type { RecipeV2Id } from "./recipes-v2";

// ---------------------------------------------------------------------------
// autov.lab/2 technique cards.
//
// RECIPES_V2[...].knowledge (recipes-v2.ts) and CRAFT_RULES (protocol-v2.ts)
// tell the candidate model WHAT a family is and HOW to construct a document
// in general (order of operations, scale anchors). Neither tells it HOW real
// VFX artists actually build one kind of element — a toon smoke lobe, a beam
// sheath, a shield lattice. Live runs kept producing documents that are
// structurally right (anticipation -> flash -> ring -> smoke -> residue) but
// visually thin, because that construction knowledge lived only in the seven
// hand-authored exemplars, not in words the model reads.
//
// A technique card is that missing layer: a named, reusable pattern with a
// concrete numbered construction, a timing rule and a vocabulary note that
// tells the model exactly which schema-v2 fields implement it TODAY, so it
// never asks for material.toon or a "blob" kind that the renderer does not
// have. `missing` vocabulary is the renderer backlog, aggregated in
// docs/vfx-lab/TECHNIQUES.md.
//
// Sourced from docs/vfx-lab/research/2026-09-14-*.md (three research passes
// over ArtStation references and their nearest documented tutorial/breakdown
// ecosystem). Cards are English, terse and numeric where the research gives
// numbers, because they are read by the model, not by a person.
// ---------------------------------------------------------------------------

export const TECHNIQUE_IDS = [
  "cauliflower-blob-cluster",
  "inverted-hull-outline",
  "flat-splash-accent",
  "three-tone-layer-stack",
  "stripe-panner-core-and-sheath",
  "converging-charge",
  "vent-on-shutoff",
  "path-window-ribbon",
  "ground-ring-with-inner-fill",
  "upright-glow-cylinder",
  "four-point-sparkles",
  "staggered-instance-timing",
  "uv-erosion-front",
  "polar-swirl-disc",
  "blinking-arc-ribbons",
  "edge-biased-sparks",
  "instanced-shard-burst",
  "hex-lattice-fresnel-shield",
  "stepped-hash-glitch",
  "speed-line-cap",
  "two-layer-noise-mist",
  "cast-sigil-reveal",
] as const;
export type TechniqueId = (typeof TECHNIQUE_IDS)[number];

export interface TechniqueCard {
  id: TechniqueId;
  name: string;
  /** When to reach for it, one sentence. */
  use: string;
  /** 3-6 numbered steps, concrete and quantitative. */
  construction: string[];
  /** Phase rule as % of duration. */
  timing: string;
  /** 4-6 "what makes it read as AAA" bullets. */
  details: string[];
  vocabulary: {
    /** schema-v2 fields that implement this today. */
    available: string[];
    /** Vocabulary the renderer does not have yet. */
    missing: string[];
  };
  sources: string[];
}

const SMOKE = "docs/vfx-lab/research/2026-09-14-smoke-stylized.md";
const ICE_SHIELD = "docs/vfx-lab/research/2026-09-14-ice-shield-aura-glitch.md";
const BEAM_ETC =
  "docs/vfx-lab/research/2026-09-14-beam-portal-column-vortex-meteor-slash.md";

export const TECHNIQUES_V2: Record<TechniqueId, TechniqueCard> = {
  "cauliflower-blob-cluster": {
    id: "cauliflower-blob-cluster",
    name: "Cauliflower blob cluster",
    use: "A smoke, cloud or puff silhouette that should read as overlapping rounded lobes, not one fuzzy volume.",
    construction: [
      "3-6 big base lobes (shell layers, radius overlapping 40-70%).",
      "Stack smaller lobes at 40-70% of base radius on top of them.",
      "Add isolated wisp lobes at 20-30% radius near the top.",
      "Displace each lobe with geometry.vertexNoise so the mesh itself is bumpy.",
      "Ramp each lobe by material.ramp.space:\"surface\" (light cap, mid body, dark shadow).",
      "Stagger every lobe's layer.start by 40-100ms so the cluster builds.",
    ],
    timing:
      "Base lobes rise 10-55%, secondary lobes separate 40-75%, wisp lobes dissolve 65-100%.",
    details: [
      "3-6 big lobes read as a volume; one blob never does.",
      "Smaller lobes break the top edge into readable shapes.",
      "Wisp lobes detach and thin fastest for the dissolve.",
      "Colour is driven by a scalar (lobe age/family), never lighting alone.",
      "Intersection seams between opaque lobes are contour lines, not a bug.",
    ],
    vocabulary: {
      available: [
        'kind:"blob" with blob.arrangement "mound"|"column"|"ring"|"string"',
        "blob.{count,radius,spread,height,rise,gravity,drift,grow,stagger,life,squash}",
        "blob.bump.{amplitude,frequency,speed} (the cauliflower radius field)",
        "blob.comma.{curl,taper}",
        "material.toon.{bands,thresholds,shadow,body,highlight,light,rim}",
        "material.opaqueUntil",
      ],
      missing: [],
    },
    sources: [SMOKE],
  },

  "inverted-hull-outline": {
    id: "inverted-hull-outline",
    name: "Inverted-hull outline",
    use: "A toon-shaded mesh (smoke lobe, crystal, slash blade) that needs a crisp painted line instead of a soft alpha edge.",
    construction: [
      "Set material.outline.width to 0.02-0.06: the same surface is drawn again, back faces only, pushed that far out along its normal.",
      "Set material.outline.color one step DARKER than material.toon.shadow — the reference line is a dark crease, not a light rim (toon.rim is the light rim).",
      "Set material.opaqueUntil so the hull is opaque and depth tested; it only shows past the front-face silhouette.",
      "It fades together with its own surface in the closing 20-25% of life, never independently.",
    ],
    timing: "Present for the mesh's full visible life; fades with it in the last 20-25%.",
    details: [
      "A dark line reads as a crease between lobes; a light one reads as a second rim and fights toon.rim.",
      "The hull runs the same vertex program as the fill, so it tracks every blob.bump lobe instead of a smooth sphere.",
      "Width is in world metres, so a small lobe gets the same line weight as a big one.",
      "Pair it with material.toon: an outline round a smooth gradient reads as a sticker.",
    ],
    vocabulary: {
      available: [
        "material.outline.{width,color} (the inverted hull, flat and unlit)",
        "material.toon (the bands the line separates)",
        "material.opaqueUntil (the hull fades with its own surface)",
      ],
      missing: [],
    },
    sources: [SMOKE],
  },

  "flat-splash-accent": {
    id: "flat-splash-accent",
    name: "Flat splash accent",
    use: "The single flat, unshaded burst shape that sells 'something just popped' in the opening 5-20% of an impact.",
    construction: [
      'One kind:"splash" layer of 6-10 slivers, length 0.9-3.0, width 0.3-0.4, spread 0.65-1.65 rad.',
      "splash.color near-white or the brightest accent; splash.backing one step darker behind it.",
      "Scale them out over the first 25-30% of the layer window (splash.scaleIn), flat: no ramp, no erosion.",
      "Detach and fly them outward over the middle third, then fade before the residue starts.",
      "Start the layer after the main volume has landed, never with the anticipation glint.",
    ],
    timing: "5-20% of duration; always the shortest layer in the document.",
    details: [
      "Independent of the smoke/fire shading: a flat graphic accent, not part of the volume.",
      "Near-white or the brightest accent colour, unshaded.",
      "Reads only in the opening burst, never reused later.",
      "Pairs with a soft yellow anticipation glint just before it.",
    ],
    vocabulary: {
      available: [
        'kind:"splash" (a generated fan of flat, camera-facing slivers)',
        "splash.{count,length,width,curvature,jaggedness,spread}",
        "splash.{color,backing} and the scaleIn/detach/fade windows",
        'kind:"decal"|"sprite" with material.blend:"additive" for a single card instead',
      ],
      missing: [],
    },
    sources: [SMOKE],
  },

  "three-tone-layer-stack": {
    id: "three-tone-layer-stack",
    name: "Three-tone layer stack",
    use: "A fire body, slash blade or crystal facet that should cel-shade as highlight/mid/shadow instead of one smooth gradient.",
    construction: [
      "Build the element as 3 overlapping mesh layers of the same geometry: highlight, midtone, shadow.",
      "Give each its own material.ramp with 2-3 stops tuned to one tone only.",
      "Offset the highlight's transform.scale and layer.start slightly ahead and smaller than the shadow's.",
      "Drive the highlight's material.ramp.displacementShift so it always reads hottest.",
    ],
    timing:
      "All three run concurrently for the element's full life; highlight's layer.start trails the shadow's by 20-40ms.",
    details: [
      "Three separate meshes beat one smooth ramp for a cel-shaded look.",
      "The highlight layer moves faster and stays smaller, concentrating energy at the tip.",
      "Bands must read as discrete, not a smooth interpolation.",
      "Works for fire bodies, slash blades and crystal facets alike.",
    ],
    vocabulary: {
      available: [
        'geometry.type:"slab" + geometry.slab.tiers (all three tones in ONE layer, hard-edged, outermost first)',
        'kind:"shell"|"trail" (x3, shared geometry) when the tones need their own transforms',
        "material.ramp (2-3 stops, ascending t)",
        "material.ramp.displacementShift",
        "material.toon (all three bands in one shader, when the element is one mesh)",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "stripe-panner-core-and-sheath": {
    id: "stripe-panner-core-and-sheath",
    name: "Stripe-panner core and sheath",
    use: "A sustained beam or energy-column core that needs hard panning bands instead of a soft additive glow tube.",
    construction: [
      'Core: one plain kind:"beam" geometry.type "cylinder" at radius 0.05-0.10, procedural "solid", a nearly flat white ramp and ONE material.stripes set at contrast 0.1-0.2 — it only breathes, it never breaks up.',
      "Sheath: a second cylinder around it at radius 0.15-0.20 carrying TWO material.stripes sets at contrast ~1, different frequencies (about 2.6 and 6.1 bands per metre) and phase 1 so every circumferential ring is offset and the bands read as filaments.",
      "Body: a geometry.type \"slab\" on the same axis with 3 hard tiers (outer, body, inner) — that is the readable WIDTH of the beam, and a soft-edged wide slab would read as fog instead.",
      "material.flicker {rate 10-14, amount 0.15-0.35} on the sheath: a hashed STEP, never a sine pulse.",
      "Keep every ramp intensity under post.bloom.threshold except the core's, so only the core blows out.",
      "One tracked geometry.length on all three layers extends and retracts them together.",
    ],
    timing:
      "Charge ~0-15%, extend (geometry.length near-zero to full) ~15-25%, sustain flat through the hold, release in the final ~10%.",
    details: [
      "Core stays plain and unmasked; all pattern detail lives on the sheath.",
      "Sheath ramp under bloom threshold, or it reads as white instead of coloured.",
      "Two ribbon trails braided above/below the core sell energy, not a static tube.",
      "geometry.length extends the beam; never scale for this.",
    ],
    vocabulary: {
      available: [
        'kind:"beam" geometry.type:"cylinder" (core and sheath) and "slab" (body)',
        "material.stripes[{frequency (bands per metre), speed, phase (ring offset), sharpness, contrast}]",
        "material.flicker.{rate,amount}",
        "geometry.slab.{anchor,tiers,taper}",
        "material.ramp (space surface, under bloom.threshold)",
        "geometry.length track",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "converging-charge": {
    id: "converging-charge",
    name: "Converging charge",
    use: "The 0.5-1s anticipation before a beam fires, a shield snaps up, or a strike lands: motes pulled inward, not out.",
    construction: [
      "One particles layer, emitter.shape a ring or sphere around the eventual origin.",
      "emitter.velocity.mode \"radial\" with a NEGATIVE speed so motes travel inward.",
      "Raise emitter.render.alphaCurve toward the collapse so motes brighten as they close in.",
      "End the layer right as the primary effect starts, feeding straight into the flare.",
    ],
    timing: "0-100% of the anticipation window, ending within 0-50ms of the primary layer's start.",
    details: [
      "Negative radial speed is the whole trick: same vocabulary as an outward burst, inverted.",
      "Motes brighten as they approach the centre, never stay constant.",
      "The collapse must finish exactly as the flare/strike/snap starts.",
      "Works for beam charge, shield cast and lightning charge alike.",
    ],
    vocabulary: {
      available: [
        'kind:"particles"',
        'emitter.velocity.{mode:"radial", speed negative}',
        "emitter.render.alphaCurve",
        'a kind:"sprite" with procedural "softRadial" and a tracked geometry.radius for the tightening ball',
        "layer.start/end timing",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "vent-on-shutoff": {
    id: "vent-on-shutoff",
    name: "Vent on shutoff",
    use: "A sustained beam or column that should never just cut to black: residual energy vents over the last 10-15%.",
    construction: [
      'Declare the beam\'s own axis once as a paths[] entry {type:"line", from: the muzzle, to: the far tip}, so nothing that vents can drift off the line the beam drew.',
      'A sparkle RUN first: a particles layer with emitter.velocity.mode "alongPath" on that path, velocity.speedCurve as the shared head envelope over the layer\'s own 0..1 progress and velocity.speed re-read as the per-particle lag band ([0, 0.4-0.6]), so the motes race out as a wave rather than a shower.',
      'Then the residue: a second particles layer with emitter.shape.type "pathLine" on the same path, scattered by shape.radius, with render.twinkle and a bell-shaped alphaCurve so it blinks in and thins out.',
      "Colour-shift the ramp across the residue's own life: a hot colour into a cooled accent (yellow into green).",
      "Keep both low-speed with a little gravity, so it reads as venting, not as firing again.",
      "End it 10-15% of total duration after the core is fully gone.",
    ],
    timing: "Starts exactly at core release/shutoff; runs 10-15% of total duration past it.",
    details: [
      "Never a hard cut: always a trailing colour-shifted burst.",
      "Colour shifts across the vent's own life, not one flat tone.",
      "Low outward speed reads as dissipating, not a second firing.",
      "Keyed to the parent beam/column's own release track, not a fixed clock time.",
    ],
    vocabulary: {
      available: [
        'paths[{type:"line", from, to}]',
        'emitter.velocity.mode:"alongPath" + velocity.speedCurve (the shared head envelope) + velocity.speed (the per-particle lag band)',
        'emitter.shape.type:"pathLine" + shape.radius (the scatter)',
        "emitter.render.twinkle + a bell alphaCurve",
        "material.ramp (multi-stop colour-shift, space life)",
        "layer.start keyed to parent release",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "path-window-ribbon": {
    id: "path-window-ribbon",
    name: "Path-window ribbon",
    use: "Anything that sweeps along a path and needs a visible travelling window — a heal sweep, a beam-braid strand, a portal ribbon — hot core plus soft halo.",
    construction: [
      'Declare the path once in document paths: {type:"orbit"} for a sweep around a subject, {type:"bezier"} for a thrown arc.',
      'One kind:"ribbon" layer on it. ribbon.window.head is a Curve over the layer\'s own 0..1 progress and ribbon.window.tail the window length as a fraction of the path; only that window is ever drawn.',
      "ribbon.strands 3-5 with spread 0.06-0.12, widthJitter ~0.45 and phaseJitter ~0.1, so the strands braid instead of overlapping.",
      "ribbon.taper {head 0.08-0.15, tail 0.22-0.3}: a squared-off end reads as a card.",
      'material.ramp.space "surface" keys the ramp ACROSS the strip (t=0 core, t=1 edge); ribbon.core multiplies the hot centre. One layer is core AND halo.',
      "ribbon.morph blends the whole sweep onto a second path, so a hip-height sweep that dives into a ground ring stays one layer.",
    ],
    timing:
      "One full sweep over 60-80% of the layer's own life; the window itself stays ~15-45% of the path length. A head curve that runs past 1 keeps circling a closed orbit.",
    details: [
      "The moving window is what reads as travelling, not just present.",
      "The ramp across the strip is the core/halo split; a second layer for the halo is wasted.",
      "Taper both ends; a squared-off end reads as a card, not an energy strand.",
      "Multiple strands need a phase offset per strand, not identical timing.",
    ],
    vocabulary: {
      available: [
        'kind:"ribbon" with ribbon.pathId into document paths',
        "ribbon.window.{head Curve, tail}",
        "ribbon.strands.{count,spread,widthJitter,phaseJitter}",
        "ribbon.{width,taper,core,orientation}",
        "ribbon.morph.{pathId,curve}",
        'material.ramp.space:"surface" (across the strip)',
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "ground-ring-with-inner-fill": {
    id: "ground-ring-with-inner-fill",
    name: "Ground ring with inner fill",
    use: "The base of an aura, heal or buff effect: a flat ring on the ground with a softly filled interior, popping in early.",
    construction: [
      'Two flat kind:"decal" cards on the ground (rotation [-1.5708,0,0]), one over the other.',
      'The rim card uses material.procedural "swirlRing": three offset thin strands with a harmonic wobble, rotating, plus short detached arcs outside the rim (the arcs ride on the wobble, so a wobble of 0 is a plain soft ring). proceduralParams = [rim radius as a fraction of the card half-size, strand half-width, wobble amplitude, rotation rate rad/s].',
      'The fill card under it uses material.procedural "ringFill": proceduralParams = [fill radius, pulse rate rad/s, noise amount, edge softness].',
      "Snap the rim out from ~72% to full over the first half second with a track on material.proceduralParams[0], not on transform.scale.",
      "Keep both flat and thin so they read as ground contact, not a dome.",
    ],
    timing: "Pops in over the first 10-15%; holds through the sustain; fades with the rest at the end.",
    details: [
      "Bright rim + soft inner fill, not one flat-coloured disc.",
      "A confident scale-in reads as a cast, not a slow fade.",
      "Panning noise in the fill keeps it alive during the hold.",
      "Always a ground-contact element even when the rest of the effect is airborne.",
    ],
    vocabulary: {
      available: [
        'kind:"decal" with material.procedural:"swirlRing" (rim) and "ringFill" (interior)',
        "material.proceduralParams [radius, width, wobble, rate]",
        "a track on material.proceduralParams[0] for the snap-out",
        "rotation [-1.5708,0,0] for ground lie",
      ],
      missing: ["ease \"outBack\" (overshoot-and-settle scale-in)"],
    },
    sources: [ICE_SHIELD],
  },

  "upright-glow-cylinder": {
    id: "upright-glow-cylinder",
    name: "Upright glow cylinder",
    use: "The vertical body of an aura, heal-over-time or energy-column effect: a soft additive glow tube, not a hard beam.",
    construction: [
      'kind:"beam" with geometry.type "cylinder", rotation [-1.5708,0,0] so it stands up; geometry.length is its height and geometry.taper 0.75-0.9 narrows the top.',
      'material.procedural must be "solid": "none" is the soft-disc SPRITE silhouette and on a tube it reads as a blob halfway around it.',
      'material.ramp.space "surface" runs along the height; end it at intensity 0 so the additive top fades out instead of ending at a cap.',
      "material.noise with uvPan up the axis perturbs that surface key, which is what makes the rising streaks.",
      "material.erosion whose curve stays near 0 until ~40% and climbs to ~1: only the top tears, so the glow escapes in streaks.",
      "material.fresnel 0.2-0.35 with a ramp that brightens just off the bottom, so the silhouette edges read hotter than the body.",
      "Keep material.opacity low (0.15-0.3) so it reads as light, not a solid tube.",
    ],
    timing: "Fades in with the ground ring (first 10-15%), holds through the sustain, fades last.",
    details: [
      "Soft top and a slight taper read as light escaping, not a capped cylinder.",
      "Fresnel-driven edge brightening separates this from a flat glow decal.",
      "Vertical noise panning keeps the column visibly alive.",
      "Low opacity: this is atmosphere, not the hero silhouette.",
    ],
    vocabulary: {
      available: [
        'kind:"beam" geometry.type:"cylinder" with geometry.taper',
        'material.blend:"additive" + material.procedural:"solid"',
        'material.ramp.space:"surface" (along the height)',
        "material.noise.uvPan, material.erosion.curve",
        "material.fresnel.{power,strength}",
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "four-point-sparkles": {
    id: "four-point-sparkles",
    name: "Four-point sparkles",
    use: "Small rising sparkle accents inside an aura, heal or magic effect: a four-point star, not a round dot.",
    construction: [
      'A particles layer with material.procedural "star4" — a four-point glint, not a round dot.',
      "Stagger every instance's birth (see staggered-instance-timing) so they do not spawn together.",
      "Give each a small sine wobble on its horizontal position as it rises.",
      "Drive alpha with a bell curve (in, hold, out) per instance, not a linear fade.",
      "Add emitter.render.twinkle (frequency 4-12, depth 0.4-0.7): the phase is hashed off each instance, so no two blink together.",
    ],
    timing: "Staggered across the whole hold; each instance's own life is short, 0.3-0.6s.",
    details: [
      "Four-point star silhouette is what reads as 'magic sparkle', not a round dot.",
      "Staggered per-instance birth is mandatory; a synchronized burst reads as one shape.",
      "Sine wobble on rise sells weightlessness.",
      "Bell-curve alpha per instance, not a shared linear fade.",
    ],
    vocabulary: {
      available: [
        'kind:"particles" with material.procedural:"star4"',
        "emitter.render.twinkle.{frequency,depth} (per-instance hashed flicker)",
        "emitter.render.alphaCurve (the bell), emitter.spawn.window (the stagger)",
        "emitter.render.rotation.speed (wobble)",
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "staggered-instance-timing": {
    id: "staggered-instance-timing",
    name: "Staggered instance timing",
    use: "Any group of repeated elements (spikes, shards, arcs, lobes) that would otherwise move in lockstep — the single biggest cheap-vs-AAA tell.",
    construction: [
      "Derive a per-instance offset from a fixed seed or index, never random per frame.",
      "Apply it to birth time (layer.start), spread across 5-15% of the group's own build time.",
      "Vary scale or speed slightly per instance from the same seed so no two copies match.",
      "Never drive a repeated group from one shared global curve alone.",
      'For a group strung along a path, emitter.spawn.mode "pathAnchored" derives the whole stagger from one head curve: no birth table, and the order follows the path.',
      'For a MESH group — spikes, shards, lobes — the generator kinds carry the stagger themselves: crystals.stagger and blob.stagger are [startFrac,endFrac] of the layer window, and crystals.groups makes each length class start later than the one before it.',
    ],
    timing: "Spread the group's births across 5-15% of the group's own build phase.",
    details: [
      "The single most common AAA-vs-cheap tell across every family in the research.",
      "5-15% stagger is enough; more reads as disorganised.",
      "Pair with a per-instance scale/speed hash, not just a time shift.",
      "Applies to shield hits, ice spikes, lightning branches, lobes and shards alike.",
    ],
    vocabulary: {
      available: [
        "per-layer layer.start offset",
        'emitter.spawn.mode:"bursts" with bursts[{t,count}]',
        'emitter.spawn.mode:"pathAnchored" + spawn.headCurve: instance i is born as the head passes u = i/(count-1)',
        "emitter.render.twinkle (per-instance hashed alpha phase)",
        "layer.jitter.{frequency,amplitude,gate} (stepped-hash offset on the layer transform)",
        "crystals.{stagger,groups} and blob.stagger (per-instance birth inside one generated mesh group)",
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "uv-erosion-front": {
    id: "uv-erosion-front",
    name: "UV erosion front",
    use: "A slash, sword trail or dissolving mesh that should tear away rather than fade out uniformly.",
    construction: [
      "material.erosion.curve advances faster than realtime (~1.3x layer-local time) with a slight lag.",
      "Key material.ramp.space to \"surface\" so ramp and erosion front travel together.",
      "Add material.noise distortion so the erosion edge is jagged, not a clean line.",
      "Widen material.erosion.edgeWidth and raise edgeIntensity as the front advances.",
    ],
    timing: "The front reaches full coverage in the closing 30-40% of the element's life, never a uniform fade over 100%.",
    details: [
      "This is tearing, not fading: opacity stays near 1 until the front passes a point.",
      "The front should outrun the element's own alpha fade.",
      "Jagged noise on the edge sells 'torn'; a clean edge reads as a wipe transition.",
      "Rising edge width/intensity keeps a hot trailing line on the tear.",
    ],
    vocabulary: {
      available: [
        "material.erosion.{curve,edgeWidth,edgeIntensity,softness}",
        'material.ramp.space:"surface"',
        "material.noise.distortion",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "polar-swirl-disc": {
    id: "polar-swirl-disc",
    name: "Polar swirl disc",
    use: "A sky vortex or tornado: a disc built from a polar-coordinate swirl, not a spinning texture.",
    construction: [
      "Stack 3 discs at different scale, spin speed and opacity: fast inner, medium, slow outer haze.",
      "Pan each disc's material.noise with a swirl bias so bands curve inward over radius.",
      "Ramp colour bright yellow-white at the centre to an orange/accent haze outward.",
      "Add a separate instanced sprite layer of dark flecks on slower orbits for parallax.",
    ],
    timing: "Continuous for the full sustained duration; flecks staggered independently of the disc spin.",
    details: [
      "At least 3 independently spinning/opacity layers, not one textured disc.",
      "Colour goes bright centre to dark/accent haze outward.",
      "Dark bands come from the same noise that drives the swirl.",
      "Flecks on their own slower orbit sell parallax and scale.",
    ],
    vocabulary: {
      available: [
        'kind:"ring" geometry.type:"disc" (x3 stacked)',
        "material.noise.{uvPan,distortion}",
        "material.ramp (space life or layerTime)",
        'separate particles layer, emitter.velocity.mode:"tangential"',
      ],
      missing: [
        "polar swirl UV remap (angle += strength/dist baked into material.noise panning)",
      ],
    },
    sources: [BEAM_ETC],
  },

  "blinking-arc-ribbons": {
    id: "blinking-arc-ribbons",
    name: "Blinking arc ribbons",
    use: "Lightning branches or an energy column: arcs that blink per-segment rather than staying continuously lit.",
    construction: [
      'One kind:"arcs" layer, never one layer per arc: the renderer hashes every wire\'s radius, pitch, base height, span and phase out of (arcs.seed, index) AND out of its own blink cycle, so no two flashes trace the same wire.',
      "arcs.radius/pitch/span size the helix band around the layer's own +Y axis; 10-14 wires read as a cage, 30 read as fur.",
      "arcs.jitter {amplitude 0.5-0.9, frequency 6-12, fold 1}: the FOLD is what makes the wire kink instead of curling, and a curling wire reads as a ribbon, not as electricity.",
      "arcs.blink {period 0.18-0.38 s, onTime 0.07-0.20 s, skipChance 0.1-0.3}: short lit windows out of short cycles, with whole cycles dropped so the set never finds a rhythm.",
      "arcs.coreColor is the white-blue filament and arcs.haloColor the sheath around it; an arcs layer takes no colour from material.ramp.",
      "Track material.opacity for the density envelope: densest just before the event, thinned through the sustain, gone before the end.",
    ],
    timing: "Each arc's own blink cycle is short (tens of ms); the group spans the effect's full sustain.",
    details: [
      "Independent per-segment blink is what reads as lightning, not static neon.",
      "Per-arc seed drives both the path noise and the blink timing.",
      "Camera-facing ribbon, not a 3D tube: crisper at a distance.",
      "More than 2-4 arcs visible at once reads noisy, not electric.",
    ],
    vocabulary: {
      available: [
        'kind:"arcs" with arcs.{count,radius,pitch,span,width,seed}',
        "arcs.jitter.{amplitude,frequency,fold}",
        "arcs.blink.{period,onTime,skipChance}",
        "arcs.{coreColor,haloColor}",
        "layer.collapse (so the cage shrinks with the body it wraps)",
        "material.opacity track for the density envelope",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "edge-biased-sparks": {
    id: "edge-biased-sparks",
    name: "Edge-biased sparks",
    use: "A portal or shield rim: sparks that spawn along the edge/perimeter, not across the whole surface.",
    construction: [
      "emitter.shape \"ring\"/\"disc\" with surfaceOnly, sized to the parent mesh's rim.",
      "emitter.velocity.mode \"cone\" outward from the rim, with gravity so sparks arc and fall.",
      "Give the rim its own emissive mesh strip layer with its own material.ramp and a subtle pulse.",
      "Sine-flicker the rim's own opacity/intensity slightly (0.7 + 0.3*sin) so it is never static.",
    ],
    timing: "Continuous through the sustain; density can rise in the final 10-20% before a portal event or shield break.",
    details: [
      "Perimeter-only spawn reads as a rim effect; whole-surface spawn reads as generic particles.",
      "The rim is a separate mesh strip so it pulses independently of the interior.",
      "Gravity on the arc sells 'sparks', not 'particles'.",
      "A slight sine flicker keeps a held shield/portal from looking like a static texture.",
    ],
    vocabulary: {
      available: [
        'emitter.shape.{type:"ring"|"disc", surfaceOnly:true}',
        'emitter.velocity.{mode:"cone", direction outward}',
        "emitter.forces.gravity",
        'separate kind:"ring" rim layer with its own material.ramp',
      ],
      missing: [],
    },
    sources: [ICE_SHIELD, BEAM_ETC],
  },

  "instanced-shard-burst": {
    id: "instanced-shard-burst",
    name: "Instanced shard burst",
    use: "Ice-shatter, glitch impact or crystal-cluster eruption debris: separate rigid pieces on ballistic paths, not a particle cloud.",
    construction: [
      'Spawn the pieces ON the thing that broke: emitter.shape.type "layerInstances" with shape.sourceLayerId pointing at the crystals (or blob) layer, so each piece inherits one spike\'s position and axis.',
      'emitter.velocity.mode "radial" then throws each piece along its OWN instance axis; add shape.radius 0.03-0.06 to scatter them off the axis a little.',
      "emitter.forces.gravity pulls the pieces down and emitter.forces.floor stops them at the ground.",
      "emitter.forces.planarDrag 1.5-2.5 settles the horizontal travel onto an asymptote, so the burst spreads, stops spreading and drifts as a flat disc instead of coasting off screen.",
      "Two populations: many small chips (0.03-0.13, life 0.9-2.1) and a handful of bigger chunks (0.10-0.30) on a heavier gravity and a shorter drag.",
      "Stagger the births over a 0.15-0.20 s spawn window and fade each piece on its own alphaCurve, so the burst never vanishes on one frame.",
    ],
    timing: "Fires at the shatter moment; chips live 0.9-2.1 s staggered, chunks a little longer.",
    details: [
      "Closed-form ballistic motion (initial velocity + gravity) needs no simulation.",
      "Borrowed spawn sites are what make the debris read as THIS object breaking rather than as a generic burst at the same place.",
      "planarDrag is the difference between a settling disc of chips and debris that leaves the frame.",
      "Angular geometry or a jagged mask, never round sprites, for a broken read.",
      "Per-piece staggered fade avoids the whole burst vanishing on one frame.",
    ],
    vocabulary: {
      available: [
        'kind:"particles" with emitter.shape.type:"layerInstances" + shape.sourceLayerId',
        'emitter.velocity.{mode:"radial"} (along the borrowed instance axis)',
        "emitter.forces.{gravity, planarDrag, floor}",
        'emitter.shape.type:"hemisphere"|"sphere" when there is no source layer to borrow',
        'kind:"wireBurst" for outline-only debris (polygon shells plus spokes)',
        "emitter.render.alphaCurve, emitter.spawn.window (the stagger)",
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "hex-lattice-fresnel-shield": {
    id: "hex-lattice-fresnel-shield",
    name: "Hex-lattice fresnel shield",
    use: "A standing forcefield/shield dome: a hex-cell lattice pulsing outward with a fresnel rim, plus a note on depth intersection.",
    construction: [
      'ONE sphere shell with material.lattice: cells 300-450, edgeWidth ~0.2, gapWidth ~0.08, a mint tile colour and a pale-gold edge. The renderer relaxes the cells onto the sphere, so there is no seam, no pole and no second pass to cross-weave.',
      "lattice.pulse {speed ~2.1, phaseJitter 1} runs an outward pulse from the crown on a hashed per-cell phase, so it is never static.",
      'material.reveal {mode:"scan"} lights the cells up from the crown down over 0.8-0.9 s; the front keys on the CELL, so a cell arrives whole instead of being wiped through.',
      "material.fresnel power 8 against a cream last ramp stop carries the silhouette where lattice.grazeFade drops the cells out; material.planeGlow draws the floor contact ring.",
      "material.ripples: 1-2 great circles at the hit times, speed ~3.7 rad/s, width ~0.17, decay ~4. lattice.dissolve switches the cells off one by one on the way out, so the shell comes apart instead of dimming.",
      "Scale it in on an overshoot: 0.22 -> 1.06 -> 1 over ~0.55 s, on transform.scale.",
    ],
    timing: "Snaps up over 100-250 ms, scans on over the next 0.8 s, holds with the pulse and the ripples, dissolves over the closing 25-30%.",
    details: [
      "One relaxed lattice beats two hex passes: real cells, no seam, no moire at the pole.",
      "High fresnel power separates a shield from a flat glowing sphere, and grazeFade is what stops the cells shimmering at the silhouette.",
      "Hit ripples are great circles on the shell, not a second sphere.",
      "The dissolve is per cell, so the shield comes apart instead of dimming.",
      "Pair it with a tilted geometry.type \"band\" belt: real geometry with depth write, so the far arc sorts behind the shell instead of glowing through it.",
    ],
    vocabulary: {
      available: [
        'kind:"shell" with material.lattice.{cells,edgeWidth,gapWidth,tileColor,edgeColor,pulse,dissolve,grazeFade}',
        'material.reveal.{mode:"scan",from,to,frontWidth}',
        "material.fresnel.{power,strength}",
        "material.planeGlow.{plane,distance,color,intensity}",
        "material.ripples[{time,origin,speed,width,decay}]",
        'geometry.type:"band" + geometry.band.{tilt,spin,stripes} for the belt',
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "stepped-hash-glitch": {
    id: "stepped-hash-glitch",
    name: "Stepped-hash glitch",
    use: "A glitch/digital/hologram projectile or impact: displacement and colour break in discrete stepped windows, not a continuous wobble.",
    construction: [
      "layer.jitter on the head and on the impact burst: {frequency 10-20, amplitude 0.07-0.14, gate 0.55-0.85}. The gate is what makes it DISCRETE — only the windows whose hash clears it fire.",
      "material.rgbSplit {offset 0.002-0.006, growth 0.8-1.6} on the mesh or wireBurst layers: three per-channel copies pushed apart in screen space, separating further as the layer ages.",
      'post.glitch {curve over document time, bands 12-20, blockGrid [54,34], split 0.005-0.01, edgeBias 0.7-1}: band displacement, channel split and block dropout, all keyed on hash(floor(t*20)).',
      'Anchor the trail to the path instead of trailing it: emitter.shape.type "path" + spawn.mode "pathAnchored" + render.mode "pathAligned" + render.twinkle, so dashes hold in space and flicker out.',
      "Keep the screen pass to two hot frames at the hit plus a ~0.2 s tail; longer reads as a broken renderer, not as an effect.",
    ],
    timing: "Glitch windows fire throughout at a fixed frequency; flicker frequency ramps up in the closing 10% before impact.",
    details: [
      "Discrete stepped windows, never a continuous sine wobble, is the whole 'glitch' read.",
      "Channel-split colour needs two accent ramp stops flanking the base hue.",
      "Block dropout wants a stepped erosion curve, not the usual smooth sweep.",
      "A dashed, stepped-hue segmented trail beats a continuous glow line.",
      "Rising flicker frequency before impact reads as instability building toward the hit.",
    ],
    vocabulary: {
      available: [
        "layer.jitter.{frequency,amplitude,gate,axis} (stepped-hash offset, any kind)",
        "material.rgbSplit.{offset,growth} (mesh kinds and wireBurst)",
        "post.glitch.{curve,bands,blockGrid,split,edgeBias}",
        'emitter.shape.type:"path" + spawn.mode:"pathAnchored" + render.mode:"pathAligned"',
        "geometry.type (faceted low-poly head), material.ramp accent stops",
      ],
      missing: ["scanline overlay"],
    },
    sources: [ICE_SHIELD],
  },

  "speed-line-cap": {
    id: "speed-line-cap",
    name: "Speed-line cap",
    use: "The head of a fast-traveling projectile (meteor, arrow, fast slash) that needs directional streak lines, not a plain sphere.",
    construction: [
      "Stretch the core mesh along its velocity direction so motion reads in silhouette.",
      "Add a hemisphere cap mesh in front with a scrolling stripe mask (uvPan) for speed-lines.",
      "Jitter the core slightly frame to frame for a burning/unstable read.",
      "Emit a velocity-aligned smoke/dust trail behind, with gravity on individual dust puffs.",
    ],
    timing: "Present for the full travel phase; the impact burst is a SEPARATE event, not a trail continuation.",
    details: [
      "A stretched core beats a static sphere with a trail behind it.",
      "A scrolling stripe-mask cap sells 'fast', independent of the trail.",
      "The impact is its own radial burst + rising particles, never just the trail stopping.",
      "Slight per-frame jitter on the core reads as unstable, not a smooth CG ball.",
    ],
    vocabulary: {
      available: [
        "kind:\"shell\" (stretched via transform.scale on the velocity axis)",
        "kind:\"sprite\"|\"decal\" hemisphere cap, material.mask.uvPan (scrolling stripe)",
        'trailing kind:"particles", emitter.render.mode:"velocityStretch"',
        "emitter.forces.gravity on trailing dust",
      ],
      missing: [],
    },
    sources: [BEAM_ETC],
  },

  "cast-sigil-reveal": {
    id: "cast-sigil-reveal",
    name: "Cast sigil reveal",
    use: "The magic circle a ground-cast spell draws itself on before anything erupts out of it.",
    construction: [
      'One flat kind:"decal" on the ground (rotation [-1.5708,0,0]) about 3 units across, material.procedural "sigil".',
      "proceduralParams [ring pairs 3, rune cells 64, radial spokes 16, gold rim 0..1]: concentric rings, a band of hashed rune ticks, spokes and a two-layer polar mist, all from one card.",
      'material.reveal {mode:"radial"} draws it outward from the centre. Set `to` past 1 so the front reaches the rim EARLY and the finished sigil then simply holds — a layer that outlives its own reveal.',
      "Track proceduralParams[3] so the gold rim only pops on the frame the effect fires, then decays.",
      "Fade the whole card out once the thing it cast owns the frame; a sigil that stays reads as UI.",
      "Put a dim softRadial ground pool under it for the cold/warm wash the circle sits in.",
    ],
    timing: "Draws over the first 15-25% of the document, holds briefly, gone by 40%.",
    details: [
      "The reveal front is what reads as DRAWING; a circle that fades in reads as a texture.",
      "A bright leading band at the front (reveal.frontWidth) sells the stroke.",
      "The rune ticks are hashed per cell, so no two sectors repeat and none of them is authored.",
      "The gold rim is an accent for one beat, never the sigil's base colour.",
    ],
    vocabulary: {
      available: [
        'kind:"decal" with material.procedural:"sigil"',
        "material.proceduralParams [rings, rune cells, spokes, gold rim]",
        'material.reveal.{mode:"radial",from,to,frontWidth}',
        "a track on material.proceduralParams[3] for the rim pop",
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },

  "two-layer-noise-mist": {
    id: "two-layer-noise-mist",
    name: "Two-layer noise mist",
    use: "A lingering ground mist, chillfog or portal-interior atmosphere: two independently panning noise layers, not one static fog sprite.",
    construction: [
      'TWO ground decals, not one: each a flat card with material.procedural "smoke" and its own material.noise.uvPan, panning in opposite directions at different rates.',
      "Give each its own distortionPan (roughly the negative of its uvPan) so the two fields never drift together.",
      "material.erosion with a shallow curve (0.24 -> 0.34) and a wide softness tears the fog into tongues instead of a soft disc.",
      "Keep them small — a card radius near the effect's own extent, grown by 1.3-1.6x over the layer — and dim: 0.1-0.2 opacity each, or the pair floods the frame.",
      "Give particle-based mist emitter.forces.floor so it pools rather than passing through the ground.",
      "Fade it in early with the anticipation, but let it linger well past the main burst.",
    ],
    timing: "Fades in 0-20%, thickens through the burst, lingers at low opacity well past the effect's peak as a residue role.",
    details: [
      "Two noise layers panned at different speeds is the minimum for 'alive' mist.",
      "Per-instance distortion phase offset avoids identical repeated mist cards.",
      "Floor collision keeps particle-based mist pooling on the ground.",
      "Mist is a residue element: the last thing still visible, not gone with the flash.",
    ],
    vocabulary: {
      available: [
        'kind:"decal"|"particles" with material.procedural:"smoke"',
        "material.noise.{uvPan,distortion,distortionPan} (one card per pan direction)",
        "material.erosion.{curve,softness,edgeWidth,edgeColor}",
        "emitter.forces.floor.{y,softness}",
        'role:"residue" with a late end',
      ],
      missing: [],
    },
    sources: [ICE_SHIELD],
  },
};

/** Every family the planner knows, mapped to its most relevant technique cards. */
export const TECHNIQUES_BY_FAMILY: Record<RecipeV2Id, TechniqueId[]> = {
  "fire-projectile": [
    "three-tone-layer-stack",
    "uv-erosion-front",
    "staggered-instance-timing",
    "cauliflower-blob-cluster",
  ],
  "smoke-burst": [
    "cauliflower-blob-cluster",
    "inverted-hull-outline",
    "flat-splash-accent",
    "two-layer-noise-mist",
  ],
  "lightning-impact": [
    "blinking-arc-ribbons",
    "converging-charge",
    "staggered-instance-timing",
    "instanced-shard-burst",
  ],
  "fire-slash": [
    "uv-erosion-front",
    "three-tone-layer-stack",
    "staggered-instance-timing",
  ],
  beam: [
    "stripe-panner-core-and-sheath",
    "converging-charge",
    "vent-on-shutoff",
    "three-tone-layer-stack",
  ],
  "energy-column": [
    "stripe-panner-core-and-sheath",
    "blinking-arc-ribbons",
    "three-tone-layer-stack",
    "edge-biased-sparks",
  ],
  shield: [
    "hex-lattice-fresnel-shield",
    "converging-charge",
    "staggered-instance-timing",
  ],
  "meteor-rain": [
    "speed-line-cap",
    "instanced-shard-burst",
    "staggered-instance-timing",
  ],
  "ice-blast": [
    "cast-sigil-reveal",
    "instanced-shard-burst",
    "two-layer-noise-mist",
    "staggered-instance-timing",
  ],
  "healing-aura": [
    "path-window-ribbon",
    "ground-ring-with-inner-fill",
    "upright-glow-cylinder",
    "four-point-sparkles",
  ],
  "glitch-projectile": [
    "stepped-hash-glitch",
    "staggered-instance-timing",
    "instanced-shard-burst",
    "path-window-ribbon",
  ],
};

/**
 * Prompt keywords for shapes the eight families don't cover directly (aura,
 * portal, vortex, glitch, energy column, water, a second look at meteor,
 * crystal/ice outside ice-blast, and smoke outside smoke-burst). Matched
 * against the raw user prompt in `techniqueBrief`, in order, each adding its
 * cards to whatever the family already contributed.
 */
export const TECHNIQUE_KEYWORDS: Array<[RegExp, TechniqueId[]]> = [
  [
    /aura|heal/i,
    [
      "ground-ring-with-inner-fill",
      "upright-glow-cylinder",
      "path-window-ribbon",
      "four-point-sparkles",
    ],
  ],
  [/portal/i, ["edge-biased-sparks", "two-layer-noise-mist", "path-window-ribbon"]],
  [/sigil|rune|circle|summon|cast/i, ["cast-sigil-reveal", "ground-ring-with-inner-fill"]],
  [/vortex|tornado|swirl/i, ["polar-swirl-disc", "edge-biased-sparks"]],
  [/glitch|digital|hologram/i, ["stepped-hash-glitch", "instanced-shard-burst"]],
  [
    /column|overload|pillar|surge/i,
    ["blinking-arc-ribbons", "stripe-panner-core-and-sheath", "upright-glow-cylinder"],
  ],
  [/water|liquid/i, ["two-layer-noise-mist", "polar-swirl-disc"]],
  [/meteor/i, ["speed-line-cap", "instanced-shard-burst"]],
  [
    /crystal|ice|frost/i,
    ["instanced-shard-burst", "two-layer-noise-mist", "hex-lattice-fresnel-shield"],
  ],
  [
    /smoke|puff|cloud/i,
    [
      "cauliflower-blob-cluster",
      "inverted-hull-outline",
      "flat-splash-accent",
      "two-layer-noise-mist",
    ],
  ],
];

/**
 * Written per card that ships with no `vocabulary.available` entries. Empty
 * today: `inverted-hull-outline` was the last such card and material.outline
 * now implements it directly.
 */
const APPROXIMATIONS: Partial<Record<TechniqueId, string>> = {};

/**
 * Total character budget for one `techniqueBrief` call. Raised from 4500 when
 * the heal and glitch ports gave path-window-ribbon, upright-glow-cylinder and
 * stepped-hash-glitch real construction steps, and again from 5400 when the ice
 * and shield ports rewrote hex-lattice-fresnel-shield and instanced-shard-burst
 * around the new vocabulary: those two cards carry real field lists now, and at
 * 5400 a shield brief dropped the keyword-matched fourth card, which is the one
 * the prompt itself asked for. Even at 6600 the block is a third of the size of
 * the example document the same call already sends.
 */
const BRIEF_CHAR_BUDGET = 6600;

/**
 * A single card in full: every construction step (numbered), the timing
 * rule, the top 3 details and the available vocabulary — nothing here is
 * truncated. Cutting a step mid-sentence throws away exactly the
 * quantitative content ("3-6 big base lobes...") the model needs; the
 * budget in `techniqueBrief` is enforced by dropping whole cards, never by
 * cutting text.
 */
function cardBrief(card: TechniqueCard): string {
  const build = card.construction
    .map((step, i) => `${i + 1}) ${step}`)
    .join(" ");
  const details = card.details.slice(0, 3).join("; ");
  const vocab = card.vocabulary.available.length
    ? card.vocabulary.available.join(", ")
    : (APPROXIMATIONS[card.id] ?? "no dedicated fields yet");
  return `### ${card.name}\n${card.use}\nBuild: ${build}\nTiming: ${card.timing}\nDetails: ${details}\nFields: ${vocab}`;
}

/**
 * A prompt block of technique cards for one family and prompt: the family's
 * own cards first, then any keyword-matched cards not already included, up
 * to `opts.max` (default 4) cards and `BRIEF_CHAR_BUDGET` (4500) characters.
 * Every included card is emitted in full — `use`, every construction step,
 * timing and the top 3 details are never cut — so a card that would push
 * the block over budget is dropped whole rather than truncated. Only
 * `vocabulary.available` is surfaced — never `missing` — so the candidate
 * model is never invited to ask for fields the renderer does not have.
 */
export function techniqueBrief(
  family: RecipeV2Id,
  prompt: string,
  opts: { max?: number } = {},
): string {
  const max = opts.max ?? 4;
  const candidates: TechniqueId[] = [];
  const addCandidate = (id: TechniqueId) => {
    if (!candidates.includes(id)) candidates.push(id);
  };
  for (const id of TECHNIQUES_BY_FAMILY[family]) addCandidate(id);
  for (const [pattern, ids] of TECHNIQUE_KEYWORDS) {
    if (!pattern.test(prompt)) continue;
    for (const id of ids) addCandidate(id);
  }
  const parts: string[] = [];
  let total = 0;
  for (const id of candidates) {
    if (parts.length >= max) break;
    const text = cardBrief(TECHNIQUES_V2[id]);
    const added = text.length + (parts.length ? 2 : 0); // "\n\n" joiner
    // Always keep at least one card, even over budget, so the brief is
    // never empty; every card after that is dropped, not trimmed, once it
    // would push the block past the budget.
    if (parts.length > 0 && total + added > BRIEF_CHAR_BUDGET) continue;
    parts.push(text);
    total += added;
  }
  return parts.join("\n\n");
}

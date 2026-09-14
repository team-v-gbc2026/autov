# Technique cards

Date: 2026-09-14. Source: `frontend/src/lib/vfx-lab/techniques-v2.ts`, built from
`docs/vfx-lab/research/2026-09-14-*.md`.

## What a technique card is

`RECIPES_V2[...].knowledge` (`recipes-v2.ts`) tells the candidate model what a family is: the
shot list for a fire projectile, a smoke burst, a shield. `CRAFT_RULES` (`protocol-v2.ts`) tells
it how to build ANY v2 document in general — construction order, scale anchors, staggering. Live
benchmark runs kept producing documents that were structurally right (anticipation, flash, ring,
smoke, residue, lights, decals) but visually thin: real VFX construction knowledge — how an
artist actually builds a cel-shaded smoke lobe, a beam sheath, a hex shield lattice — only
existed in the seven hand-authored exemplar documents, never in words the model reads.

A **technique card** is that missing layer. Each one is a named, reusable construction pattern:

- `use` — one sentence on when to reach for it.
- `construction` — 3-6 numbered, concrete, quantitative steps.
- `timing` — a phase rule as % of duration.
- `details` — 4-6 "what makes it read as AAA" bullets (secondary elements, staggering, edge
  treatment).
- `vocabulary.available` — the schema-v2 fields that implement it TODAY.
- `vocabulary.missing` — the vocabulary the renderer does not have yet.
- `sources` — which research doc it came from.

29 cards live in `TECHNIQUES_V2`. `TECHNIQUES_BY_FAMILY` maps each of the fifteen `RecipeV2Id`
families to its 3-4 most relevant cards; `TECHNIQUE_KEYWORDS` is a list of `[RegExp, TechniqueId[]]`
pairs that add cards for shapes a family doesn't cover directly — aura/heal, sigil/summon,
glitch/hologram, meteor/comet, slash/blade, crystal/ice outside `ice-blast`, and smoke outside
`smoke-burst`. (Portal, vortex, energy column, water and the playful symbol burst now have families
of their own; their keywords route to those families and to the same cards.)

## How it reaches the prompt

`techniqueBrief(family, prompt, opts?)` builds the family's cards first, then adds any
keyword-matched cards not already present, capped at `opts.max` (default 4) so the block stays
bounded — it never returns more than 4 cards, so a run only pays for what the model can actually
use inside a candidate call. Each card is condensed to name, the first 3 construction steps, timing,
the top 3 details and — deliberately — **only `vocabulary.available`**, never `missing`: the point
is that the model is never invited to ask for vocabulary the renderer cannot render. A card whose
`available` list is empty gets a one-line hand-written "approximate with: ..." fallback instead;
no card is in that state today (`inverted-hull-outline` was the last, until `material.outline`
landed).

It is wired into the v2 candidate call (`route.ts`, `action: "candidate"`, alongside
`RECIPES_V2[family].knowledge` and the example document) and into the structural-refinement call
(`action: "restructure"`, alongside the admitted defects and director notes) — both send
`technique: techniqueBrief(family, run.prompt)` in the same JSON payload as everything else the
model already reads.

## The 26 cards

| Card | One line |
|---|---|
| `cast-sigil-reveal` | A whole magic circle from one `sigil` card, drawn outward by a radial reveal front. |
| `cauliflower-blob-cluster` | A generated cluster of toon-shaded lobes for a smoke/cloud silhouette, not one fuzzy blob. |
| `inverted-hull-outline` | Back-face-pushed second pass for a crisp dark crease on a toon mesh. |
| `flat-splash-accent` | A generated fan of flat, unshaded slivers that sells "something popped". |
| `three-tone-layer-stack` | Three overlapping meshes (highlight/mid/shadow), each its own ramp, offset in scale and time. |
| `stripe-panner-core-and-sheath` | Plain additive core plus a wider panning-stripe sheath for a beam or column. |
| `converging-charge` | Anticipation motes on a negative radial speed, converging inward before the payoff. |
| `vent-on-shutoff` | A colour-shifted trailing burst so a sustained beam/column never just cuts to black. |
| `path-window-ribbon` | A moving [head-tail, head] draw window along a path, hot core plus soft halo. |
| `ground-ring-with-inner-fill` | Bright-rim ring plus a soft panning inner fill, popping in with an overshoot scale. |
| `upright-glow-cylinder` | Soft additive vertical tube with fresnel-brightened edges for an aura/column body. |
| `four-point-sparkles` | Staggered, wobbling, bell-alpha four-point star instances for magic accents. |
| `staggered-instance-timing` | Per-instance birth/scale offset so a repeated group never moves in lockstep. |
| `uv-erosion-front` | An erosion curve that outruns the alpha fade, so a mesh tears rather than fades. |
| `polar-swirl-disc` | Three stacked discs whose ANGLE is sheared by twist/distance, so noise becomes spiral arms. |
| `blinking-arc-ribbons` | Camera-facing ribbons that blink per-segment on an independent per-arc seed. |
| `edge-biased-sparks` | Perimeter-only spark spawn plus a separately pulsing rim mesh for a portal/shield edge. |
| `instanced-shard-burst` | Closed-form ballistic debris burst with angular geometry for ice/glitch impact. |
| `hex-lattice-fresnel-shield` | One relaxed Voronoi lattice, a high fresnel rim, a per-cell dissolve and great-circle ripples. |
| `stepped-hash-glitch` | Discrete stepped vertex/erosion jitter plus RGB-split ramp stops for a glitch look. |
| `speed-line-cap` | A `teardropStreak` card anchored at its leading point, so the streak trails the tip. |
| `two-layer-noise-mist` | Two independently panning noise layers with floor collision for lingering ground mist. |
| `sdf-frame-rim` | One rounded-rect signed distance carrying a portal's whole rim, drawn up both sides at once. |
| `panning-flow-interior` | Four panning noise octaves with a view parallax, so a flat card reads as an interior. |
| `orbiting-lobe-ring` | Cel lobes on a ring band at r^-0.65, far half drawn first and dimmer, lit from the core. |
| `path-anchored-trail` | Lobes that HOLD where the head passed, retracting from one end, with events hung off the path. |

## Family and keyword routing

| Family | Cards |
|---|---|
| `fire-projectile` | three-tone-layer-stack, uv-erosion-front, staggered-instance-timing, cauliflower-blob-cluster |
| `smoke-burst` | cauliflower-blob-cluster, inverted-hull-outline, flat-splash-accent, two-layer-noise-mist |
| `lightning-impact` | blinking-arc-ribbons, converging-charge, staggered-instance-timing, instanced-shard-burst |
| `fire-slash` | uv-erosion-front, three-tone-layer-stack, staggered-instance-timing |
| `beam` | stripe-panner-core-and-sheath, converging-charge, vent-on-shutoff, three-tone-layer-stack |
| `energy-column` | stripe-panner-core-and-sheath, blinking-arc-ribbons, three-tone-layer-stack, edge-biased-sparks |
| `shield` | hex-lattice-fresnel-shield, converging-charge, staggered-instance-timing |
| `meteor-rain` | path-anchored-trail, speed-line-cap, instanced-shard-burst, cauliflower-blob-cluster |
| `portal` | sdf-frame-rim, panning-flow-interior, edge-biased-sparks, ground-ring-with-inner-fill |
| `sky-vortex` | polar-swirl-disc, orbiting-lobe-ring, cauliflower-blob-cluster, staggered-instance-timing |
| `ice-blast` | instanced-shard-burst, two-layer-noise-mist, staggered-instance-timing |
| `healing-aura` | path-window-ribbon, ground-ring-with-inner-fill, upright-glow-cylinder, four-point-sparkles |
| `glitch-projectile` | stepped-hash-glitch, staggered-instance-timing, instanced-shard-burst, path-window-ribbon |

| Prompt keyword | Cards added |
|---|---|
| `aura\|heal` | ground-ring-with-inner-fill, upright-glow-cylinder, path-window-ribbon, four-point-sparkles |
| `portal\|gate\|doorway\|rift` | sdf-frame-rim, panning-flow-interior, edge-biased-sparks |
| `vortex\|tornado\|swirl\|maelstrom` | polar-swirl-disc, orbiting-lobe-ring, edge-biased-sparks |
| `glitch\|digital\|hologram` | stepped-hash-glitch, instanced-shard-burst |
| `column\|overload\|pillar\|surge` | blinking-arc-ribbons, stripe-panner-core-and-sheath, upright-glow-cylinder |
| `water\|liquid` | two-layer-noise-mist, polar-swirl-disc |
| `meteor\|comet\|falling` | path-anchored-trail, speed-line-cap, instanced-shard-burst |
| `sigil\|rune\|circle\|summon\|cast` | cast-sigil-reveal, ground-ring-with-inner-fill |
| `crystal\|ice\|frost` | instanced-shard-burst, two-layer-noise-mist, hex-lattice-fresnel-shield |
| `smoke\|puff\|cloud` | cauliflower-blob-cluster, inverted-hull-outline, flat-splash-accent, two-layer-noise-mist |

## Missing vocabulary — renderer backlog

Aggregated from every card's `vocabulary.missing`. This is what a real AAA construction pattern
needs that schema-v2 / runtime-v2 cannot express yet; `techniqueBrief` never surfaces any of it to
the model, so it is exposed here instead, for whoever picks up renderer work next.

| Missing vocabulary | Needed by | Notes |
|---|---|---|
| ease `"outBack"` (overshoot-and-settle scale-in, beyond `outCubic`) | ground-ring-with-inner-fill | `CurveSchema.ease` today is `linear \| smooth` only (`easing` on tracks adds `outCubic \| inQuad`, no back-ease). |
| polar swirl UV remap (`angle += strength / dist`, baked into material panning) | polar-swirl-disc | Approximated with stacked discs at different `uvPan` speeds plus `emitter.forces.vortex` on fleck particles. |
| scanline overlay | stepped-hash-glitch | `post.glitch` covers band displacement, channel split and block dropout, but not a standing scanline pattern. |

### Closed 2026-09-14 — the heal / glitch spike port

Five more entries were closed by the Phase D port of the S2 heal and glitch spikes
(`TOOLBOX_V2_MAPPING.md` §5–§6):

| Was missing | Now | Card |
|---|---|---|
| ribbon window (moving head-tail draw range along a path, independent of `layer.start`/`end`) | document `paths` + `kind:"ribbon"` with `ribbon.window.{head,tail}`, `ribbon.strands`, `ribbon.taper` and `ribbon.morph` onto a second path | path-window-ribbon |
| true per-instance hashed offset inside a single emitter | `emitter.spawn.mode:"pathAnchored"` + `spawn.headCurve` (birth ordered along the path) and `emitter.render.twinkle` (per-instance alpha phase) | staggered-instance-timing, four-point-sparkles |
| world-position-offset vertex jitter gated by a stepped time hash | `layer.jitter{frequency,amplitude,gate,axis}`, on ANY kind, closed form from `floor(age*frequency)` | stepped-hash-glitch |
| true per-channel RGB split (separate R/G/B UV offset) | `material.rgbSplit{offset,growth}` — three per-channel draws, mesh kinds and `wireBurst` only | stepped-hash-glitch |
| (none, added outright) | `post.glitch{curve,bands,blockGrid,split,edgeBias}`, `kind:"wireBurst"`, `geometry.taper`, `material.proceduralParams` with the `swirlRing` / `ringFill` flat-card patterns | stepped-hash-glitch, ground-ring-with-inner-fill, upright-glow-cylinder |

`material.rgbSplit` is deliberately NOT available on particles: a particles layer is one instanced
draw, and splitting it would triple the instance budget. A particle population fakes the split with
magenta/cyan ramp stops flanking the base hue, which is what `glitch-projectile`'s shards do.

### Closed 2026-09-14 — the smoke-spike port

The four entries at the top of this table were closed by the Phase C port of the S2 smoke spike
(`TOOLBOX_V2_MAPPING.md` §4), and their cards now carry real `vocabulary.available` lists:

| Was missing | Now | Card |
|---|---|---|
| `material.toon` (posterised N·L bands) | `material.toon{bands,thresholds,shadow,body,highlight,light,rim}` | cauliflower-blob-cluster, inverted-hull-outline, three-tone-layer-stack |
| `outline` (inverted-hull second pass, unlit) | `material.outline{width,color}` — and the convention flipped: the line is DARKER than the shadow tone, a crease, not a rim | inverted-hull-outline |
| `kind:"blob"` (fusion of overlapping lobes) | `kind:"blob"` + `layer.blob` — a generator with four arrangements; overlapping opaque lobes with `material.opaqueUntil`, so seams read as contour lines by design | cauliflower-blob-cluster |
| per-mesh unlit flat shading | the outline pass is unlit by construction; `material.toon` makes the fill independent of the scene's point lights too | inverted-hull-outline |

`flat-splash-accent` also moved from "a decal plus a jagged mask" to `kind:"splash"`, a generated
fan of flat slivers, though it never contributed a backlog entry.

### Closed 2026-09-14 — the ice / shield spike port

The Phase E port of the S3 ice and shield spikes (`TOOLBOX_V2_MAPPING.md` §7–§8) closed the last
shield entry and rewrote four cards around real fields:

| Was missing | Now | Card |
|---|---|---|
| depth-intersection glow (world position vs. dome radius -> contact line) | `material.planeGlow{plane,distance,color,intensity}` — analytic proximity to the ground plane, no depth texture, so it cannot flicker | hex-lattice-fresnel-shield |
| (none, added outright) | `kind:"crystals"` + `layer.crystals` — an instanced faceted cluster generated from a direction band, length/width bands, groups, stagger, easeOutBack growth and a collapse | instanced-shard-burst, staggered-instance-timing |
| (none, added outright) | `material.lattice` (relaxed spherical Voronoi cells, pulse, dissolve, grazeFade), `material.reveal` (radial / scan front), `material.ripples` (great circles), `geometry.type:"band"` + `geometry.band` | hex-lattice-fresnel-shield |
| (none, added outright) | `emitter.shape.type:"layerInstances"` + `shape.sourceLayerId` (borrowed spawn sites) and `emitter.forces.planarDrag` (XZ-only drag) | instanced-shard-burst |
| (none, added outright) | `material.procedural:"sigil"` with `proceduralParams` [ring pairs, rune cells, spokes, gold rim] | cast-sigil-reveal (new) |

`hex-lattice-fresnel-shield` no longer asks for two cross-woven hexagon passes: one relaxed
lattice gives real cells with no seam, no pole and no moire, so the card is one sphere now.

### Closed 2026-09-14 — the beam / energy-column spike port

Two more entries were closed by the port of the S7 beam and S10 column spikes
(`TOOLBOX_V2_MAPPING.md` §9–§10):

| Was missing | Now | Card |
|---|---|---|
| stripe panner (hard `fract(u*n - t)` scrolling band shader on a mesh material) | `material.stripes[{frequency (bands per metre along the layer axis), speed, phase (per-ring offset: 0 is a straight segment ladder, 1 is filaments), sharpness, contrast}]`, plus `material.flicker{rate,amount}` for the hashed step and `geometry.type:"slab"` + `geometry.slab.tiers` for the hard-edged body the bands sit in | stripe-panner-core-and-sheath, three-tone-layer-stack |
| per-segment blink gating inside a single arc layer | `kind:"arcs"` + `layer.arcs` — a generator whose radius, pitch, base, span and phase are re-hashed on every blink cycle, with `arcs.blink{period,onTime,skipChance}` and a folded `arcs.jitter` so the wire kinks | blinking-arc-ribbons |

The port also added vocabulary no card had asked for: `kind:"streakBurst"` (a clumped screen-space
speed-line fan), `post.flash` (a full-screen additive white-out), `layer.collapse` (one retraction
shared by every part of a composite body), `paths[].type:"line"`, `emitter.shape.type:"pathLine"`,
`emitter.velocity.mode:"alongPath"`, `emitter.render.mode:"flatStrip"` (tapered flat cel licks on a
flipbook hold) and the `lensFlare` / `radialRays` procedurals. `vent-on-shutoff` and
`converging-charge` were rewritten around the first four of those.

### Closed 2026-09-14 — the portal / vortex / meteor spike port

The last of the three standing backlog entries closed with the port of the S8 portal, S9 vortex and
S11 meteor spikes (`TOOLBOX_V2_MAPPING.md` §11–§13):

| Was missing | Now | Card |
|---|---|---|
| polar swirl UV remap (angle += strength/dist baked into `material.noise` panning) | `material.procedural:"swirlDisc"` with `material.swirl.{bands,detail,lobe,strength}` — the angle is sheared by `twist/(distance+eps)`, an explicit log spiral draws the arms, an independently wound tighter spiral shades them, and one `strength` envelope winds the whole thing up and unwinds it | polar-swirl-disc |

The port also added vocabulary no card had asked for: `geometry.type:"frame"` with
`material.sdfLine` and `material.beads` (a rim read off a signed distance, with a `"perimeter"`
`material.reveal` running up both sides at once), `material.flow` (a multi-layer panning surface
with a view parallax), `kind:"reflection"`, `ramp.space:"radial"`, `blob.arrangement:"orbit"` and
`"path"` with `blob.{lightFrom,retract,head,perAnchor}`, `emitter.shape.type:"frame"` and
`"orbit"`, `emitter.velocity.mode:"orbit"`, `emitter.spawn.mode:"event"` with
`spawn.originsFromPath`, `emitter.render.anchor:"head"` with
`material.procedural:"teardropStreak"`, `layer.window` (a layer that starts when a path's head
reaches a point rather than at a clock time) and `environment.groundPool`. Four cards were added
around them — `sdf-frame-rim`, `panning-flow-interior`, `orbiting-lobe-ring` and
`path-anchored-trail` — and `polar-swirl-disc`, `speed-line-cap` and `edge-biased-sparks` were
rewritten.

### Closed 2026-09-14 — the water / playful / slash spike port

The port of the S12 water, S13 playful and S13 slash spikes (`TOOLBOX_V2_MAPPING.md` §14–§16) added
three cards and no backlog. Nothing in the three is renderer backlog: every field they name exists.

| Card | What it carries |
|---|---|
| `torn-membrane-tail` | `kind:"sheets"` — curved, tapered, OPAQUE membranes on a hashed MULTI-CADENCE schedule, cel-shaded from `material.toon` and torn at the border by a low-frequency threshold. The one rule the schema now enforces outright: a size class whose `life` outlives its own `period` is clipped by its own re-fire, and coverage inside a class comes from spreading its births evenly across that period |
| `arc-window-crescent` | `kind:"crescent"` — a strip swept along a signed arc of which only `[tail, head]` is drawn, head and tail being TWO curves on ONE window, drawn once per tonal copy with an optional lagging smear; its tail EATEN by a Voronoi erosion front, with `kind:"licks"` and `emitter.spawn.mode:"frontAnchored"` both anchored to that front |
| `drawn-symbol-burst` | `layer.frame:"camera"`, `environment.backdrop`, the six drawn-symbol procedurals with `material.symbol` and `material.screentone`, `emitter.shape.type:"radialFan"` and `emitter.render.mode:"sliver"` with `render.{retract,secondary}` — a star line RETRACTS from the root outward, it never simply fades |

The port also added vocabulary no card had asked for: `transform.squash` (a volume-conserving
breath on any kind) and `material.streaks` / `material.creases` (thin hard bands keyed on the along
OR the angular coordinate, and a higher-frequency field darkening narrow folds). `uv-erosion-front`
and `three-tone-layer-stack` — the two cards a slash reaches for — were already fully expressible
and stay as they were; `arc-window-crescent` now leads the `fire-slash` family ahead of both.

27 of the 29 cards now implement fully within today's vocabulary (`vocabulary.missing: []`); the
remaining 2 entries in the backlog above belong to `ground-ring-with-inner-fill` and
`stepped-hash-glitch`.

### Closed 2026-09-14 — the colour-field port

The port that came out of the first live run with the v2 vocabulary (`TOOLBOX_V2_MAPPING.md` §17)
added two cards and four backlog entries.

| Card | What it carries |
|---|---|
| `continuous-colour-field` | `material.ramp.space:"sprite"` (the key across a particle's own quad, 0 tail → 1 head), `material.ramp.blend {space, weight}` (a second key space mixed into the first: `key = mix(primary, secondary, weight)`), `material.ramp.heightSpan` used honestly, and `material.toon.{colorSource:"ramp",shadowScale,highlightMix}` — a cel cluster whose BODY band comes from the ramp at the fragment, so the bands stay and the flat colour goes. Plus the rule that decides which key: height for what rises, radial for what spreads, life for what ages, sprite for pieces big enough to read their own gradient |
| `particle-ribbon-trails` | `emitter.trail.{segments,spacing,widthCurve,ramp}` — the ribbon each particle drags behind it, keyed head-to-tail by `trail.ramp.space:"along"`, tapered to 0 at the tail. Cross-references `kind:"trail"` (one mesh streak) and `kind:"ribbon"` (a multi-strand strip swept along a document path), which are for a single hero path and not for a population |

Backlog the two cards name (`vocabulary.missing`):

- A per-particle hue jitter — a random offset into the ramp per instance, so a population varies
  without needing a spatial key.
- A `"speed"` ramp space, keying on the particle's own velocity magnitude.
- A trail width in world units, independent of `emitter.render.size` (today a 0.05 spark can only
  drag a hairline).
- Per-segment noise on the ribbon spine, for a wavy streamer rather than an exact replay of the path.

31 of the 31 cards route from a family or a keyword; 27 implement fully within today's vocabulary,
and the backlog above belongs to `ground-ring-with-inner-fill`, `stepped-hash-glitch`,
`continuous-colour-field` and `particle-ribbon-trails`.

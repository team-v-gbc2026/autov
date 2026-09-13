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

21 cards live in `TECHNIQUES_V2`. `TECHNIQUES_BY_FAMILY` maps each of the eight `RecipeV2Id`
families to its 3-4 most relevant cards; `TECHNIQUE_KEYWORDS` is a list of `[RegExp, TechniqueId[]]`
pairs that add cards for shapes the eight families don't cover directly — aura/heal, portal,
vortex/tornado, glitch/hologram, energy column, water, a second look at meteor, crystal/ice
outside `ice-blast`, and smoke outside `smoke-burst`.

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

## The 21 cards

| Card | One line |
|---|---|
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
| `polar-swirl-disc` | Three stacked spinning discs with swirl-biased noise panning for a vortex/tornado. |
| `blinking-arc-ribbons` | Camera-facing ribbons that blink per-segment on an independent per-arc seed. |
| `edge-biased-sparks` | Perimeter-only spark spawn plus a separately pulsing rim mesh for a portal/shield edge. |
| `instanced-shard-burst` | Closed-form ballistic debris burst with angular geometry for ice/glitch impact. |
| `hex-lattice-fresnel-shield` | Two hex passes, high fresnel power, repeatedly-pulsed erosion for a shield dome. |
| `stepped-hash-glitch` | Discrete stepped vertex/erosion jitter plus RGB-split ramp stops for a glitch look. |
| `speed-line-cap` | A stretched, jittering core plus a scrolling-stripe hemisphere cap for a fast projectile head. |
| `two-layer-noise-mist` | Two independently panning noise layers with floor collision for lingering ground mist. |

## Family and keyword routing

| Family | Cards |
|---|---|
| `fire-projectile` | three-tone-layer-stack, uv-erosion-front, staggered-instance-timing, cauliflower-blob-cluster |
| `smoke-burst` | cauliflower-blob-cluster, inverted-hull-outline, flat-splash-accent, two-layer-noise-mist |
| `lightning-impact` | blinking-arc-ribbons, converging-charge, staggered-instance-timing, instanced-shard-burst |
| `fire-slash` | uv-erosion-front, three-tone-layer-stack, staggered-instance-timing |
| `beam` | stripe-panner-core-and-sheath, converging-charge, vent-on-shutoff, path-window-ribbon |
| `shield` | hex-lattice-fresnel-shield, converging-charge, staggered-instance-timing |
| `meteor-rain` | speed-line-cap, instanced-shard-burst, staggered-instance-timing |
| `ice-blast` | instanced-shard-burst, two-layer-noise-mist, staggered-instance-timing |

| Prompt keyword | Cards added |
|---|---|
| `aura\|heal` | ground-ring-with-inner-fill, upright-glow-cylinder, path-window-ribbon, four-point-sparkles |
| `portal` | edge-biased-sparks, two-layer-noise-mist, path-window-ribbon |
| `vortex\|tornado\|swirl` | polar-swirl-disc, edge-biased-sparks |
| `glitch\|digital\|hologram` | stepped-hash-glitch, instanced-shard-burst |
| `column\|overload\|pillar` | blinking-arc-ribbons, upright-glow-cylinder |
| `water\|liquid` | two-layer-noise-mist, polar-swirl-disc |
| `meteor` | speed-line-cap, instanced-shard-burst |
| `crystal\|ice\|frost` | instanced-shard-burst, two-layer-noise-mist, hex-lattice-fresnel-shield |
| `smoke\|puff\|cloud` | cauliflower-blob-cluster, inverted-hull-outline, flat-splash-accent, two-layer-noise-mist |

## Missing vocabulary — renderer backlog

Aggregated from every card's `vocabulary.missing`. This is what a real AAA construction pattern
needs that schema-v2 / runtime-v2 cannot express yet; `techniqueBrief` never surfaces any of it to
the model, so it is exposed here instead, for whoever picks up renderer work next.

| Missing vocabulary | Needed by | Notes |
|---|---|---|
| stripe panner (hard `fract(u*n - t)` scrolling band shader on a mesh material) | stripe-panner-core-and-sheath | Approximated with `material.mask` atlas panning or a tracked `erosion.curve`. |
| ribbon window (moving head-tail draw range along a path, independent of `layer.start`/`end`) | path-window-ribbon | Approximated with `layer.start/end` plus a tracked opacity/length ramp. |
| ease `"outBack"` (overshoot-and-settle scale-in, beyond `outCubic`) | ground-ring-with-inner-fill | `CurveSchema.ease` today is `linear \| smooth` only (`easing` on tracks adds `outCubic \| inQuad`, no back-ease). |
| true per-instance hashed offset inside a single emitter | staggered-instance-timing | Today: author N separate layers with different seed/start instead of one emitter with per-instance variation. |
| polar swirl UV remap (`angle += strength / dist`, baked into material panning) | polar-swirl-disc | Approximated with stacked discs at different `uvPan` speeds plus `emitter.forces.vortex` on fleck particles. |
| per-segment blink gating inside a single arc layer | blinking-arc-ribbons | Today: author several short-lived arc layers as the blink window. |
| depth-intersection glow (reconstructed world position vs. dome radius -> contact line) | hex-lattice-fresnel-shield | Needs a depth pre-pass comparison; noted as a renderer gap directly in the card. |
| world-position-offset vertex jitter gated by a stepped time hash | stepped-hash-glitch | Distinct from `geometry.vertexNoise`, which is continuous, not stepped/discrete. |
| true per-channel RGB split (separate R/G/B UV offset) | stepped-hash-glitch | Approximated with magenta/cyan `material.ramp` stops flanking the base colour. |
| scanline overlay | stepped-hash-glitch | No approximation offered; purely missing. |

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

14 of the 21 cards now implement fully within today's vocabulary (`vocabulary.missing: []`); the
remaining 7 each contribute one or more entries to the renderer backlog above.

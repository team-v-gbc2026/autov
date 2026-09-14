# Toolbox v2 — status and research direction (2026-09-13, evening)

Branch: `feature/vfx-toolbox-v2` (from `codex/vfx-integrated-benchmark`), repo `team-v-gbc2026/autov`.
Companion docs: `TOOLBOX_V2_MAPPING.md` (spike → schema decisions), `DESIGN.md` (v1 thesis).

## What exists now

- **Schema v2** (`schema-v2.ts`, `migrate.ts`): materials with HDR ramps, mask/noise/erosion, emitters with
  shapes/spawn/velocity/forces/render/trail/sub, geometry with vertexNoise/lightning, light + decal layers,
  environment (ground/fog/ambient), camera framing/shake/pushIn, post. 91 archived v1 trials upgrade cleanly.
- **Renderer v2** (`runtime-v2.ts`, `shaders-v2.ts`, `post-v2.ts`, `environment-v2.ts`, `lightning-v2.ts`,
  `evaluate-v2.ts`, `capture-v2.ts`): analytic (closed-form in time) particles with textured erosion, curl,
  vortex, trails, sub-emitters; analytic teardrop shell + library meshes; procedural surfaces; MSAA+SMAA,
  HalfFloat, bloom/vignette/chromatic/grade; depth pre-pass soft particles; hero-centric auto-framing; orbit camera.
- **Cel-shaded blob vocabulary** (`schema-v2.ts`, `blob-v2.ts`, `splash-v2.ts`, `shaders-v2.ts`,
  `runtime-v2.ts`): `kind:"blob"` generates a cluster of toon-shaded, inverted-hull-outlined lobes
  from `layer.blob` (arrangement / count / spread / height / rise / bump / comma) and `kind:"splash"`
  a fan of flat slivers from `layer.splash`; `material.{toon,outline,opaqueUntil}`, the `height` ramp
  space and the `star4` / `softRadial` billboard procedurals go with them. Ported from the S2 smoke
  spike (see `TOOLBOX_V2_MAPPING.md` §4); the `smoke-burst` exemplar is built entirely from them.
- **Path vocabulary** (`paths-v2.ts`, `ribbon-v2.ts`, `schema-v2.ts`, `shaders-v2.ts`, `runtime-v2.ts`):
  document-level `paths` (`orbit` / `bezier`, evaluated identically on the CPU and in GLSL),
  `kind:"ribbon"` (a multi-strand strip swept inside a moving `[head-tail, head]` window, with a
  `morph` onto a second path), and path-anchored emitters (`emitter.shape.type:"path"` +
  `spawn.mode:"pathAnchored"` + `render.mode:"pathAligned"`). Ported from the S2 heal and glitch
  spikes (`TOOLBOX_V2_MAPPING.md` §5–§6); `healing-aura` and `glitch-projectile` are built on them.
- **Discrete vocabulary** (same files plus `wire-burst-v2.ts`, `post-v2.ts`, `evaluate-v2.ts`):
  `layer.jitter` (stepped-hash transform offset on any kind), `kind:"wireBurst"` (a generated burst
  of polygon outlines and spokes), `material.rgbSplit` (three per-channel draws on mesh kinds and
  wireBurst), `post.glitch` (a time-gated screen break keyed on `hash(floor(t*20))`),
  `emitter.render.twinkle`, `geometry.taper` on an open cylinder, and the `swirlRing` / `ringFill`
  flat-card procedurals driven by the new generic `material.proceduralParams` vec4.
- **Solid vocabulary** (`crystals-v2.ts`, `lattice-v2.ts`, `schema-v2.ts`, `shaders-v2.ts`,
  `runtime-v2.ts`): `kind:"crystals"` generates an instanced cluster of flat-shaded faceted
  spikes from `layer.crystals` (direction band / length + width bands / groups / stagger /
  easeOutBack growth / collapse / glint), depth-writing so overlapping spikes intersect for
  real; `material.lattice` turns a mesh into a spherical hex shell whose cells are a relaxed
  (Lloyd) Fibonacci Voronoi set generated and cached by `(cells, seed)` and looked up per pixel;
  `material.reveal` is a travelling radial or scan front over the layer's own progress (it keys
  on the CELL on a lattice layer); `material.planeGlow` is an analytic ground-contact ring and
  `material.ripples` up to four expanding great circles; `geometry.type:"band"` is a real
  spherical belt with `geometry.band.{tilt,spin,stripes}`; `emitter.shape.type:"layerInstances"`
  borrows another generator layer's instance positions and axes as spawn sites; and
  `emitter.forces.planarDrag` settles a burst into a drifting disc. `material.procedural:"sigil"`
  draws a whole cast circle from one card. Ported from the S3 ice and shield spikes
  (`TOOLBOX_V2_MAPPING.md` §7–§8); `ice-blast` and `shield` are rebuilt entirely on them.
- **Sustained vocabulary** (`arcs-v2.ts`, `streak-burst-v2.ts`, `schema-v2.ts`, `shaders-v2.ts`,
  `runtime-v2.ts`, `post-v2.ts`, `evaluate-v2.ts`): `material.stripes` (up to three sets of hard
  panning bands keyed on the layer's ALONG coordinate in world metres, each set's `phase` deciding
  whether the bands run straight round the body as a machine segment ladder or break into
  per-ring filaments) and `material.flicker` (a hashed STEP on the layer's intensity, not a sine
  pulse); `geometry.type:"slab"` + `geometry.slab` (a view-space billboard bar pinned to the
  layer's local +Z, tiered into hard-edged bands — the readable body of a beam and of a column);
  `kind:"arcs"` (blinking camera-facing helical wires re-hashed on every blink cycle) and
  `kind:"streakBurst"` (a clumped screen-space speed-line fan); `layer.collapse` (ONE retraction
  applied uniformly to a layer, so every part of a composite body shrinks in step); `post.flash`
  (a full-screen additive white-out); `paths[].type:"line"`, `emitter.shape.type:"pathLine"` and
  `emitter.velocity.mode:"alongPath"` (a scatter and a run along a straight axis);
  `emitter.render.mode:"flatStrip"` + `render.strip` (tapered flat cel licks on a flipbook hold,
  two palettes by instance parity); and the `lensFlare` / `radialRays` procedurals, both radially
  cut off and both supplying their own ramp key. Ported from the S7 beam and S10 column spikes
  (`TOOLBOX_V2_MAPPING.md` §9–§10); `beam` is rebuilt on them and `energy-column` is new.
- **Edge, spiral and event vocabulary** (`events-v2.ts`, `blob-v2.ts`, `schema-v2.ts`,
  `shaders-v2.ts`, `runtime-v2.ts`, `environment-v2.ts`): `geometry.type:"frame"` (a rounded-rect
  strip exposing a normalised PERIMETER coordinate) with `material.sdfLine` (the double-line rim:
  a bar, a hot spine, an inner line and up to three halo skirts, coloured from one ramp sampled at
  four fixed keys), `material.beads` and a `"perimeter"` `material.reveal` that draws up both sides
  at once; `material.flow` (up to four panning noise octaves mixed into one mask, with a
  view-direction parallax on the slowest, keying a `"surface"` ramp); `kind:"reflection"` (a
  flipped, washed copy of another mesh layer painted on the floor, drawing the SOURCE's own
  geometry and material); `material.procedural:"swirlDisc"` with `material.swirl` and
  `ramp.space:"radial"` (the angle sheared by `twist/(distance+eps)`, an explicit log spiral for
  the arms and an independent tighter one for the shading, under one `strength` envelope);
  `blob.arrangement:"orbit"` (a ring band at r^-0.65 with a far/near split) and `"path"` (lobes
  anchored at fixed path parameters, born as `blob.head` passes them, with `blob.retract` eating
  the column from one end), plus `blob.lightFrom`; `emitter.shape.type:"frame"` and `"orbit"` with
  `emitter.velocity.mode:"orbit"`; `emitter.render.anchor:"head"` with
  `material.procedural:"teardropStreak"`; `layer.window` and `emitter.spawn.mode:"event"` +
  `spawn.originsFromPath` (a path is a CLOCK: a layer starts, or an instance is born, the moment a
  head reaches a point on it); and `environment.groundPool` (analytic disc/rect pools in the ground
  shader). Ported from the S8 portal, S9 vortex and S11 meteor spikes
  (`TOOLBOX_V2_MAPPING.md` §11–§13); `portal` and `sky-vortex` are new and `meteor-rain` is rebuilt.
- **Liquid, drawn and arc vocabulary** (`sheets-v2.ts`, `crescent-v2.ts`, `licks-v2.ts`,
  `schema-v2.ts`, `shaders-v2.ts`, `runtime-v2.ts`, `environment-v2.ts`, `evaluate-v2.ts`):
  `kind:"sheets"` (curved, tapered, OPAQUE membranes on a hashed MULTI-CADENCE schedule — each
  size class re-fires on its own period and the births inside it are spread evenly across it, so a
  long crescent is never clipped by its own re-fire — cel-shaded from `material.toon` and torn at
  the border by a low-frequency threshold); `kind:"crescent"` (the arc-window blade: a strip swept
  along a signed arc of which only `[tail, head]` is drawn, head and tail being TWO curves on ONE
  window, drawn once per tonal copy with an optional lagging smear, its tail EATEN by a Voronoi
  erosion front rather than faded) and `kind:"licks"` (flat cel flame strips anchored to that
  front on a flipbook hold), with `emitter.spawn.mode:"frontAnchored"` + `spawn.sourceLayerId`
  (an instance owns a hashed parameter along that blade's arc and is born the moment the tail
  reaches it); `transform.squash` (a volume-conserving breath on any kind);
  `material.streaks` / `material.creases` (thin hard bands keyed on the along OR the angular
  coordinate, and a higher-frequency field darkening narrow folds — what makes a smooth teardrop
  read as folded water); `material.screentone` and `material.symbol` with the six drawn-symbol
  procedurals (`starSolid`, `face`, `heart`, `crescent`, `cloudLobe`, `bolt`);
  `layer.frame:"camera"` (the layer's local XY re-based onto the camera's right/up, closed form,
  so a symbol burst lays out in the SCREEN plane); `emitter.shape.type:"radialFan"` with
  `shape.{angleJitter,angleBias}`; `emitter.render.mode:"sliver"` with `render.{sliver,retract,
  secondary}` (a jagged tapered needle that retracts from the root outward, plus short secondary
  bits strung along it in the same layer); and `environment.backdrop` (a screen-space vignette
  card behind everything). Ported from the S12 water, S13 playful and S13 slash spikes
  (`TOOLBOX_V2_MAPPING.md` §14–§16); `water-projectile` and `playful-impact` are new and
  `fire-slash` is rebuilt.
- **Pipeline v2** (`protocol-v2.ts`, `recipes-v2.ts`, `pipeline.ts`, `refine.ts`, `route.ts`): planner/candidate/
  review/refine on schema v2 with structured outputs, scale anchors, lint-driven repair, review v2
  (640×360 sheet + 12-frame motion strip, six axes, defect checklist, jitter evidence).
- **Exemplars** (`fixtures/v2/*/document.json`): fire-projectile, smoke-burst, lightning-impact, beam,
  fire-slash, ice-blast, shield, healing-aura, glitch-projectile, energy-column, portal,
  sky-vortex, meteor-rain, water-projectile, playful-impact — hand-authored against the benchmark
  references (the "oracle"). The last eight are the fx15, fx04, fx16, fx14, fx17, fx09, fx03 and
  fx06 cases; the planner reaches the families the v1 vocabulary cannot name by prompt keyword
  (`recipeV2For(id, prompt)` on aura/heal, glitch/digital/hologram, column/overload/pillar/surge,
  vortex/tornado/swirl/maelstrom, water/liquid/aqua/splash and playful/cute/comic/kawaii), since
  `PlanSchema` still names v1 recipe ids — `portal` is the exception, because v1 has a `portal`
  recipe id and `V1_RECIPE_TO_V2` now routes it to the family of the same name, and `water` is the
  second: `V1_RECIPE_TO_V2.water` now points at `water-projectile` instead of at `ice-blast`, so a
  planner that picks it lands on the right family with or without a prompt. Nothing is built in
  code any more: `meteor-rain` was the last code-built recipe and it moved to a fixture with the
  S11 port.
- **Dev gallery** `/dev/vfx-v2` (`npm run dev`): exemplars + every generated benchmark run, references,
  feature toggles, orbit camera, contact-sheet capture. `/dev` is excluded from production builds at build time
  (`scripts/verify-dev-excluded.mjs`).
- **Live runs**: `node scripts/run-benchmark.mjs --live --schema v2 …` (see `TOOLBOX_V2_STATUS` in the project
  notes for the exact command). Three rounds on fx12/fx01/fx13 so far.

## Where the v2 assets live

The 32-texture v2 library and the thirteen exemplar documents are served from two public
Supabase Storage buckets instead of `frontend/public/` — the PNGs are no longer committed, so
they never enter a build or a deployment.

- Textures: `vfx-textures/v2/<file>` — base URL from `NEXT_PUBLIC_VFX_ASSET_BASE`, else derived
  from `NEXT_PUBLIC_SUPABASE_URL` as `<url>/storage/v1/object/public/vfx-textures/v2`.
  Resolved by `textureUrl()` in `src/lib/vfx-lab/asset-urls.ts`; the runtime loads them
  with `crossOrigin = "anonymous"`.
- Fixtures: `vfx-fixtures/v2/<id>/document.json`. `frontend/fixtures/v2/**` stays in the repo for
  tests and harnesses; `fixtures-server.ts` fetches the bucket copy first (short timeout) and
  falls back to the local file, so the dev gallery, `/dev/vfx-studio-v2` and `/dev/vfx-ui-review`
  work offline.
- Upload: `npm run upload:vfx-assets` (secret key in `frontend/.env.local`,
  `--dry-run` / `--verify` / `--textures <dir>`).
- Headless harnesses serve local PNGs from `$VFX_ASSET_DIR`, `public/textures/v2`,
  `.vfx-textures/v2` or `../textures-codex/library`, so CI needs no network.

See `LOCAL_SETUP.md` for the full conventions.

## What the live runs taught us

Given the vocabulary and written scale rules, the model produces documents that are structurally right
(anticipation → flash → ring → smoke → residue, lights, decals, masks, staggered starts) but visually thin:
too few / too small / too dim, and refinement rounds rarely improve the review. Only families with a
hand-authored exemplar reach the target look. Hand-authoring seven exemplars also exposed generic renderer
gaps (per-frame uniform refresh, ribbon sizing, crystal routing, procedural surfaces, shell tail) — all fixed.

Root causes (diagnosis): (A) no perceptual grounding of the parameter space; (B) feedback is adjectives, not a
gradient; (C) knowledge locked in monolithic exemplars; (D) references consumed as prose, not as a spec.

## Direction chosen (after an adversarial review by a second model)

**Reference-conditioned renderer response calibration.** Keep the LLM as the author of the document; then,
with camera / exposure / seed fixed, measure how ~8 knobs (count, size, opacity, emission, life, phase times,
light intensity, erosion) move screen features (foreground area, luminance percentiles, edge density,
temporal-difference envelope) via finite differences (~17 renders), and solve a bounded least-squares update
toward the reference's features. No language in the loop, no API cost per iteration, deterministic, explains
which knob moved which feature. Discrete knobs are rounded; topology is a separate discrete search. Guards
against metric hacking: luminance cap, structure preservation. A minimal reference sheet (phase boundaries,
occupancy, luminance percentiles, with confidence) provides the targets per reference.

Evaluation plan: Baseline / +Sheet / +Random search / +Coordinate search / +Response-model search under the same
render budget; perceptual metrics not used by the optimizer; blind pairwise human ranking; paired bootstrap CI.
Pilot on 4 dev cases, then widen.

Dropped: visual parameter "cards" (prior art: Design Galleries, 1997; weak novelty).

## Open renderer/pipeline items

- v1→v2 visual parity of upgraded documents is not claimed (upgrader maps everything to a teardrop shell).
- `layer.window` is resolved ONCE, when a document is loaded (`resolveEventWindows`), and the result
  is not idempotent: resolving an already-resolved document would shift its windows a second time.
  The runtime applies it in `setDocument` and nothing else calls it.
- A `path` emitter shape samples ONE document path, so five descents need five tip layers; only the
  event-spawned populations (`spawn.originsFromPath` with no `shape.pathId`) collapse to one layer.
- Texture generation is off in v2 (library only). `quality.style` ps1/ps2 is approximate.
- Structured-output documents are 13–15 kB minified; candidate max_output_tokens 32 000.
- `material.toon.colorSource:"ramp"` is implemented for blob lobes only. `kind:"sheets"` and
  `kind:"crescent"` cel-shade from their own fixed tonal stacks (authored per copy), and a
  `colorSource:"ramp"` set on one of those is accepted by the schema and ignored by the renderer.
- `material.ramp.space:"sprite"` is a no-op on the flat cel strip (`render.mode:"flatStrip"`), which
  is a two-band palette selector by design, and on `kind:"licks"`, which carries its own two colours.
- `material.ramp.blend` is implemented on the particle, mesh and blob programs. The wireBurst and
  strip programs ignore it: neither has a second key space worth mixing.
- The mesh-hero framing lint (`MESH_HERO_FRAMING_LINT`) warns below 0.80 rather than the authored
  0.85–1.0 band, because the portal exemplar frames its doorway at 0.80.

## 2026-09-14 — technique cards, spikes, generalised vocabulary, first live runs

Branch `feature/vfx-technique-cards` (from `feature/vfx-toolbox-v2`, which is already merged into
`main` via PR #28). Method that worked: published artist breakdowns → 24 technique cards fed to the
candidate prompt → one hand-built single-HTML spike per family (`/dev/vfx-v2/spike-*`, 13 of them)
judged against same-phase reference frames → each spike generalised into schema v2 vocabulary
(`TOOLBOX_V2_MAPPING.md` §4–§17) → a hand-tuned exemplar per family (15 fixtures, all uploaded to the
`vfx-fixtures` bucket). `/dev/vfx-review` plays every exemplar and every generated run beside the
benchmark reference clip with an A/B toggle at the same time.

Live runs (gpt-6-astra, fast mode, `--no-video`): `v2-techniques-3/4` (fx12, quality) and
`v2-fast-dev` (nine dev cases). Findings:

- The model now uses the new kinds unprompted and correctly: blob + toon + outline + splash for smoke,
  shell + sheets for water, crescent + licks for the slash, ring + reflection for the portal,
  `toon.colorSource:"ramp"` with a height ramp once it existed. Vocabulary is no longer the limit.
- The remaining gap is magnitude and time: framing at the particle band (fixed by the mesh-hero
  framing rule + exemplar-camera repair), columns that die before the prompt's peak (rule added: copy
  the exemplar's timing windows), and a beam whose body sits above 1.0 linear and washes the frame.
- refine and restructure were rejected as "no clear improvement" in both quality runs, so fast mode
  (plan → candidate → review, ≈ $2.3 per case at ~38k input tokens) buys the same quality for a third
  of the cost until the improvement loop can act on `smallInFrame` and timing.
- Two silent renderer faults surfaced only through live runs: the splash fragment shader referenced an
  undeclared uniform (every splash layer had been skipped), and `pathAnchored` fell through to burst on
  the GPU. Every exemplar is now rendered and checked for shader faults on every verification run.

Merged with main / WebGPU: `main` moved the V2 runtime to WebGPU with static TSL node materials, and
this branch's vocabulary was ported onto it. Every layer kind draws through `createV2NodeMaterial`;
there is no runtime GLSL and no WebGL fallback left. `shaders-v2.ts` is the migration reference only —
`npm run generate:v2-nodes` turns it into the checked-in `shaders-v2-nodes.js`, which is what the
browser loads. `post.flash`/`post.glitch` and `environment.groundPool`/`backdrop` are node graphs now.
The WebGL-only `npm run verify:shaders` is gone: `npm run verify:webgpu` renders all fifteen exemplars
plus the workspace emitter and fails on any GPU error or blank frame, which is a superset of what the
shader-link check caught. `npm run verify:studio` covers the preview path the studio actually uses, and
`npm run verify:perf` is the performance gate. See `WEBGPU_PORT.md` for the programs, the converter
extensions and the two device limits (eight vertex buffers, twelve uniform buffers per stage) that
shaped the contract.

Performance contract: a document's cost is draw calls, distinct programs and instances, and all three
are bounded. Two layers of one kind now generate byte-identical WGSL, so they share one compiled
program — smoke-burst went from 557 pipelines to 32 and meteor-rain from 673 to 21, and the worst any
exemplar builds during playback is three. Blob lobes are one instanced draw per layer instead of a
material each, and sheets share one material. `lintDocumentV2` reports a document over the GPU budget
(120 draws, 24 programs, 3000 instances — about twice the busiest exemplar) and `repairCandidateV2`
scales instance counts down to fit without ever dropping a layer. Warm frames at studio size are
1-3 ms for every exemplar and for a synthetic document holding every kind at the ceiling, the longest
first frame is 69 ms, and nine frames across every exemplar are byte-identical to before the change.

Budget: the OpenAI project cap is $80 (raised 2026-09-14). The local ledger (`budget.ts`) caps at $80
by code and stood at $56.7 after `v2-fast-dev`; the validation cases (fx06, fx08, fx15) and the holdout
five were not run. To run more, archive `.autov-local/budget.json` and start a fresh ledger; holdout
additionally needs `--final-evaluation`.

Studio path: the product generator (`studio-tools/generation.ts`, behind `generate_vfx` and
`/api/studio`) now shares the candidate system prompt, payload builder (family routing, technique
brief, exemplar scale summary) and the model-free exemplar-camera repair with `/api/local-vfx` via
`lib/vfx-lab/candidate-v2.ts`; it adds no paid repair stage and `add` mode still leaves the camera
alone. See "What the generation prompt contains" in `docs/EVE_STUDIO_TOOLS.md`.

Next: PR `feature/vfx-technique-cards` → `main` after merging `main` in; then make the improvement loop
act on framing/timing/luminance (exemplar camera + timing copy on `smallInFrame`, a luminance cap
repair for washout), and re-run the three validation cases.

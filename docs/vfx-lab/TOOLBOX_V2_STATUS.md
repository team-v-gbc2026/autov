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
- **Pipeline v2** (`protocol-v2.ts`, `recipes-v2.ts`, `pipeline.ts`, `refine.ts`, `route.ts`): planner/candidate/
  review/refine on schema v2 with structured outputs, scale anchors, lint-driven repair, review v2
  (640×360 sheet + 12-frame motion strip, six axes, defect checklist, jitter evidence).
- **Exemplars** (`fixtures/v2/*/document.json`): fire-projectile, smoke-burst, lightning-impact, beam,
  fire-slash, ice-blast, shield, healing-aura, glitch-projectile — hand-authored against the benchmark
  references (the "oracle"). The last two are the fx15 and fx04 cases; the planner reaches them by
  prompt keyword (`recipeV2For(id, prompt)`), since `PlanSchema` still names v1 recipe ids.
- **Dev gallery** `/dev/vfx-v2` (`npm run dev`): exemplars + every generated benchmark run, references,
  feature toggles, orbit camera, contact-sheet capture. `/dev` is excluded from production builds at build time
  (`scripts/verify-dev-excluded.mjs`).
- **Live runs**: `node scripts/run-benchmark.mjs --live --schema v2 …` (see `TOOLBOX_V2_STATUS` in the project
  notes for the exact command). Three rounds on fx12/fx01/fx13 so far.

## Where the v2 assets live

The 32-texture v2 library and the seven exemplar documents are served from two public
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
- Upload: `npm run upload:vfx-assets` (service role key in `frontend/.env.local`,
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
- Texture generation is off in v2 (library only). `quality.style` ps1/ps2 is approximate.
- Structured-output documents are 13–15 kB minified; candidate max_output_tokens 32 000.

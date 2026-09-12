# Integrated VFX work — September 13, 2026

The requested generation and UI branches are integrated with current main. The shared branch is `codex/vfx-integrated-benchmark`, reviewed in draft PR #27. All three source tips were verified as ancestors after fetching them again on September 13: main `0b97b55`, generation `a75ddbc`, UI `c82e94f`.

## What can be reviewed

The local morning overview groups **88 actual application-generated candidates across all 17 benchmark cases**. Each case includes the latest selected output, previous candidates, a deterministic video, an editable standalone player, input prompt/reference images, and a source-video comparison when supplied. Sixteen cases have source video; the shield case has reference images only. Japanese visual notes distinguish improvements from remaining differences. Rejected and unreviewed variants are retained.

Run `node scripts/build-morning-review.mjs` from `frontend/` to rebuild `.autov-local/morning-review/index.html`. The HTML works without the app server. The studio also exposes `/local/trials`. Private source media, complete outputs, usage records and local notes are intentionally untracked. A real generated smoke example is available in the shared studio's Presets menu.

## Changes driven by observed failures

- Water: attached flowing membranes, rounded roots/tips, shaded bodies and separate highlight streaks. These replace disconnected zigzags and flat cut ends.
- Smoke and sky vortex: actual Codex-generated continuous plume, curl and spiral masks, decoded and bound to layer materials. Rotating explicit planes now animate their UVs.
- Ice: deterministic faceted crystal clusters support 1–32 crystals per layer, with editable count, footprint and width. A new live trial used two clusters totaling 21 crystals.
- Impacts and shields: pointed stars, attached circular faces/eyes, circular glow without square clipping, and connected hexagonal cell boundaries.
- Generation: reference-aware rendered critique, bounded scalar and structural repair with rollback, immediate archival of rendered candidates, a configurable initial candidate count, and 30Hz activity diagnostics for possible timing gaps.
- Reliability: cumulative spend survives restarts/configuration changes, unknown requests remain reserved, complex plans have a larger bounded output allowance, and model calls have no automatic SDK retries. Secret scanning now runs the pinned upstream MIT Gitleaks CLI and passes in GitHub CI.

The renderer uses lightweight parameterized meshes built with the existing Three.js dependency. A separate full 3D inference service was not needed for these shapes. Model synthesis, fluid simulation and world-space particle trails remain outside the current representation.

## Evaluation limits

All generation inputs are the benchmark's exact text-image prompts and reference-image bytes. Evaluation answer files and source videos are not passed to the generator; videos are attached afterward for comparison. Reports record implementation revision, input hashes, mode and candidate count.

This overnight work spans several implementation revisions and includes both quality searches and single-candidate fast probes. Once held-out cases informed changes, later reruns were development iterations, not fresh blind holdout tests. Generation coverage does not establish a 17-case fidelity pass. Model ratings are candidate-selection aids; no human acceptance is claimed.

Visible remaining differences include sparse lightning/overload bodies, overly regular meteor impact rings, weak ice shading and breakup, incomplete healing-ribbon continuity, and insufficient atmospheric volume around the sky vortex. New masks substantially widen the available appearance, but a recognizable sprite is not equivalent to a fully volumetric effect. Full videos and Japanese notes should guide the next art review.

## Image API and spending

GPT Image 2.5 Sunburst/Flare integration is implemented. The configured restricted key's actual image request returned a missing image-generation scope error. Local experiments therefore explicitly used the library of real Codex-generated masks; they must not be described as successful direct Image API calls. Texture provenance records the actual source and reuse.

Both the application cumulative cap and the provider project hard limit were set to the user-authorized $60. The local accounting includes prior usage and unresolved reservations. It is conservative bookkeeping, not the provider invoice. No unknown reservation was discarded merely to enable another run.

See [INTEGRATED_STUDIO.md](INTEGRATED_STUDIO.md) for setup, renderer design, source links and commands. The older [VERIFICATION.md](VERIFICATION.md) describes a separate earlier checkpoint.

## Final checks

- 78 unit tests passed; lint, production build/typecheck and self-contained runtime checks passed.
- 24 Apple Metal browser fixtures passed, including deterministic seeking, final extinction, shader compilation, texture decoding, connected hexagons and animated textured planes.
- All 88 saved trial videos passed file, embedded-texture binding, exact 30fps/frame-count and historical runtime checks. All 88 prompt/reference and embedded-PNG hashes matched their expected inputs/assets.
- The offline entry opened all 17 case pages with HTTP(S) blocked, loaded 16 source videos and all 17 generated videos, verified local links, and played/paused paired videos together without browser errors.
- All 17 latest selected documents were profiled using the current flow11 renderer on Apple M3 Pro / Metal at 960×540: approximately 60fps, per-scene render p95 0.5–0.9ms, no browser errors. This is headless Chrome playback evidence on one device, not a game-engine certification.
- Final conservative API accounting: **$58.288475 / $60**, including four unresolved reservations. Two final beam/water attempts completed planning but were blocked before candidate generation by the next-request reservation requirement. They produced no additional candidate; prior results remain available. No further paid experiment was started.

These checks establish archive integrity and renderer behavior. They do not certify reference fidelity, authenticated Supabase cloud login, or performance on other hardware.

A final full-frame inspection found 15 historical videos with black intervals. Repeating the same timestamps via framebuffer readback reproduced the defect: retired particle vertices could evaluate a fractional power with an invalid base, contaminating bloom. The shader now culls dead particles before that math and clamps its domains. A 181-frame GPU regression covers expiry. All 15 affected videos and players were re-rendered from unchanged JSON with flow11, with original videos/players retained and correction notices shown. A new scan of all 88 videos found no such all-black intervals. Original generation-time scores/contact sheets remain historical and were not silently re-scored.

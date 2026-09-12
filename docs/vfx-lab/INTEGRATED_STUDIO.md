# Integrated VFX studio

This branch retains the VFX generation pipeline from `codex/vfx-generation-studio` and merges the emitter timeline UI from `feature/vfx-studio-ui-add-emitter-timeline`. At integration, `main` was `0b97b55` and already an ancestor of the generation branch (`a75ddbc`). The UI source was `98086ce`. Both histories are preserved by a merge, not file replacement.

## Run and review

```sh
cd frontend
npm ci
npm run dev:local
```

Open `http://127.0.0.1:3000/workspace`. Local generation remains localhost-only; the Supabase-backed workspace and main's reference Board remain available with the original deployment behavior. This work does not deploy or expose the local key endpoint publicly.

The real renderer now uses the newer timeline presentation, Add emitter, selection/solo/visibility, scoped-edit markings, effect/environment tabs and a measured preview area. Mesh, surface and texture controls update the actual document. Undo/redo, references, generation, JSON import/export and standalone Three.js export remain connected.

`Presets → Generated texture demo` loads a deliberately authored effect that uses an actual Codex-generated PNG in a shader. It is explicitly labeled as a demonstration, not a live API generation or a benchmark pass. The mask and provenance are in `frontend/public/textures/`; the self-contained document is in `frontend/public/examples/`.

## Generation changes

- Parameterized meshes: plane, teardrop, cone, crystal, torus, curved ribbon and seeded branched lightning, alongside the original sphere and instanced particle billboards. No external 3D inference service or executable generated code is introduced.
- Layer-local XYZ motion keys are evaluated directly at the requested time, preserving arbitrary seeking. Mesh rotation/UVs have fixed budgets. Motion describes the emitter transform; it is not a world-space particle simulation.
- Surface variants add directional flame erosion, water streaks, hexagonal cells, rounded smoke, star masks, solid mesh shading and a rectangular portal.
- Construction examples now include lightning, projectile, smoke, sustained beam and portal so the model is not shown only slash/magic/explosion templates.
- Optional texture stage: plan a useful grayscale mask → generate once per run → validate/downsample/retain alpha → cache by prompt, references and model → attach by stable layer IDs → decode before rendering → embed in JSON and exported HTML. The shader uses luminance × alpha as a tintable emission/opacity mask. Particles currently use procedural billboards; generated textures bind to surface layers.
- Image API defaults to `gpt-image-2.5-sunburst`; `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare` is also supported. An unavailable image model or invalid texture does not destroy the procedural candidate. No automatic model substitution or paid retry is performed.
- Critic now receives the input reference images **and** the output contact sheet, clearly separated. It previously received only the sheet. Sampling includes each short primary event, reducing missed staggered strikes. Blank rendered outputs are rejected.
- A refinement may replace the best candidate only if the weighted score improves, passed criteria remain passed, failures do not increase, and no formerly adequate axis falls below 3. The previous valid candidate remains available after failures.
- The fixed oblique camera is fitted to the sampled animation envelope. Oriented geometry is projected directly into camera coordinates, avoiding excessively loose bounds for billboards. It does not follow the effect during playback. Capture times cover growth, sustain, breakup and decay as well as brief primary events.
- Codex-generated sigil, sculpted smoke and connected fire masks form a reusable library. The planner selects a compatible asset or requests a custom Image API asset. `OPENAI_IMAGE_MODE=library` explicitly limits this stage to existing assets when the key lacks image permissions. Provenance distinguishes reuse from a new API image; no successful image API call is implied by fallback. Textured smoke preserves its alpha and broad shading, and procedural smoke shading preserves crescent geometry for wisps.

## Local trial gallery

Open `/local/trials` or follow **Trials** in the studio. All generated candidates, including rejected refinements, retain their input prompt, references, document, sheet and review. Reopen an effect in the editor or download its JSON. The benchmark archive also produces videos and self-contained interactive players.

```sh
# Run from frontend; FFmpeg and ffprobe must be installed.
node scripts/build-trial-gallery.mjs
node scripts/verify-trials.mjs
```

The static `.autov-local/trials/index.html` works from the filesystem after the server stops. Each benchmark run keeps a snapshot of its renderer, so subsequent rendering changes do not silently rewrite historical trials. Video export samples the actual runtime at `n/30` seconds and verifies the encoded frame count/rate with ffprobe. This produces 30fps comparison videos even on slow software rendering; it is **not** a claim of 30fps real-time hardware performance. Private benchmark media and trial data stay out of Git; the gallery implementation and reusable generated texture library are shared.

## Spending and assets

Text and image calls use one cumulative local ledger, defaulting to $30. `OPENAI_VFX_BUDGET_USD` can configure an explicitly authorized limit up to $60. Changing the limit preserves all prior entries and pending reservations. `AUTOV_DATA_DIR` can point multiple local checkouts to the same ledger. Images reserve $2 before sending a request; settlement uses returned token usage and official input/output rates. Definitive authorization/validation rejections settle at zero; missing usage and interrupted requests stay reserved. A reservation overrun halts further generation. This is an application reservation, **not** a provider-enforced billing cap.

Do not copy a new empty ledger over a used one. A separate checkout has a separate `.autov-local` directory; preserve the intended cumulative ledger when moving an existing API configuration. Keys, source benchmark media, per-run results and ledgers are ignored by Git.

## Benchmark runner

The user-supplied `effect-benchmark-v1-full.zip` contains **17 cases** (34 text-only/text-image inputs). An older pre-existing extracted folder had 11 cases; it is not the source used for the integration audit. Always use the supplied archive's complete extraction.

```sh
# Read inputs only; no paid calls. Run from frontend/.
npm run benchmark -- --dataset /path/to/extracted-benchmark --split all --max-cases 17

# After configuring a key and authorizing spend:
npx playwright install chromium
npm run benchmark -- --dataset /path/to/extracted-benchmark --split dev --cases fx10-stylized-lightning,fx12-smoke-burst --mode quality --textures --live

# Freeze implementation before using validation/holdout as a final evaluation.
npm run benchmark -- --dataset /path/to/extracted-benchmark --split holdout --max-cases 5 --final-evaluation --live
```

The runner calls the **same** `generatePipeline` and local API used by the UI. It supplies exact prompts and reference images, not evaluation answers, source videos, or screenshots as replayed output. It records input hashes, revision/dirty state, candidates, reviews, usage, selected document, contact sheet, timestamped frames, a WebM of the real renderer, seek/extinction/shader gates and renderer details. Output defaults to `.autov-local/benchmarks/latest`.

Visual acceptance is not inferred from schema tests or a model score. Records remain `pending_visual_review` with an unset reviewer. Check the supplied evaluation rubric, critical checks, full video and reference stills separately. SwiftShader checks correctness; its timing is not representative of game hardware. Live benchmark generation was not run during the first implementation checkpoint because paid API budget authorization was pending. Input audits and authored renderer fixtures must not be reported as benchmark generation results.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:runtime
npm run verify:browser
```

First checkpoint: 51 unit tests and 9 browser fixtures passed. The subsequent trial-gallery checkpoint adds persistence/path validation and cumulative-budget migration checks. Actual live dev trials are now saved locally; their model reviews have identified remaining size, accent hierarchy and late-wisp defects. No 17-case fidelity pass is claimed. Use the current test output and private trial reports for the latest counts.

![Generated texture in the actual realtime renderer](integration-evidence/generated-texture.jpg)

`verify:browser` exercises the real UI, every construction example, texture decoding/sampling, deterministic seeking, end-time extinction, and an offline exported player with HTTP(S) blocked. `AUTOV_TEST_URL`, `AUTOV_CHROME_PATH` and `AUTOV_PLAYWRIGHT_MODULE` can target an existing local test server/browser installation. Evidence is saved under `.autov-local/renderer-verification`.

## Design sources and limits

- [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation): image/edit endpoints, model IDs, transparent PNG and output configuration. [Sunburst model/rates](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst). Confirmed September 13, 2026.
- [ParticleGen](https://arxiv.org/html/2608.00629v1): motivates separating composition, rendering and bounded visual refinement. No claim that its Niagara results transfer quantitatively to this Three.js implementation.
- [KinemaFX](https://arxiv.org/html/2507.19782v1): motivates explicitly representing motion rather than relying on appearance words alone.
- [Three.js documentation](https://threejs.org/docs/): existing Three.js primitives and custom BufferGeometry. No additional 3D model-generation runtime has been installed.
- [Riot VFX style guide, Shapes](https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf): readable silhouettes and concise texture detail inform the mask design. No copyrighted texture assets were copied.
- [Alex's toon-smoke shader tutorial](https://blog.ldev.app/building-a-toon-smoke-particle-shader-in-shader-graph/): broad highlight/shadow regions and local-space deformation inform the separation of silhouette, shading and motion. This implementation uses its own shaders and generated masks, not the downloadable Unity graph.

The procedural smoke/fire examples are editable construction guides, not proof of reference fidelity. Meshes and alpha masks widen the available representation; particle collision, fluid simulation, world-space trailing and arbitrary model synthesis remain outside this renderer. No OSS dependency is claimed to be absolutely safe; the change uses existing Three.js and adds explicit pinned Sharp (already transitively present) plus Playwright for verification.

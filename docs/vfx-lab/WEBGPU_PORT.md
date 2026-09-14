# V2 WebGPU renderer

The `autov.lab/2` JSON contract is unchanged. `VfxRuntimeV2` now uses Three.js
r186 `WebGPURenderer` and static TSL node materials. The workspace preview,
offscreen evaluation, calibration, and V2 video export share this runtime.
The historical V1 lab renderer remains WebGL.

## Document mapping

| Document data | WebGPU implementation |
| --- | --- |
| Layer transforms, motion, tracks, overrides, seed, timing | Existing CPU evaluator and geometry construction; explicit sample time |
| Particle shape, birth/lifetime, velocity, forces, size/alpha curves | Instanced attributes and closed-form TSL vertex graph |
| Particle trails and sub-emitters | Separate ribbon draw; the same trajectory math and sampled parent path |
| Surface shape, displacement, procedural masks, textures, erosion, fresnel | TSL vertex/fragment graphs |
| Color ramps and edge colors | Scene-linear values; typed color uniforms and padded uniform arrays |
| Soft particles | Opaque-ground depth prepass; WebGPU screen coordinates and interpolated clip depth |
| Light layers, ground, grid, background, fog | Existing light evaluator; node-based lit ground and derivative-filtered grid |
| Bloom, grade, vignette, chromatic aberration, exposure | HDR node pass graph; one tone-map/output conversion |
| `none`, `msaa`, `msaa+smaa` | Scene-pass sample count; optional display-space SMAA |
| Solo, seeking, renderer flags | Applied before each complete render sample |

`environment.groundReflect` remains unsupported, as in the previous renderer.
Existing retro-style and CPU framing/sorting approximations are unchanged.
Bloom/SMAA use Three.js's WebGPU implementations, so bit-identical WebGL output
is not promised. The bloom mapping preserves UnrealBloomPass r186’s explicit
3× composite intensity multiplier; document strength values are unchanged.

## Shader maintenance

`shaders-v2-nodes.js` is checked-in, static generated TSL. There is no runtime
GLSL compilation, transpiler, `eval`, or model-generated shader execution.
`shaders-v2.ts` retains the migration reference; `uniforms-v2.ts` owns the live
uniform data. Regenerate with `npm run generate:v2-nodes` from `frontend`.

The offline converter handles mutable locals, `out` parameters, typed array
element access, explicit void helper calls, and early-return lowering explicitly. Uniform-dependent helper
functions stay inline; pure math helpers become WGSL functions. Changes to the
migration reference need browser validation, not just successful transpilation.

## Merged with the technique-card vocabulary (September 2026)

`feature/vfx-technique-cards` added thirteen layer kinds and a much larger
procedural bank on the WebGL runtime. They are now generated the same way
everything else is: every draw the renderer makes comes from a static TSL
program pair, and `createV2NodeMaterial` is the only place a material is built.

### Programs

`shaders-v2-nodes.js` now carries a vertex/fragment pair per draw, listed once
in `PROGRAMS` in `node-material-v2.ts`:

| Program | Draw |
| --- | --- |
| `particle` / `subParticle` | Sprite instances, and the sub-emitter variant |
| `trail` / `subTrail` | The per-particle ribbon |
| `strip` | `render.mode "flatStrip"`: flat cel licks |
| `sliver` | `render.mode "sliver"`: needles and their secondary bits |
| `surface` | Every mesh kind: shells, rings, decals, sprites, beams, bands, slabs, frames, lattices, reveals, ripples, plane glow, screentone, streaks and creases |
| `blob` | Metaball lobes, fill and outline hull |
| `crystal` | Crystal instances and their hull pass |
| `splash` | Splash slivers |
| `ribbon` | Path ribbons |
| `wireBurst` | Wire-burst line segments |
| `arc` | Arc bundles |
| `streak` | Streak-burst fans |
| `sheet` | Water sheets |
| `crescent` | Crescent sweeps |
| `lick` | Flame licks |

`post.flash` and `post.glitch` moved into the HDR node graph in `post-v2.ts`,
between bloom and grade. The flash is a per-pixel additive wash and is exactly
neutral at zero strength, so it stays in every graph; the glitch displaces bands
and therefore needs its own resolved texture, so its graph is built only for
documents that declare one. Both switch on the document, never on the per-frame
strength, so crossing a glitch window mid-playback rebuilds nothing.

`environment.groundPool` is part of the node-based ground: one analytic gaussian
per slot, round or rectangular, every slot evaluated with an intensity of zero
for the unused ones so adding a pool does not rebuild the ground pipeline.
`environment.backdrop` is a `NodeMaterial` card locked to the clip-space
corners.

### Converter extensions

`scripts/webgpu/port-shaders.mts` and `lower-returns.mjs` gained, in order of
how much they matter:

- **General single-exit lowering.** The authored shaders guard their variants
  with early returns, including returns inside `for` loops. Every guard becomes
  the `if` half of an if/else and the rest of the function becomes the `else`
  half; a loop records its answer in a result variable and breaks. A chain of
  guards is emitted as `else if`, not as `else { if ... }` — a flat `ElseIf`
  sequence rather than one nested closure per branch. That distinction is not
  cosmetic: nesting a twenty-branch procedural bank exhausted the JavaScript
  heap while building the node graph, before a frame was ever drawn.
- **Helpers that keep a WGSL function.** Detected rather than listed: a helper
  that touches no uniform, attribute or varying, takes no `out` parameter and
  calls only other such helpers. `return` is legal in a real WGSL function, so
  these are left exactly as authored — lowering them would be the nesting above
  for no reason. Uniform-dependent helpers stay inline, because Three r186 only
  records a uniform in the shader's struct on the build that first sees it: a
  uniform read from inside a generated function survives the first pipeline and
  leaves a later rebuild (a diagnostic or post-free pass) referring to a struct
  member that is no longer declared.
- **Instance data as parameters.** The trajectory helpers read the borrowed
  spawn site, the resolved event and the instance index. Those arrive as
  parameters now, which is what lets the helpers stay real functions.
  `pathFrame`'s `out` parameters became `pathSide` / `pathUp` for the same
  reason.
- **Braceless loop bodies** are wrapped in braces (`for (...) for (...) {}` does
  not parse otherwise). `if` and `else` are deliberately left alone.
- **Parameter mutation.** WGSL parameters are immutable, so a helper that
  rewrites its own argument gets a local copy of the same name.
- **Declaration scanning** blanks comments first — the authored prose mentions
  `uniform` and `attribute` — and a negated float literal at the head of an
  expression (`-.5*a`) is rewritten, since `- .5.mul( a )` is not JavaScript.
- **Guards.** The converter fails if the transpiler drops `main()` or if a
  number literal is left standing where a node belongs; both used to surface
  only as a runtime error in the browser.

### Device limits

Two WebGPU limits bind at this size and shaped the contract:

- **Eight vertex buffers per pipeline.** A particle draw has more per-instance
  fields than that once spawn sites, events and a sub-emitter's parent hashes
  are all present. Every instance field now shares one interleaved buffer
  (`instanceAttributes` in `runtime-v2.ts`), so a draw costs one vertex buffer
  whatever the emitter uses, and the sorted draw permutes every field together
  rather than only the seeds.
- **Twelve uniform buffers per stage,** and every uniform array is one. The
  naturally paired arrays share a slot: ripple origins and their parameters,
  slab tier heights and their colours, flow layers and their mix weights.

### Verification

`npm run verify:webgpu` covers every exemplar under `fixtures/v2` — all fifteen
— plus the workspace's own Add emitter document and the synthetic sub-emitter
case, each at an authored active timestamp.

`npm run verify:studio` covers the other path: a preview runtime at the studio's
size, its warm pass, and animated preview frames. It asserts no console or GPU
error, a non-blank frame, and that no draw needs more than WebGPU's eight vertex
buffers. That limit is not theoretical — a crystals layer needed nine and broke
every studio page while the capture check stayed green, because the capture
samples one authored timestamp and the preview warms every emitter at once. It is also the only shader-link
check the renderer needs: a program that fails to build is a GPU error and a
blank frame, and both fail the run. The WebGL-era `scripts/verify-shader-links.mjs`
and its test are gone.

Hardware runs use the full Chromium build (`channel: "chromium"`). Playwright's
default headless shell reports `navigator.gpu` and then hands out no adapter.

### One draw per cluster, not one per lobe

A blob layer built a material per lobe, and a material is a program: `smoke-burst`
(85 lobes) and `meteor-rain` (290 lobes) asked the device for 557 and 673 render
pipelines, stalled for seconds compiling them, and then paid for 192 and 591
draw calls on every frame. Every lobe of a layer is now one instance of a single
draw — one for the fill, one for the outline hull — with the lobe's own shape,
placement and shading in an interleaved instance buffer:

| | | |
| --- | --- | --- |
| `aLobeA` | seed, amplitude, frequency, squash | shape |
| `aLobeB` | curl, taper, rotation, hull inflation | shape |
| `aLobeC` | lobe age, shade, alpha | read by the fragment through one varying |
| `aLobeP` | centre in layer space, radius | placement |

Instances are written far-to-near each frame, which is what the per-lobe
`renderOrder` used to do and what a cluster of translucent lobes needs anyway;
the orbit ring's near/far bias and shade ride in the same buffer. The blend
state now switches once per layer instead of once per lobe.

| | Meshes | GPU frame at studio size | Pipelines at install |
| --- | ---: | ---: | ---: |
| smoke-burst before | 192 | 11.8 ms | 557 |
| smoke-burst after | 36 | 2.7 ms | — |
| meteor-rain before | 591 | — | 673 |
| meteor-rain after | 31 | 2.7 ms | — |

The same fan-out is why two materials of the same kind never shared a compiled
program: their generated WGSL differs only in the node ids Three bakes into
identifier names (`fn12` vs `fn1776`, `NodeBuffer_1718` vs `NodeBuffer_19760`),
and Three's stage cache is keyed by the shader text. Fewer materials is the
lever that works today; making the text identical would mean one node graph per
kind with every per-material value resolved through the render context.

### What the merged renderer looks like next to the pre-merge branch

`AUTOV_WEBGL_BASELINE` pointed at a standalone V2 bundle built from this
branch's last WebGL commit, comparing all fifteen exemplars at their authored
active timestamps. Every effect matches structurally; the sheets are in the
merge scratchpad. Mean absolute channel error, out of 255:

| Exemplar | Δ | Exemplar | Δ | Exemplar | Δ |
| --- | ---: | --- | ---: | --- | ---: |
| playful-impact | 0.38 | healing-aura | 2.30 | fire-projectile | 4.09 |
| ice-blast | 0.43 | shield | 2.95 | lightning-impact | 5.13 |
| smoke-burst | 0.54 | portal | 3.31 | water-projectile | 5.82 |
| sky-vortex | 1.00 | meteor-rain | 3.71 | glitch-projectile | 8.39 |
| | | fire-slash | 3.91 | energy-column | 14.93 |
| | | | | beam | 18.43 |

The spread is the ground, not the effects: `main` retuned the environment
defaults (grid `#9a9cab` → `#737779` at a `0.30/0.07` → `0.32/0.06` mix, base
`#4a4952` → `#484b4e`), and the merge keeps `main`'s. The exemplars that show
the most floor — beam, energy-column —differ the most, and a dark close-up like
ice-blast lands at 0.43. The 8/255 acceptance gate was calibrated for `main`
against `main`'s own WebGL bundle, where the dressing is identical; it is not a
like-for-like number across that retune. The workspace document is excluded for
the same reason: the merge adopted `main`'s `#282a2c` background and fog.

The comparison did find one real fault, which is fixed: `layer.collapse` wrote
its result straight back into the document through `main`'s read-only evaluator,
so the energy column's body was multiplied down to the 0.01 geometry floor
within a second and only its base stub drew. The evaluator now clones every
branch a stage writes — collapse, jitter and `transform.squash` as well as
tracks, motion and active overrides — and `tests/seek-v2.test.ts` asserts that
evaluating never mutates the document.

The suite draws until two consecutive samples at the measured time agree before
it starts comparing: Three r186's SMAA pass settles a draw or two after arriving
at a new time, and its first output can differ along a single edge pixel (one or
two channel values out of 230,400 in the meteor-rain and smoke-burst fixtures).
It fails if a time never settles. Everything the suite then asserts — identical
pixels after seeking back, live animation-frame output equal to the capture, the
AA, solo, post and time checks — is exact.

## Frame and resource ownership

Call `setDocument`, then await `whenReady()` before the first `render`. Read the
canvas immediately after rendering, in the same JavaScript task: the WebGPU
presentation texture is not a persistent screenshot buffer.

Each `render(time)` advances the node-frame ID once. Three.js r186 normally
advances it from RAF, which would otherwise cache post-processing across several
offscreen samples in one task. This small, documented internal access is isolated
in `VfxRuntimeV2.render`; Three.js and its types are pinned to r186. Upgrade them
only with the repeated-time, time-change, solo, and capture checks below.

The runtime owns the renderer/device lifecycle, layer resources, texture cache,
depth target, and post graph. Post disposal includes the scene pass, HDR grading
texture, SMAA input, SMAA targets, and bloom targets. Device loss is surfaced to
the workspace's existing error/retry state. A WebGL fallback is rejected.

## Verification

From `frontend`:

```sh
npm run typecheck
node --import tsx --test tests/schema-v2.test.ts tests/evaluator.test.ts tests/seek-v2.test.ts tests/assets-motion.test.ts tests/ui-bridge.test.ts
npm run bundle:runtime
npm run verify:runtime
npm run verify:webgpu
```

For Linux without a hardware GPU, install the matching Playwright Chromium and
run with a virtual display:

```sh
AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a npm run verify:webgpu
AUTOV_FIXTURES=subemitters,fire-projectile AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a npm run verify:webgpu
```

`PLAYWRIGHT_BROWSERS_PATH` and `AUTOV_CHROME_PATH` select an installed browser.
`AUTOV_EVIDENCE_DIR` selects the output directory. The test needs access to the
existing public V2 texture library. It performs no model calls.

The suite includes the workspace’s default Add emitter document and authored
active timestamps for all seven fixtures. It verifies:
initialized WebGPU, nonblank pixels, identical pixels after seeking back, changed
pixels for time/solo/post toggles, all AA modes, and document color edits. The
synthetic sub-emitter case exercises all three parent modes, ribbons, and full
offscreen contact-sheet/motion/30 Hz temporal capture. Console/GPU errors fail
the run. PNGs and `report.json` are written to `.autov-local/webgpu-verification`.

An optional `AUTOV_WEBGL_BASELINE` points to a preserved pre-port standalone V2
bundle. The suite captures both at the same timestamp/camera/size/DPR and gates
mean absolute RGB-channel difference at 8/255, alongside visual inspection.
Software-WebGPU correctness does not establish hardware/mobile performance.

The corrected migration acceptance run passed the workspace emitter and all
seven active fixtures on Chromium 151
with SwiftShader WebGPU. Mean RGB-channel differences against the preserved
WebGL bundle ranged from 0.33 to 1.11/255 (gate: 8/255). The synthetic sub-emitter
capture also passed, including nonempty contact sheets and finite temporal
metrics. TypeScript, focused ESLint, the five schema/evaluator/seek/asset/bridge
test files, and both standalone bundle checks passed. Hardware performance and
encoded video export were not benchmarked by this acceptance run.


## Workspace emitter regression

The initial port omitted explicit `void` types on inline TSL helpers. Three r186
only adds unused function calls to the statement stack when their type is
`void`; otherwise particle trajectory and inactive-particle clipping calls were
skipped. The workspace default emitter collapsed onto the origin, and inactive
vertices could invalidate the rendered image. The offline converter now retains
that contract for all void helpers, including parent/child trajectories and
trail clipping.

`AUTOV_FIXTURES=workspace npm run verify:webgpu` exercises the same
`createDocument` used by Add emitter. It samples animation frames before birth,
during emission, at expiration, and across a loop, asserting that the ground
remains visible. The fixed active frame differs from the preserved WebGL image
by 0.44/255 mean RGB-channel error. This case is included in the default suite.

To isolate workspace-only startup reports, the existing dev studio accepts
`?fixture=empty` (same empty-start/Add emitter path as the workspace) and
`?fixture=new-emitter` (the same default emitter installed on mount). Both use
`Studio`; standalone mode only changes chat persistence. These modes avoid
confounding the startup transition with the dev route's usual fire fixture.
The full empty-start Studio was checked in Chromium with Add emitter followed
by pausing and scrubbing to 0.50 s; particles and ground were visible. A report
that differs on another browser remains unconfirmed until that browser's
comparison or GPU error is available.

## Interactive performance

The workspace/dev Studio uses `new VfxRuntimeV2(host, { preview: true })` and
`renderPreview(time, solo)`. This preview retains scene MSAA, omits the four
SMAA-related fullscreen draws, and caps the drawing buffer at one megapixel and
DPR 1.5. Offscreen evaluation/export still honors document AA and capture size.
The image-quality tradeoff is limited to the interactive preview.

Unchanged paused samples and inactive intervals with a static camera submit no
GPU work; document/texture readiness, resize, camera damping, and seeking
invalidate that cache. Explicit `render()` always draws, preserving immediate
capture semantics. The regression harness counts queue submissions for pause,
inactive intervals, resize, and seeking back into an emitter.

The playback clock is an external store. The canvas reads its live snapshot
inside its render loop without a React subscription; timeline React updates are
bounded to 30 Hz. Seek, pause, loop transitions, and duration edits publish
immediately. Animation ticks do not rerender Studio's board/chat or canvas
component. Clock tests cover display cadence, pause, seek, looping, end-of-playback,
and duration changes.
Post resources are reused across document edits with unchanged MSAA sample count.
Structural curve/ramp counts and shape modes are specialized in node materials;
plain particle masks skip unused noise evaluation.

`AUTOV_PREVIEW=1 npm exec -- node scripts/webgpu/profile-emitter.mjs` records
first-frame latency, warm median CPU submission and queue-completed frame times,
draw calls, memory, and a Chrome CPU profile summary. It uses a bundled browser
build at 640×360/DPR 1, 3 warmup frames and 12 measured samples, for 600 and 6000
particles, with and without post-processing. Queue-completed timings include
synchronization and are not isolated GPU timestamps or a hardware FPS claim.
`AUTOV_SAVE_PERF_BUNDLE` / `AUTOV_PERF_BUNDLE` preserve and replay a baseline.

Profiling reference ledger: read `threejs-debug-profiler/references/debug-profile-checklists.md`
`references/checklists/performance-profile.md`, and
`references/checklists/scene-debugging.md`; used canvas dimensions,
loop ownership, CPU sampling, shader/post costs, draw counts, resource reuse,
and browser visual regression checks. Native hardware timing is unavailable in
this environment; browser verification uses Chromium 151/SwiftShader.

Final sequential comparison with identical CPU-profiling instrumentation:

| Active particles, post enabled | Before | Optimized preview | Frame-time reduction |
| --- | ---: | ---: | ---: |
| 600 | 155.4 ms | 106.3 ms | 31.6% |
| 6000 | 352.9 ms | 279.5 ms | 20.8% |

Draw calls fell from 20 to 16. These serial, software-GPU timings are a
comparative correctness/performance signal, not expected desktop FPS. The
high-DPI pixel cap and removal of unrelated React rerenders are additional
preview savings outside this DPR-1 runtime benchmark. Raw reports are in
`.autov-local/performance/emitter-before.json` and `emitter-after.json`.
Validation passed: eight fixture comparisons, sub-emitter capture, queue-count
preview assertions, full Studio Add emitter/pause/seek browser check, clock and
seek/UI bridge tests, TypeScript, focused lint, and standalone bundle checks.

## Shared studio optimization (September 2026)

Document installs reuse unchanged layer objects and their GPU resources. Cache
keys include layer content/order, seed, duration, particle density, motion blur,
texture data, and sub-emitter parent content. Editing a parent invalidates its
children; equivalent documents retain all layer resources. Texture cache keys
include the resolved URL/data so replacing an embedded image under the same ID
cannot reuse the old image. Installs stage replacements before disposing old
layers. Workspace edits use `preserveCamera: true`, avoiding repeated framing
samples and camera resets; explicit focus and resize still compute bounds.

Runtime evaluation copies only branches written by tracks, motion, or active
overrides. Its result is read-only; the public mutable evaluator still returns a
full deep clone. Particle sorting reuses temporary vectors, and ramp writes reuse
a Color. Solo/inactive layers skip evaluation; the soft-particle depth pass only
runs when a visible soft layer needs it. No preview-quality settings changed in
this optimization.

`node scripts/webgpu/verify-studio-performance.mjs` checks resource retention,
camera preservation, seed/duration/parent invalidation, and paused-frame reuse.
Set `AUTOV_STUDIO_BASELINE` to a previous `Probe` runtime IIFE for a pixel-exact
comparison and before/after measurements. Linux CI uses
`AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a node ...`. `AUTOV_FIXTURES` optionally selects
cases. Results default to `.autov-local/studio-performance/results.json`.

Sequential Chromium 151/SwiftShader comparison, bundled runtime, 320×180/DPR 1,
post enabled: 3 warmup frames, 12 CPU submission samples, 6 document edit samples.
The baseline includes the earlier fog-object reuse fix. Edit measurements cover
installation, not subsequent GPU pipeline compilation.

| Scene | CPU median before → after | Document install before → after | Retained layers |
| --- | ---: | ---: | ---: |
| Fire projectile | 5.4 → 5.3 ms | 50.7 → 1.7 ms | 8 / 9 |
| Beam | 4.9 → 3.7 ms | 41.1 → 1.2 ms | 18 / 19 |
| Lightning impact | 4.3 → 4.2 ms | 23.5 → 1.4 ms | 9 / 10 |
| Smoke burst | 3.3 → 2.6 ms | 25.3 → 0.7 ms | 9 / 10 |
| 24 smoke emitters | 8.6 → 7.7 ms | 217.4 → 1.9 ms | 23 / 24 |

All five sampled images matched baseline pixels exactly. Nine WebGPU scenarios
passed (all seven fixtures, workspace transitions, and sub-emitters), including
seek determinism, solo, post, and capture checks. All 31 unit test files passed;
the two subprocess-based files required execution outside the IPC-restricted
sandbox. TypeScript and focused ESLint passed. Hardware FPS remains unmeasured;
these software-GPU CPU timings show the largest gain in editing, with smaller
steady playback improvements. Adaptive resolution and cheaper bloom remain
possible future quality tradeoffs, not part of this change.

The actual dev Studio route passed play/pause, keyboard seeking, paused orbit and
pan, and an emitter slider edit with the original canvas retained and no page or
scene errors. The inspected screenshot is
`output/playwright/studio-performance-after.png` at the repository root.

## Emitter boundary stalls

Light layers remain in the render list at zero intensity outside their active
interval or when excluded by solo/feature flags. The depth pre-pass retains the
same lights. Previously, adding/removing a light changed the node cache key for
all VFX materials, repeatedly rebuilding shaders at light start/end times.

Preview `whenReady()` warms every enabled emitter, including delayed emitters,
through the actual post graph at 64×64, then restores the requested image and
canvas size synchronously before presentation. Three r186's `compileAsync()`
uses a top-level render context; it does not populate the nested post scene
pass's context cache. Warming uses the real passes instead. This moves first-use
compilation to preparation. Edits also warm replacements, advancing the frame
cache so an earlier post sample cannot skip the work. Capture runtimes do not
perform this preview warmup. Initial scene preparation can take longer; quality
and authored emitter timing are unchanged.

Run `AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a node scripts/webgpu/verify-boundaries.mjs`
for beam, ice blast, and lightning. It samples just before, at, and after every
bar edge over two loops, then edits a delayed emitter. It asserts zero shader
builds during those playback samples and after the edit's preparation.

Chromium 151/SwiftShader, 320×180 preview: beam's worst sampled CPU frame fell
from 351.6 ms to 6.8 ms on the first loop, and from 147.1 ms to 4.7 ms on the
second. Ice and lightning also had zero boundary shader builds, with maximum
sampled CPU times of 6.2 and 5.6 ms respectively. These are local CPU submission
timings, not hardware FPS guarantees. Raw results are under
`frontend/.autov-local/boundaries-before` and `boundaries-after`.

Validation: beam, lightning, and fire projectile matched previous-runtime pixels.
Workspace, beam, lightning, and sub-emitter seek/capture checks passed. The actual
Studio crossed the beam start, paused, and orbited without page errors; its
restored canvas was inspected in `output/playwright/studio-boundary-after.png`.
Focused unit tests, TypeScript, lint, and the runtime bundle also passed.

## Persistent workspace ownership

`Studio` owns an immutable workspace document from first mount, including an
empty emitter list, camera settings, post settings, and the default ground/grid.
It always mounts `WorkspaceScene`; Add emitter and deleting the last emitter no longer
swap a placeholder renderer in or out. The scene, renderer, controls, and
environment keep their lifecycle, and ordinary document edits preserve the
user's orbit. Environment edits made before adding an emitter remain in place.

`validateWorkspaceDocumentV2` accepts empty/all-hidden editor states and returns
a detached document. `validateDocumentV2` continues to require a nonempty,
enabled generated effect. JSON workspace import/export supports empty editor
state. The renderer receives its own parsed copy; evaluation already creates
its own runtime and parsed document, so it does not touch the displayed scene.

The intended agent integration is a revisioned document snapshot, isolated
offscreen evaluation, and a proposed patch applied only if its base revision
still matches (or explicitly rebased). The document is canonical; a cloned
Three.js scene is not the source of truth. Revision checking and the agent
patch transport are not implemented by this workspace lifecycle change.

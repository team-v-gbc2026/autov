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

The playback clock is an external store subscribed to only by preview/timeline
components; animation ticks no longer rerender Studio's board/chat. Clock tests
cover pause notifications, seek, looping, end-of-playback, and duration changes.
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
and `references/checklists/performance-profile.md`; used canvas dimensions,
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

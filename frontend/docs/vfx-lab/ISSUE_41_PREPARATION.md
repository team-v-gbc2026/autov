# Issue #41: prepare the actual playback pipelines cooperatively

Original measurement baseline: `6c0534c004a5a4fe7c9f0d7d8c84e3c26e70c41a` (including PR #43).

Integration base: `08c83b871f90e0f2bd67841e6c1308108974c678` (main after PR #50).
The original timing tables below retain their original baseline; they are not new
measurements of the #50 merge.

## Behavior

The studio previously prepared every layer in one synchronous warm draw. A single
preparation task could block input for multiple seconds. Export/capture runtimes
skipped that preparation entirely, so shaders compiled during the first playback.
The soft-particle depth pass also used a different visible light set during
preparation and playback, leaving additional pipelines to compile later.

Preparation now runs the actual post-processing graph one layer at a time, yielding
a browser task between batches. Each layer keeps its midpoint and optional second
warm state; layers that require all children retain that behavior. The depth pass
uses the same receiver/light visibility as playback and is only prepared when a
soft-particle layer needs it. This is deliberately not a top-level `compileAsync`:
that would prepare a different render-target context from the nested post pass.

`whenReady()` is shared by preview and full-quality players. Concurrent calls share
one preparation job. An edit invalidates the job's revision; the next batch stops
and prepares the latest document. Disposal and rendering cannot interleave inside
a renderer operation. A temporary canvas masks warm frames, with cleanup on exit.
The studio's playback hold is released only by the current installed edit.

Prepared layer objects are retained in a WeakSet. Existing material-instance reuse
remains in place: a live opacity edit creates neither geometry nor GPU pipelines.
AA/post/environment/light-structure changes invalidate preparation; changing only
live layer appearance values does not repeat it. Empty workspaces prepare their graph too.

## Integration with PR #50

Main is merged into the existing #51 branch without rewriting its published
history. The conflict was in `workspace-scene.tsx`'s preparation completion:

- Keep #50's authored environment, first-effect framing, panel-safe fitting,
  camera-change detection, and authored `camera.framing` in runtime focus.
- Keep #51's current-document/runtime guards, playback holds, preparation reuse,
  cancellation, cleanup, and ready-state transition for ordinary edits.
- Carry a pending fit through a superseding live edit. Otherwise the first
  document's stale completion is correctly ignored but its successor can miss
  the camera fit, leaving the effect under the panels or the loading state stuck.
  Completion uses the latest solo selection and fits only when required.

`node scripts/webgpu/verify-workspace-preparation.mjs` exercises the actual React
component and playback clock in a browser, with controlled GPU-ready completion.
It covers overlapping initial/authored-camera edits, stale callbacks, authored
background, panel-safe framing, current solo, ordinary-edit orbit preservation,
and unmount. Real WebGPU checks are separate.

After integration, all 609 unit tests passed (one existing test skipped), as did
changed-file lint, typecheck, the production build, and development-route exclusion.
The GPU comparison against #50's main passed for ice-blast, smoke-burst, and
fire-projectile: all nine sampled images are identical, no pipelines were built
during candidate playback or live opacity edits, and the preparation lifecycle
checks passed. For ice-blast the longest preparation task was 6,953 → 1,100 ms;
smoke-burst was 3,368 → 868 ms. These sample results do not change the cold-load
limitations below. Raw evidence: [main comparison](evidence/issue-41/main-50-preview.json),
[pixels](evidence/issue-41/main-50-pixels.json).

## Quality contract

No authored resolution, particle count, geometry detail, shader math, material
appearance, AA mode, bloom or texture filtering has been reduced. The 64×64 hidden
preparation target existed before this change; visible rendering restores the same
requested dimensions. No recipe- or fixture-specific optimization was added.

## Measurements

Local macOS hardware WebGPU, Chromium, same authored documents and dimensions in
both runs. These are sample timings, not portable hardware-independent guarantees.
Paired probe: 960×540, device scale 1. Frames include GPU completion and identical
readbacks at three authored timestamps. Long tasks are measured with
PerformanceObserver; their scope is preparation, not steady-state GPU time.

| Preview | Ready before → after | Longest preparation task | Worst first-play frame | Playback pipeline builds |
| --- | --- | --- | --- | --- |
| ice-blast | 10.53 → 8.29 s | 8,376 → 1,171 ms | 30.9 → 13.6 ms | 3 → 0 |
| smoke-burst | 3.81 → 4.20 s | 3,769 → 1,130 ms | 65.9 → 19.9 ms | 4 → 0 |
| fire-projectile | 4.73 → 4.05 s | 3,397 → 883 ms | 27.8 → 20.3 ms | 0 → 0 |

| Full-quality player | Worst first-play frame | Playback pipeline builds |
| --- | --- | --- |
| ice-blast | 5,331.7 → 15.0 ms | 33 → 0 |
| smoke-burst | 1,497.2 → 12.2 ms | 38 → 0 |
| fire-projectile | 4,186.7 → 35.5 ms | 27 → 0 |

Full-quality players now wait for preparation before starting their clock, instead
of returning ready immediately and paying that cost during playback. Cold readiness
is therefore longer in that path. Preview wall-clock readiness is not universally
faster: smoke-burst paid about 0.4 s for cooperative preparation in this run.

The individual expensive shader/TSL build is still synchronous: approximately
0.9–1.3 s worst preparation tasks remain in these samples. This change bounds the
stall by a layer instead of the complete effect; it does **not** claim stutter-free
initial loading or background-thread compilation.

Visual comparison: all nine preview images are byte-identical. Eight of nine player
images are byte-identical; the remaining image differs in one 8-bit channel by one
unit (1/255). The automated image gate permits at most 16 such one-unit channels,
records the exact count, and rejects larger changes. Same settings and camera are
used; the tolerance does not permit image-wide drift.

Raw timing evidence: [preview](evidence/issue-41/preview.json),
[player](evidence/issue-41/player.json), [all 18 configurations](evidence/issue-41/all-fixtures.json),
[preview pixels](evidence/issue-41/preview-pixels.json), and
[player pixels](evidence/issue-41/player-pixels.json).

The complete fixture/maximum-configuration gate passed with zero late pipelines
for all 18 documents at 1264×790, and shared shader text remained identical for
every tested layer kind. All 592 unit tests passed (one additional test skipped);
changed-file lint, typecheck, and the production build/dev-exclusion check passed.

## Reproduce

From `frontend/`, with Node 24+, installed dependencies, and Playwright Chromium:

```sh
# Compare the changed runtime with its base version; all its imports are unchanged.
AUTOV_BASELINE_REF=08c83b8 AUTOV_LIFECYCLE=1 node scripts/webgpu/verify-hitch.mjs
AUTOV_BASELINE_REF=08c83b8 AUTOV_PLAYER=1 AUTOV_LIFECYCLE=1 AUTOV_EVIDENCE_DIR=.autov-local/issue-41-player node scripts/webgpu/verify-hitch.mjs
# Alternatively supply a separately built complete Probe baseline via AUTOV_BASELINE_BUNDLE.

# Existing full fixture + maximum configuration + shared-WGSL contract, stricter zero late builds.
AUTOV_LATE_PIPELINES=0 node scripts/webgpu/verify-perf.mjs
node --import tsx --test tests/*.test.ts tests/agent/*.test.ts
npm run typecheck
npm run build
```

The lifecycle probe also checks overlapping callers, structural edits superseded
between batches, repeat readiness, empty previews, and disposal during preparation.
GPU validation errors, rebuilding a live opacity edit, or candidate playback
compilation fail the probe. Its images, timings, and pixel comparison report are
written under `AUTOV_EVIDENCE_DIR` (default `.autov-local/issue-41`).

## Review in the browser

Run `npm run dev -- --hostname 127.0.0.1 --port 3141`, then open
[the local review page](http://127.0.0.1:3141/dev/hitch).
Switch effects while preparing and click the input counter. The page shows the
unchanged authored effects and preparation timing. It is `page.dev.tsx` and is
excluded at build time; `npm run build` verifies no `/dev/` routes ship.

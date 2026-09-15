# Browser capabilities and Niagara export follow-up

Status: proposed work for a separate PR. Physics is deferred for later discussion.

## Intent

Let AutoV build a broader range of effects using existing, procedural, generated,
or baked assets as appropriate. Keep capabilities compatible with a future
Niagara converter by defining their behavior and asset formats explicitly.

This document records scope and implementation options, not completed features
or a promise of Niagara parity. It does not require a v3 graph or new layer kinds.

## Existing foundation

The current v2 renderer has analytic particles, mesh-based effect layers,
particle trails, procedural masks, library textures, flipbook playback, and
deterministic captures. Recent work extends flipbook blending and soft depth
intersections across drawable layers and exposes library texture inspection to
the agent.

Current particle motion is evaluated from document, time, and seed. Soft depth
fading and the analytic floor constraint are not persistent collision physics.
Reference-board image generation is separate from producing usable runtime
textures. The generation workflow can now generate isolated effect masks, register them on the reference board, and inspect them alongside library assets. See ART_DIRECTION_PIPELINE.md. Broader asset preparation and physics remain follow-up work.

## Browser-friendly asset work

| Capability | Proposed implementation | Relative effort |
| --- | --- | --- |
| Asset discovery | Search catalog metadata and inspect candidate textures | Small; catalog and inspection already exist |
| Procedural masks | Canvas or shader generation of gradients, rings, streaks, and noise | Small |
| Texture preparation | Resize, extract channels, pad edges, and preview transparency | Small–moderate |
| Flipbook baking | Capture an effect at fixed timestamps and pack frames into an atlas | Moderate |
| Asset validation | Check dimensions, channel meaning, alpha, tiling, and atlas layout | Small–moderate |

Suggested first asset PR: procedural masks and flipbook baking, connected to
the same asset-registration and inspection flow as library assets. Final scope
should be chosen before implementation.

### Browser and server responsibilities

- Browser: procedural mask construction, effect captures, atlas packing,
  previews, and local validation where practical.
- Server: image-model calls, bounded file processing, durable asset registration,
  authorization, provenance, and generation spending controls.
- Generation workflow: decide whether to reuse, construct, generate, or bake an
  asset; inspect the result; then use its registered ID in the effect document.

Proposed flow:

```text
Plan effect and required assets
  → select existing assets or prepare new ones
  → validate and register immutable asset IDs
  → generate candidate document
  → render, review, and correct
```

Possible tool responsibilities, with names still undecided:

- Search effect assets.
- Build a procedural mask.
- Generate a runtime texture through a server-side image model.
- Bake an effect into a flipbook.
- Inspect an asset's pixels and metadata.

Asset creation should depend on the effect, not run automatically for every
prompt. Generation needs access to registered project assets as well as the
fixed library; adding a texture-generation tool alone will not provide that.

### Asset contract

Record dimensions, channel meanings, color space, alpha convention, wrapping,
edge padding, content hash, source/provenance, and project ownership. Flipbooks
also need columns, rows, frame count, frame ordering, time range, sampling cadence,
and playback recommendations. Distinguish authored playback FPS from bake FPS.

Keep asset dependencies immutable and portable. Do not place arbitrary URLs or
unregistered image output directly into generated documents.

A generated picture is not automatically a usable particle texture. Inspect
its silhouette, background, alpha, and seams. Independently generated animation
frames can flicker; prefer coherent animation or simulation bakes for sequences.

### Baking decisions and acceptance

Define capture camera, seed, timestamps, resolution, background/alpha handling,
and whether lighting is baked. The effect stays separate from these bake settings.
Prevent accidental double application of exposure or bloom when replaying an
already processed atlas. Verify that the exporter actually preserves alpha;
do not infer transparency from a black preview background.

Acceptance examples:

- A procedural ring or streak has clean coverage and no unwanted card edges.
- A baked sequence replays in the existing v2 flipbook path with correct frame
  order, duration, interpolation, and end/loop behavior.
- An asset chosen or created by generation survives save/reload and is inspectable
  by both the conversational agent and generation workflow.
- Invalid files and failed generation preserve the current effect; ambiguous
  image-model calls are not automatically repeated.

## Physics: deferred

Revisit this independently. Do not add a physics mode as part of the asset PR.

The proposed first physics slice was gravity, drag, and plane bounce. Once a
persistent simulator exists, additional forces and collision responses become
incremental, but building that simulator is a meaningful architectural change.

| Capability | Implementation option | Relative effort |
| --- | --- | --- |
| Persistent state | Position, previous position, velocity, age, lifetime, stable IDs | Foundational/moderate |
| Gravity and drag | Fixed-step integration with explicit equations | Small after state exists |
| Wind and attraction | Additional ordered force calculations | Small after state exists |
| Primitive collision | Planes first, then spheres and boxes | Moderate |
| Collision response | Restitution, friction, bounce/slide/kill | Small after collision exists |
| Rotation | Angular velocity and rotational drag | Small–moderate |
| Mesh particles | Instanced geometry driven by particle state | Moderate; separate renderer work |

One option is a CPU reference simulator feeding instanced rendering at modest
particle counts. Measure its cost before setting limits. Keep the simulation
interface independent of rendering so a WebGPU compute backend can follow.
CPU-first is an option to evaluate, not an agreed implementation requirement.

Retain analytic mode. Reuse existing emitter/force fields where their semantics
match; avoid a second contradictory set of gravity, drag, or lifetime controls.
Specify initialization, ordered update operations, integration, and rendering
separately. Stateful seeking needs reset/replay or checkpoints, including clear
invalidation on edits and deterministic spawn/random-state handling.

Deferred beyond the first physics slice: particle-to-particle collision, fluid
solvers, arbitrary animated-mesh collision, complex GPU event routing, and
volumetric lighting.

## Niagara compatibility considerations

Define a supported subset before promising conversion. Each capability should
have a versioned behavior contract covering units, coordinate spaces, execution
order, distributions, interpolation, and resource inputs. Convert AutoV's units
and axes explicitly at the export boundary.

Classify exported features as supported, approximate, bake-required, or
unsupported. Pin the Unreal target version and validate both implementations
against common fixtures. A shared seed alone does not guarantee identical motion.

Start future collision comparisons with explicit shared primitives. Scene-depth
and distance-field collision depend on the host's camera and scene representation.
Niagara CPU/GPU event support must be checked for the chosen target; conventional
event handlers cannot be assumed to map to browser GPU collision events.

Materials need their own export mapping alongside Niagara emitters. Prefer a
portable vocabulary of mask sampling, ramps, emission, erosion, UV animation,
flipbooks, and depth fade, implemented in both WebGPU and Unreal material
templates. A browser-only custom shader is not automatically convertible.

Build a small converter prototype early enough to test assumptions, before
investing in complex simulation features.

References consulted during planning; recheck for the eventual target version:

- [Niagara particle update modules](https://dev.epicgames.com/documentation/en-us/unreal-engine/particle-update-group-reference-for-niagara-effects-in-unreal-engine)
- [Niagara events and event handlers](https://dev.epicgames.com/documentation/en-us/unreal-engine/events-and-event-handlers-in-niagara-effects-for-unreal-engine)
- [Niagara renderer settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/render-module-reference-for-niagara-effects-in-unreal-engine)
- [Niagara flipbook baker](https://dev.epicgames.com/documentation/unreal-engine/niagara-flipbook-baker-quick-start-guide-in-unreal-engine)

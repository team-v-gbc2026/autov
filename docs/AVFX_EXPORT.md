# AVFX bundle

Use **Dev utilities → AVFX export workbench** (`/dev/avfx`) and **Export .avfx**.
The export uses the source document, not the current playback time or solo selection.
It is a local download; it does not upload or modify the document.

The AI still authors `autov.lab/2` documents. The application builds `avfx/0.1`.
This is an experimental adapter contract, not a claim of engine rendering parity.

## Scope

Enabled `particles`, `ring`, `shell`, `trail`, `beam`, `sprite`, and `decal` layers.
The expanded Godot adapter also supports `blob`, `crystals`, `splash`, `ribbon`,
`wireBurst`, `arcs`, `streakBurst`, `sheets`, `crescent`, `licks`, and `reflection`.
Export now retains these layers. Use updated adapters: the expanded Godot plugin,
Unreal asset adapter version 2, or Unity package 0.3.0 / importer version 2.
Older adapters do not support the additional programs or sampled instance data.
Disabled layers and other kinds are explicitly listed in `avfx.json.excluded`.
Fire-projectile exports six particle layers and two geometry layers. Its point
light is excluded. The authored environment and post-processing are reference
context, not exported effect layers.

Particle sub-emitters, trails, strip/sliver draws, secondary draws and surface
RGB-split draws retain their individual programs and attributes. Camera-frame
layer transforms are currently rejected. Dependencies on excluded layers or
excluded path-event drivers are rejected rather than silently changing motion.

Timeline samples may include an `instances` path. It selects an immutable instance
table alongside the sampled mesh; players must update both. Absent `instances`
means use the draw's original instance table (legacy bundles). Empty populations
are invisible and carry a one-row placeholder. Geometry and instance snapshots
are content-deduplicated; shader-only deformation remains live for now.

## Files

`.avfx` is a deterministic, uncompressed ZIP with ordinary relative paths:

- `avfx.json`: version, source hash, coordinate conventions, layer index,
  shader ABI, texture inventory, exclusions, warnings, and SHA-256/size for every
  other file. The manifest cannot hash itself.
- `layers/layer-N.json`: one logical layer; draws, geometry/instance references,
  typed uniform defaults/bindings, blend/depth/cull state and sorting policy.
- `meshes/mesh-N.glb`: geometry-only glTF 2.0 meshes. No substitute PBR material.
  Custom vertex semantics have `_` prefixes, with original names recorded in
  `meshes[0].extras.attributeMap`.
- `meshes/draw-N-instances.json`: per-instance attributes in original seed order.
  Includes `aSeed`, `aExtra`, `aExtra2`, **and all additional attributes** required
  by that draw (index, event, parent, source-site, secondary-bit, etc.).
- `textures/texture-N.png`: actual texture bytes, not remote links. Each binding
  records wrap/filter/mipmap/color-space/flip settings. Procedural data textures
  use lossless numeric JSON instead of quantizing floats into PNG.
- `timeline.json`: per-draw absolute-time state changes sampled at 60 Hz, plus
  exact layer boundaries and lightning strike boundaries. Includes visibility,
  model matrices, numeric uniforms, and mesh references for changing geometry.
- `kernel/glsl/*`: complete attribute-enabled migration reference variants used
  as inputs to the project's TSL conversion. **Not engine-ready shaders.**
- `source/document.json`: validated original document for provenance.
- `source/export-document.json`: styled, event-resolved in-scope document for
  diagnostics. Adapters do not need to execute either source document.

## Adapter playback contract

1. Verify paths, version, sizes and hashes; load layer descriptors and shader ABI.
2. Load each GLB without applying unit or axis conversions twice. Source space is
   right-handed, Y-up, local +Z forward, meters. Matrices are column-major.
3. Build instanced draws or duplicate the base vertices and instance fields when
   an engine requires expanded particle quads. Do not regenerate seeds.
4. Implement the named vertex/fragment programs in the target engine, including
   the supplied curve/ramp arrays. The live browser renderer uses generated TSL;
   GLSL is reference material and still requires port/parity testing.
5. At absolute time `T`, use the last timeline record whose `time <= T` (step
   interpolation). Records contain complete state, not partial patches. Hide a
   layer outside `[start, end)`. Set `uTime = T - start` continuously while alive.
   To loop, wrap `T` by document duration before looking up timeline state.
6. Supply the engine bindings: camera basis, near/far, pixel viewport size and
   opaque scene depth. Convert the engine's depth convention to the reference
   shader's expected depth before evaluating soft particles. Standard shader
   model/view/projection inputs are implicit, not authored uniforms.
7. Preserve the declared blend factors. In particular the current additive
   fragment output and source-alpha blending must not be “corrected”: the
   resulting alpha-squared contribution is intentional compatibility behavior.
8. Implement camera-dependent particle sorting where requested. Every instance
   attribute must move with the same permutation. Alpha ordering differences
   can cause visible drift even when positions and shading match.

Numeric curve/ramp uniforms are exported with shader types and lengths. Values
marked `storage: "constant"` are baked by the browser's TSL material factory and
must remain fixed at their descriptor values, even if source tracks would
otherwise change them. LUT
fallbacks for engines with uniform limits remain adapter work. CPU-evaluated
motion/parameter changes are quantized to 60 Hz; shader animation remains
continuous. The exporter deduplicates unchanged timeline records and geometry
objects. It does not claim exact between-sample parity for CPU motion.

## Implementation and verification

`createV2ExportScene` uses the production layer factories and evaluators without
creating a GPU renderer. Deferred texture handles retain the same shader
feature flags; export independently loads and checks asset bytes, and fails on
missing/non-PNG image assets. The live preview is never sampled or mutated.

`src/lib/avfx/export.ts` builds the archive; `binary.ts` writes ZIP/GLB;
`scope.ts` owns support checks. Bundles are capped at 256 MiB for this pass.

Run from `frontend`:

```sh
node --import tsx --test --test-isolation=none tests/avfx.test.ts
npm run typecheck
```

An experimental Godot particle/surface adapter is available in
[`godot-plugin`](../godot-plugin/README.md). Copy its `autov_avfx` folder into
your Godot project's `addons` directory and enable the plugin.
Reference screenshots, engine parity, automatic LUT
fallbacks, and export UI in the production studio are not implemented here.
The manifest explicitly marks reference capture as `not-captured` and adapter
compatibility as `adapter-required`.

### First-pass verification (2026-09-17)

- 149 focused export/schema/texture regression tests pass, along with TypeScript
  and ESLint checks on the new/changed export code.
- ZIP payloads are also opened with an independent ZIP reader; all six geometry
  kinds are loaded with `GLTFLoader`. An animated torus verifies mesh sequencing.
- The actual workbench component downloaded a 3.59 MiB fire-projectile bundle
  in Chromium: 39 files, 8 layers, 9 real PNG assets, particle/surface programs.
  All file SHA-256 hashes, ZIP CRCs and PNG decodes were independently checked.
- This browser download was tested with the unchanged workbench mounted in an
  isolated page: the running Next dev server served `/dev/avfx` but did not
  hydrate in the test browser. Its HMR connection also failed. The browser had
  no WebGPU adapter, so this verifies export/download, not rendered appearance.
- Additional CPU-only export probes passed for retained layers in beam,
  healing-aura, and shield (including strip/trail programs and lattice data).

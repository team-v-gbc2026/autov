# AVFX parity rollout

Order: Godot, verify; Unreal, verify; Unity, verify. Do not use successful import
or shader compilation alone as evidence of rendered parity.

## Bake-first contract

The app builds the archive; AI still authors only the source document. Resolve
procedural geometry, seeds, topology, transforms and camera-independent motion
at export time wherever possible. Preserve animation as sampled data, not a
single frozen mesh. Preserve the original material inputs and vertex-to-fragment
values when baking deformation; final positions alone are not sufficient.

Camera-dependent billboarding, view/depth effects and sorting remain live.
Fragment shading remains live when baking it would change arbitrary-camera or
destination-scene behavior. Shader ports are a fallback/reference, not completion
of the baking work. Do not bake one reference camera into a supposedly reusable
3D effect. Do not silently reduce sample rate or precision to meet size limits.

Current mesh snapshots use content equality, not object identity or upload
versions. In-place CPU edits are captured, and identical/rewound frames share
one GLB. The existing timeline selects immutable meshes at absolute sample times.
This does **not** yet capture deformation performed exclusively by vertex shaders.

## Acceptance matrix

Each adapter needs coverage for all source programs: particle, subParticle,
trail, subTrail, strip, sliver, surface, blob, crystal, splash, ribbon, wireBurst,
arc, streak, sheet, crescent and lick. Layer kinds and shader programs are not
one-to-one; particle auxiliary draws and reflection reuse other programs.

Additional contracts requiring explicit tests:

- All mesh attributes and all per-instance attributes, including mixed data.
- Animated geometry and immutable material constants; seek/loop determinism.
- Blend/depth/cull behavior and independent texture sampling settings.
- Camera-facing and camera-frame behavior, depth fading and particle sorting.
- Cross-layer dependencies, reflection and light layers.
- Source-scene presentation (camera/environment/post-processing): scope pending.
- Editor playback, saved resources, reimport and packaged runtime playback.

## Current checkpoint

Working branch: `avfx/full-parity-godot`, based on the current
`avfx-exportCreation` layout. The distributable Godot folder stays
`godot-plugin/autov_avfx`; developer tooling belongs in `tools/avfx`.

Godot: expanded vertex/fragment program support is connected to the exporter.
Unreal and Unity: expanded 17-program adapters implemented. Existing Godot
particle/surface ports remain unchanged. Export includes the ten generator kinds and reflection; older
adapters must not be used for the newly required programs.

Verified in this checkpoint:

- Existing AVFX export test file and new mesh snapshot regression test file pass.
- Frontend `npm run typecheck` passes.
- Godot 4.6.1 reads line/triangle GLBs with correct winding and mixed vertex and
  instance attributes; player script compiles.
- Godot Compatibility / Mesa llvmpipe renders an exported animated torus bundle:
  sampled meshes change pixels, rewind reproduces exact pixels, end hides draw.
- All 17 trusted programs compile; ten isolated generator bundles render nonempty
  output at two authored times, change pixels with animation and rewind exactly.
  The licks check hides its source crescent draw to test the lick program itself.
- Animated instance snapshots fix initially empty/dynamic blob populations.
- New shader ports reconstruct soft depth with Godot projection conventions;
  culling and depth-disabled draws are supported. Scene-intersection visual
  comparisons and auxiliary particle-program rendering coverage remain pending.
- No full-generator visual parity, editor/save/reimport or packaged build claim.

Still pending: shader-deformation baking, remaining material/camera contracts,
source-image parity, reflection visual coverage, and full fixture matrix.

## Unreal / Unity expansion

Both adapters import line topology, custom attributes and sampled instance-table
changes alongside mesh samples. Unreal expands attributes into packed vertex
buffers using a generated per-program ABI; Unity expands attribute textures and
stores mesh/texture pairs as subassets. Remaining vertex deformation runs live.
Both use shipped trusted shaders, never shader code supplied by an archive.

Unreal 5.6 Win64: Editor Development, Game Development and Game Shipping package
builds pass; all 34 shader stages pass offline GLSL/HLSL compilation. GPU-enabled
editor startup and fire-projectile/ABI tests pass. All ten expanded generator
imports pass with `Test-Plugin.ps1 -Generators <directory>` (three automation
tests total, zero failures).
Actual Unreal generator rendering, save/cook roundtrip and parity remain unverified.
Version-1 imported Unreal assets must be imported again under a new name.

Unity 6000.0.44f1 Built-in / Windows D3D11: runtime/editor assemblies compile;
27 archive regression assertions pass. Fire projectile renders (4733 visible
pixels), all ten isolated generators render/animate/rewind exactly, and all 17
shaders import. Package 0.3.0 increments the importer version to force reimport.
URP/HDRP, soft-depth intersection fading, particle sorting and standalone player
builds remain outside verified coverage.

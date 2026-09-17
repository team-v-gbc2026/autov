# AutoV AVFX for Unreal Engine 5.6 — experimental source plugin

Target: **UE 5.6, Win64, desktop SM5/SM6 rendering**. This branch is stacked on
`avfx-exportCreation`; a PR should use that branch as its base until it merges.

**Build status:** UE 5.6 Win64 packaging passes for Editor Development, Game
Development and Game Shipping using MSVC 14.44.35229 / Windows SDK 10.0.26100.0
(UE warns that MSVC 14.38 is preferred). Both Unreal automation tests pass under
NullRHI: coordinate/ABI checks and real eight-draw fire-projectile import with
corrupt-texture rejection. GPU-enabled D3D12/SM5 editor startup, native global
shader compilation and both tests also pass. The generated HLSL additionally
compiles independently.
Expanded validation also passes all ten generator imports with the updated
17-program ABI (three automation tests total). Use `-Generators <directory>`
with `tools/Test-Plugin.ps1` to include the shared generated fixtures.
Visual playback, save/cook roundtrip and parity are still release gates—not
implied by a successful package build or import test.

The expanded locally built plugin is in `dist/AutoVAVFX-expanded` (ignored by Git). Copy that whole
folder into your project's `Plugins` directory, enable AutoV AVFX and restart.
This package includes the editor binaries; you do not need to compile it again
just to load it in the matching UE 5.6 editor.

The expanded asset ABI is version 2. Import old `.avfx` files again under new
asset names; previously saved version-1 Unreal assets need conversion by import.
The new plugin does not render old packed assets using the incompatible layout.

## Install and build

1. Install UE **5.6** and its C++ build prerequisites: Visual Studio 2022 with
   **Game development with C++**, an appropriate MSVC toolchain, and a Windows
   SDK. The local UBT diagnostic requires at least SDK `10.0.19041.0`; its
   AutoSDK target is `10.0.22621.0`. See Epic's
   [Visual Studio setup guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-visual-studio-development-environment-for-cplusplus-projects-in-unreal-engine).
2. Close Unreal. Copy the **AutoVAVFX** folder into
   `<YourProject>/Plugins/AutoVAVFX`. Do not copy the enclosing `unreal-plugin`
   folder as the plugin. Use a C++ project for this source-only build, or first
   package the plugin with the script below.
3. Regenerate project files, build the project's **Development Editor / Win64**
   target and reopen it. Enable **AutoV AVFX** under **Edit → Plugins**, then
   restart. The shader module must load at startup; Live Coding is not enough
   for first installation.

To compile/package separately, run in Windows PowerShell:

```powershell
.\tools\Build-Plugin.ps1 -EngineRoot 'C:\Program Files\Epic Games\UE_5.6'
```

The script copies the source into a unique Windows temporary directory, then
uses Epic's `BuildPlugin` automation. It prints the packaged-plugin directory on
success and retains diagnostics on failure. It works with the repository in
WSL because compiler inputs are staged on a Windows drive. It does not change
the Unreal installation or install SDKs. Copy the successful package into your
game's `Plugins/AutoVAVFX` folder; Blueprint-only projects can consume a packaged
plugin once matching binaries have been built.

## Import and use

1. Export **fire-projectile** as `.avfx` from autoV's dev workbench. The source
   fixture contains six particle and two surface draws; its light is excluded.
2. Drag the archive into Unreal's **Content Browser**, or choose **Import**.
   The importer creates one **AVFXAsset**, embedding decoded mesh data, seed
   attributes, timeline state and texture subobjects. Save the asset.
3. Drag the imported asset into a level to create an **AVFX Effect** actor.
   Alternatively place that actor class and assign its **Effect** property.
4. Enable the editor viewport's **Realtime** mode. **Preview Time** selects a
   still frame; **Editor Preview** loops the effect. The **Play**, **Pause** and
   **Restart** Details buttons control preview. Select the actor through the
   Outliner; no native mesh hit proxy is supplied in this rendering pass.
5. Use **screen percentage 100%**, disable dynamic resolution for this first
   pass, and use a perspective viewport. Test with fixed exposure first.
6. In gameplay, use **Autoplay**, **Loop** and **Speed**, or Blueprint calls
   **Set Effect**, **Play**, **Pause**, **Restart**, **Seek**. **Finished** fires
   at the end of non-looping playback. Seek takes absolute effect seconds.

One source meter becomes 100 Unreal centimeters. Source +Z forward maps to
Unreal +X forward; source +Y up maps to Unreal +Z up. The actor's transform places
the complete effect. No document generation or external autoV connection occurs
in Unreal. The original bundle is not needed by the packaged game: the imported
asset and its referenced texture subobjects are cooked through normal references.

## Architecture

- **AutoVAVFXEditor:** bounded STORE-ZIP import, inventory SHA-256 validation,
  shader revision checks, geometry-only GLB reader, PNG texture import, packed
  uniform/timeline conversion and drag-to-level actor factory.
- **AutoVAVFX:** cooked data asset + AVFX Effect actor, absolute-time playback
  and a scene-view extension. A draw uses vertex/index/instance byte-address
  buffers; particle seeds are never regenerated by Niagara or randomized.
- **Shaders:** all 17 trusted source programs are compiled offline through
  glslang + SPIRV-Cross to shipped HLSL global shaders. Both vertex deformation
  and fragment logic are retained. Bundle shader text is fingerprinted but
  **never compiled or executed**. Global shaders are used instead of substituting
  a generic Unreal material or approximating the effect with a Niagara emitter.
- **Render pass:** rasterizes into HDR scene color before post-processing,
  reads opaque scene depth for soft particles, uses the live view camera and
  source alpha/additive/premultiplied blend factors. Engine post-processing can
  affect the result; the source document's post stack is not recreated.

## Limits and validation still required

- Expanded programs include sub-particles, strips, trails and all ten generator
  kinds. Mesh snapshots and sampled instance tables are combined into immutable
  expanded vertex buffers; generators are not reconstructed in Unreal.
- Linear PNG and float RGBA data textures are supported.
  Common nearest/bilinear/trilinear and wrapping settings are represented, not
  every possible independently configured Three.js min/mag combination.
- Front/back/double-sided, depth-tested/disabled and depth-writing draws are
  represented. Screen blending still fails import.
- No per-particle depth sorting; draw order is preserved within an actor, but
  ordering between separate AVFX actors/other Unreal translucency is not solved.
- No shadow casting, ray tracing/Lumen participation, collision, native mesh
  picking, velocity buffer output, Niagara editing, or automatic light/environment
  recreation. TAA/TSR may ghost moving effects without motion vectors.
- Current viewport rectangle handling assumes 100% screen percentage; dynamic
  resolution, stereo/VR, orthographic views, mobile and scene captures are not
  supported/validated. Large-world precision and overlapping viewport contexts
  need engine-side testing.
- Import is capped at 256 MiB / 4096 archive entries / 256 draws / 60,000
  instances per draw and 2M expanded vertices per asset. Render data is copied/uploaded each update in this pass;
  persistent GPU buffer caching, resource budgets and performance profiling are
  follow-up work before production use.
- Hashes catch corruption/revision drift, not archive authenticity. The narrow
  importer is intended for app-produced files, not a fully audited hostile-file
  security boundary. Reimport/update-in-place is not implemented yet.

Remaining release gates: actual factory UI import, save/reopen and cook/package
roundtrip, visible fire-projectile
render, backward seek/loop checks, actor transform and scene isolation checks,
depth/blend comparison and teardown/resource checks. None should be inferred
from compilation or headless import checks.

## Development checks

With frontend dependencies installed, from the repository root:

```sh
node unreal-plugin/tools/verify-contract.mjs output/playwright/avfx/fire-projectile.avfx
```

Regenerate shader ports using `glslangValidator` and `spirv-cross` on PATH, or
set `GLSLANG` and `SPIRV_CROSS` to their executable paths:

```sh
cd frontend
node --import tsx ../unreal-plugin/tools/generate-shaders.mjs
```

This builds trusted GLSL to SPIR-V, translates to HLSL, recompiles each generated
HLSL stage independently, and updates the shared layout/hash tables. Commit
generated `.usf`, `layout.json` and `Generated/Layout.inl` together. Shader tools
are development-only; plugin consumers do not need Node or GLSL compilers.

After compiling the plugin, run the supplied Unreal automation tests:

```powershell
& 'C:\Program Files\Epic Games\UE_5.6\Engine\Binaries\Win64\UnrealEditor-Cmd.exe' `
  'C:\Projects\Test\Test.uproject' -unattended -NullRHI `
  '-AVFXFixture=C:\Effects\fire-projectile.avfx' `
  '-ExecCmds=Automation RunTests AutoV.AVFX' '-TestExit=Automation Test Queue Empty' -log
```

These cover ABI/coordinate conventions, real archive import and corruption
rejection. They do not render with `-NullRHI`; visual/cook/runtime checks require
a separate real editor/game run.

`tools/Test-Plugin.ps1 -PackageDirectory <built-plugin> -Fixture <file.avfx>`
creates an isolated test project and runs those tests. Add `-WithGPU` to also
exercise GPU-enabled startup and Unreal shader compilation (not a visual parity
test). `tests/Smoke.uproject` is its minimal project template.

References: [Epic plugin structure](https://dev.epicgames.com/documentation/en-us/unreal-engine/plugins-in-unreal-engine),
[custom import factory](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/UFactory/FactoryCreateBinary),
[AVFX bundle contract](../docs/AVFX_EXPORT.md).

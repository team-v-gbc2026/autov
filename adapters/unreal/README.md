# Auto V → Unreal Engine 5.8

Experimental C++ AVFX importer and native 3D renderer for `particle`
and `surface`. The renderer executes the original kernel math over real indexed
geometry and compact per-particle attributes. It is not a video or a baked card.

## Current scope

- Editor factory: import an extracted `effect.avfx.json` through Content Browser.
  ZIP input is implemented in source, but its build/runtime validation is currently
  blocked by Windows Smart App Control (see validation status).
- Dependencies are embedded in `UAutoVAsset`; no source-directory or network access
  is needed at runtime. Unsupported formats/programs/blends fail explicitly.
- `UAutoVPlayer`: Blueprint component, loop/pause/seek and arbitrary orbit/zoom.
- A dedicated 640×360 HDR/depth target plus explicit Three.js ACES/sRGB conversion
  makes reference comparison independent of the game's post-processing.
- `AAutoVActor` / `RenderInWorld`: actual indexed geometry drawn into the deferred
  world scene color, with reversed-Z opaque depth testing and actor transforms.
  World rendering and cube occlusion were exercised; a subsequently identified
  billboard metre/cm correction still needs rebuilding and verification.
- The world pass executes before postprocessing, after ordinary translucency.
  It does not interleave with UE translucent materials or provide motion vectors,
  lighting/shadow interaction, Niagara conversion, mobile, or ray-tracing support.
  UE world tone mapping may look different from the controlled reference mode.

## Build and run

Prerequisites: UE 5.8, MSVC 14.50 (servicing version 14.50.35723 or later),
Windows SDK, .NET Framework 4.8 SDK. The local verification machine uses UE 5.8.2,
MSVC 14.50.35738, Windows SDK 10.0.22621.0 and RTX 5070.

```powershell
.\Build.ps1
.\Import-Demo.ps1 -BundlesRoot C:\path\to\extracted-handoff
.\Launch-Demo.ps1
```

`BundlesRoot` must contain `fire-projectile/effect.avfx.json` and
`shield/effect.avfx.json`, with all their dependency folders. The import command
refuses to overwrite existing packages. The demo references `/Game/AutoV/Fire`
and `/Game/AutoV/Shield`; generated assets are local, not checked into Git.

Double-click `Launch-Demo.cmd` to reopen the demo. Controls: **1/2** effect,
**Space** pause, **left drag** orbit, **wheel** zoom, **R** restart, **F** reference
time; **V** toggles world mode, **O** toggles an opaque test cube.
`UAutoVPlayer` is also available to Blueprints in another project; copy
the `AutoV` directory into that project's `Plugins` and rebuild.

## Verification loop

```powershell
.\Launch-Demo.ps1 -CaptureDirectory C:\path\to\captures
# Install the small comparison dependency with npm install in this directory.
node compare.mjs C:\bundles\fire-projectile C:\captures\fire-projectile unreal
node compare.mjs C:\bundles\shield C:\captures\shield unreal
```

The capture mode reads the fixed time and camera from the imported manifest,
renders 0/90/180 degrees about source Y, writes six PNGs and exits. The comparison
uses the same foreground-union threshold as the Unity/Godot verification script.
Source-coordinate shader evaluation preserves right-handed Y-up metres; the
reference camera uses the same basis and OpenGL→D3D clip-depth conversion. World
mode converts source metres `(x,y,z)` to UE centimetres `(-z,x,y)*100`, applies the
actor transform, and preserves the original source-space shader contract.

`node generate-shaders.mjs` deterministically regenerates HLSL and its matching
float4 binding table from the existing SPIRV-Cross-generated Unity kernel bodies.
Shader bodies are retained, Unity wrappers are removed, integer casts and explicit
array strides are preserved. See `AutoV/THREE-LICENSE.txt` for Three.js attribution.

## Validation status

2026-09-17:

- Editor/runtime/demo C++ builds passed on UE 5.8.2 / MSVC 14.50.35738.
- Both extracted bundles imported into self-contained `.uasset` packages.
- Native HLSL compiled and six 640×360 fixed-time views rendered successfully.
- PNG mipmapping reduced Fire's foreground RGB MAE from 2.64–5.85 to 1.47–3.45.
  Shield MAE is 0.229–0.241. Fresh-process recapture reproduced these values exactly.
- World mode rendered both effects and an opaque cube correctly occluded Fire's
  visible surface. Particle billboard sizes revealed a metre/cm mismatch; its
  source fix is included but not yet rebuilt.
- Latest ZIP-import and billboard-unit changes are **not yet build verified**:
  Windows Smart App Control blocked `AutoVDemoModuleRules.dll` with `0x800711C7`.
  No Windows security configuration was changed by this implementation.
- `Package-Demo.ps1` is supplied but a packaged executable has **not** been built
  or tested. Current working launch uses the installed UE Editor executable.

See `docs/engine-export/unreal/STATUS.md` in the repository for evidence and the
remaining validation steps. This is an experimental two-program importer, not
general compatibility with arbitrary Auto V exports.

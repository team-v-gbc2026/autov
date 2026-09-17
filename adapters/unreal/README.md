# Auto V → Unreal Engine 5.8

Experimental C++ AVFX importer and native 3D reference renderer for `particle`
and `surface`. The renderer executes the original kernel math over real indexed
geometry and compact per-particle attributes. It is not a video or a baked card.

## Current scope

- Editor factory: import an extracted `effect.avfx.json` through Content Browser.
- Dependencies are embedded in `UAutoVAsset`; no source-directory or network access
  is needed at runtime. Unsupported formats/programs/blends fail explicitly.
- `UAutoVPlayer`: Blueprint component, loop/pause/seek and arbitrary orbit/zoom.
- A dedicated 640×360 HDR/depth target plus explicit Three.js ACES/sRGB conversion
  makes reference comparison independent of the game's post-processing.
- **The output is a reference-viewer render target. It does not yet participate in
  a game world's scene depth, shadows, lighting, Niagara, or mesh renderer.**
  Do not advertise this milestone as a production scene-integrated VFX plugin.
- Import currently consumes an extracted bundle, not the ZIP directly.

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
time. `UAutoVPlayer` is also available to Blueprints in another project; copy
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
reference camera uses the same basis and OpenGL→D3D clip-depth conversion. There
is currently no conversion to UE scene-world centimetres because scene integration
is not implemented.

`node generate-shaders.mjs` deterministically regenerates HLSL and its matching
float4 binding table from the existing SPIRV-Cross-generated Unity kernel bodies.
Shader bodies are retained, Unity wrappers are removed, integer casts and explicit
array strides are preserved. See `AutoV/THREE-LICENSE.txt` for Three.js attribution.

## Validation status

2026-09-17: Editor/runtime/demo C++ build passed on UE 5.8.2. Imported-asset,
shader compilation, image parity and packaged-game verification are in progress.
No parity or packaging claim is made from a successful C++ build alone.

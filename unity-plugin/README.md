# autoV Unity plugin — shared `.avfx` importer

Unity 6 (`6000.0`), **Built-in render pipeline**, desktop shader model 4.5.
The package now imports the same `.avfx` ZIP bundle as Godot and Unreal. The
exporter is unchanged. The legacy `effect.unity.json` importer was replaced.

## Install and test

1. Copy `com.autov.avfx` into a permanent Windows folder. In Unity's Package
   Manager choose **Install package from disk** and select its `package.json`.
   Package Manager resolves the official Newtonsoft JSON dependency.
2. If an older autoV adapter lives in `Assets`, remove that adapter first to
   avoid duplicate scripts and shaders. Keep your effect source files.
3. Export an effect using the current Studio's **Export AVFX** button.
4. Drag the `.avfx` file into Unity's Project window under `Assets`.
   **Do not unzip it.** Unity imports a prefab-like effect with mesh, texture
   and material subassets. No extracted files or additional export are needed.
5. Drag the imported effect from Project into the scene. Select its root to
   enable **Editor preview**, scrub **Time**, or use Play/Pause and Restart.
   It also plays in Play mode. Use a perspective camera aimed at the origin;
   geometry is in meters. Enable HDR/bloom in your own scene if desired.

Replacing the source `.avfx` triggers Unity reimport. Subasset identifiers are
derived from draw IDs and mesh paths for stable references on unchanged exports.
Runtime API: `AvfxPlayer.Play()`, `Pause()`, `Restart()`, `Seek(seconds)`.

## Implementation and limits

- Bounded STORE ZIP reader; no extraction, remote loading, scripts or shader
  compilation from the bundle. Validates paths, duplicate entries, CRCs, central
  directory, inventory sizes/SHA-256, coordinates and known shader fingerprints.
- GLB triangle meshes and authored particle instances; PNG sampling settings;
  numeric shader uniforms, constants, step-held mesh/transform timelines and
  continuous layer-local shader time. Editor/runtime share the player.
- Trusted particle/surface Unity shader ports reused from reference commit
  `5ebef9e196cb13b2c755b29054ab875c21dd6356`; source GLSL matches this exporter's
  revisions. Separate alpha blending was corrected for the shared contract.
  The Unity ports use explicit column-major uniform declarations plus transposed
  matrix uploads for the generated row-vector math: the inherited `row_major`
  declarations were not populated by Unity's Windows material binding. The
  surface shader's reserved `half2` variable was also renamed for HLSL.
- Supported programs: `particle`, `surface`. Other particle variants (trails,
  subemitters, strips/slivers) are rejected, not silently approximated. Six
  geometry layer kinds are accepted when they use supported surface features.
- First pass accepts double-sided triangles, additive/alpha/premultiplied
  blending and linear PNGs. Numeric data textures, screen blending, one-sided
  draws and other shader revisions are rejected. URP/HDRP are not supported.
- Soft intersection fading is explicitly disabled with an import warning.
  Particle seed order is retained; camera-dependent particle sorting is not
  implemented. Source lights, environment and post-processing are not imported.
- CPU-expanded instances are capped at 1M vertices per mesh / 2M per effect;
  this is a correctness-first adapter, not a GPU-instancing optimization pass.
- Old optional reference-camera scripts remain packaged, but the importer does
  not create a reference camera or populate legacy preview data. Use your own
  scene camera; do not attach the legacy preview camera to the imported effect.

## Verification

Export the eight-draw fire-projectile effect from AutoV, then pass the downloaded
file to each check on Windows (the fixture is not bundled in this repository):

```powershell
.\unity-plugin\Compile-Plugin.ps1 -Fixture 'C:\Downloads\fire-projectile.avfx'
.\unity-plugin\Test-Plugin.ps1 -Fixture 'C:\Downloads\fire-projectile.avfx'
```

`Compile-Plugin.ps1` compiles runtime/editor assemblies against
Unity 6.0.44 and runs license-independent archive/GLB/ABI tests using the shared
fire-projectile fixture. Tests include corrupt CRC/SHA, unknown shader revisions,
duplicate JSON keys, malformed GLB and truncated archives.

`Test-Plugin.ps1` creates a temporary Unity project, copies the same `.avfx` fixture,
and checks automatic import, prefab instantiation, playback and shader import.
Verified on Windows Unity 6000.0.44f1 / NVIDIA RTX 3060: package compilation,
shared fire-projectile `.avfx` import (eight draws), prefab instantiation,
playback controls and a real offscreen camera render. The inspected 640×360
capture contains the flame body, bright core, smoke and particles (4,733 visible
pixels at one second). All 27 license-independent archive/GLB/ABI checks pass.
The render test also verifies that seeking changes the image and disabling the
player removes the effect from the camera output.

The smoke script writes `avfx-smoke.png` and `unity.log` into its printed temporary
project directory. These are smoke tests, not a claim of engine visual parity.
Interactive inspector UX, scene save/reload, and standalone player builds still
need verification. No changes to your existing Unity project are made by tests.

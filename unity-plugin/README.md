# autoV Unity plugin

Installable Unity Package Manager package: `com.autov.avfx`.
Target: Unity 6 (`6000.0`), **Built-in render pipeline**, desktop shader model 4.5.
URP/HDRP are explicitly rejected by the importer in this first pass.

## Install

Copy `com.autov.avfx` to a permanent local Windows folder. In Unity open
**Window > Package Manager**, choose **Install package from disk**, and select
its `package.json`. Do not also install the old bundle's `Unity/` scripts: those
would duplicate the same classes and shaders. Remove that old adapter folder
before installing this package; keep the exported effect data.

## Import and use

1. Export with the **Export 3D** workflow on `feature/unreal-5.8-vfx-import`.
2. Extract the bundle. Copy its data into a dedicated folder under Unity's
   `Assets` (keep `effect.avfx.json`, `effect.unity.json`, attributes and textures
   in their original relative layout). Do not copy its `Unity/` adapter folder.
3. Select `effect.avfx.json`, then **Assets > autoV > Import selected AVFX**.
4. Drag the generated `Imported/Effect.prefab` into a scene.
5. Select the effect for editor preview, time scrubbing, play/pause, restart,
   loop and speed controls. In Play mode it advances automatically.

`Imported/Preview.prefab` additionally includes the source reference camera and
optional Built-in tone mapping. Use it in an otherwise empty scene, not alongside
another active camera/tone mapper. Its mouse/Space controls require legacy Input
Manager or Both under Active Input Handling. Game effects do not require it.

Runtime API: `AvfxPlayer.Play()`, `Pause()`, `Restart()`, `Seek(seconds)`.

## Format boundary

This packages the working native Unity adapter from commit
`5ebef9e196cb13b2c755b29054ab875c21dd6356` on
`origin/feature/unreal-5.8-vfx-import`. Generated shader ports and the Three.js
license are retained. No arbitrary bundle-provided shader code is loaded.

**It does not import the newer ZIP `.avfx` format used by `src/lib/avfx/export.ts`
and the separate Godot/UE 5.6 plugins.** Both exporters label their data `avfx/0.1`,
but their payload layouts differ. A format bridge is required before the current
Studio's Export AVFX button can feed this Unity package.

Reference-branch limitations remain: camera-dependent sorting follows the export
camera; authored post effects and soft intersection fading are not reproduced.
Editor preview is transient and does not bake playback time every frame.
The shaders are retained unchanged; this packaging does not claim new parity.

## Verification

`Compile-Plugin.ps1` compiles runtime and editor C# separately against installed
Unity assemblies, without starting Unity. `Test-Plugin.ps1` creates an isolated
temporary Windows project and runs playback/path/shader smoke checks in Unity.
Both scripts default to Unity `6000.0.44f1` and accept an installation override.

Verified: runtime/editor C# compile against Unity 6000.0.44f1 assemblies; all 18
shader sources match the reference branch (apart from trailing newlines);
package manifest, editor assembly isolation and unique asset GUID checks pass.

The editor run is currently blocked by the local Unity license (machine bindings
do not match; no valid editor entitlement). Activate through Unity Hub and rerun
the smoke check. Import, rendered appearance and standalone player builds still
need Unity verification; upstream reference captures do not verify this package.

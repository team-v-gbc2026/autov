# Auto V native 3D export — development branch

Based on main `58652df`, branch `feature/engine-vfx-export`. Work in progress; no merge to main.

The Studio header's **Export 3D** action produces native meshes, compact particle attributes, sampled CPU animation, shader ports, textures, source JSON and fixed-camera reference images. It retains 3D geometry and camera-facing particles.

## Verified locally

Apple M4, Unity 6.6 (6000.6.1f1, Built-in/Metal), Godot 4.7.2 (Forward+/Metal).

- Fire Projectile (presentation case): exported 8 draws, imported and rendered at three viewpoints in both engines. Foreground-union RGB MAE: Godot 1.41–3.31/255; Unity 1.32–2.58/255.
- Shield: exported 7 draws, including floating-point lattice data textures. After aligning camera motion and face orientation, Godot 0.20–0.21/255; Unity 0.73–0.85/255.

These measurements describe fixed-time captures of two fixtures, not a guarantee for arbitrary effects. The comparison tool writes difference images and a JSON report. Camera shake/push-in, bloom/other authored post effects, ground scenery and soft intersection fading are outside these captures. CPU animation uses the selected sampling rate; sorting and camera-anchored transforms currently follow the export camera.

## Use a bundle

**Godot:** open `Godot/project.godot`, press Play. Drag to orbit, wheel to zoom, Space to pause. Keep the bundle next to its Godot folder.

**Unity:** install the bundle's `Unity/` scripts and shaders once in `Assets/AutoVAdapters`. Copy the rest of the bundle into its own folder under Assets, select `effect.avfx.json`, then choose **Assets → autoV → Import selected AVFX**. Use `Imported/Effect.prefab` in a game. For the Built-in reference preview, put `Imported/Preview.prefab` in an empty scene and press Play. Do not copy duplicate adapter scripts for each additional effect. The preview camera has orbit/zoom/pause controls and matching ACES color output. URP/HDRP post-processing is not validated.

**Unreal:** minimal importer still being implemented; do not treat the current branch as Unreal-ready.

## Development verification

From `frontend` with Node available:

```sh
node --import tsx --test scripts/engine-export/geometry.test.mts
node node_modules/typescript/bin/tsc --noEmit
node scripts/engine-export/preview.mjs
```

The verification page runs at `http://127.0.0.1:4317/` and writes generated bundles into `.autov-local/engine-export/`. `capture-godot.gd` and `unity/AvfxValidation.cs` capture three matching viewpoints. `compare.mjs` compares those images against the exported references:

```sh
node scripts/engine-export/compare.mjs <bundle> <capture-directory> godot
node scripts/engine-export/compare.mjs <bundle> <capture-directory> unity
```

Adapter sources in `adapters/` must match the browser-distributed copies in `frontend/public/engine-export/`. Unity shaders are generated from Auto V's GLSL reference kernels using glslang and SPIRV-Cross. The generator accepts `AVFX_GLSLANG` and `AVFX_SPIRV_CROSS` tool paths. Generated shaders are checked in; end users do not need the compilers.

Windows / Unreal 5.8 continuation: [self-contained Japanese handoff](WINDOWS-UE58-HANDOFF.ja.md). Unreal implementation and product UI verification remain in progress.

The local presentation uses Fire Projectile and Shield. `prepare-presentation.mjs <destination> <Unity-template-project>` copies exported bundles and launch scripts to a permanent folder. Run from frontend. The template supplies only Packages and ProjectSettings from a Built-in project with legacy input enabled. Unity `AvfxValidation.RunPresentation` imports both scenes and captures them; `AvfxPresentation.Build` builds a standalone macOS app. The app built and rendered Fire Projectile locally; runtime effect-switch UI validation is still pending. See PROGRESS.md for evidence and limitations.

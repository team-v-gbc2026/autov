# Windows / UE progress — 2026-09-17

Source checkout: `feature/engine-vfx-export` at
`bcb7f04502ceb967cfea8c86f7cebe612da638f3`.
Working branch: `feature/unreal-5.8-vfx-import`.

## Measured environment

UE 5.8.2, changelist 56702186; Windows 11 25H2 build 26200.9457;
NVIDIA RTX 5070; D3D12 with PCD3D_SM5; AMD Ryzen 7 7700; 32 GB RAM.
MSVC 14.50.35738; Windows SDK 10.0.22621.0; Node 24.19.0.

All 21 files listed in the outer handoff's SHA256SUMS were verified.
Bundle SHA256 values:

- Fire: `e896c775a2e60e633f3b4265ad6b4a083ac53b0546b1c302b0824f236b8afd31`
- Shield: `0d88d1b435bf0a7d2e7c776cc6f5580e33f299b3c1648de8e72e698e006489de`

## Completed observations

1. C++ Editor factory and Runtime modules built and loaded.
2. Fire imported 8 draws / 231 embedded dependencies; Shield 7 / 16.
   Both commandlets exited successfully with zero reported errors/warnings.
3. Native HLSL compiled. A SPIRV-Cross variable named `half2` collided with UE's
   precision macro; deterministic generation now renames the variable.
4. Both assets rendered from an independently restarted process without reading
   source textures from disk. They contain all dependencies as serialized bytes.
5. Fixed-time 0/90/180 degree captures use manifest time 0.7333333333333333.
   Float player storage prints 0.733333349; frame selection remains 11 at 15 FPS.
6. Initial Fire foreground MAE was 2.637 / 3.524 / 5.852. Supplying PNG mip chains
   and trilinear sampling improved it to **1.473 / 2.137 / 3.448**.
7. Shield foreground MAE is **0.237 / 0.241 / 0.229**. RGBA32F site/attribute
   textures remain uncompressed float, nearest sampled, with no mipmaps or flips.
8. Repeating the capture in a fresh process after world-render integration gave
   numerically identical reference metrics. These are fixed-time fixture metrics,
   not all-time or arbitrary-effect parity claims.
9. The world render path drew Fire/Shield in a regular perspective camera and
   respected an opaque test cube. The initial world implementation undersized
   particle billboards because model-view was in centimetres. A source correction
   keeps shader view-space in metres, restoring cm only in projection.

Small reference captures and world-occlusion evidence accompany this file.
Large transient captures, assets and logs remain in ignored local directories.

## Current blocker and next steps

At 12:23 JST, Smart App Control rejected UE's generated
`Demo/Intermediate/Build/BuildRules/AutoVDemoModuleRules.dll`:
Code Integrity event 3077, error `0x800711C7`. A normal retry also failed. The
security policy was not disabled or bypassed. The user was asked to resolve the
Windows development-machine restriction.

The ZIP reader source (libzip with bounded in-memory reads), the billboard unit
correction and packaging settings were added after the last successful build.
They must not be treated as verified until the following checks pass:

1. Rebuild with `Build.ps1` after the OS restriction is resolved.
2. Import each original `.avfx.zip` to fresh package names using `AutoVImport`;
   compare embedded payloads against the already imported extracted versions.
3. Reject a missing dependency, unknown shader program, invalid float byte count,
   and unsafe ZIP dependency path without mutating existing assets.
4. Repeat reference capture and world smoke test (`-AutoVWorldTest=<directory>`),
   verify particle billboard size and transformed actor placement/occlusion.
5. Visually exercise a full lifetime and loop boundary of both effects, including
   pause/seek/orbit/zoom and editor reload. Fixed-time captures alone are insufficient.
6. Build/package the demo with `Package-Demo.ps1`; launch its `.exe` without the
   Editor and repeat captures. Package and test a distributable plugin ZIP.

No PR or merge to main was performed. Commits are pushed only to the Windows branch.

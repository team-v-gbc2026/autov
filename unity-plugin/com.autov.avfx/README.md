# autoV AVFX for Unity

Unity 6 / Built-in render pipeline. Experimental adapter for the **shared
single-file `.avfx` format**, also used by the Godot and Unreal plugins.

Install this package through Package Manager > Install package from disk.
Remove duplicate old autoV scripts from Assets if present.

Drag a Studio-exported `.avfx` into Assets. Unity automatically imports an effect
with mesh, material and texture subassets. Drag it into your scene and select
the root for editor preview, time scrubbing and playback controls. **No unzip,
`effect.unity.json`, or alternate exporter is needed.** Runtime API:
`AvfxPlayer.Play()`, `Pause()`, `Restart()`, `Seek(seconds)`.

Supported programs are particle and surface, with double-sided triangle meshes
and linear PNG textures. Unknown shader revisions and unsupported programs or
features fail import. URP/HDRP and numeric data textures are not supported yet.
Soft intersection fading is disabled; camera-dependent particle sorting is not
implemented. Imported effects do not include source lighting or post-processing.

The importer reuses trusted Unity shader ports from commit
`5ebef9e196cb13b2c755b29054ab875c21dd6356`, never executes shader text from a bundle,
and validates file hashes, GLBs and shader revisions. Third-party notice:
`THREE-LICENSE.txt`. Shared fire-projectile import and an offscreen render were
verified in Windows Unity 6000.0.44f1. Visual parity and standalone builds remain
unverified.

# autoV AVFX for Unity

Unity 6, Built-in render pipeline. Experimental package.

Install this `package.json` using Package Manager's **Install package from disk**.
Do not install the legacy bundle's `Unity/` scripts alongside this package.

Copy an extracted native Unity export from `feature/unreal-5.8-vfx-import` into
`Assets`, select `effect.avfx.json`, and choose **Assets > autoV > Import selected
AVFX**. Drag `Imported/Effect.prefab` into a scene. The effect inspector provides
editor preview, time scrubbing and playback controls. `Preview.prefab` adds the
reference camera and Built-in tone mapper; it is optional.

Requires `effect.unity.json`, textures and attribute files in the original bundle
layout. This is NOT an importer for the newer ZIP `.avfx` bundle. URP/HDRP are not
supported. Soft intersection fading and authored post effects remain outside
the reference adapter's supported behavior.

Runtime: `AvfxPlayer.Play()`, `Pause()`, `Restart()`, `Seek(seconds)`.
The reference preview camera uses legacy Input Manager; enable it or Both if
using its mouse/Space controls. Effects themselves have no input dependency.

Source adapter and shader ports: reference commit
`5ebef9e196cb13b2c755b29054ab875c21dd6356`. Three.js notice: `THREE-LICENSE.txt`.

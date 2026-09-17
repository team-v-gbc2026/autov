# Unreal 5.8 asset importer — ingestion stage

This directory implements the first, separately verifiable stage of AVFX import. It **does not yet implement mesh playback, particle/surface shaders, Niagara systems, or a presentation map**. Do not treat a successful texture import as VFX reproduction.

## What is implemented

- Read an extracted `avfx/0.1` bundle and resolve shared base geometry and compact attribute references.
- Check referenced files, topology indices, sample timing, dimensions and float data; reject non-finite values and external/traversing paths.
- Convert raw RGBA32F attribute/data textures to uncompressed, full FLOAT OpenEXR without changing rows, channel values or precision. Ordinary PNGs remain unchanged.
- Produce a portable import plan mapping each draw/geometry/uniform texture to its import source.
- UE Editor Python script imports textures to a new Content folder, applies linear sampling/compression/address settings, saves assets and writes a result report. Sources are copied into `Saved/AutoVImports` for stable reimport.

## Verification status

The pure Python preparation was executed on the actual **Fire Projectile** and **Shield** bundles. Fire: 8 draws, 120 texture bindings/sources (111 float). Shield: 7 draws, 8 float sources. An independent OpenEXR 3.4.15 decoder read all **119** generated float textures; every float32 bit matched the original binary, including signed values and HDR range.

**UE 5.8 is not installed on the authoring Mac.** `avfx_import.py` has syntax validation only. Its Unreal API execution, import pipeline selection, resulting source/GPU precision, and texture orientation remain to be validated on Windows. `TC_HDR_F32` is explicitly selected, but this is not proof that Unreal's EXR import/cook path retains all source bits; verify with GPU/readback or a diagnostic material before building the VFX renderer.

## Windows usage

1. Extract each `.avfx.zip` to a separate folder.
2. Prepare data using Python 3.9+ (standard library only):

```powershell
py -3 adapters/unreal/avfx_prepare.py C:\Dev\Bundles\fire-projectile C:\Dev\Prepared\fire-projectile
py -3 adapters/unreal/avfx_prepare.py C:\Dev\Bundles\shield C:\Dev\Prepared\shield
```

The output folder must not already exist. The preparation does not overwrite previous results.

3. In UE 5.8 enable **Python Editor Script Plugin** and **Editor Scripting Utilities**, then restart as required. In the Editor's Python console:

```python
import sys
sys.path.insert(0, r'C:\Dev\autov-ue58\adapters\unreal')
import avfx_import
fire = avfx_import.import_prepared(r'C:\Dev\Prepared\fire-projectile', '/Game/AutoV/Fire')
shield = avfx_import.import_prepared(r'C:\Dev\Prepared\shield', '/Game/AutoV/Shield')
```

Choose new destination folders; existing Content/source-staging folders are preserved. On partial failure the script records the error and leaves imported assets for inspection. Resolve the error and use a fresh destination; no destructive cleanup is automatic.

`Saved/AutoVImports/<destination>/unreal-import-result.json` records the engine version and imported asset paths. `import-plan.json` holds draw-to-asset-source bindings; `Source/effect.avfx.json` retains geometry, animation and uniforms. Saved data is **not** automatically cooked or a runtime asset. The Windows runtime implementation must create proper cookable data/assets and keep texture references alive.

## Next work

Continue with the main [Windows handoff](../../docs/engine-export/WINDOWS-UE58-HANDOFF.ja.md): implement the particle and surface shaders and AVFX player, verify coordinates/blending/depth/color, compare the 3 reference angles, then create a launchable UE demo. Exported base mesh positions alone do not contain the final shader-deformed effect.

Official API references used for this draft: [texture factory](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/TextureFactory), [float32 compression setting](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/TextureCompressionSettings), [asset import task](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetImportTask?application_version=5.7). Consult the installed 5.8 API when validating the editor script.

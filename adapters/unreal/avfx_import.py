"""UE 5.8 Editor asset ingestion, not a VFX player.

Enable Python Editor Script Plugin, add this directory to sys.path, then:
    import avfx_import
    avfx_import.import_prepared(r'C:\\Dev\\PreparedFire', '/Game/AutoV/Fire')

Run avfx_prepare.py outside UE first. No C++ build needed for this stage.
Unreal execution is not verified on the Mac used to implement this script.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil

from avfx_prepare import inside, load_json


def import_prepared(prepared_directory, destination):
    import unreal
    prepared=Path(prepared_directory).resolve()
    plan=load_json(inside(prepared,'import-plan.json'))
    if plan.get('format') != 'avfx-unreal-ingest/0.1': raise ValueError('Unsupported import plan')
    if not re.fullmatch(r'/Game/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*',destination):
        raise ValueError('Use a new /Game/path containing only letters, digits and underscores')
    if unreal.EditorAssetLibrary.does_directory_exist(destination):
        raise ValueError('Destination exists; choose a new folder to preserve previous assets')
    # Verify all prepared sources before importing or writing into the project.
    manifest=inside(prepared,plan['manifest'])
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != plan['manifestSha256']:
        raise ValueError('Manifest checksum mismatch')
    for item in plan['textures']:
        if not re.fullmatch(r'AVFX_[0-9]+',item['assetName']): raise ValueError('Invalid texture name')
        file=inside(prepared,item['importFile'])
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['importSha256']:
            raise ValueError('Texture checksum mismatch: '+item['importFile'])
    # Keep stable reimport sources inside this project; do not link to temp files.
    relative=destination.removeprefix('/Game/')
    source_root=Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())).resolve()/'AutoVImports'/relative
    if source_root.exists(): raise ValueError('Source staging folder exists; use a new destination')
    shutil.copytree(prepared,source_root)
    report={'destination':destination,'sourceDirectory':str(source_root),'textures':{},
            'runtimeImplemented':False,'status':'importing','engine':unreal.SystemLibrary.get_engine_version()}
    report_path=source_root/'unreal-import-result.json'
    try:
        tools=unreal.AssetToolsHelpers.get_asset_tools()
        for item in plan['textures']:
            task=unreal.AssetImportTask()
            task.set_editor_property('filename',str(source_root/item['importFile']))
            task.set_editor_property('destination_path',destination+'/Textures')
            task.set_editor_property('destination_name',item['assetName'])
            task.set_editor_property('automated',True)
            task.set_editor_property('replace_existing',False)
            task.set_editor_property('save',False)
            task.set_editor_property('factory',unreal.TextureFactory())
            tools.import_asset_tasks([task])
            paths=list(task.get_editor_property('imported_object_paths'))
            textures=[unreal.EditorAssetLibrary.load_asset(p) for p in paths]
            textures=[t for t in textures if isinstance(t,unreal.Texture2D)]
            if len(textures)!=1: raise RuntimeError('Expected one Texture2D for '+item['importFile'])
            texture=textures[0]
            is_float=item['kind']=='float'
            texture.set_editor_property('srgb',False)
            texture.set_editor_property('compression_settings',unreal.TextureCompressionSettings.TC_HDR_F32 if is_float else unreal.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
            texture.set_editor_property('filter',unreal.TextureFilter.TF_NEAREST if is_float else unreal.TextureFilter.TF_TRILINEAR)
            texture.set_editor_property('mip_gen_settings',unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS if is_float else unreal.TextureMipGenSettings.TMGS_SIMPLE_AVERAGE)
            address=unreal.TextureAddress.TA_WRAP if item['wrap']=='repeat' else unreal.TextureAddress.TA_CLAMP
            texture.set_editor_property('address_x',address)
            texture.set_editor_property('address_y',address)
            texture.set_editor_property('never_stream',True)
            if not unreal.EditorAssetLibrary.save_loaded_asset(texture): raise RuntimeError('Could not save '+texture.get_path_name())
            report['textures'][item['key']]=texture.get_path_name()
        report['status']='assets_imported_runtime_missing'
        report['next']='Port particle/surface shaders, implement AVFX mesh/player, then verify UE captures. This import does not create a playable effect.'
        unreal.log_warning('AVFX assets imported. Shader port/player are NOT implemented by this script. Result: '+str(report_path))
    except Exception as error:
        report['status']='failed'
        report['error']=str(error)
        raise
    finally:
        report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report

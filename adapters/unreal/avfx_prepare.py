"""Prepare AVFX data for UE texture import; no Unreal/Python dependencies.

This is an asset ingestion stage, NOT an Unreal VFX renderer.
Usage: python avfx_prepare.py <extracted-bundle> <new-output-directory>
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import shutil
import struct
import sys


def load_json(path):
    def invalid(value):
        raise ValueError('Non-finite JSON constant: '+value)
    return json.loads(Path(path).read_text(encoding='utf-8'), parse_constant=invalid)


def inside(root, relative):
    p = PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or '\\' in relative or ':' in relative:
        raise ValueError('Expected a bundle-relative path: '+relative)
    path = (root / relative).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise ValueError('Missing or external bundle file: '+relative)
    return path


def rgba32f_exr(data, width, height):
    """Lossless, little-endian, uncompressed OpenEXR scanlines (FLOAT RGBA).

    Keep row order unchanged. Configure UE as HDR_F32, linear, nearest, no mips.
    The reference bundles were exported on a little-endian host.
    """
    if type(width) is not int or type(height) is not int or not (0 < width <= 16384 and 0 < height <= 16384):
        raise ValueError('Invalid float texture dimensions')
    if len(data) != width * height * 16:
        raise ValueError('Float texture byte length disagrees with dimensions')
    values = array.array('f')
    values.frombytes(data)
    if sys.byteorder != 'little': values.byteswap()
    if not all(math.isfinite(x) for x in values):
        raise ValueError('Float texture contains NaN/Infinity')
    def attr(name, kind, value):
        return name.encode()+b'\0'+kind.encode()+b'\0'+struct.pack('<I',len(value))+value
    channels = b''.join(name+b'\0'+struct.pack('<iB3xii',2,0,1,1) for name in [b'A',b'B',b'G',b'R'])+b'\0'
    bounds = struct.pack('<iiii',0,0,width-1,height-1)
    header = struct.pack('<II',20000630,2)
    header += attr('channels','chlist',channels)+attr('compression','compression',b'\0')
    header += attr('dataWindow','box2i',bounds)+attr('displayWindow','box2i',bounds)
    header += attr('lineOrder','lineOrder',b'\0')+attr('pixelAspectRatio','float',struct.pack('<f',1))
    header += attr('screenWindowCenter','v2f',struct.pack('<ff',0,0))
    header += attr('screenWindowWidth','float',struct.pack('<f',1))+b'\0'
    scan_bytes = width*16
    first = len(header)+height*8
    offsets = b''.join(struct.pack('<Q',first+y*(scan_bytes+8)) for y in range(height))
    result = bytearray(header+offsets)
    for y in range(height):
        result.extend(struct.pack('<iI',y,scan_bytes))
        for component in [3,2,1,0]:
            plane=array.array('f',values[(y*width*4+component):((y+1)*width*4):4])
            if sys.byteorder != 'little': plane.byteswap()
            result.extend(plane.tobytes())
    return bytes(result)


def prepare(bundle, output):
    bundle, output = Path(bundle).resolve(), Path(output).resolve()
    if output.exists(): raise ValueError('Use a new output directory; existing imports are not overwritten')
    manifest_path = inside(bundle,'effect.avfx.json')
    doc = load_json(manifest_path)
    if doc.get('format') != 'avfx/0.1' or doc.get('coordinates') != 'right-handed-y-up-metres':
        raise ValueError('Unsupported AVFX format or coordinates')
    if doc.get('fps') not in (15,30,60) or not 0 < doc.get('duration',0) <= 60:
        raise ValueError('Invalid timing')
    if not doc.get('draws') or not doc.get('geometries'): raise ValueError('Empty AVFX bundle')
    requests = {}
    def request(relative, kind, wrap):
        source=inside(bundle,relative)
        key=relative+'|'+wrap
        if key in requests: return key
        item={'key':key,'source':relative,'kind':kind,'wrap':wrap,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        if kind == 'float':
            meta_path=relative+'.json' if relative.endswith('.rgba32f') else str(PurePosixPath(relative).with_suffix('.json'))
            meta=load_json(inside(bundle,meta_path))
            item.update(width=meta['width'],height=meta['height'])
            # Validate dimensions/data before creating any output files.
            item['_exr']=rgba32f_exr(source.read_bytes(),meta['width'],meta['height'])
        requests[key]=item
        return key
    bindings=[]
    for draw in doc['draws']:
        if not draw.get('samples'): raise ValueError('Draw has no samples: '+draw['id'])
        previous=-1
        attributes={}
        for sample in draw['samples']:
            t=sample['time']
            if not math.isfinite(t) or t < previous or t > doc['duration']+1e-6: raise ValueError('Invalid sample order/time')
            previous=t
            if len(sample['matrix']) != 16: raise ValueError('Expected column-major 4x4 matrix')
            gi=sample['geometry']
            if type(gi) is not int or not 0 <= gi < len(doc['geometries']): raise ValueError('Invalid geometry index')
            g=doc['geometries'][gi]
            base=g['baseGeometry']
            if base >= 0:
                if base >= len(doc['geometries']) or doc['geometries'][base]['baseGeometry'] != -1: raise ValueError('Invalid baseGeometry')
                g=doc['geometries'][base]
            count=len(g['positions'])//3
            if len(g['positions'])%3 or len(g['attributeIndex']) != count: raise ValueError('Invalid expanded vertex map')
            if any(type(i) is not int or i < 0 or i >= count for i in g['indices']): raise ValueError('Invalid topology index')
            relative='attributes/'+draw['id']+'-'+str(gi)+'.bin'
            attributes[str(gi)]=request(relative,'float','clamp')
        textures={name:request(relative,'float' if relative.endswith('.rgba32f') else 'png','repeat' if name=='uNoise' else 'clamp') for name,relative in draw['textures'].items()}
        bindings.append({'draw':draw['id'],'program':draw['program'],'textures':textures,'attributes':attributes})
    report={'format':'avfx-unreal-ingest/0.1','sourceFormat':doc['format'],'name':doc['name'],
        'manifest':'Source/effect.avfx.json','manifestSha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        'runtimeImplemented':False,'unrealExecutionVerified':False,
        'remaining':['UE shader port and AVFX player','UE 5.8 compile/import/render validation','three-view comparison and packaged playback'],
        'bindings':bindings,'textures':[]}
    (output/'Source').mkdir(parents=True)
    (output/'TextureSources').mkdir()
    shutil.copy2(manifest_path,output/'Source/effect.avfx.json')
    for relative in ['source.autov.json']:
        if (bundle/relative).is_file(): shutil.copy2(bundle/relative,output/'Source'/relative)
    for index,item in enumerate(requests.values()):
        item['assetName']='AVFX_'+str(index).zfill(4)
        item['importFile']='TextureSources/'+item['assetName']+('.exr' if item['kind']=='float' else '.png')
        target=output/item['importFile']
        if item['kind']=='float': target.write_bytes(item.pop('_exr'))
        else: shutil.copy2(inside(bundle,item['source']),target)
        item['importSha256']=hashlib.sha256(target.read_bytes()).hexdigest()
        report['textures'].append(item)
    (output/'import-plan.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle'); parser.add_argument('output')
    args=parser.parse_args()
    result=prepare(args.bundle,args.output)
    print(json.dumps({'draws':len(result['bindings']),'textures':len(result['textures']),'runtimeImplemented':False}))

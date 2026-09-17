"""Independent source-vs-EXR check (verification only; pip install OpenEXR numpy).
Usage: python verify_prepared_exr.py <original-bundle> <prepared-directory>
Does not verify Unreal's EXR import or GPU texture representation.
"""
import argparse
from pathlib import Path
import OpenEXR
import numpy as np
from avfx_prepare import inside, load_json

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('bundle'); parser.add_argument('prepared')
args=parser.parse_args()
bundle=Path(args.bundle).resolve(); prepared=Path(args.prepared).resolve()
plan=load_json(inside(prepared,'import-plan.json'))
count=0
for item in plan['textures']:
    if item['kind']!='float': continue
    raw=inside(bundle,item['source']).read_bytes()
    expected=np.frombuffer(raw,dtype='<f4').reshape(item['height'],item['width'],4)
    with OpenEXR.File(str(inside(prepared,item['importFile'])),separate_channels=True) as image:
        actual=np.stack([image.channels()[channel].pixels for channel in 'RGBA'],axis=-1)
    if actual.dtype!=np.float32 or actual.shape!=expected.shape or not np.array_equal(actual.view('uint32'),expected.view('uint32')):
        raise AssertionError('Float32 mismatch: '+item['source'])
    count+=1
print(str(count)+' float textures match source bit-for-bit; Unreal import is not covered.')

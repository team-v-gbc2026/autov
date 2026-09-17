// Run from frontend with node --import tsx. Not a UE material/vertex factory.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { kernels, parseKernel } from '../../src/lib/vfx-lab/engine-export/kernels.ts';
const output='../adapters/unreal/Shaders';
await mkdir(output,{recursive:true});
const manifest={format:'avfx-hlsl-kernels/0.1',coordinateSpace:'right-handed-y-up-metres',unrealIntegrationVerified:false,programs:{}};
for(const name of ['particle','surface']) {
  const source=await readFile(`public/engine-export/Unity/${name}.shader`,'utf8');
  const marker='#if defined(SHADER_STAGE_VERTEX)\n';
  const begin=source.indexOf(marker)+marker.length;
  const split=source.indexOf('\n#else\n',begin);
  const end=source.indexOf('\n#endif\nENDHLSL',split);
  if(begin<marker.length||split<0||end<0) throw Error(`Unexpected generated shader structure: ${name}`);
  // The GLSL local named half2 collides with an HLSL type keyword.
  const vertex=source.slice(begin,split).replace(/\bhalf2\b/g,'avfxHalfExtent');
  const fragment=source.slice(split+'\n#else\n'.length,end).replace('gl_FrontFacing = !stage_input.gl_FrontFacing;', 'gl_FrontFacing = (AVFX_INVERT_FRONT_FACE != 0) ? !stage_input.gl_FrontFacing : stage_input.gl_FrontFacing;');
  const sourceSha256=createHash('sha256').update(source).digest('hex');
  const header=`// Generated from Auto V ${name}; source SHA256 ${sourceSha256}.\n// Host supplies matrices in AVFX source coordinates.\n// UE integration/bindings/blend/depth/cull/GPU precision still need validation.\n// Independent entry point, NOT code to paste into a Material Custom node.\n`;
  const vs=`${name}.vert.usf`,ps=`${name}.frag.usf`;
  await writeFile(`${output}/${vs}`,header+vertex.trimEnd()+'\n');
  await writeFile(`${output}/${ps}`,header+'#ifndef AVFX_INVERT_FRONT_FACE\n#define AVFX_INVERT_FRONT_FACE 0\n#endif\n'+fragment.trimEnd()+'\n');
  const bindings=JSON.parse(await readFile(`public/engine-export/Unity/${name}.bindings.json`,'utf8'));
  const attributes=parseKernel(kernels[name][0]).bindings.filter(b=>b.kind==='attribute');
  manifest.programs[name]={sourceSha256,attributeLayout:{width:1024,fields:attributes,pixel:'row * fields.length + fieldIndex; xy = (pixel % 1024, floor(pixel / 1024))'},vertex:{file:vs,entry:'avfxVertex'},fragment:{file:ps,entry:'avfxFragment'},uniforms:bindings,
    vertexInputs:{POSITION:'float3 source local position',NORMAL:'float3 source local normal',TEXCOORD0:'float2 uv',TEXCOORD1:'float compact attribute row from baseGeometry.attributeIndex'},
    arrays:'Numeric arrays occupy float4 elements. Do not upload packed scalar/float2/float3 arrays.',
    matrices:'row_major HLSL; construct mathematical matrices, not unchecked memcpy of Three column-major arrays.',
    frontFace:'Default preserves source facing. Set AVFX_INVERT_FRONT_FACE only after measuring coordinate/winding conversion.',
    requiredSystemBindings:['modelMatrix','viewMatrix','projectionMatrix','modelViewMatrix','normalMatrix','cameraPosition','avfxAttributes','sampleravfxAttributes']};
}
await writeFile(`${output}/kernels.json`,JSON.stringify(manifest,null,2)+'\n');
console.log('Exported particle/surface HLSL; Unreal render integration remains unimplemented.');

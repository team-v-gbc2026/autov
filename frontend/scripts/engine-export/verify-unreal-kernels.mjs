// Independent HLSL parsing/SPIR-V compilation; NOT an Unreal render test.
// Run from frontend with AVFX_HLSL_VALIDATOR pointing to glslang (HLSL enabled).
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const compiler=process.env.AVFX_HLSL_VALIDATOR;
if(!compiler) throw Error('Set AVFX_HLSL_VALIDATOR to a glslang executable built with ENABLE_HLSL=ON');
const directory='../adapters/unreal/Shaders';
const manifest=JSON.parse(await readFile(`${directory}/kernels.json`,'utf8'));
const output='.autov-local/unreal-hlsl-check';
await mkdir(output,{recursive:true});
const results=[];
for(const [name,program] of Object.entries(manifest.programs)) {
  const original=await readFile(`public/engine-export/Unity/${name}.shader`);
  if(createHash('sha256').update(original).digest('hex')!==program.sourceSha256)
    throw Error(`Stale ${name} kernel; regenerate from current source`);
  for(const [kind,stage] of [['vertex','vert'],['fragment','frag']]) {
    const spec=program[kind];
    for(const face of kind==='fragment'?[0,1]:[0]) {
      const target=`${output}/${name}-${stage}-${face}.spv`;
      execFileSync(compiler,['-D','-V','--auto-map-bindings','--auto-map-locations',`-DAVFX_INVERT_FRONT_FACE=${face}`,'-S',stage,'-e',spec.entry,`${directory}/${spec.file}`,'-o',target],{stdio:'pipe'});
      const binary=await readFile(target);
      if(binary.readUInt32LE(0)!==0x07230203) throw Error('Invalid compiler output');
      results.push({program:name,stage,frontFaceInversion:face,bytes:binary.length});
    }
  }
}
const report={scope:'standalone HLSL parse/compile only; no UE integration or render validation',compiler:execFileSync(compiler,['--version'],{encoding:'utf8'}).trim(),results};
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log(`${results.length} HLSL configurations compiled. Unreal rendering remains unverified.`);

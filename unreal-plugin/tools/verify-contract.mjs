// Offline contract checks against a real export. Does NOT execute Unreal C++.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync } from '../../frontend/node_modules/three/examples/jsm/libs/fflate.module.js';
const fixture=process.argv[2];
if(!fixture)throw new Error('Usage: node tools/verify-contract.mjs /path/effect.avfx');
const files=unzipSync(new Uint8Array(await readFile(fixture)));
const json=path=>JSON.parse(new TextDecoder().decode(files[path]));
const layout=JSON.parse(await readFile(new URL('../AutoVAVFX/Shaders/layout.json',import.meta.url),'utf8'));
const manifest=json('avfx.json'),timeline=json(manifest.timeline);
assert.equal(manifest.version,'avfx/0.1');assert.equal(timeline.interpolation,'step');
for(const entry of manifest.files){assert.equal(files[entry.path].length,entry.bytes);assert.equal(createHash('sha256').update(files[entry.path]).digest('hex'),entry.sha256);}
for(const [program,paths]of Object.entries(manifest.programs)){
  const expected=layout.programs[program];assert.ok(expected,`Unsupported ${program}`);
  for(const [i,stage]of ['vertex','fragment'].entries())assert.equal(createHash('sha256').update(files[paths[stage]]).digest('hex'),expected.hashes[i]);
}
let draws=0,particles=0;
for(const layer of manifest.layers){
  const descriptor=json(layer.path);
  for(const draw of descriptor.draws){
    draws++;
    const abi=layout.programs[draw.program];assert.ok(abi);
    assert.ok(['additive','alpha','premultiplied'].includes(draw.renderState.blend));
    assert.ok(['double','front','back'].includes(draw.renderState.side));
    for(const [name,uniform]of Object.entries(draw.uniforms)){
      if(uniform.value!==undefined){const field=abi.fields[name];assert.ok(field,`Missing ${name}`);assert.equal(field.size,uniform.size??1);}
      if(uniform.binding?.source==='bundle'){assert.ok(layout.textures.includes(name));assert.ok(/\.(png|json)$/.test(uniform.binding.path));assert.equal(uniform.binding.colorSpace,'linear');}
    }
    const samples=timeline.draws[draw.id];assert.equal(samples[0].time,0);
    for(let i=0;i<samples.length;i++){
      const sample=samples[i];assert.ok(sample.time<=manifest.duration);if(i)assert.ok(sample.time>samples[i-1].time);
      assert.equal(sample.matrix.length,16);assert.ok(sample.matrix.every(Number.isFinite));
      assert.ok(files[sample.mesh]);
      if(sample.instances) assert.ok(files[sample.instances]);
      for(const name of Object.keys(sample.uniforms))assert.ok(abi.fields[name]);
    }
    for(const path of new Set([draw.instances,...samples.map(s=>s.instances)].filter(Boolean))){const data=json(path);assert.ok(data.count>0&&data.count<=60000);for(const a of Object.values(data.attributes)){assert.equal(a.count,data.count);assert.equal(a.values.length,a.count*a.itemSize);}}
    if(draw.instances)particles++;
  }
}
assert.ok(draws>0);
console.log(`PASS: archive integrity, trusted shader hashes, uniform layouts, textures, attributes and timelines (${draws} draws / ${particles} instanced draws).`);

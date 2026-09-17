// Offline compiler of TRUSTED repository sources only. Never accepts bundle GLSL.
// Run from frontend: GLSLANG=/path/glslangValidator SPIRV_CROSS=/path/spirv-cross
// node --import tsx ../unreal-plugin/tools/generate-shaders.mjs
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as sources from '../../frontend/src/lib/vfx-lab/shaders-v2.ts';

const root = new URL('../AutoVAVFX/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'avfx-hlsl-'));
const programs = { particle: [sources.particleVertexSource(false, true, true), sources.particleFragmentV2], surface: [sources.surfaceVertexV2, sources.surfaceFragmentV2] };
const attributes = { aSeed: [0, ''], aExtra: [1, ''], aExtra2: [2, ''], aIndex: [3, '.x'], aSrcPos: [4, '.xyz'], aSrcDir: [5, '.xyz'], aEvent: [6, ''], aSub: [7, '.x'] };
const textures = ['uTexture', 'uNoise', 'uAlphaTexture', 'uMask', 'uNormalMap', 'uSites', 'tDepth'];
const tables = {};
await mkdir(new URL('Shaders/Private/', root), {recursive:true});
await mkdir(new URL('Source/AutoVAVFX/Private/Generated/', root), {recursive:true});
for (const [program, stages] of Object.entries(programs)) {
  const fields = new Map();
  const varying = new Map();
  for (const source of stages) {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [, kind, type, names] of stripped.matchAll(/\b(uniform|varying)\s+(\w+)\s+([^;]+);/g)) {
      for (const part of names.split(',')) {
        const [, name, length] = part.trim().match(/^(\w+)(?:\[(\d+)\])?$/);
        if (kind === 'varying') { if (!varying.has(name)) varying.set(name, varying.size); }
        else if (type !== 'sampler2D') fields.set(name, {type, size: length ? +length : 1});
        else if (!textures.includes(name)) textures.splice(textures.length - 1, 0, name);
      }
    }
  }
  for (const name of ['modelMatrix', 'viewMatrix', 'modelViewMatrix', 'projectionMatrix', 'avfxInvProjection']) fields.set(name, {type:'mat4',size:1});
  fields.set('avfxPreExposure', {type:'float',size:1});
  let slot=0;
  for (const field of fields.values()) {field.slot=slot; slot+=field.type==='mat4'?4:field.size;}
  tables[program] = {fields:Object.fromEntries(fields),slots:slot,hashes:stages.map(s=>createHash('sha256').update(s).digest('hex'))};
  for (let stage=0;stage<2;stage++) {
    let source = stages[stage].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    source=source.replace(/\b(?:precision\s+\w+\s+\w+|uniform\s+\w+\s+[^;]+|attribute\s+\w+\s+[^;]+);/g,'');
    source=source.replace(/\bvarying\s+(\w+)\s+([^;]+);/g, (_,type,names)=>names.split(',').map(name=>`layout(location=${varying.get(name.trim())}) ${stage?'in':'out'} ${type} ${name.trim()};`).join('\n'));
    let prefix='#version 450\nlayout(binding=0,std430) readonly buffer AVFXData { vec4 avfxData[]; };\n';
    if (!stage) {
      prefix+='layout(binding=1,std430) readonly buffer AVFXVertices { vec4 avfxVertices[]; };\nlayout(binding=2,std430) readonly buffer AVFXIndices { uint avfxIndices[]; };\nlayout(binding=3,std430) readonly buffer AVFXInstances { vec4 avfxInstances[]; };\n';
      prefix+='#define position (avfxVertices[avfxIndices[gl_VertexIndex]*3].xyz)\n#define normal (avfxVertices[avfxIndices[gl_VertexIndex]*3+1].xyz)\n#define uv (avfxVertices[avfxIndices[gl_VertexIndex]*3+2].xy)\n';
      for (const [name,[column,swizzle]] of Object.entries(attributes)) prefix+=`#define ${name} (avfxInstances[gl_InstanceIndex*8+${column}]${swizzle})\n`;
    } else prefix+='layout(location=0) out vec4 avfxColor;\n#define gl_FragColor avfxColor\n';
    for (const [name,field] of fields) {
      const suffix={float:'.x',int:'.x',vec2:'.xy',vec3:'.xyz',vec4:''}[field.type];
      if (field.type==='mat4') prefix+=`#define ${name} mat4(avfxData[${field.slot}],avfxData[${field.slot+1}],avfxData[${field.slot+2}],avfxData[${field.slot+3}])\n`;
      else if (field.size>1) {
        // Arrays become accessor functions; preserve dynamic curve indexing.
        prefix+=`${field.type} avfx_${name}(int i){return ${field.type}(avfxData[${field.slot}+i]${suffix});}\n`;
        const re=new RegExp(`\\b${name}\\s*\\[`, 'g');
        source=source.replace(re,`avfx_${name}(`);
        let start=0;
        while((start=source.indexOf(`avfx_${name}(`,start))>=0){
          let pos=start+name.length+6,depth=0;
          for(;pos<source.length;pos++){if(source[pos]==='[')depth++;else if(source[pos]===']'){if(depth===0){source=source.slice(0,pos)+')'+source.slice(pos+1);break;}depth--;}}
          start=pos+1;
        }
      } else prefix+=`#define ${name} ${field.type}(avfxData[${field.slot}]${suffix})\n`;
    }
    for(let i=0;i<textures.length;i++) prefix+=`layout(binding=${4+i}) uniform sampler2D ${textures[i]};\n`;
    source=source.replace(/texture2D\(/g,'texture(');
    if(stage){
      // UE reversed-Z scene depth; shader distances remain in source meters.
      source=source.replace(/float softDepth\(\)\s*\{[^}]*\}/, `float softDepth(){if(uSoft<=0.)return 1.; vec4 s=avfxInvProjection*vec4(0.,0.,texture(tDepth,gl_FragCoord.xy/uResolution).r,1.); vec4 f=avfxInvProjection*vec4(0.,0.,gl_FragCoord.z,1.); return clamp((abs(s.z/s.w)-abs(f.z/f.w))*.01/uSoft,0.,1.);}`);
      source=source.replace(/void main\s*\(/,'void avfxMain(');
      source+='\nvoid main(){avfxMain(); gl_FragColor.rgb*=avfxPreExposure;}\n';
    }
    for (const [block, member] of [['AVFXData','avfxData'],['AVFXVertices','avfxVertices'],['AVFXIndices','avfxIndices'],['AVFXInstances','avfxInstances']]) {
      prefix=prefix.replace(`buffer ${block} {`, `buffer ${block}Block {`).replace(new RegExp(`(${member}\\[\\]; \\});`), `$1 ${block};\n#define ${member} ${block}.${member}`);
    }
    // HLSL reserves these identifiers even though GLSL permits them.
    source=source.replace(/\bhalf\b/g,'avfx_half').replace(/\bhalf2\b/g,'avfx_half2');
    const name=program+(stage?'PS':'VS'), path=join(temp,name+(stage?'.frag':'.vert'));
    await writeFile(path,prefix+source);
    execFileSync(process.env.GLSLANG||'glslangValidator',['-V',path,'-o',path+'.spv'],{stdio:'pipe'});
    execFileSync(process.env.SPIRV_CROSS||'spirv-cross',[path+'.spv','--hlsl','--shader-model','50','--output',path+'.hlsl'],{stdio:'pipe'});
    let hlsl=await readFile(path+'.hlsl','utf8');
    // Unreal binds reflection names; explicit register locations are not needed.
    hlsl=hlsl.replace(/\s*:\s*register\([^)]+\)/g,'');
    hlsl=hlsl.replace(/\bmain\(/g,stage?'MainPS(':'MainVS(');
    await writeFile(new URL(`Shaders/Private/${name}.usf`,root),'// Generated from trusted autoV sources; do not edit.\n'+hlsl);
    // Independently compile generated HLSL, catching cross-compiler failures.
    const result=fileURLToPath(new URL(`Shaders/Private/${name}.usf`,root));
    execFileSync(process.env.GLSLANG||'glslangValidator',['-D','-V','-S',stage?'frag':'vert','-e',stage?'MainPS':'MainVS','--auto-map-bindings',result,'-o',join(temp,name+'-roundtrip.spv')],{stdio:'pipe'});
  }
}
await writeFile(new URL('Shaders/layout.json',root),JSON.stringify({programs:tables,textures},null,2)+'\n');
const cpp=['// Generated shader ABI; source hashes are migration guards, not signatures.'];
for(const [program,table]of Object.entries(tables)){
  cpp.push(`if (Program == TEXT("${program}")) { Layout.Slots=${table.slots}; Layout.VertexHash=TEXT("${table.hashes[0]}"); Layout.FragmentHash=TEXT("${table.hashes[1]}");`);
  for(const [name,f]of Object.entries(table.fields))cpp.push(`Layout.Fields.Add(TEXT("${name}"), {${f.slot},${f.size},${{float:1,int:1,vec2:2,vec3:3,vec4:4,mat4:16}[f.type]}});`);
  cpp.push('return true; }');
}
cpp.push('return false;');
await writeFile(new URL('Source/AutoVAVFX/Private/Generated/Layout.inl',root),cpp.join('\n')+'\n');
console.log('Generated and round-trip compiled four Unreal HLSL shaders.', {temp,textures});

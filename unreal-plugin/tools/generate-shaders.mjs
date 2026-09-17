// Offline compiler of TRUSTED repository sources only. Never accepts bundle GLSL.
// Run from frontend: GLSLANG=/path/glslangValidator SPIRV_CROSS=/path/spirv-cross
// node --import tsx ../unreal-plugin/tools/generate-shaders.mjs
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { kernels as programs, parseKernel } from '../../tools/avfx/kernels.ts';

const root = new URL('../AutoVAVFX/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'avfx-hlsl-'));
const textures = ['uTexture', 'uNoise', 'uAlphaTexture', 'uMask', 'uNormalMap', 'uSites', 'tDepth'];
const tables = {};
await mkdir(new URL('Shaders/Private/', root), {recursive:true});
await mkdir(new URL('Source/AutoVAVFX/Private/Generated/', root), {recursive:true});
for (const [program, stages] of Object.entries(programs)) {
  const attributes = parseKernel(stages[0]).bindings.filter(b=>b.kind==='attribute');
  const stride=3+attributes.length;
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
  fields.set('cameraPosition', {type:'vec3',size:1});
  fields.set('normalMatrix', {type:'mat3',size:1});
  let slot=0;
  for (const field of fields.values()) {field.slot=slot; slot+=field.type==='mat4'?4:field.type==='mat3'?3:field.size;}
  tables[program] = {attributes,fields:Object.fromEntries(fields),slots:slot,hashes:stages.map(s=>createHash('sha256').update(s).digest('hex'))};
  for (let stage=0;stage<2;stage++) {
    let source = stages[stage].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    source=source.replace(/\b(?:precision\s+\w+\s+\w+|uniform\s+\w+\s+[^;]+|attribute\s+\w+\s+[^;]+);/g,'');
    source=source.replace(/\bvarying\s+(\w+)\s+([^;]+);/g, (_,type,names)=>names.split(',').map(name=>`layout(location=${varying.get(name.trim())}) ${stage?'in':'out'} ${type} ${name.trim()};`).join('\n'));
    let prefix='#version 450\nlayout(binding=0,std430) readonly buffer AVFXData { vec4 avfxData[]; };\n';
    if (!stage) {
      prefix+='layout(binding=1,std430) readonly buffer AVFXVertices { vec4 avfxVertices[]; };\nlayout(binding=2,std430) readonly buffer AVFXIndices { uint avfxIndices[]; };\nlayout(binding=3,std430) readonly buffer AVFXInstances { vec4 avfxInstances[]; };\n';
      prefix+=`#define position (avfxVertices[avfxIndices[gl_VertexIndex]*${stride}].xyz)\n#define normal (avfxVertices[avfxIndices[gl_VertexIndex]*${stride}+1].xyz)\n#define uv (avfxVertices[avfxIndices[gl_VertexIndex]*${stride}+2].xy)\n`;
      attributes.forEach((a,i)=>{prefix+=`#define ${a.name} (avfxVertices[avfxIndices[gl_VertexIndex]*${stride}+${3+i}]${{float:'.x',vec2:'.xy',vec3:'.xyz',vec4:''}[a.type]})\n`;});
    } else prefix+='layout(location=0) out vec4 avfxColor;\n#define gl_FragColor avfxColor\n';
    for (const [name,field] of fields) {
      const suffix={float:'.x',int:'.x',vec2:'.xy',vec3:'.xyz',vec4:''}[field.type];
      if (field.type==='mat4') prefix+=`#define ${name} mat4(avfxData[${field.slot}],avfxData[${field.slot+1}],avfxData[${field.slot+2}],avfxData[${field.slot+3}])\n`;
      else if(field.type==='mat3') prefix+=`#define ${name} mat3(avfxData[${field.slot}].xyz,avfxData[${field.slot+1}].xyz,avfxData[${field.slot+2}].xyz)\n`;
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
    await writeFile(new URL(`Shaders/Private/${name}.usf`,root),'// Generated from trusted autoV sources; do not edit.\n#ifndef AVFX_STANDALONE\n#include "/Engine/Public/Platform.ush"\n#endif\n'+hlsl);
    // Independently compile generated HLSL, catching cross-compiler failures.
    const result=fileURLToPath(new URL(`Shaders/Private/${name}.usf`,root));
    execFileSync(process.env.GLSLANG||'glslangValidator',['-D','-DAVFX_STANDALONE=1','-V','-S',stage?'frag':'vert','-e',stage?'MainPS':'MainVS','--auto-map-bindings',result,'-o',join(temp,name+'-roundtrip.spv')],{stdio:'pipe'});
  }
}
await writeFile(new URL('Shaders/layout.json',root),JSON.stringify({programs:tables,textures},null,2)+'\n');
const cpp=['// Generated shader ABI; source hashes are migration guards, not signatures.'];
for(const [program,table]of Object.entries(tables)){
  cpp.push(`if (Program == TEXT("${program}")) { Layout.Slots=${table.slots}; Layout.VertexHash=TEXT("${table.hashes[0]}"); Layout.FragmentHash=TEXT("${table.hashes[1]}");`);
  for(const [name,f]of Object.entries(table.fields))cpp.push(`Layout.Fields.Add(TEXT("${name}"), {${f.slot},${f.size},${{float:1,int:1,vec2:2,vec3:3,vec4:4,mat3:9,mat4:16}[f.type]}});`);
  for(const a of table.attributes) cpp.push(`Layout.Attributes.Add(TEXT("${a.name}")); Layout.AttributeWidths.Add(${{float:1,vec2:2,vec3:3,vec4:4}[a.type]});`);
  cpp.push('return true; }');
}
cpp.push('return false;');
await writeFile(new URL('Source/AutoVAVFX/Private/Generated/Layout.inl',root),cpp.join('\n')+'\n');
await writeFile(new URL('Source/AutoVAVFX/Private/Generated/Shaders.inl',root),Object.keys(programs).map(p=>`AVFX_SHADER_CLASS(FAVFX_${p}VS)\nAVFX_SHADER_CLASS(FAVFX_${p}PS)\nIMPLEMENT_GLOBAL_SHADER(FAVFX_${p}VS,"/Plugin/AutoVAVFX/Private/${p}VS.usf","MainVS",SF_Vertex);\nIMPLEMENT_GLOBAL_SHADER(FAVFX_${p}PS,"/Plugin/AutoVAVFX/Private/${p}PS.usf","MainPS",SF_Pixel);`).join('\n'));
await writeFile(new URL('Source/AutoVAVFX/Private/Generated/Dispatch.inl',root),Object.keys(programs).map(p=>`if(Draw.Program==TEXT("${p}")) AVFXDrawPass<FAVFX_${p}VS,FAVFX_${p}PS>(Graph,View,P,Draw);`).join('\n'));
console.log(`Generated and round-trip compiled ${Object.keys(programs).length*2} Unreal HLSL shaders.`, {temp,textures});

/** Regenerate the native kernels with Khronos glslang + SPIRV-Cross.
 * Tool paths are explicit; these are development tools, never shipped in the browser. */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { kernels, parseKernel } from '../../src/lib/vfx-lab/engine-export/kernels';
const require = createRequire(import.meta.url);
const glslangFactory = require(process.env.AVFX_GLSLANG || '@webgpu/glslang');
const cross = process.env.AVFX_SPIRV_CROSS || 'spirv-cross';
const glslang = glslangFactory();
const out = 'public/engine-export/Unity';
const temp = '.autov-local/native-kernels'; mkdirSync(out, {recursive:true}); mkdirSync(temp,{recursive:true});
for (const [name, pair] of Object.entries(kernels)) {
  const parsed = pair.map(parseKernel);
  const attrs = parsed[0].bindings.filter(b => b.kind === 'attribute');
  const vars = parsed[0].bindings.filter(b => b.kind === 'varying');
  const uniformMap = new Map(parsed.flatMap(s=>s.bindings).filter(b=>b.kind==='uniform').map(b=>[b.name,b]));
  const uniforms = [...uniformMap.values()];
  const numeric = uniforms.filter(b=>b.type!=='sampler2D');
  const textures = uniforms.filter(b=>b.type==='sampler2D');
  const matrixBlock = ['modelMatrix','viewMatrix','projectionMatrix','modelViewMatrix'].map(n=>`mat4 ${n};`).join('\n')+'\nmat3 normalMatrix;\nvec3 cameraPosition;';
  const block = `layout(set=0,binding=0,std140) uniform UnityPerMaterial {\n${matrixBlock}\n${numeric.map(b=>`${b.type} ${b.name}${b.size?`[${b.size}]`:''};`).join('\n')}\n};`;
  const samplerBlock = [...textures.map(b=>b.name),'avfxAttributes'].map((n,i)=>`layout(set=0,binding=${i+1}) uniform sampler2D ${n};`).join('\n');
  const codes = parsed.map((p, stage) => {
    const vertex = stage === 0;
    const input = vertex ? `layout(location=0) in vec3 position;\nlayout(location=1) in vec3 normal;\nlayout(location=2) in vec2 uv;\nlayout(location=3) in float avfxVertexIndex;\n${attrs.map(b=>`${b.type} ${b.name};`).join('\n')}` : 'layout(location=0) out vec4 avfxColor;';
    const vary = vars.map((b,i)=>`layout(location=${i}) ${vertex?'out':'in'} ${b.type} ${b.name};`).join('\n');
    let body = p.body.replace(/\btexture2D\b/g,'texture').replace(/\bgl_FragColor\b/g,'avfxColor');
    if (vertex) body=body.replace(/void main\s*\(\s*\)\s*\{/, `void main(){\n${attrs.map((b,i)=>`${b.name}=texelFetch(avfxAttributes,ivec2((int(avfxVertexIndex)*${attrs.length}+${i})%1024,(int(avfxVertexIndex)*${attrs.length}+${i})/1024),0)${b.type==='float'?'.x':b.type==='vec2'?'.xy':b.type==='vec3'?'.xyz':''};`).join('\n')}`);
    const source=`#version 450\n${block}\n${samplerBlock}\n${input}\n${vary}\n${body}`;
    writeFileSync(`${temp}/${name}.${vertex?'vert':'frag'}`,source);
    const spirv=glslang.compileGLSL(source,vertex?'vertex':'fragment',false);
    const file=`${temp}/${name}.${stage}.spv`;writeFileSync(file,Buffer.from(spirv.buffer));
    let hlsl=execFileSync(cross,[file,'--hlsl','--shader-model','50'],{encoding:'utf8'});
    // Unity's material property names must match exported uniform names.
    hlsl=hlsl.replace(/\b_\d+_(\w+)/g,'$1');
    hlsl=hlsl.replace(/\b_(\w+)_sampler\b/g,'sampler$1');
    hlsl=hlsl.replace(/\s*:\s*packoffset\([^)]*\)/g,'');
    // Unity's legacy property binding populates $Globals, not a custom block.
    hlsl=hlsl.replace(/cbuffer UnityPerMaterial\s*:\s*register\([^)]*\)\s*\{([\s\S]*?)\};/g,'$1');
    hlsl=hlsl.replace(/\s*:\s*register\([^)]*\)/g,'');
    // Unity SetVectorArray uploads float4 elements. Metal packs float2/3 arrays
    // differently, so give every exported array an explicit four-float stride.
    for (const b of numeric.filter(b => b.size)) {
      const type = b.type === 'float' ? 'float' : b.type.replace('vec','float');
      const components = b.type === 'float' ? 'x' : b.type === 'vec2' ? 'xy' : b.type === 'vec3' ? 'xyz' : '';
      if (!components) continue;
      const declaration = new RegExp(`\\b${type}\\s+${b.name}\\[${b.size}\\]`);
      hlsl = hlsl.replace(declaration, `float4 AVFX_ARRAY_DECL_${b.name}[${b.size}]`);
      hlsl = hlsl.replace(new RegExp(`\\b${b.name}\\[([^\\]]+)\\]`, 'g'), `${b.name}[$1].${components}`);
      hlsl = hlsl.replace(`AVFX_ARRAY_DECL_${b.name}`, b.name);
    }
    hlsl=hlsl.replace(/\bmain\(/g,vertex?'avfxVertex(':'avfxFragment(');
    hlsl=hlsl.replace(/\bSV_Target0\b/g,'SV_Target');
    hlsl=hlsl.replace('gl_FrontFacing = stage_input.gl_FrontFacing;', 'gl_FrontFacing = !stage_input.gl_FrontFacing;');
    if (vertex) hlsl=hlsl.replace(/struct SPIRV_Cross_Input\s*\{([\s\S]*?)\};/, (_all, body: string) => `struct SPIRV_Cross_Input {${body.replace(/(\bposition\s*:)\s*TEXCOORD0/g,'$1 POSITION').replace(/(\bnormal\s*:)\s*TEXCOORD1/g,'$1 NORMAL').replace(/(\buv\s*:)\s*TEXCOORD2/g,'$1 TEXCOORD0').replace(/(\bavfxVertexIndex\s*:)\s*TEXCOORD3/g,'$1 TEXCOORD1')}};`);
    return hlsl;
  });
  // Keep independent SPIRV-Cross globals and entry points in stage branches.
  const shader=`Shader "autoV/Native/${name}" { Properties { ${[...textures.map(b=>b.name),'avfxAttributes'].map(n=>`${n} ("${n}", 2D) = "white" {}`).join(' ')} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]\nHLSLPROGRAM\n#pragma target 4.5\n#pragma vertex avfxVertex\n#pragma fragment avfxFragment\n#if defined(SHADER_STAGE_VERTEX)\n${codes[0]}\n#else\n${codes[1]}\n#endif\nENDHLSL\n} } }`;
  writeFileSync(`${out}/${name}.shader`,shader);
  writeFileSync(`${out}/${name}.bindings.json`,JSON.stringify(uniforms));
  console.log(name);
}

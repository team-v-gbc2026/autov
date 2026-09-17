/** Offline, trusted source port. Never run against shader text from a bundle.
 * From frontend: node --import tsx ../godot-plugin/tools/generate-shaders.mjs
 * Generated shaders are shipped; users do not need Node/Three.js.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as sources from "../../frontend/src/lib/vfx-lab/shaders-v2.ts";

const root = new URL("../addons/autov_avfx/", import.meta.url);
const programs = {
  particle: [sources.particleVertexSource(false, true, true), sources.particleFragmentV2],
  surface: [sources.surfaceVertexV2, sources.surfaceFragmentV2],
};
const hashes = {};

function items(code) {
  code = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const result = [];
  let depth = 0, start = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") depth++;
    if (code[i] === "}") depth--;
    if ((code[i] === ";" || code[i] === "}") && depth === 0) {
      const item = code.slice(start, i + 1).trim();
      if (item) result.push(item);
      start = i + 1;
    }
  }
  if (depth || code.slice(start).trim()) throw new Error("Unparsed GLSL declaration");
  return result;
}

const soft = `float softDepth(vec2 screen_uv, mat4 inv_projection, float fragment_depth) {
  if(uSoft<=0.0) return 1.0;
  float sd=texture(tDepth,screen_uv).r;
  vec3 sn=vec3(screen_uv*2.0-1.0,sd);
  vec3 fn=vec3(screen_uv*2.0-1.0,fragment_depth);
  #if CURRENT_RENDERER == RENDERER_COMPATIBILITY
  sn.z=sd*2.0-1.0;
  fn.z=fragment_depth*2.0-1.0;
  #endif
  vec4 sp=inv_projection*vec4(sn,1.0);
  vec4 fp=inv_projection*vec4(fn,1.0);
  return clamp((-sp.z/sp.w+fp.z/fp.w)/uSoft,0.0,1.0);
}`;

function translate(code, stage) {
  const entry = /\bvoid main\s*\(/.test(code);
  code = code.replace(/\bvoid main\s*\(/, `void ${stage}(`);
  const mapping = { position: "VERTEX", normal: "NORMAL", uv: "UV", modelMatrix: "MODEL_MATRIX",
    modelViewMatrix: "MODELVIEW_MATRIX", viewMatrix: "VIEW_MATRIX", projectionMatrix: "PROJECTION_MATRIX",
    gl_Position: "POSITION", gl_FrontFacing: "FRONT_FACING", texture2D: "texture" };
  for (const [from, to] of Object.entries(mapping)) {
    if (["position", "normal", "uv"].includes(from) && !entry) continue;
    code = code.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  code = code.replace(/\binstance\b/g, "avfx_instance");
  // Processor functions cannot return in Godot. Source entry-point early exits
  // are outside loops, so a single-iteration loop preserves their semantics.
  if (entry && /\breturn\s*;/.test(code)) {
    code = code.replace("{", "{ for(int avfx_once=0;avfx_once<1;avfx_once++) {")
      .replace(/\breturn\s*;/g, "break;").replace(/}\s*$/, "} }");
  }
  code = code.replace(/mat2\(([^(),]+),([^(),]+),([^(),]+),([^(),]+)\)/g, "mat2(vec2($1,$2),vec2($3,$4))");
  code = code.replace(/\bsoftDepth\(\)/g, "softDepth(SCREEN_UV,INV_PROJECTION_MATRIX,FRAGCOORD.z)");
  code = code.replace(/\bgl_FragColor\s*=\s*([^;]+);/g,
    `{ vec4 avfx_out=$1; ALBEDO=avfx_out.rgb*(avfx_blend_kind<2 ? avfx_out.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : avfx_out.a; }`);
  const attrs = {aSeed:0, aExtra:1, aExtra2:2, aIndex:3, aSrcPos:4, aSrcDir:5, aEvent:6};
  for (const [name, column] of Object.entries(attrs)) {
    const swizzle = name === "aIndex" ? ".x" : ["aSrcPos", "aSrcDir"].includes(name) ? ".xyz" : "";
    code = code.replace(new RegExp(`\\b${name}\\b`, "g"), `avfxAttr(UV2.x,${column})${swizzle}`);
  }
  return code;
}

await fs.mkdir(new URL("shaders/", root), { recursive: true });
for (const [program, [vertex, fragment]] of Object.entries(programs)) {
  hashes[program] = { vertex: createHash("sha256").update(vertex).digest("hex"), fragment: createHash("sha256").update(fragment).digest("hex") };
  const globals = new Map(), functions = new Map();
  let killBody = "";
  const entries = [];
  for (const [stage, code] of [["vertex", vertex], ["fragment", fragment]]) {
    for (let item of items(code)) {
      if (/^precision\b/.test(item)) continue;
      const declaration = item.match(/^(uniform|varying|attribute)\s+(\w+)\s+([^;]+);$/);
      if (declaration) {
        const [, kind, type, names] = declaration;
        if (kind === "attribute") continue;
        for (const name of names.split(",").map(x => x.trim())) {
          const id = name.replace(/\[.*$/, "");
          let hint = "";
          if (type === "sampler2D") hint = id === "tDepth" ? " : hint_depth_texture, filter_nearest, repeat_disable"
            : id === "uNoise" ? " : filter_linear_mipmap, repeat_enable"
            : id === "uSites" ? " : filter_nearest, repeat_disable" : " : filter_linear_mipmap, repeat_disable";
          const entry = `${kind} ${type} ${name}${hint};`;
          if (globals.has(id) && globals.get(id) !== entry) throw new Error(`Conflicting global ${id}`);
          globals.set(id, entry);
        }
        continue;
      }
      const func = item.match(/^\w+\s+(\w+)\s*\(/);
      if (!func) throw new Error(`Unsupported global: ${item.slice(0, 80)}`);
      const name = func[1];
      if (name === "kill") { killBody = item.slice(item.indexOf("{") + 1, -1); continue; }
      if (name === "main") { entries.push([stage, item]); continue; }
      if (name === "linDepth") continue;
      if (name === "softDepth") item = soft;
      else item = translate(item, stage);
      if (functions.has(name) && functions.get(name).replace(/\s/g, "") !== item.replace(/\s/g, "")) throw new Error(`Conflicting function ${name}`);
      functions.set(name, item);
    }
  }
  const header = `// Generated by tools/generate-shaders.mjs from trusted autoV source.\nshader_type spatial;\nrender_mode unshaded, fog_disabled, cull_disabled, depth_draw_never, blend_premul_alpha, shadows_disabled;\nuniform int avfx_blend_kind=1;\n`;
  const attributes = program === "particle" ? `uniform sampler2D avfx_attributes : filter_nearest, repeat_disable;
vec4 avfxAttr(float index, int column) { int p=int(index)*8+column; return texelFetch(avfx_attributes,ivec2(p%1024,p/1024),0); }
` : "";
  const result = header + [...globals.values()].join("\n") + "\n" + attributes + [...functions.values()].join("\n\n") + "\n" +
    entries.map(([stage, code]) => translate(code.replace(/kill\(\);/g, killBody), stage)).join("\n\n") + "\n";
  await fs.writeFile(new URL(`shaders/${program}.gdshader`, root), result);
}
await fs.writeFile(new URL("shader_versions.gd", root), `# Generated source fingerprints; never compile shader text from an archive.\nextends RefCounted\nconst EXPECTED = ${JSON.stringify(hashes, null, 2)}\n`);
console.log("Generated Godot particle/surface shaders and source fingerprints.");

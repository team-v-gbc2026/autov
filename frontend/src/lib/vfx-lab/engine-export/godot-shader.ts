import { kernels, parseKernel, type Binding } from "./kernels";

function addArgument(source: string, names: Set<string>) {
  const pattern = /\b([A-Za-z_]\w*)\s*\(/g;
  const edits: { at: number; text: string }[] = [];
  for (let m; (m = pattern.exec(source));) {
    if (!names.has(m[1])) continue;
    const start = pattern.lastIndex;
    let end = start, depth = 1;
    for (; end < source.length && depth; end++) {
      if (source[end] === "(") depth++;
      if (source[end] === ")") depth--;
    }
    edits.push({ at: end - 1, text: `${source.slice(start, end - 1).trim() ? ", " : ""}avfx` });
  }
  for (const e of edits.sort((a,b) => b.at-a.at)) source = source.slice(0, e.at) + e.text + source.slice(e.at);
  return source;
}

function stage(source: string, prefix: string, vertex: boolean) {
  const parsed = parseKernel(source);
  const vars = parsed.bindings.filter(b => b.kind !== "uniform");
  const extras = vertex ? [
    { name: "position", type: "vec3" }, { name: "normal", type: "vec3" }, { name: "uv", type: "vec2" },
    { name: "gl_Position", type: "vec4" }, { name: "modelMatrix", type: "mat4" },
    { name: "modelViewMatrix", type: "mat4" }, { name: "projectionMatrix", type: "mat4" },
    { name: "viewMatrix", type: "mat4" }, { name: "normalMatrix", type: "mat3" },
    { name: "cameraPosition", type: "vec3" },
  ] : [{ name: "gl_FragColor", type: "vec4" }, { name: "gl_FragCoord", type: "vec4" }, { name: "gl_FrontFacing", type: "bool" }, { name: "viewMatrix", type: "mat4" }];
  const fields = [...vars, ...extras];
  const context = `${prefix}Context`;
  const functions: { name: string; type: string; args: string; body: string }[] = [];
  const header = /\b(void|float|int|bool|vec[234]|mat[234])\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  for (let m; (m = header.exec(parsed.body));) {
    let end = header.lastIndex, depth = 1;
    for (; end < parsed.body.length && depth; end++) {
      if (parsed.body[end] === "{") depth++;
      if (parsed.body[end] === "}") depth--;
    }
    functions.push({ name: m[2], type: m[1], args: m[3], body: parsed.body.slice(header.lastIndex, end - 1) });
    header.lastIndex = end;
  }
  // All reference kernels use function-local constants. Fail closed if that changes.
  let remainder = parsed.body;
  for (const f of functions) {
    const re = new RegExp(`\\b${f.type}\\s+${f.name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = re.exec(remainder)!;
    let end = m.index + m[0].length, depth = 1;
    for (; end < remainder.length && depth; end++) { if (remainder[end] === "{") depth++; if (remainder[end] === "}") depth--; }
    remainder = remainder.slice(0, m.index) + remainder.slice(end);
  }
  if (remainder.trim()) throw new Error(`Unsupported global shader code: ${remainder.slice(0, 100)}`);
  const names = new Set(functions.map(f => f.name));
  const code = functions.map(f => {
    const shadow = new Set([...`${f.args};${f.body}`.matchAll(/\b(?:float|int|bool|vec[234]|mat[234])\s+(\w+)/g)].map(m => m[1]));
    let body = f.body;
    for (const field of fields) if (!shadow.has(field.name))
      body = body.replace(new RegExp(`\\b${field.name}\\b`, "g"), `avfx.${field.name}`);
    body = addArgument(body, names);
    for (const name of names) body = body.replace(new RegExp(`\\b${name}\\s*\\(`, "g"), `${prefix}_${name}(`);
    body = body.replace(/\btexture2D\b/g, "texture");
    body = body.replace(/\binstance\b/g, "avfxInstance").replace(/\bmat2\s*\(/g, "avfxMat2(");
    return `${f.type} ${prefix}_${f.name}(${f.args}${f.args.trim() ? ", " : ""}inout ${context} avfx) {${body}}`;
  }).join("\n");
  return { bindings: parsed.bindings, fields, context, code: `struct ${context} {\n${fields.map(b => `${b.type} ${b.name};`).join("\n")}\n};\n${code}` };
}

export function godotShader(program: string, blend: string, depthTest = true, depthWrite = false, side = "double") {
  if (!kernels[program]) throw new Error(`Unknown native program ${program}`);
  const v = stage(kernels[program][0], "avfxV", true);
  const f = stage(kernels[program][1], "avfxF", false);
  const uniforms = new Map<string, Binding>();
  for (const b of [...v.bindings, ...f.bindings]) if (b.kind === "uniform") uniforms.set(b.name, b);
  const varyings = v.bindings.filter(b => b.kind === "varying");
  const attrs = v.bindings.filter(b => b.kind === "attribute");
  const declarations = [...uniforms.values()].map(b => `uniform ${b.type} ${b.name}${b.size ? `[${b.size}]` : ""}${b.type === "sampler2D" ? ` : ${b.name === "uSites" ? "filter_nearest" : "filter_linear_mipmap"}, ${b.name.toLowerCase().includes("noise") ? "repeat_enable" : "repeat_disable"}` : ""};`).join("\n");
  const swizzle = (type: string) => type === "float" ? ".x" : type === "vec2" ? ".xy" : type === "vec3" ? ".xyz" : "";
  return `shader_type spatial;
render_mode unshaded, ${side === "front" ? "cull_front" : side === "back" ? "cull_back" : "cull_disabled"}, fog_disabled, blend_premul_alpha, ${depthWrite ? "depth_draw_always" : "depth_draw_never"}${depthTest ? "" : ", depth_test_disabled"};
${declarations}
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
${varyings.map(b => `varying ${b.type} ${b.name};`).join("\n")}
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
${v.code}
${f.code}
void vertex() {
  ${v.context} avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  ${attrs.map((b, i) => `avfx.${b.name}=texelFetch(avfxAttributes,ivec2((int(UV2.x)*${attrs.length}+${i})%avfxAttributeWidth,(int(UV2.x)*${attrs.length}+${i})/avfxAttributeWidth),0)${swizzle(b.type)};`).join("\n")}
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  ${varyings.map(b => `${b.name}=avfx.${b.name};`).join("\n")}
}
void fragment() {
  ${f.context} avfx;
  ${f.bindings.filter(b => b.kind === "varying").map(b => `avfx.${b.name}=${b.name};`).join("\n")}
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=!FRONT_FACING;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ${blend === "additive" ? "ALBEDO=col.rgb*col.a; ALPHA=0.0;" : blend === "alpha" ? "ALBEDO=col.rgb*col.a; ALPHA=col.a;" : "ALBEDO=col.rgb; ALPHA=col.a;"}
}
`;
}

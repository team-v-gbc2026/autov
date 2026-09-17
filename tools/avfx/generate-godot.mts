/** Offline trusted shader generation; never accepts archive-provided code. */
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { kernels, parseKernel } from "./kernels";
import { godotShader } from "./godot-shader";

const root = new URL("../../godot-plugin/autov_avfx/", import.meta.url);
const versions: Record<string, unknown> = {};
const attributes: Record<string, unknown> = {};
await mkdir(new URL("shaders/", root), { recursive: true });
for (const [name, [vertex, fragment]] of Object.entries(kernels)) {
  versions[name] = Object.fromEntries([["vertex",vertex],["fragment",fragment]].map(([stage,code])=>[stage,createHash("sha256").update(code).digest("hex")]));
  attributes[name] = parseKernel(vertex).bindings.filter(b=>b.kind==="attribute").map(b=>({name:b.name,type:b.type}));
  // Keep the already verified particle/surface ports until the generic port's
  // rendering suite passes. Their eight-slot ABI stays backwards compatible.
  if (name === "particle" || name === "surface") continue;
  const code = godotShader(name,"alpha")
    .replace("uniform sampler2D avfxAttributes", "uniform int avfx_blend_kind=1;\nuniform sampler2D avfxAttributes")
    .replace("ALBEDO=col.rgb*col.a; ALPHA=col.a;", "ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;");
  await writeFile(new URL(`shaders/${name}.gdshader`,root),code);
}
await writeFile(new URL("shader_versions.gd",root),`# Generated from trusted autoV source; never compile archive shader text.\nextends RefCounted\nconst EXPECTED = ${JSON.stringify(versions,null,2)}\nconst ATTRIBUTES = ${JSON.stringify(attributes,null,2)}\n`);
await writeFile(new URL("shader_library.gd",root),`# Generated explicit resource dependencies for packaged Godot games.\nextends RefCounted\nconst PROGRAMS = {\n${Object.keys(kernels).map(name=>`  "${name}": preload("shaders/${name}.gdshader")`).join(",\n")}\n}\n`);
console.log(`Generated ${Object.keys(kernels).length} Godot shader definitions.`);

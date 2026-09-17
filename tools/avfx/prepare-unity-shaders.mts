/** Trusted shader metadata and Unity material-binding normalization. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { kernels, parseKernel } from "./kernels";
const root = new URL("../../unity-plugin/com.autov.avfx/", import.meta.url);
const versions: string[] = [], layouts: string[] = [];
for (const [program, stages] of Object.entries(kernels)) {
  const path = new URL(`Runtime/Shaders/${program}.shader`, root);
  let code = await readFile(path, "utf8");
  // Only the global declaration blocks, never function-local declarations.
  code = code.replace(/(#if defined\(SHADER_STAGE_VERTEX\)|#else)([\s\S]*?)(?=Texture2D|static )/g,
    (_all, start, globals) => start + globals.replace(/\brow_major\s+/g, "").replace(/^(\s*)(?!uniform\b)((?:float(?:[234](?:x[234])?)?|int)\s+\w+(?:\[\d+\])?;)/gm, "$1uniform $2"));
  code = code.replace(/\bhalf2\b/g, "avfxHalfExtent").replace(/Blend \[_SrcBlend\] \[_DstBlend\](?!,)/g, "Blend [_SrcBlend] [_DstBlend], One [_DstBlend]");
  await writeFile(path, code);
  const hashes = stages.map(s => createHash("sha256").update(s).digest("hex"));
  versions.push(`{"${program}",new[]{"${hashes[0]}","${hashes[1]}"}}`);
  const bindings = parseKernel(stages[0]).bindings.filter(b => b.kind === "attribute");
  const names = [...code.matchAll(/\b(a\w+)\s*=\s*avfxAttributes\.Load\(/g)].map(m => m[1]);
  if (new Set(names).size !== names.length) throw new Error(`Duplicate attribute loads: ${program}`);
  for (const name of names) if (!bindings.some(b => b.name === name)) throw new Error(`Unknown attribute: ${program}/${name}`);
  layouts.push(`{"${program}",new string[]{${names.map(n => `"${n}"`).join(",")}}}`);
}
await writeFile(new URL("Editor/AvfxShaderAbi.cs", root), `// Generated from trusted repository sources; never execute bundle shader text.\nusing System.Collections.Generic;\npublic static class AvfxShaderAbi {\npublic static readonly Dictionary<string,string[]> Versions=new Dictionary<string,string[]> {${versions.join(",\n")}};\npublic static readonly Dictionary<string,string[]> Attributes=new Dictionary<string,string[]> {${layouts.join(",\n")}};\n}\n`);

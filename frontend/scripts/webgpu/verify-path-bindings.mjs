/** Offline shader-layout check: no browser, GPU, or app server required.
 * Compile the real TSL materials through Three's WGSL builder, then enforce
 * WebGPU's portable per-stage UBO budget (the curved trail previously used 13).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import path from "node:path";
const source = await readFile(
  new URL("./path-bindings-probe.ts", import.meta.url),
  "utf8",
);
const three = path.resolve("node_modules/three/src");
const result = await build({
  stdin: {
    contents: source,
    loader: "ts",
    resolveDir: path.dirname(fileURLToPath(import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "iife",
  write: false,
  alias: {
    "three/webgpu": path.join(three, "Three.WebGPU.js"),
    "three/tsl": path.join(three, "Three.TSL.js"),
    three: path.join(three, "Three.js"),
    "curve-wgsl-builder": path.join(
      three,
      "renderers/webgpu/nodes/WGSLNodeBuilder.js",
    ),
  },
});
new Function(result.outputFiles[0].text)();

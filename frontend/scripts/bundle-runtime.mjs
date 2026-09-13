import { build } from "esbuild";
await build({
  entryPoints: ["src/lib/vfx-lab/runtime.ts"],
  bundle: true,
  format: "iife",
  globalName: "AutoV",
  minify: true,
  legalComments: "inline",
  outfile: "public/vfx-runtime.js",
  platform: "browser",
  target: "es2020",
});
// The v2 player bundle. capture-v2 is the entry so one global carries the
// runtime, the capture path and the schema guard.
await build({
  entryPoints: ["src/lib/vfx-lab/capture-v2.ts"],
  bundle: true,
  format: "iife",
  globalName: "AutoVV2",
  minify: true,
  legalComments: "inline",
  outfile: "public/vfx-runtime-v2.js",
  platform: "browser",
  target: "es2020",
});

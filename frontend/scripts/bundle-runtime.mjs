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

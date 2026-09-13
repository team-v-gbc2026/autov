// Browser acceptance procedure is documented in docs/vfx-lab/VERIFICATION.md.
// This static check ensures the distributable is self-contained before delivery.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await readFile("public/vfx-runtime.js", "utf8");
assert.ok(bundle.includes("VfxRuntime"));
assert.ok(bundle.includes("WebGLRenderer"));
assert.ok(!bundle.includes("OPENAI_API_KEY"));
assert.ok(!bundle.includes("api.openai.com"));
assert.ok(!/import\s+.*from\s+["']https?:/.test(bundle));
console.log(
  `Self-contained Three.js runtime verified (${(Buffer.byteLength(bundle) / 1024).toFixed(0)} KiB).`,
);

const v2 = await readFile("public/vfx-runtime-v2.js", "utf8");
assert.ok(v2.includes("autov.lab/2-three-r186-webgpu"));
assert.ok(v2.includes("VfxRuntimeV2"));
assert.ok(!v2.includes("OPENAI_API_KEY"));
assert.ok(!v2.includes("api.openai.com"));
assert.ok(!v2.includes("GLSLDecoder"), "Shader translation must stay offline");
console.log(`Self-contained V2 WebGPU runtime verified (${(Buffer.byteLength(v2) / 1024).toFixed(0)} KiB).`);

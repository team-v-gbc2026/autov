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

import test from "node:test";
import assert from "node:assert/strict";
import { textureAlphaBounds } from "../src/lib/vfx-lab/texture-bounds";
test("transparent margins do not force the effect camera out, and PNG Y maps to plane Y", () => {
  const data = new Uint8Array(100 * 100 * 4);
  for (let y = 10; y < 30; y++)
    for (let x = 20; x < 80; x++) data[(y * 100 + x) * 4 + 3] = 255;
  const b = textureAlphaBounds(data, 100, 100)!;
  assert.ok(b.minX < -0.6 && b.maxX > 0.6);
  assert.ok(b.minY > 0.3 && b.maxY < 0.9);
  assert.ok(b.maxY > b.minY);
  assert.equal(textureAlphaBounds(new Uint8Array(64), 4, 4), undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTextureBindings } from "../src/lib/studio-tools/texture-bindings";
import type { AuthoringDirection } from "../src/lib/studio-tools/art-direction";

function need(
  role: string,
  id: string | null,
): AuthoringDirection["art"]["textureNeeds"][number] {
  return {
    role,
    candidateTextureId: id,
    appearance: "mask",
    channel: "alpha",
    animation: "static",
    generationPrompt: null,
  };
}
function binding(role: string, textureId: string | null) {
  return {
    role,
    textureId,
    treatment: "tint",
    rationale: "inspected mask",
    unmetNeed: null,
  };
}
const allowed = new Set(["spark-streak-01", "spark-dot-01"]);

test("reported label mismatch resolves by supplied texture ID, including reordered bindings", () => {
  const textures = {
    bindings: [
      binding("spark glints", "spark-dot-01"),
      binding("electric tail", "spark-streak-01"),
    ],
  };
  const result = resolveTextureBindings(
    [
      need("electric tail mask", "spark-streak-01"),
      need("spark glint mask", "spark-dot-01"),
    ],
    textures,
    allowed,
  );
  assert.deepEqual(
    result.bindings.map((b) => [b.role, b.textureId]),
    [
      ["electric tail mask", "spark-streak-01"],
      ["spark glint mask", "spark-dot-01"],
    ],
  );
  assert.equal(textures.bindings[0].role, "spark glints");
});
test("unsupplied textures stay rejected with the offending ID", () => {
  assert.throws(
    () =>
      resolveTextureBindings(
        [need("tail", null)],
        { bindings: [binding("tail", "unknown")] },
        allowed,
      ),
    /Texture "unknown".*not supplied/,
  );
});
test("count mismatch has a distinct diagnostic", () => {
  assert.throws(
    () =>
      resolveTextureBindings([need("tail", null)], { bindings: [] }, allowed),
    /exactly one/,
  );
});
test("ambiguous shared IDs require explicit roles", () => {
  assert.throws(
    () =>
      resolveTextureBindings(
        [need("a", "spark-dot-01"), need("b", "spark-dot-01")],
        {
          bindings: [
            binding("x", "spark-dot-01"),
            binding("y", "spark-dot-01"),
          ],
        },
        allowed,
      ),
    /Cannot uniquely match/,
  );
});
test("explicit roles support shared assets and procedural null bindings", () => {
  const result = resolveTextureBindings(
    [need("a", null), need("b", "spark-dot-01")],
    { bindings: [binding("b", "spark-dot-01"), binding("a", null)] },
    allowed,
  );
  assert.deepEqual(
    result.bindings.map((b) => b.textureId),
    [null, "spark-dot-01"],
  );
});
test("unrelated labels and IDs are not guessed by position", () => {
  assert.throws(
    () =>
      resolveTextureBindings(
        [need("tail", "spark-streak-01")],
        { bindings: [binding("other", "spark-dot-01")] },
        allowed,
      ),
    /Cannot uniquely match/,
  );
});

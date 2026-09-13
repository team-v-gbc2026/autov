import test from "node:test";
import assert from "node:assert/strict";
import { referenceInput } from "../src/lib/vfx-lab/reference-input";
import { encodeMention, displayPrompt } from "../src/components/studio/composer/prompt-format";
const refs = Array.from({ length: 10 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, name: `Reference ${i}`, type: "image/jpeg", url: `image-${i}` }));
test("only explicitly mentioned board images are attached, preserving mention order", () => {
  const prompt = `${encodeMention(refs[7].id, refs[7].name)} color; ${encodeMention(refs[2].id, refs[2].name)} shape`;
  const input = referenceInput(prompt, [refs[7].id, refs[2].id, refs[7].id], refs);
  assert.deepEqual(input.selected.map(r => r.url), ["image-7", "image-2"]);
  assert.equal(input.prompt, prompt);
  assert.equal(displayPrompt(prompt), "@Reference 7 color; @Reference 2 shape");
  assert.equal(referenceInput("No reference requested", [], refs).selected.length, 0);
});
test("main limits allow 8 references and 10,000 characters but reject excess and missing images", () => {
  assert.equal(referenceInput("a".repeat(10000), refs.slice(0, 8).map(r => r.id), refs).selected.length, 8);
  assert.throws(() => referenceInput("a".repeat(10001), [], refs));
  assert.throws(() => referenceInput("test", refs.slice(0, 9).map(r => r.id), refs));
  assert.throws(() => referenceInput("test", ["removed-reference"], refs));
});

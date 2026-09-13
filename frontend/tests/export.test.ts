import test from "node:test";
import assert from "node:assert/strict";
import { exportHtml } from "../src/lib/vfx-lab/export";
import { createPreset } from "../src/lib/vfx-lab/recipes";
test("HTML export embeds document as escaped data, never executable markup", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("var AutoV={};");
  try {
    const doc = createPreset("slash");
    doc.name = "</script><script>alert(1)</script>";
    const html = await exportHtml(doc);
    assert.ok(html.includes("\\u003c/script>"));
    assert.equal(html.includes(doc.name), false);
    assert.equal(html.includes("OPENAI_API_KEY"), false);
    assert.equal(html.includes("https://"), false);
    assert.ok(html.includes("var AutoV={};"));
  } finally {
    globalThis.fetch = original;
  }
});

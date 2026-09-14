import { test } from "node:test";
import assert from "node:assert/strict";
import { ReferenceImageCache } from "../../agent/lib/reference-image-cache";

test("cache expires bytes and evicts least recently used entries within its byte budget", () => {
  let now = 0;
  const cache = new ReferenceImageCache(4, 100, () => now);
  cache.set("a", Buffer.from("aa"));
  cache.set("b", Buffer.from("bb"));
  assert.equal(cache.get("a")?.toString(), "aa");
  cache.set("c", Buffer.from("cc"));
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c")?.toString(), "cc");
  now = 100;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("c"), undefined);
});

test("oversized images are not retained and replacement updates the byte budget", () => {
  const cache = new ReferenceImageCache(4);
  cache.set("large", Buffer.alloc(5));
  assert.equal(cache.get("large"), undefined);
  cache.set("a", Buffer.alloc(4));
  cache.set("a", Buffer.from("a"));
  cache.set("b", Buffer.from("bbb"));
  assert.equal(cache.get("a")?.toString(), "a");
  assert.equal(cache.get("b")?.toString(), "bbb");
});

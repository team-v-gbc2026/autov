import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { referenceParts } from "../../agent/lib/references";
const projectId = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
function fakeClient(bytes: Uint8Array, available = true) {
  const query = {
    select() { return this; },
    eq(key: string, value: unknown) {
      if (key === "project_id") assert.equal(value, projectId);
      if (key === "archived") assert.equal(value, false);
      return this;
    },
    async in() { return { data: available ? [{ id, name: "Blue flame", storage_path: "owned/reference", mime_type: "image/png" }] : [], error: null }; },
  };
  return { from: () => query, storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from(bytes)]), error: null }) }) } } as unknown as SupabaseClient;
}
test("reference snapshots carry real image bytes and a human-readable name", async () => {
  const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "blue" } }).png().toBuffer();
  const parts = await referenceParts(fakeClient(input), projectId, [id]);
  assert.equal(parts[0].type, "text");
  const image = parts[1];
  assert.equal(image.type, "file");
  if (image.type !== "file") throw new Error("Expected image");
  assert.match(String(image.data), /^data:image\/jpeg;base64,/);
  const snapshot = Buffer.from(String(image.data).split(",")[1], "base64");
  const metadata = await sharp(snapshot).metadata();
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 640);
  // Snapshot has no signed URL or expiry and can be passed on subsequent turns.
  assert.equal(String(image.data).includes("token="), false);
});
test("unavailable or cross-project references fail before image download", async () => {
  await assert.rejects(referenceParts(fakeClient(new Uint8Array(), false), projectId, [id]), { code: "INVALID_REFERENCES" });
});
test("corrupt image input gives a useful rejection", async () => {
  await assert.rejects(referenceParts(fakeClient(new Uint8Array([1, 2, 3])), projectId, [id]), { code: "INVALID_IMAGE" });
});

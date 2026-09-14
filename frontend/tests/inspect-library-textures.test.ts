import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { inspectLibraryTextures } from "../src/lib/vfx-lab/inspect-library-textures";
import { TEXTURE_MANIFEST_PROMPT } from "../src/lib/vfx-lab/protocol-v2";
import { TEXTURE_MANIFEST_V2 } from "../src/lib/vfx-lab/texture-manifest-v2";
import { FlipbookSchema } from "../src/lib/vfx-lab/schema-v2";

test("every library flipbook exposes valid explicit playback settings", () => {
  for (const asset of TEXTURE_MANIFEST_V2.filter(
    (a) => a.kind === "flipbook",
  )) {
    const metadata = TEXTURE_MANIFEST_PROMPT.find((a) => a.id === asset.id)!;
    const settings = FlipbookSchema.parse(metadata.flipbook);
    assert.ok(
      asset.suggestedUse?.includes(`${settings.cols}x${settings.rows}`),
    );
  }
});

test("texture inspection rejects unknown IDs and arbitrary URLs before fetching", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw Error("unexpected fetch");
  }) as typeof fetch;
  await assert.rejects(
    inspectLibraryTextures(
      { textureIds: ["flame-tongue-01", "unknown"] },
      fetcher,
    ),
    /Unknown library texture/,
  );
  await assert.rejects(
    inspectLibraryTextures(
      { textureIds: ["https://example.com/private"] },
      fetcher,
    ),
    /Unknown library texture/,
  );
  await assert.rejects(
    inspectLibraryTextures(
      { textureIds: Array(5).fill("flame-tongue-01") },
      fetcher,
    ),
  );
  assert.equal(calls, 0);
});

test("inspection returns actual PNG pixels, metadata and deduplicates reads", async () => {
  const png = await sharp({
    create: { width: 16, height: 8, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const fetcher = (async (url, options) => {
    calls++;
    assert.ok(String(url).endsWith("/flipbook-fire-8x8.png"));
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    return new Response(png);
  }) as typeof fetch;
  const result = await inspectLibraryTextures(
    { textureIds: ["flipbook-fire-8x8", "flipbook-fire-8x8"] },
    fetcher,
  );
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].texture.flipbook?.cols, 8);
  const metadata = await sharp(
    Buffer.from(result[0].image, "base64"),
  ).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 16);
});

test("failed and oversized texture reads fail explicitly", async () => {
  await assert.rejects(
    inspectLibraryTextures(
      { textureIds: ["flame-tongue-01"] },
      (async () => new Response(null, { status: 404 })) as typeof fetch,
    ),
    /Could not load/,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    inspectLibraryTextures(
      { textureIds: ["flame-tongue-01"] },
      (async () => new Response(body)) as typeof fetch,
    ),
    /too large/,
  );
  assert.equal(cancelled, true);
});

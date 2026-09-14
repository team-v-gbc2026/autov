import { test } from "node:test";
import assert from "node:assert/strict";
import { registerUsedLibraryTextures } from "../src/lib/studio-tools/library-board";
import { visibleBoardAssets } from "../src/lib/studio-tools/board-visibility";
import { createDocument } from "../src/lib/vfx-lab/ui-bridge";
import type { inspectLibraryTextures } from "../src/lib/vfx-lab/inspect-library-textures";
import type { Operation } from "../src/lib/studio-tools/server";

test("used masks, noise and trail textures are registered once, without embedding them", async () => {
  const doc = createDocument();
  const layer = doc.layers[0];
  layer.material!.mask.textureId = "mask-soft-01";
  layer.material!.noise = {
    textureId: "noise-cloud-tile-01",
    uvScale: [1, 1],
    uvPan: [0, 0],
    distortion: 0,
    distortionPan: [0, 0],
  };
  layer.emitter!.trail = {
    segments: 2,
    spacing: 0.01,
    textureId: "spark-streak-01",
    widthCurve: {
      keys: [
        [0, 1],
        [1, 0],
      ],
      ease: "linear",
    },
  };
  doc.layers.push(structuredClone(layer));
  const registered: string[] = [];
  const references = await registerUsedLibraryTextures(
    { userId: "user", projectId: "project" },
    {} as Operation,
    doc,
    {
      inspectLibraryTextures: (async (input: { textureIds: string[] }) =>
        input.textureIds.map((id) => ({
          texture: { id, suggestedUse: "mask" },
          image: "cG5n",
        }))) as typeof inspectLibraryTextures,
      registerEffectTexture: async (_identity, _operation, asset, role) => {
        registered.push(asset.id);
        return {
          referenceId: asset.id,
          textureId: asset.id,
          role,
          sha256: asset.sha256,
          tag: "board",
        };
      },
    },
  );
  assert.deepEqual(
    registered.sort(),
    ["mask-soft-01", "noise-cloud-tile-01", "spark-streak-01"].sort(),
  );
  assert.equal(references.length, 3);
  assert.equal(doc.textures?.length ?? 0, 0);
});
test("procedural-only layers do not create a board asset", async () => {
  await registerUsedLibraryTextures(
    { userId: "user", projectId: "project" },
    {} as Operation,
    createDocument(),
    {
      inspectLibraryTextures: async () => {
        throw Error("Unexpected fetch");
      },
      registerEffectTexture: async () => {
        throw Error("Unexpected registration");
      },
    },
  );
});
test("production hides capture evidence but keeps library, generated and uploaded assets", () => {
  const assets = [
    { id: "capture", studio_reference_provenance: { timestamps: [0, 0.5, 1] } },
    { id: "texture", studio_reference_provenance: { timestamps: [] } },
    { id: "upload", studio_reference_provenance: null },
    { id: "capture-array", studio_reference_provenance: [{ timestamps: [1] }] },
  ];
  assert.deepEqual(
    visibleBoardAssets(assets, true).map((a) => a.id),
    ["texture", "upload"],
  );
  assert.equal(visibleBoardAssets(assets, false).length, 4);
});

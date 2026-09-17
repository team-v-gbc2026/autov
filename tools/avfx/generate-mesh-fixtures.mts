/** Developer-only fixtures shared by the exporter and real Godot reader. */
import { mkdir, writeFile } from "node:fs/promises";
import { meshGlb } from "../../frontend/src/lib/avfx/binary";

const target = process.argv[2];
if (!target) throw new Error("Usage: generate-mesh-fixtures.mts <fixture-directory>");
await mkdir(target, { recursive: true });
const attributes = {
  position: { itemSize: 3, count: 6, values: [0,0,0, 1,0,0, 0,1,0, 0,0,1, 1,0,1, 0,1,1] },
  aWeight: { itemSize: 1, count: 6, values: [0,1,2,3,4,5] },
};
for (const mode of [1,4] as const)
  await writeFile(`${target}/mode-${mode}.glb`, meshGlb({ attributes, indices: null, mode }));
await writeFile(`${target}/before.glb`, meshGlb({ attributes, indices: null }));
attributes.position.values[0] = 2;
await writeFile(`${target}/after.glb`, meshGlb({ attributes, indices: null }));

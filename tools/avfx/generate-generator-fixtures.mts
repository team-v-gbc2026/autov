import { mkdir, readFile, writeFile } from "node:fs/promises";
import { exportAvfx } from "../../frontend/src/lib/avfx/export";
import { defaultsV2, defaultToon, validateDocumentV2 } from "../../frontend/src/lib/vfx-lab/schema-v2";
import { AVFX_GENERATOR_KINDS } from "../../frontend/src/lib/avfx/kinds";

const target = process.argv[2];
if (!target) throw new Error("Usage: generate-generator-fixtures.mts <output-directory>");
await mkdir(target, { recursive: true });
const source = validateDocumentV2(JSON.parse(await readFile(new URL("../../frontend/fixtures/v2/fire-projectile/document.json", import.meta.url), "utf8")));
const defaults = defaultsV2();
const pathSource = validateDocumentV2(JSON.parse(await readFile(new URL("../../frontend/fixtures/v2/healing-aura/document.json", import.meta.url), "utf8")));
source.paths = structuredClone(pathSource.paths);
defaults.ribbon.pathId = source.paths[0].id;
const template = source.layers.find(layer => layer.kind === "shell")!;
for (const kind of AVFX_GENERATOR_KINDS) {
  const doc = structuredClone(source);
  doc.duration = 2;
  doc.layers = [{ ...structuredClone(template),
    [kind]: structuredClone(defaults[kind as keyof typeof defaults]),
    material: defaultsV2().material, geometry: undefined,
    id: kind.toLowerCase(), kind, start: 0, end: 2,
    transform: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] },
    motion: null, window: null, tracks: [], overrides: [],
  } as typeof template];
  if (kind === "sheets") doc.layers[0].material!.toon = defaultToon();
  if (kind === "licks") {
    const blade = structuredClone(doc.layers[0]);
    blade.id = "blade";
    blade.kind = "crescent";
    delete blade.licks;
    blade.crescent = defaultsV2().crescent;
    doc.layers.unshift(blade);
  }
  const result = await exportAvfx(doc);
  await writeFile(`${target}/${kind}.avfx`, result.bytes);
  console.log(`${kind}: ${result.bytes.length} bytes`);
}

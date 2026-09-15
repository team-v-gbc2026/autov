import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { upgradeDocument } from "../src/lib/vfx-lab/migrate";
import { validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";

const root = path.resolve("public/trial-presets");
const effects = path.join(root, "effects");
let migrated = 0;
for (const entry of await readdir(effects, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(effects, entry.name, "document.json");
  const source = JSON.parse(await readFile(file, "utf8"));
  const document = validateDocumentV2(upgradeDocument(source));
  await writeFile(file, `${JSON.stringify(document)}\n`);
  migrated++;
}
const manifestFile = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
manifest.runtime = "autov.lab/2-three-r186";
manifest.documentSchema = "autov.lab/2";
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Migrated and validated ${migrated} preset documents to autov.lab/2.`);

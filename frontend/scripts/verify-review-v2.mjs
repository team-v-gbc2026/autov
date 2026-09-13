#!/usr/bin/env node
// Headless verification for the Review v2 evidence capture.
//
// Renders a document through captureV2 and writes the contact sheet and the
// motion strip out as PNGs so a human can check the tile layout, the labelled
// times and whether the strip is actually readable as motion.
//
// Usage: node scripts/verify-review-v2.mjs [fixtureId|path-to-document.json]
// Output: .autov-local/v2-verify/review/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureDocumentsV2,
  writeDataUrlAsPng,
} from "./capture-v2-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? "fire-projectile";
const file = target.endsWith(".json")
  ? path.resolve(process.cwd(), target)
  : path.join(root, "fixtures", "v2", target, "document.json");
const document = JSON.parse(fs.readFileSync(file, "utf8"));
const label = path.basename(target, ".json").replace(/[^a-zA-Z0-9._-]+/g, "_");
const outDir = path.join(root, ".autov-local", "v2-verify", "review");

const { results, problems } = await captureDocumentsV2([
  { id: label, document },
]);
const { evidence } = results[0];

const sheetFile = await writeDataUrlAsPng(
  evidence.sheet,
  path.join(outDir, `${label}-sheet.png`),
);
const stripFile = await writeDataUrlAsPng(
  evidence.strip,
  path.join(outDir, `${label}-strip.png`),
);
fs.writeFileSync(
  path.join(outDir, `${label}-evidence.json`),
  JSON.stringify(
    {
      times: evidence.times,
      stripTimes: evidence.stripTimes,
      renderedPixels: evidence.renderedPixels,
      jitterScore: evidence.jitterScore,
      runtime: evidence.runtime,
      renderer: evidence.renderer,
      temporal: evidence.temporal,
    },
    null,
    2,
  ),
);

const failures = [];
if (problems.length) failures.push(`page errors:\n  ${problems.join("\n  ")}`);
if (evidence.times.length !== 8)
  failures.push(`sheet has ${evidence.times.length} tiles, expected 8`);
if (evidence.stripTimes?.length !== 12)
  failures.push(`strip has ${evidence.stripTimes?.length} frames, expected 12`);
if (!(evidence.renderedPixels > 20))
  failures.push(`no visible effect pixels (${evidence.renderedPixels})`);
if (evidence.times.some((t, i, all) => i && t <= all[i - 1]))
  failures.push("sheet times are not strictly ascending");
if (evidence.stripTimes?.some((t, i, all) => i && t <= all[i - 1]))
  failures.push("strip times are not strictly ascending");

console.log(`document:    ${file}`);
console.log(`sheet:       ${sheetFile}`);
console.log(`strip:       ${stripFile}`);
console.log(`sheet times: ${JSON.stringify(evidence.times)}`);
console.log(`strip times: ${JSON.stringify(evidence.stripTimes)}`);
console.log(`pixels:      ${evidence.renderedPixels}`);
console.log(`jitterScore: ${evidence.jitterScore}`);
if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOK");

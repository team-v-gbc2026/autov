#!/usr/bin/env node
// Belt-and-braces check that dev-only routes never ship in a production build.
//
// Dev-only routes live under src/app/dev/ as page.dev.tsx / route.dev.ts.
// next.config.ts only adds "dev.tsx"/"dev.ts" to pageExtensions when the phase
// is the development server, so `next build` cannot see them at all. This
// script fails the build if one leaks anyway.
//
// Usage:
//   node scripts/verify-dev-excluded.mjs   - run after `next build`

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nextDir = path.join(root, ".next");

if (!fs.existsSync(nextDir)) {
  console.log("[verify-dev-excluded] no .next/ build output found, skipping");
  process.exit(0);
}

let failed = false;

const manifestPath = path.join(nextDir, "server", "app-paths-manifest.json");
if (fs.existsSync(manifestPath)) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const leaked = Object.keys(parsed).filter((key) => key.includes("/dev/"));
  if (leaked.length > 0) {
    console.error(
      `[verify-dev-excluded] FAILED: found /dev/ route(s) in app-paths-manifest.json: ${leaked.join(", ")}`,
    );
    failed = true;
  }
}

const builtDevDir = path.join(nextDir, "server", "app", "dev");
if (fs.existsSync(builtDevDir)) {
  console.error(
    `[verify-dev-excluded] FAILED: ${path.relative(root, builtDevDir)} exists in the production build output`,
  );
  failed = true;
}

if (failed) {
  process.exit(1);
}
console.log("[verify-dev-excluded] OK: no /dev/ routes present in production build");

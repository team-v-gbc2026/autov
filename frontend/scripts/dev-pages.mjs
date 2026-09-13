#!/usr/bin/env node
// Links (copies) dev-only routes from dev-pages/ into src/app/(dev)/dev/
// for local development, and unlinks them before production builds so
// dev-only pages never ship in a production build.
//
// Usage:
//   node scripts/dev-pages.mjs link     - copy dev-pages/* into src/app/(dev)/dev/
//                                          (only when NEXT_PUBLIC_DEV_PAGES=1)
//   node scripts/dev-pages.mjs unlink   - remove src/app/(dev)
//   node scripts/dev-pages.mjs verify   - fail if any /dev/ route leaked into
//                                          a production build under .next/

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "dev-pages");
const devGroupDir = path.join(root, "src", "app", "(dev)");
const targetDir = path.join(devGroupDir, "dev");

function removeDevGroup() {
  if (fs.existsSync(devGroupDir)) {
    fs.rmSync(devGroupDir, { recursive: true, force: true });
    console.log(`[dev-pages] removed ${path.relative(root, devGroupDir)}`);
  } else {
    console.log(`[dev-pages] nothing to unlink (${path.relative(root, devGroupDir)} not present)`);
  }
}

function link() {
  if (process.env.NEXT_PUBLIC_DEV_PAGES !== "1") {
    console.log("[dev-pages] NEXT_PUBLIC_DEV_PAGES!=1, skipping link (dev routes stay excluded)");
    return;
  }
  if (!fs.existsSync(sourceDir)) {
    console.log(`[dev-pages] no dev-pages/ directory found, nothing to link`);
    return;
  }

  removeDevGroup();
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  console.log(`[dev-pages] linked dev-pages/ -> ${path.relative(root, targetDir)}`);
}

function unlink() {
  removeDevGroup();
}

function verify() {
  const nextDir = path.join(root, ".next");
  if (!fs.existsSync(nextDir)) {
    console.log("[dev-pages] verify: no .next/ build output found, skipping");
    return;
  }

  let failed = false;

  const manifestPath = path.join(nextDir, "server", "app-paths-manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(manifest);
    const leaked = Object.keys(parsed).filter((key) => key.includes("/dev/"));
    if (leaked.length > 0) {
      console.error(`[dev-pages] verify FAILED: found /dev/ route(s) in app-paths-manifest.json: ${leaked.join(", ")}`);
      failed = true;
    }
  }

  const builtDevDir = path.join(nextDir, "server", "app", "dev");
  if (fs.existsSync(builtDevDir)) {
    console.error(`[dev-pages] verify FAILED: ${path.relative(root, builtDevDir)} exists in the production build output`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }
  console.log("[dev-pages] verify OK: no /dev/ routes present in production build");
}

const command = process.argv[2];

switch (command) {
  case "link":
    link();
    break;
  case "unlink":
    unlink();
    break;
  case "verify":
    verify();
    break;
  default:
    console.error(`[dev-pages] unknown command: ${command}\nUsage: node scripts/dev-pages.mjs <link|unlink|verify>`);
    process.exit(1);
}

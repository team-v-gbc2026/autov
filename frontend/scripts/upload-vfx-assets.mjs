#!/usr/bin/env node
// Uploads the v2 VFX assets to Supabase Storage.
//
//   <texture dir>/<file>                        -> vfx-textures/v2/<file>
//   frontend/fixtures/v2/<id>/document.json     -> vfx-fixtures/v2/<id>/document.json
//
// The PNG library is no longer committed (see docs/vfx-lab/LOCAL_SETUP.md). The
// texture dir is the first of these that exists: $VFX_ASSET_DIR,
// frontend/public/textures/v2, frontend/.vfx-textures/v2,
// ../textures-codex/library — or pass it explicitly:
//   npm run upload:vfx-assets -- --textures ../textures-codex/library
//
// Usage:
//   npm run upload:vfx-assets                   upload everything it can find
//   npm run upload:vfx-assets -- --verify       only GET each public URL
//   npm run upload:vfx-assets -- --textures DIR alternate texture directory
//   npm run upload:vfx-assets -- --dry-run      list what would be uploaded
//
// Env (read from the shell or frontend/.env.local):
//   NEXT_PUBLIC_SUPABASE_URL      defaults to the shared team project
//   SUPABASE_SECRET_KEY     required for uploads, never printed
//
// Plain fetch against the storage REST API — no dependencies, no client lib.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_SUPABASE_URL = "https://tkjstnitmfwgmedipcvs.supabase.co";
const TEXTURE_BUCKET = "vfx-textures";
const FIXTURE_BUCKET = "vfx-fixtures";
const CACHE_CONTROL = "31536000";

const CONTENT_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".json", "application/json"],
  [".ktx2", "application/octet-stream"],
]);

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
function option(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const verifyOnly = flag("--verify");
const dryRun = flag("--dry-run");

// --- env -------------------------------------------------------------------

/**
 * Minimal .env parser: KEY=VALUE per line, optional `export `, # comments,
 * optional single/double quotes. Values are never logged.
 */
function parseEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(root, ".env.local"));
const env = (name) => process.env[name] || fileEnv[name] || "";

const supabaseUrl = (
  env("NEXT_PUBLIC_SUPABASE_URL") || DEFAULT_SUPABASE_URL
).replace(/\/+$/, "");
const serviceKey = env("SUPABASE_SECRET_KEY");

const publicUrl = (bucket, objectPath) =>
  `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;

// --- what to upload --------------------------------------------------------

// Same candidate order as scripts/vfx-assets.mjs, so whatever the harnesses
// render from is also what gets uploaded.
function defaultTextureDir() {
  const candidates = [
    process.env.VFX_ASSET_DIR,
    path.join(root, "public", "textures", "v2"),
    path.join(root, ".vfx-textures", "v2"),
    path.join(root, "..", "textures-codex", "library"),
  ].filter(Boolean);
  for (const dir of candidates)
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  return candidates[1];
}

const textureDir = path.resolve(root, option("--textures", defaultTextureDir()));
const fixtureDir = path.join(root, "fixtures", "v2");

function textureEntries() {
  let names = [];
  try {
    names = fs.readdirSync(textureDir).sort();
  } catch {
    return [];
  }
  return names
    .filter((name) => /\.(png|jpg|jpeg|webp|json|ktx2)$/i.test(name))
    .map((name) => ({
      bucket: TEXTURE_BUCKET,
      objectPath: `v2/${name}`,
      localPath: path.join(textureDir, name),
    }));
}

function fixtureEntries() {
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(fixtureDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const entries = [];
  for (const id of dirs) {
    const localPath = path.join(fixtureDir, id, "document.json");
    if (!fs.existsSync(localPath)) continue;
    entries.push({
      bucket: FIXTURE_BUCKET,
      objectPath: `v2/${id}/document.json`,
      localPath,
    });
  }
  return entries;
}

const entries = [...textureEntries(), ...fixtureEntries()];

if (entries.length === 0) {
  console.error(
    `no assets found\n  textures: ${textureDir}\n  fixtures: ${fixtureDir}\n` +
      "pass --textures <dir> if the PNG library lives outside the repo",
  );
  process.exit(1);
}

// --- transfer --------------------------------------------------------------

const contentType = (file) =>
  CONTENT_TYPES.get(path.extname(file).toLowerCase()) ||
  "application/octet-stream";

async function upload(entry) {
  const body = fs.readFileSync(entry.localPath);
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${entry.bucket}/${entry.objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        "content-type": contentType(entry.localPath),
        "cache-control": `max-age=${CACHE_CONTROL}`,
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ");
    return { ok: false, bytes: body.length, note: `${response.status} ${detail}` };
  }
  return { ok: true, bytes: body.length, note: "uploaded" };
}

async function verify(entry) {
  const expected = fs.existsSync(entry.localPath)
    ? fs.statSync(entry.localPath).size
    : null;
  let response;
  try {
    response = await fetch(publicUrl(entry.bucket, entry.objectPath), {
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, bytes: 0, note: `fetch failed: ${error.message}` };
  }
  if (!response.ok)
    return { ok: false, bytes: 0, note: `HTTP ${response.status}` };
  const bytes = (await response.arrayBuffer()).byteLength;
  if (bytes === 0) return { ok: false, bytes, note: "empty body" };
  if (expected !== null && bytes !== expected)
    return { ok: false, bytes, note: `size ${bytes} != local ${expected}` };
  return { ok: true, bytes, note: expected === null ? "200" : "200, size ok" };
}

if (!verifyOnly && !dryRun && !serviceKey) {
  console.error(
    "SUPABASE_SECRET_KEY is not set.\n" +
      "Put it in frontend/.env.local (never commit it) or export it, then re-run.",
  );
  process.exit(1);
}

const action = verifyOnly ? "verify" : dryRun ? "dry-run" : "upload";
console.log(`${action} → ${supabaseUrl}`);
console.log(`textures: ${textureDir}`);
console.log(`fixtures: ${fixtureDir}`);
console.log("");

let failures = 0;
const pad = Math.min(
  52,
  Math.max(...entries.map((e) => `${e.bucket}/${e.objectPath}`.length)),
);

for (const entry of entries) {
  const label = `${entry.bucket}/${entry.objectPath}`.padEnd(pad);
  if (dryRun) {
    const size = fs.statSync(entry.localPath).size;
    console.log(`  plan ${label}  ${size} B  ${contentType(entry.localPath)}`);
    continue;
  }
  const result = verifyOnly ? await verify(entry) : await upload(entry);
  if (!result.ok) failures++;
  console.log(
    `  ${result.ok ? "ok  " : "ERR "} ${label}  ${result.bytes} B  ${result.note}`,
  );
}

console.log("");
if (dryRun) {
  console.log(`${entries.length} object(s) would be transferred`);
  process.exit(0);
}
console.log(
  `${entries.length - failures}/${entries.length} object(s) ${verifyOnly ? "verified" : "uploaded"}`,
);
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}

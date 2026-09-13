// Texture source for the headless v2 harnesses.
//
// The v2 texture library no longer ships in frontend/public — it lives in the
// public `vfx-textures` Supabase bucket (see src/lib/vfx-lab/asset-urls.ts).
// CI has no network, so the harnesses need a local option:
//
//   VFX_ASSET_BASE=<url>   force a base URL (e.g. the bucket, or any mirror)
//   VFX_ASSET_DIR=<dir>    serve PNGs from this directory at /textures/v2/*
//
// With neither set, the first existing candidate directory wins; if none
// exists, the harness points at the production bucket (works only online).
//
// textureUrl() in asset-urls.ts honours globalThis.__VFX_ASSET_BASE, so the
// harness only has to inject assetBaseScript() ahead of its bundle.

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REMOTE_BASE =
  "https://tkjstnitmfwgmedipcvs.supabase.co/storage/v1/object/public/vfx-textures/v2";

/** Where local PNGs may live, most specific first. */
function candidateDirs(root) {
  return [
    process.env.VFX_ASSET_DIR,
    path.join(root, "public", "textures", "v2"),
    path.join(root, ".vfx-textures", "v2"),
    path.join(root, "..", "textures-codex", "library"),
  ].filter(Boolean);
}

/**
 * Resolve the texture source for a harness run.
 * Returns { base, dir } — `dir` is null when textures come from a URL.
 */
export function resolveTextureSource(root) {
  if (process.env.VFX_ASSET_BASE)
    return { base: process.env.VFX_ASSET_BASE.replace(/\/+$/, ""), dir: null };
  for (const dir of candidateDirs(root)) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory())
      return { base: "/textures/v2", dir };
  }
  return { base: DEFAULT_REMOTE_BASE, dir: null };
}

/** Script tag to place before the harness bundle. */
export function assetBaseScript(base) {
  return `<script>globalThis.__VFX_ASSET_BASE=${JSON.stringify(base)};</script>`;
}

/**
 * Serve /textures/v2/<file> from `dir`. Returns true when the request was
 * handled (including as a 404 for a missing texture), false otherwise.
 */
export function serveLocalTexture(url, res, dir) {
  if (!dir || !url.startsWith("/textures/v2/")) return false;
  const name = path.basename(url);
  const file = path.join(dir, name);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404).end("texture not found");
  }
  return true;
}

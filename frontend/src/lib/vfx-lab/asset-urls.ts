// Where the v2 texture library and the v2 fixture documents live.
//
// Both used to ship inside frontend/public (textures) and frontend/fixtures
// (documents), which put ~30 MB of PNG into every build. They now live in two
// public Supabase Storage buckets:
//
//   vfx-textures/v2/<file>              e.g. v2/flame-tongue-01.png
//   vfx-fixtures/v2/<id>/document.json  e.g. v2/fire-projectile/document.json
//
// Resolution order for the texture base URL:
//   1. globalThis.__VFX_ASSET_BASE  — runtime override; headless harnesses set
//      this to a path served from local files so CI works without network.
//   2. NEXT_PUBLIC_VFX_ASSET_BASE   — explicit deployment override.
//   3. NEXT_PUBLIC_SUPABASE_URL     — derived bucket URL for that project.
//   4. DEFAULT_SUPABASE_URL         — the shared team project.

export const DEFAULT_SUPABASE_URL = "https://tkjstnitmfwgmedipcvs.supabase.co";

export const VFX_TEXTURE_BUCKET = "vfx-textures";
export const VFX_FIXTURE_BUCKET = "vfx-fixtures";

/** The hand-authored exemplars in fixtures/v2 / the vfx-fixtures bucket. */
export const FIXTURE_IDS = [
  "beam",
  "energy-column",
  "fire-projectile",
  "fire-slash",
  "fire-slash-classic",
  "glitch-projectile",
  "healing-aura",
  "ice-blast",
  "ice-blast-classic",
  "lightning-impact",
  "meteor-rain",
  "playful-impact",
  "portal",
  "shield",
  "sky-vortex",
  "smoke-burst",
  "water-projectile",
] as const;

export type FixtureId = (typeof FIXTURE_IDS)[number];

const trimSlash = (value: string) => value.replace(/\/+$/, "");

// `typeof process` keeps this safe inside plain browser bundles (the esbuild
// harnesses in scripts/), while the literal member access stays statically
// replaceable by Next for the NEXT_PUBLIC_* vars.
function envVar(name: "NEXT_PUBLIC_VFX_ASSET_BASE" | "NEXT_PUBLIC_SUPABASE_URL") {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value =
    name === "NEXT_PUBLIC_VFX_ASSET_BASE"
      ? process.env.NEXT_PUBLIC_VFX_ASSET_BASE
      : process.env.NEXT_PUBLIC_SUPABASE_URL;
  return value && value.trim() ? trimSlash(value.trim()) : undefined;
}

export function publicObjectBase(supabaseUrl: string, bucket: string) {
  return `${trimSlash(supabaseUrl)}/storage/v1/object/public/${bucket}`;
}

function resolveTextureBase(): string {
  const explicit = envVar("NEXT_PUBLIC_VFX_ASSET_BASE");
  if (explicit) return explicit;
  const supabase = envVar("NEXT_PUBLIC_SUPABASE_URL") ?? DEFAULT_SUPABASE_URL;
  return `${publicObjectBase(supabase, VFX_TEXTURE_BUCKET)}/v2`;
}

function resolveFixtureBase(): string {
  const supabase = envVar("NEXT_PUBLIC_SUPABASE_URL") ?? DEFAULT_SUPABASE_URL;
  return `${publicObjectBase(supabase, VFX_FIXTURE_BUCKET)}/v2`;
}

/** Base URL (no trailing slash) for `vfx-textures/v2`. */
export const VFX_ASSET_BASE = resolveTextureBase();

/** Base URL (no trailing slash) for `vfx-fixtures/v2`. */
export const VFX_FIXTURE_BASE = resolveFixtureBase();
/** Base URL for generated trial presets published to Supabase Storage. */
export const VFX_PRESET_BASE = `${publicObjectBase(
  envVar("NEXT_PUBLIC_SUPABASE_URL") ?? DEFAULT_SUPABASE_URL,
  VFX_FIXTURE_BUCKET,
)}/presets`;

function runtimeOverride(): string | undefined {
  const value = (globalThis as { __VFX_ASSET_BASE?: unknown }).__VFX_ASSET_BASE;
  return typeof value === "string" && value.trim()
    ? trimSlash(value.trim())
    : undefined;
}

/**
 * URL for one texture. Accepts a bare file name ("flame-tongue-01.png") or a
 * legacy "/textures/v2/flame-tongue-01.png" path; anything already absolute
 * (http(s):, data:, blob:) is returned untouched.
 */
export function textureUrl(name: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(name) || /^(?:data|blob):/i.test(name))
    return name;
  const file = name.replace(/^.*\//, "");
  return `${runtimeOverride() ?? VFX_ASSET_BASE}/${file}`;
}

/** URL for one fixture document in the vfx-fixtures bucket. */
export function fixtureUrl(id: string): string {
  return `${VFX_FIXTURE_BASE}/${id}/document.json`;
}

export function presetManifestUrl(): string {
  return `${VFX_PRESET_BASE}/manifest.json`;
}

export function presetDocumentUrl(id: string): string {
  return `${VFX_PRESET_BASE}/effects/${encodeURIComponent(id)}/document.json`;
}

export function presetThumbnailUrl(id: string): string {
  return `${VFX_PRESET_BASE}/thumbnails/${encodeURIComponent(id)}.webp`;
}

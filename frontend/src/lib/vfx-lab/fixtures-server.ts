// Server-side reader for the v2 exemplar fixtures.
//
// The canonical copies live in the public `vfx-fixtures` bucket as
// v2/<id>/document.json. frontend/fixtures/v2/** stays in the repo because the
// node tests and the headless harnesses import it directly, and it is the
// offline fallback here: a fetch failure (no network, bucket not populated yet,
// slow cold start) falls back to the local file instead of 500-ing a dev page.
//
// Node-only (node:fs): import it from server components, route handlers and
// scripts, never from client code.

import fs from "node:fs";
import path from "node:path";
import { FIXTURE_IDS, fixtureUrl } from "./asset-urls";

/** Timeout for one bucket fetch. Dev pages must not hang on a cold bucket. */
const FETCH_TIMEOUT_MS = Number(process.env.VFX_FIXTURE_TIMEOUT_MS || 2500);

export function fixturesRoot(): string {
  return path.join(process.cwd(), "fixtures", "v2");
}

/** Directory listing of local fixtures — server-only, unlike FIXTURE_IDS. */
export function localFixtureIds(): string[] {
  try {
    return fs
      .readdirSync(fixturesRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every fixture id we know about: the bucket's fixed set plus anything extra
 * found on disk in this checkout.
 */
export function knownFixtureIds(): string[] {
  return [...new Set([...FIXTURE_IDS, ...localFixtureIds()])].sort();
}

export function readLocalFixtureJson(
  id: string,
  file = "document.json",
): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(fixturesRoot(), id, file), "utf8"));
  } catch {
    return null;
  }
}

async function fetchFixtureJson(id: string): Promise<unknown | null> {
  if (process.env.VFX_FIXTURES_LOCAL_ONLY === "1") return null;
  try {
    const response = await fetch(fixtureUrl(id), {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * One fixture document: the bucket copy when reachable, the local file
 * otherwise. Returns null when neither exists.
 */
export async function loadFixtureDocument(id: string): Promise<unknown | null> {
  return (await fetchFixtureJson(id)) ?? readLocalFixtureJson(id);
}

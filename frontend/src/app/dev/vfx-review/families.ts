// Family -> benchmark case -> reference asset mapping for the vfx-review
// dev page, plus the family -> spike-page key mapping used for the "Open
// spike" link.
//
// Families come from FIXTURE_IDS (frontend/src/lib/vfx-lab/asset-urls.ts) at
// runtime — this file only maps a subset of *known* family ids to benchmark
// artifacts. A family with no entry here still lists in the review page; it
// just has no reference video/image and no spike link.

export type ReferenceKind = "video" | "image";

export interface FamilyReference {
  /** Benchmark case id, e.g. "fx02-fire-projectile". */
  caseId: string;
  /** Reference asset file name (no extension) under the case/videos dir. */
  file: string;
  kind: ReferenceKind;
}

/**
 * Family id (from FIXTURE_IDS) -> benchmark reference.
 *
 * Video files live at
 *   <repo>/benchmark-verified-2026-09-13/references/videos/<file>.mp4
 * The one image-only family (shield, which has no benchmark video) instead
 * points at its case's reference-01.jpg under inputs/cases/<caseId>/.
 */
export const FAMILY_REFERENCES: Record<string, FamilyReference> = {
  "fire-projectile": { caseId: "fx02-fire-projectile", file: "P6lbvB-fire", kind: "video" },
  "water-projectile": { caseId: "fx03-water-projectile", file: "P6lbvB-water", kind: "video" },
  "glitch-projectile": { caseId: "fx04-glitch-magic", file: "kw4Rnl-final", kind: "video" },
  shield: { caseId: "fx05-shield", file: "reference-01", kind: "image" },
  "playful-impact": { caseId: "fx06-playful-impact", file: "y4NzBn-final", kind: "video" },
  "fire-slash": { caseId: "fx07-fire-slash", file: "OGNX6k-final", kind: "video" },
  "ice-blast": { caseId: "fx08-ice-blast", file: "K3NbvB-final", kind: "video" },
  "meteor-rain": { caseId: "fx09-meteor-rain", file: "8B9kvx-view1", kind: "video" },
  "lightning-impact": { caseId: "fx01-lightning-impact", file: "X132B3-final", kind: "video" },
  "smoke-burst": { caseId: "fx12-smoke-burst", file: "03rPr8-final", kind: "video" },
  beam: { caseId: "fx13-sustained-beam", file: "g0kq88-final", kind: "video" },
  portal: { caseId: "fx14-rectangular-portal", file: "2qzwGx-final", kind: "video" },
  "healing-aura": { caseId: "fx15-healing-aura", file: "NyaNzN-final", kind: "video" },
  "energy-column": { caseId: "fx16-energy-overload", file: "Zag96G-final", kind: "video" },
  "sky-vortex": { caseId: "fx17-sky-vortex", file: "WB4B2y-final", kind: "video" },
};

/**
 * Benchmark case id -> family id, derived from FAMILY_REFERENCES. Used to
 * find a generated result's family (for its reference video/image and for
 * the "Compare with exemplar" A/B toggle) from the case id recorded in its
 * benchmark run (report.json / pipeline.json).
 */
export const CASE_TO_FAMILY: Record<string, string> = Object.fromEntries(
  Object.entries(FAMILY_REFERENCES).map(([familyId, ref]) => [ref.caseId, familyId]),
);

export function familyForCase(caseId: string): string | null {
  return CASE_TO_FAMILY[caseId] ?? null;
}

/** Family id -> "/dev/vfx-v2/spike-<key>" suffix; "" means the bare /spike route. */
export const FAMILY_SPIKE_KEYS: Record<string, string> = {
  "smoke-burst": "smoke",
  "healing-aura": "heal",
  "glitch-projectile": "glitch",
  "ice-blast": "ice",
  shield: "shield",
  beam: "beam",
  portal: "portal",
  "sky-vortex": "vortex",
  "energy-column": "column",
  "meteor-rain": "meteor",
  "water-projectile": "water",
  "playful-impact": "playful",
  "fire-slash": "slash",
  "fire-projectile": "", // the original /dev/vfx-v2/spike
  // lightning-impact: no spike page.
};

export function spikeHref(familyId: string): string | null {
  const key = FAMILY_SPIKE_KEYS[familyId];
  if (key === undefined) return null;
  return key === "" ? "/dev/vfx-v2/spike" : `/dev/vfx-v2/spike-${key}`;
}

type Provenance = { timestamps: unknown };
/** Keep internal capture evidence available to reviewers without exposing it on the production board. */
export function visibleBoardAssets<
  T extends { studio_reference_provenance?: Provenance | Provenance[] | null },
>(assets: T[], production = process.env.NODE_ENV === "production") {
  return assets.filter((asset) => {
    if (!production) return true;
    const provenance = asset.studio_reference_provenance;
    const entries = Array.isArray(provenance)
      ? provenance
      : provenance
        ? [provenance]
        : [];
    return !entries.some(
      (entry) => Array.isArray(entry.timestamps) && entry.timestamps.length > 0,
    );
  });
}

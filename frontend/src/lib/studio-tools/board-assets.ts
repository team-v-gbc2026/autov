import { admin } from "./server";
import { visibleBoardAssets } from "./board-visibility";

/** Input must come from the caller's project-authorized assets query.
 * Provenance is internal and is deliberately not readable by the browser role. */
export async function productionBoardAssets<T extends { id: string }>(
  assets: T[],
) {
  if (process.env.NODE_ENV !== "production" || !assets.length) return assets;
  const { data, error } = await admin()
    .from("studio_reference_provenance")
    .select("asset_id,timestamps")
    .in(
      "asset_id",
      assets.map((asset) => asset.id),
    );
  if (error) throw new Error("Could not read reference visibility.");
  const provenance = new Map(
    data.map((row) => [row.asset_id, { timestamps: row.timestamps }]),
  );
  return visibleBoardAssets(
    assets.map((asset) => ({
      ...asset,
      studio_reference_provenance: provenance.get(asset.id) ?? null,
    })),
    true,
  ).map(
    ({ studio_reference_provenance: _internal, ...asset }) =>
      asset as unknown as T,
  );
}

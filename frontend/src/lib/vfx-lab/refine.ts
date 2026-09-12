import { type VfxDocument, validateDocument, RANGES } from "./schema";
import { RefinementSchema, StructuralRefinementSchema } from "./protocol";
export function applyRefinement(
  doc: VfxDocument,
  input: unknown,
  allowedLayerIds: string[],
) {
  const changes = RefinementSchema.parse(input).changes;
  const next = structuredClone(doc),
    allowed = new Set(allowedLayerIds);
  for (const change of changes) {
    if (!allowed.has(change.layerId))
      throw new Error("Refiner exceeded diagnosed layer scope.");
    const layer = next.layers.find((l) => l.id === change.layerId);
    if (!layer) throw new Error("Refiner referenced unknown layer.");
    if (change.target === "color") {
      if (typeof change.value !== "string") throw new Error("Invalid color.");
      layer.params.color = change.value;
      continue;
    }
    const value = change.value,
      target = change.target,
      [lo, hi] = RANGES[target];
    if (typeof value !== "number" || value < lo || value > hi)
      throw new Error("Refinement outside supported range.");
    const track = layer.tracks.find((t) => t.target === target);
    if (track) {
      // The proposal specifies the new animated PEAK, not a multiple of a tiny birth-time base.
      // Map the old [allowed minimum, peak] interval to [allowed minimum, new peak].
      const peak = Math.max(...track.keys.map((k) => k[1]));
      track.keys = track.keys.map(([t, v]) => [
        t,
        peak === lo
          ? value
          : Math.min(
              hi,
              Math.max(lo, lo + ((v - lo) * (value - lo)) / (peak - lo)),
            ),
      ]);
    }
    layer.params[target] = value;
  }
  return validateDocument(next);
}

export function applyStructuralRefinement(
  doc: VfxDocument,
  input: unknown,
  allowedLayerIds: string[],
  allowPost = false,
) {
  const proposal = StructuralRefinementSchema.parse(input),
    next = structuredClone(doc),
    seen = new Set<string>();
  for (const replacement of proposal.layers) {
    if (seen.has(replacement.id) || !allowedLayerIds.includes(replacement.id))
      throw Error("Structural repair exceeded diagnosed layer scope.");
    seen.add(replacement.id);
    const index = next.layers.findIndex((l) => l.id === replacement.id);
    if (index < 0) throw Error("Structural repair referenced unknown layer.");
    // Global document/seed/assets/other layers remain byte-for-byte equivalent data.
    next.layers[index] = replacement as VfxDocument["layers"][number];
  }
  if (proposal.post) {
    if (
      !allowPost ||
      proposal.post.bloom > doc.post.bloom ||
      proposal.post.exposure > doc.post.exposure
    )
      throw Error("Post repair may only reduce diagnosed washout.");
    next.post = { ...next.post, ...proposal.post };
  }
  return validateDocument(next);
}

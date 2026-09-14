import { type VfxDocument, validateDocument, RANGES } from "./schema";
import { RefinementSchema, StructuralRefinementSchema } from "./protocol";
import {
  MAX_ADDED_LAYERS_V2,
  MAX_ADDED_LIGHTS_V2,
  StructuralRefinementV2Schema,
} from "./protocol-v2";
import { readTarget, writeTarget } from "./evaluate-v2";
import {
  fromWireV2,
  mapV1Target,
  meshHeroLayerV2,
  MESH_HERO_FRAMING_LINT,
  validateDocumentV2,
  V2_TARGET_RANGES,
  type VfxDocumentV2,
} from "./schema-v2";
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

// ---------------------------------------------------------------------------
// autov.lab/2
//
// The refiner keeps speaking v1's director vocabulary (nine numeric targets
// plus color): those names describe what a reviewer sees, not how the schema
// stores it. `mapV1Target` translates each note into the v2 dotted path for
// that layer kind, and `V2_TARGET_RANGES` bounds the result.
// ---------------------------------------------------------------------------

export function applyRefinementV2(
  doc: VfxDocumentV2,
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
    const target = mapV1Target(change.target, layer.kind);
    if (change.target === "color") {
      if (typeof change.value !== "string") throw new Error("Invalid color.");
      // A layer with no ramp (a light) takes the note on its own color.
      writeTarget(layer, layer.material ? target : "light.color", change.value);
      continue;
    }
    const value = change.value;
    if (typeof value !== "number")
      throw new Error("Numeric target requires a numeric value.");
    // The note arrives in v1 units; the v1 range and the v2 range for the same
    // idea differ (turbulence 0..2 versus a 0..0.5 vertex-noise amplitude), so
    // the proportion within the v1 range is what carries over.
    const [v1Low, v1High] = RANGES[change.target];
    if (value < v1Low || value > v1High)
      throw new Error("Refinement outside supported range.");
    const bounds = V2_TARGET_RANGES[target];
    const scaled = bounds
      ? bounds[0] +
        ((value - v1Low) / (v1High - v1Low || 1)) * (bounds[1] - bounds[0])
      : value;
    const current = readTarget(layer, target);
    if (typeof current !== "number")
      throw new Error(`Refinement target is not available: ${target}`);
    const track = layer.tracks.find((t) => t.target === target);
    if (track) {
      // Same rule as v1: the proposal is the new animated PEAK. Rescale the
      // curve into [lower bound, new peak] and keep its timing untouched.
      const low = bounds ? bounds[0] : 0;
      const peak = Math.max(...track.keys.map((k) => k[1]));
      track.keys = track.keys.map(([t, v]) => [
        t,
        peak === low
          ? scaled
          : Math.max(
              bounds ? bounds[0] : v,
              Math.min(
                bounds ? bounds[1] : scaled,
                low + ((v - low) * (scaled - low)) / (peak - low),
              ),
            ),
      ]) as typeof track.keys;
    }
    writeTarget(layer, target, scaled);
  }
  return validateDocumentV2(next);
}

/**
 * Structural repair in v2 replaces the whole document. The baseline bounds what
 * a repair may do: it may not change the seed, duration or impact, may add at
 * most two layers (at most one of them a light), and may only lower post.
 */
export function applyStructuralRefinementV2(
  doc: VfxDocumentV2,
  input: unknown,
) {
  const proposal = StructuralRefinementV2Schema.parse(input);
  const next = fromWireV2(proposal.document, doc.textures ?? []);
  if (
    next.seed !== doc.seed ||
    next.duration !== doc.duration ||
    next.impact !== doc.impact
  )
    throw Error("Structural repair may not change seed or global timing.");
  if (next.layers.length > doc.layers.length + MAX_ADDED_LAYERS_V2)
    throw Error(
      `Structural repair may add at most ${MAX_ADDED_LAYERS_V2} layers.`,
    );
  const lights = (d: VfxDocumentV2) =>
    d.layers.filter((l) => l.kind === "light").length;
  if (lights(next) > lights(doc) + MAX_ADDED_LIGHTS_V2)
    throw Error(
      `Structural repair may add at most ${MAX_ADDED_LIGHTS_V2} light layer.`,
    );
  if (
    next.post.bloom.strength > doc.post.bloom.strength ||
    next.post.exposure > doc.post.exposure
  )
    throw Error("Post repair may only lower bloom and exposure.");
  return validateDocumentV2(next);
}

/**
 * The one repair the knob solver cannot reach and the model keeps getting
 * wrong: a document whose biggest layer is a mesh hero — a blob column, a
 * crystal cluster, a blade, a swept ribbon, an SDF frame rim — framed in the
 * particle band. The knob subspace has no camera in it, so a `smallInFrame`
 * defect on such a document is rejected by the residual and nothing moves.
 *
 * The fix is the exemplar's own camera, which is measured, not guessed: the
 * family example is already the scale reference, so it is also the framing
 * reference. Only the camera block moves, and only when the lint actually
 * complains, so a document the model framed correctly is returned untouched
 * (the same object, so a caller can test for "nothing to do").
 */
export function applyExemplarCameraV2(
  doc: VfxDocumentV2,
  exemplar: VfxDocumentV2,
): VfxDocumentV2 {
  const hero = meshHeroLayerV2(doc);
  if (!hero || doc.camera.framing >= MESH_HERO_FRAMING_LINT) return doc;
  // An exemplar framed in the particle band is no better a reference than the
  // candidate: take the minimum acceptable framing instead of copying a number
  // that would leave the same defect in place.
  const camera = {
    ...exemplar.camera,
    framing: Math.max(exemplar.camera.framing, MESH_HERO_FRAMING_LINT),
    // Shake and push-in are direction, not framing: whatever the candidate
    // chose for the motion of the shot survives the repair.
    shake: doc.camera.shake,
    pushIn: doc.camera.pushIn,
  };
  return validateDocumentV2({ ...doc, camera });
}

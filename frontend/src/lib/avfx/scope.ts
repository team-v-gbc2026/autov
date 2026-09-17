import { validateDocumentV2, type VfxDocumentV2 } from "../vfx-lab/schema-v2";
import { pathEventTime } from "../vfx-lab/events-v2";
import { isAvfxKind } from "./kinds";

/** Exclusions are intentional and reported. Dependencies cannot be silently
 * removed: they can change seed generation, windows or particle motion. */
export function prepareAvfxDocument(input: VfxDocumentV2) {
  const source = validateDocumentV2(input);
  const layers = source.layers.filter(layer => layer.enabled && isAvfxKind(layer.kind));
  const ids = new Set(layers.map(layer => layer.id));
  if (!layers.length) throw new Error("No enabled exportable effect layers.");
  for (const layer of layers) {
    // CPU camera-frame transforms cannot be baked for an arbitrary engine camera.
    if (layer.frame) throw new Error(`${layer.id}: camera-frame transforms are not supported by AVFX 0.1 yet.`);
    const dependencies = [layer.licks?.anchor.sourceLayerId, layer.reflection?.sourceLayerId, layer.emitter?.sub?.parentLayerId, layer.emitter?.shape.sourceLayerId, layer.emitter?.spawn.sourceLayerId];
    for (const id of dependencies) if (id && !ids.has(id))
      throw new Error(`${layer.id} depends on excluded layer ${id}.`);
  }
  const excluded = source.layers.filter(layer => !ids.has(layer.id)).map(layer => ({
    id: layer.id, kind: layer.kind, reason: !layer.enabled ? "disabled" : "out-of-scope",
  }));
  // Environment is reference context, not an exported layer. Keep only valid
  // references so normal document validation remains applicable.
  const document = validateDocumentV2({ ...source, layers, environment: {
    ...source.environment,
    groundPool: source.environment.groundPool?.filter(pool => !pool.followsLayerId || ids.has(pool.followsLayerId)),
  } });
  for (const layer of layers) {
    const eventPaths = layer.window ? [{ id: layer.window.at.pathId, u: layer.window.at.u }] : [];
    if (layer.emitter?.spawn.mode === "event" && layer.emitter.spawn.originsFromPath)
      eventPaths.push(...(layer.emitter.shape.pathId ? [layer.emitter.shape.pathId] : source.paths.map(path => path.id)).map(id => ({ id, u: 1 })));
    for (const { id, u } of eventPaths) if (pathEventTime(source, id, u) !== pathEventTime(document, id, u))
      throw new Error(`${layer.id}: path event ${id} depends on an excluded driver.`);
  }
  return { source, document, excluded };
}

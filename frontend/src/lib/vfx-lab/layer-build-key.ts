import type { LayerV2 } from "./schema-v2";

/** Values uploaded every frame do not require new geometry or shader materials. */
export function layerBuildKey(layer: LayerV2): string {
  const shape = structuredClone(layer);
  // Visibility is live editor state. Keeping it out of the structural key lets
  // the preview retain the layer's geometry, materials and compiled pipelines
  // while it is hidden, so showing it again is just a visibility change.
  shape.enabled = true;
  if (shape.material) {
    shape.material.opacity = 1;
    for (const stop of shape.material.ramp.stops) { stop.color = "#ffffff"; stop.intensity = 1; }
  }
  if (shape.emitter) {
    shape.emitter.velocity.speed = [0, 0];
    shape.emitter.render.size = [1, 1];
  }
  return JSON.stringify(shape);
}

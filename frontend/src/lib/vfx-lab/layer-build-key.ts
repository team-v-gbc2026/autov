import type { LayerV2 } from "./schema-v2";

/** Values uploaded every frame do not require new geometry or shader materials. */
export function layerBuildKey(layer: LayerV2): string {
  const shape = structuredClone(layer);
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

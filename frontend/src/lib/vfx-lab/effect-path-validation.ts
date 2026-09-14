import type { VfxDocumentV2 } from "./schema-v2";
import { sampleEffectPath } from "./effect-path";

/** Explicit capability boundary for the first curve renderer adapter. Keep
 * unsupported combinations visible instead of silently mixing coordinate rules. */
export function validateEffectPaths(doc: VfxDocumentV2): void {
  const pathIds = new Set<string>();
  for (const path of doc.paths ?? []) {
    if (pathIds.has(path.id)) throw new Error(`Duplicate path: ${path.id}`);
    pathIds.add(path.id);
    sampleEffectPath(path);
  }
  for (const layer of doc.layers) {
    if (!layer.path) continue;
    if (!pathIds.has(layer.path.pathId))
      throw new Error(`Missing path: ${layer.path.pathId}`);
    if (
      layer.motion ||
      layer.transform.scale.some((v) => v !== 1) ||
      layer.tracks.some((t) => t.target.startsWith("transform.")) ||
      layer.overrides.some((t) => t.target.startsWith("transform."))
    )
      throw new Error(
        `Path attachments currently require a static rigid layer transform: ${layer.id}`,
      );
    if (layer.path.mode === "shape") {
      if (
        !["beam", "trail"].includes(layer.kind) &&
        !(layer.kind === "ring" && layer.geometry?.type === "ribbon") &&
        !(
          layer.kind === "shell" &&
          ["auto", "sphere", "teardrop"].includes(layer.geometry?.type ?? "")
        )
      )
        throw new Error(
          `Path shape supports beams, trails and ribbons: ${layer.id}`,
        );
      if (layer.geometry?.type === "lightning" && !layer.geometry.lightning)
        throw new Error(
          `Path lightning requires a procedural bolt specification: ${layer.id}`,
        );
    } else {
      const e = layer.emitter;
      if (layer.kind !== "particles" || !e)
        throw new Error(`Path motion requires particles: ${layer.id}`);
      if (
        e.sub ||
        doc.layers.some((l) => l.emitter?.sub?.parentLayerId === layer.id)
      )
        throw new Error(`Path sub-emitters are not supported yet: ${layer.id}`);
      if (e.forces.curl || e.forces.vortex || e.forces.floor)
        throw new Error(
          `Path particles currently support gravity, wind and drag only: ${layer.id}`,
        );
      if (
        e.shape.type === "line" &&
        (e.shape.axis[0] !== 0 ||
          e.shape.axis[1] !== 0 ||
          e.shape.axis[2] !== 1)
      )
        throw new Error(`Path line emission uses local +Z: ${layer.id}`);
      if (
        layer.path.mode === "follow" &&
        (e.velocity.mode !== "directional" ||
          e.velocity.direction[0] !== 0 ||
          e.velocity.direction[1] !== 0 ||
          e.velocity.direction[2] !== 1 ||
          e.velocity.angle !== 0)
      )
        throw new Error(
          `Follow mode requires directional +Z velocity: ${layer.id}`,
        );
      if (e.shape.type !== "point" && e.shape.type !== "line")
        throw new Error(
          `Path emission currently supports point or line shapes: ${layer.id}`,
        );
    }
  }
}

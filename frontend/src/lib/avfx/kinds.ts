/** Lightweight UI capability list; validation and renderer imports stay lazy. */
export const AVFX_GEOMETRY_KINDS = new Set(["ring", "shell", "trail", "beam", "sprite", "decal"]);
export const AVFX_GENERATOR_KINDS = new Set(["blob", "crystals", "splash", "ribbon", "wireBurst", "arcs", "streakBurst", "sheets", "crescent", "licks"]);
export const isAvfxKind = (kind: string) => kind === "particles" || kind === "reflection" || AVFX_GEOMETRY_KINDS.has(kind) || AVFX_GENERATOR_KINDS.has(kind);

/** Export stays available when at least one enabled layer is supported. */
export function hasExportableAvfxLayers(layers: readonly { kind: string; enabled: boolean }[]) {
  return layers.some(layer => layer.enabled && isAvfxKind(layer.kind));
}

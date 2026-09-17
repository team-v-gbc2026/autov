/** Lightweight UI capability list; validation and renderer imports stay lazy. */
export const AVFX_GEOMETRY_KINDS = new Set(["ring", "shell", "trail", "beam", "sprite", "decal"]);
export const isAvfxKind = (kind: string) => kind === "particles" || AVFX_GEOMETRY_KINDS.has(kind);

/** Studio export is all-or-nothing; the dev workbench may explicitly exclude layers. */
export function hasOnlyAvfxLayers(layers: readonly { kind: string; enabled: boolean }[]) {
  return layers.some(layer => layer.enabled) && layers.every(layer => isAvfxKind(layer.kind));
}

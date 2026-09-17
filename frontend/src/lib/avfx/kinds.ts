/** Lightweight UI capability list; validation and renderer imports stay lazy. */
export const AVFX_GEOMETRY_KINDS = new Set(["ring", "shell", "trail", "beam", "sprite", "decal"]);
export const isAvfxKind = (kind: string) => kind === "particles" || AVFX_GEOMETRY_KINDS.has(kind);

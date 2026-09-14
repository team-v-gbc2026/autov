/**
 * Effect placement: where the authored effect sits in the workspace.
 *
 * # The authoring contract
 *
 * Every effect document is authored in its own coordinate frame:
 *
 * - origin at (0, 0, 0), up is +Y, forward is +Z
 * - distances in meters, angles in radians
 * - layer positions, emission directions, motion paths and forces are all
 *   effect-local — none of them reference the workspace
 *
 * Generation and agent edits work exclusively in that local frame, which is
 * what makes a document portable: the same JSON produces the same effect in the
 * studio, in a capture harness and in an exported runtime.
 *
 * Imported documents may carry an authoringFrame that identifies their semantic
 * source and orientation. Rendering first removes that frame, then applies
 * placement: world = placement * inverse(authoringFrame) * authored coordinates.
 * New documents use an identity authoringFrame.
 *
 * Placement is the single transform from that local frame into the workspace.
 * It is deliberately NOT part of the effect document — the same reasoning as
 * the backdrop (see backdrop-settings.ts). A document stays comparable and
 * unchanged by wherever the viewer happens to have dragged it, and an agent
 * editing an effect never has to reason about, or accidentally clobber, the
 * editor's placement.
 *
 * Identity placement reproduces the pre-placement behaviour exactly, so every
 * existing effect and every stored fixture keeps its appearance.
 *
 * This module is intentionally free of three.js imports: `studio.tsx` reads
 * placement statically, while the runtime is loaded dynamically to keep
 * three.js out of the main bundle. Matrix composition lives in the runtime.
 */

/** Rotation is an XYZ-ordered Euler triple in radians, matching three's default. */
export type EffectPlacement = {
  position: [number, number, number];
  rotation: [number, number, number];
};

/** The effect sits at the workspace origin, unrotated: pre-placement behaviour. */
export const IDENTITY_PLACEMENT: EffectPlacement = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export function clonePlacement(placement: EffectPlacement): EffectPlacement {
  return {
    position: [...placement.position],
    rotation: [...placement.rotation],
  };
}

export function isIdentityPlacement(placement: EffectPlacement): boolean {
  return placementsEqual(placement, IDENTITY_PLACEMENT);
}

/** Exact comparison: values come from the same slider/gizmo, never from arithmetic drift. */
export function placementsEqual(a: EffectPlacement, b: EffectPlacement): boolean {
  return (
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2] &&
    a.rotation[0] === b.rotation[0] &&
    a.rotation[1] === b.rotation[1] &&
    a.rotation[2] === b.rotation[2]
  );
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Anything unrecognised falls back to identity rather than throwing: a corrupt
 * stored placement must never stop the workspace from opening. */
export function parsePlacement(raw: unknown): EffectPlacement {
  if (!raw || typeof raw !== "object") return clonePlacement(IDENTITY_PLACEMENT);
  const record = raw as Record<string, unknown>;
  return {
    position: isVec3(record.position)
      ? record.position
      : [...IDENTITY_PLACEMENT.position],
    rotation: isVec3(record.rotation)
      ? record.rotation
      : [...IDENTITY_PLACEMENT.rotation],
  };
}

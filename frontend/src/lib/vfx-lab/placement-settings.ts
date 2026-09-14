/**
 * Persistence for effect placement.
 *
 * Its own storage key, per workspace, for the same reason the backdrop has one
 * (backdrop-settings.ts): placement is a property of the viewer's workspace,
 * not of the effect. Switching fixtures, regenerating or importing a document
 * leaves placement alone, and an exported document carries none of it.
 */
import {
  IDENTITY_PLACEMENT,
  clonePlacement,
  parsePlacement,
  type EffectPlacement,
} from "./placement";

export const PLACEMENT_STORAGE_KEY = "autov.vfx-lab.placement.v1";

export function loadPlacement(storageKey = PLACEMENT_STORAGE_KEY): EffectPlacement {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return clonePlacement(IDENTITY_PLACEMENT);
    return parsePlacement(JSON.parse(raw));
  } catch {
    return clonePlacement(IDENTITY_PLACEMENT);
  }
}

export function savePlacement(
  placement: EffectPlacement,
  storageKey = PLACEMENT_STORAGE_KEY,
): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(placement));
    return true;
  } catch {
    return false;
  }
}

export function clearPlacement(storageKey = PLACEMENT_STORAGE_KEY): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}

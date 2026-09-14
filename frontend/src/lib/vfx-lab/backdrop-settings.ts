/**
 * Persistence for backdrop settings.
 *
 * Deliberately its own storage key and its own shape: a backdrop is a property
 * of the viewer, not of an effect. Keeping it out of the effect document means
 * documents stay portable, comparable and unchanged by whatever reference the
 * viewer happens to be showing — and switching fixtures does not disturb the
 * backdrop.
 */
import {
  DEFAULT_BACKDROP_SETTINGS,
  type BackdropSettings,
} from "./backdrop-controller";

export const BACKDROP_STORAGE_KEY = "autov.vfx-lab.backdrop.v1";

/** Object URLs die with the page, so a persisted one would always dangle. */
const isPersistableUrl = (url: string | null): url is string =>
  typeof url === "string" && url.length > 0 && !url.startsWith("blob:");

function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function parseBackdropSettings(raw: unknown): BackdropSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BACKDROP_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    url: isPersistableUrl(r.url as string | null) ? (r.url as string) : null,
    visible: typeof r.visible === "boolean" ? r.visible : DEFAULT_BACKDROP_SETTINGS.visible,
    position: isVec3(r.position) ? r.position : [...DEFAULT_BACKDROP_SETTINGS.position],
    rotation: isVec3(r.rotation) ? r.rotation : [...DEFAULT_BACKDROP_SETTINGS.rotation],
    scale:
      typeof r.scale === "number" && Number.isFinite(r.scale) && r.scale > 0
        ? r.scale
        : DEFAULT_BACKDROP_SETTINGS.scale,
  };
}

export function loadBackdropSettings(storageKey = BACKDROP_STORAGE_KEY): BackdropSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_BACKDROP_SETTINGS };
    return parseBackdropSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BACKDROP_SETTINGS };
  }
}

export function saveBackdropSettings(settings: BackdropSettings, storageKey = BACKDROP_STORAGE_KEY): boolean {
  try {
    const persistable: BackdropSettings = {
      ...settings,
      url: isPersistableUrl(settings.url) ? settings.url : null,
    };
    localStorage.setItem(storageKey, JSON.stringify(persistable));
    return true;
  } catch {
    return false;
  }
}

export function clearBackdropSettings(storageKey = BACKDROP_STORAGE_KEY): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* storage unavailable; nothing to clear */
  }
}

"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type BoardNote = { id: string; text: string; x: number; y: number; width?: number; height?: number; fontSize?: number };
const cache = new Map<string, string>();
const eventName = "autov:board-notes";
function subscribe(callback: () => void) {
  const changed = () => { cache.clear(); callback(); };
  window.addEventListener("storage", changed);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener(eventName, callback); };
}
function snapshot(key: string) {
  if (!cache.has(key)) {
    try { cache.set(key, localStorage.getItem(key) || "[]"); }
    catch { cache.set(key, "[]"); }
  }
  return cache.get(key)!;
}
function parse(raw: string): BoardNote[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is BoardNote => item && typeof item.id === "string" && typeof item.text === "string" && Number.isFinite(item.x) && Number.isFinite(item.y));
  } catch { return []; }
}
export function useBoardNotes(projectId: string) {
  const key = `autov.board-notes.${projectId}`;
  const raw = useSyncExternalStore(subscribe, () => snapshot(key), () => "[]");
  const notes = useMemo(() => parse(raw), [raw]);
  const change = useCallback((mutate: (current: BoardNote[]) => BoardNote[]) => {
    const next = JSON.stringify(mutate(parse(snapshot(key))));
    cache.set(key, next);
    window.dispatchEvent(new Event(eventName));
    try { localStorage.setItem(key, next); return true; } catch { return false; }
  }, [key]);
  return { notes, change };
}

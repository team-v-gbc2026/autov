"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export type BoardItem = { x: number; y: number; name?: string };
type Layout = Record<string, BoardItem>;
const snapshots = new Map<string, string>();
const EVENT = "autov:board-layout";
function subscribe(callback: () => void) {
  const changed = () => { snapshots.clear(); callback(); };
  window.addEventListener("storage", changed);
  window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener(EVENT, callback); };
}
function snapshot(key: string) {
  if (!snapshots.has(key)) {
    try { snapshots.set(key, localStorage.getItem(key) || "{}"); }
    catch { snapshots.set(key, "{}"); }
  }
  return snapshots.get(key)!;
}
function parse(raw: string): Layout {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, value]) => {
      const item = value as BoardItem;
      return item && Number.isFinite(item.x) && Number.isFinite(item.y) && (item.name === undefined || typeof item.name === "string");
    })) as Layout;
  } catch { return {}; }
}
export function useBoardLayout(projectId: string) {
  const key = `autov.board.${projectId}`;
  const raw = useSyncExternalStore(subscribe, () => snapshot(key), () => "{}");
  const layout = useMemo(() => parse(raw), [raw]);
  const update = useCallback((id: string, item: BoardItem) => {
    const next = JSON.stringify({ ...parse(snapshot(key)), [id]: item });
    snapshots.set(key, next);
    window.dispatchEvent(new Event(EVENT));
  }, [key]);
  const persist = useCallback(() => {
    try { localStorage.setItem(key, snapshot(key)); return true; }
    catch { return false; }
  }, [key]);
  return { layout, update, persist };
}
export function defaultPosition(index: number) { return { x: 24 + (index % 3) * 180, y: 24 + Math.floor(index / 3) * 174 }; }
export function referenceName(name: string) { return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60) || "Reference"; }

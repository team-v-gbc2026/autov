"use client";
import { useRef } from "react";
import styles from "./board.module.css";

export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Size = { width: number; height: number };
export default function ImageResizeHandle({ size, scale, corner, disabled, onResize, onCommit, label = "image" }: {
  label?: string; size: Size; scale: number; corner: ResizeCorner; disabled: boolean; onResize: (size: Size, corner: ResizeCorner) => void; onCommit: () => void;
}) {
  const drag = useRef<{ x: number; y: number; size: Size } | null>(null);
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  const finish = () => { if (drag.current) { drag.current = null; onCommit(); } };
  return <button type="button" className={`${styles.resizeHandle} board-no-drag`} style={{ left: left ? 0 : "100%", top: top ? 0 : "100%", transformOrigin: `${top ? "bottom" : "top"} ${left ? "right" : "left"}`, transform: `translate(${left ? "-100%" : "0"}, ${top ? "-100%" : "0"}) scale(${1 / scale})`, cursor: left === top ? "nwse-resize" : "nesw-resize" }} aria-label={`Resize ${label} from ${corner}. Drag or use arrow keys.`} title="Drag to resize" disabled={disabled}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); drag.current = { x: event.clientX, y: event.clientY, size }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start) return;
      event.stopPropagation();
      const dx = (event.clientX - start.x) / scale * (left ? -1 : 1);
      const dy = (event.clientY - start.y) / scale * (top ? -1 : 1);
      const { width, height } = start.size;
      const factor = Math.max(32 / Math.min(width, height), Math.min(32768 / Math.max(width, height), 1 + (dx * width + dy * height) / (width * width + height * height)));
      onResize({ width: width * factor, height: height * factor }, corner);
    }}
    onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => { if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const factor = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1.05 : 1 / 1.05; if (Math.min(size.width, size.height) * factor < 32 || Math.max(size.width, size.height) * factor > 32768) return; onResize({ width: size.width * factor, height: size.height * factor }, corner); onCommit(); }}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d={top ? (left ? "M13 3H3v10" : "M3 3h10v10") : (left ? "M13 13H3V3" : "M3 13h10V3")} /></svg>
  </button>;
}

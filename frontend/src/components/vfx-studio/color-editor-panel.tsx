"use client";

import { useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import ColorPicker from "./color-picker";
import styles from "./color-editor-panel.module.css";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function ColorEditorPanel({ label, value, onChange, onClose }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const move = (x: number, y: number) => {
    const bounds = panel.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({ x: clamp(x, 12, window.innerWidth - bounds.width - 12), y: clamp(y, 12, window.innerHeight - bounds.height - 12) });
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const bounds = panel.current?.getBoundingClientRect();
    if (!bounds) return;
    if (!position) setPosition({ x: bounds.left, y: bounds.top });
    drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return createPortal(
    <div ref={panel} className={styles.panel} style={position ? { left: position.x, top: position.y, transform: "none" } : undefined} role="dialog" aria-modal="false" aria-label={`Edit ${label} color`}>
      <header>
        <button type="button" className={styles.drag} onPointerDown={startDrag}
          onPointerMove={event => drag.current && move(event.clientX - drag.current.x, event.clientY - drag.current.y)}
          onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { drag.current = null; }} aria-label={`Move ${label} color picker`}>
          <span>⠿</span><strong>{label}</strong><i style={{ background: value }} />
        </button>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close color picker">×</button>
      </header>
      <ColorPicker label={label} value={value} onChange={onChange} />
    </div>,
    document.body,
  );
}

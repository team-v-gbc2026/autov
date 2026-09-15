"use client";

import { useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Curve } from "@/lib/vfx-lab/schema-v2";
import styles from "./curve-ramp-editor.module.css";

export type CurveRampTarget = { kind: "curve"; label: string; value: Curve };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const WIDTH = 320, HEIGHT = 150, PAD = 12;

function sampleCurve(curve: Curve, t: number) {
  if (t <= curve.keys[0][0]) return curve.keys[0][1];
  for (let index = 1; index < curve.keys.length; index += 1) {
    if (t > curve.keys[index][0]) continue;
    let amount = (t - curve.keys[index - 1][0]) / (curve.keys[index][0] - curve.keys[index - 1][0]);
    if (curve.ease === "smooth") amount = amount * amount * (3 - 2 * amount);
    return curve.keys[index - 1][1] + (curve.keys[index][1] - curve.keys[index - 1][1]) * amount;
  }
  return curve.keys[curve.keys.length - 1][1];
}

export default function CurveRampEditor({ target, onChange, onClose }: {
  target: CurveRampTarget; onChange: (value: Curve) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null), canvas = useRef<SVGSVGElement>(null);
  const dragPanel = useRef<{ x: number; y: number } | null>(null), dragPoint = useRef<number | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const [[low, high]] = useState(() => {
    const values = target.value.keys.map(key => key[1]), min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
    return [clamp(min - span * .2, -20, 20), clamp(max + span * .2, -20, 20)] as const;
  });
  const curve = target.value;
  const x = (time: number) => PAD + time * (WIDTH - PAD * 2);
  const y = (value: number) => PAD + (1 - (value - low) / Math.max(.001, high - low)) * (HEIGHT - PAD * 2);
  const fromPointer = (clientX: number, clientY: number) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds) return { time: 0, value: 0 };
    return {
      time: clamp(((clientX - bounds.left) / bounds.width * WIDTH - PAD) / (WIDTH - PAD * 2), 0, 1),
      value: clamp(high - (((clientY - bounds.top) / bounds.height * HEIGHT - PAD) / (HEIGHT - PAD * 2)) * (high - low), -20, 20),
    };
  };
  const updatePoint = (index: number, time: number, value: number) => {
    if (!Number.isFinite(time) || !Number.isFinite(value)) return;
    const before = index ? curve.keys[index - 1][0] + .001 : 0;
    const after = index < curve.keys.length - 1 ? curve.keys[index + 1][0] - .001 : 1;
    const keys = curve.keys.map(key => [...key] as [number, number]);
    keys[index] = [clamp(time, before, after), clamp(value, -20, 20)];
    onChange({ keys, ease: curve.ease });
  };
  const line = Array.from({ length: 121 }, (_, index) => {
    const time = index / 120;
    return `${x(time)},${y(sampleCurve(curve, time))}`;
  }).join(" ");
  const movePanel = (left: number, top: number) => {
    const bounds = panel.current?.getBoundingClientRect();
    if (bounds) setPosition({ x: clamp(left, 12, window.innerWidth - bounds.width - 12), y: clamp(top, 12, window.innerHeight - bounds.height - 12) });
  };
  const addPoint = (time: number, value: number) => {
    if (curve.keys.length >= 12 || time <= 0 || time >= 1) return;
    const keys = [...curve.keys.map(key => [...key] as [number, number]), [time, clamp(value, -20, 20)] as [number, number]].sort((a, b) => a[0] - b[0]);
    setSelected(keys.findIndex(key => key[0] === time));
    onChange({ keys, ease: curve.ease });
  };
  const removePoint = () => {
    if (curve.keys.length <= 2) return;
    const keys = curve.keys.filter((_, index) => index !== selected);
    setSelected(Math.min(selected, keys.length - 1));
    onChange({ keys, ease: curve.ease });
  };

  return createPortal(<div ref={panel} className={styles.panel} style={position ? { left: position.x, top: position.y, transform: "none" } : undefined} role="dialog" aria-modal="false" aria-label={`Edit ${target.label}`}>
    <header><button type="button" className={styles.drag}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => { if (event.button !== 0) return; const bounds = panel.current?.getBoundingClientRect(); if (!bounds) return; if (!position) setPosition({ x: bounds.left, y: bounds.top }); dragPanel.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => dragPanel.current && movePanel(event.clientX - dragPanel.current.x, event.clientY - dragPanel.current.y)}
      onPointerUp={event => { dragPanel.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragPanel.current = null; }} aria-label={`Move ${target.label} editor`}>
      <span>⠿</span><strong>{target.label}</strong><small>curve</small></button>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close curve editor">×</button></header>
    <div className={styles.canvasWrap}>
      <svg ref={canvas} className={styles.graph} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onDoubleClick={event => { const point = fromPointer(event.clientX, event.clientY); addPoint(point.time, point.value); }} role="img" aria-label={`${target.label} curve graph. Double click to add a point.`}>
        <path className={styles.grid} d={`M${PAD} ${PAD}V${HEIGHT - PAD}H${WIDTH - PAD} M${PAD} ${HEIGHT / 2}H${WIDTH - PAD} M${WIDTH / 4} ${PAD}V${HEIGHT - PAD} M${WIDTH / 2} ${PAD}V${HEIGHT - PAD} M${WIDTH * .75} ${PAD}V${HEIGHT - PAD}`} />
        <polyline className={styles.curve} points={line} />
        {curve.keys.map(([time, value], index) => <circle key={index} className={styles.point} data-selected={selected === index} cx={x(time)} cy={y(value)} r={selected === index ? 6 : 5} tabIndex={0} role="slider" aria-label={`Key ${index + 1}`} aria-valuetext={`${Math.round(time * 100)} percent, ${value.toFixed(2)}`}
          onPointerDown={event => { event.stopPropagation(); dragPoint.current = index; setSelected(index); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (dragPoint.current === index) { const point = fromPointer(event.clientX, event.clientY); updatePoint(index, point.time, point.value); } }}
          onPointerUp={event => { dragPoint.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragPoint.current = null; }}
          onKeyDown={event => { const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0; const vertical = event.key === "ArrowDown" ? -1 : event.key === "ArrowUp" ? 1 : 0; if (!horizontal && !vertical) return; event.preventDefault(); const scale = event.shiftKey ? 5 : 1; updatePoint(index, time + horizontal * .01 * scale, value + vertical * (high - low) * .01 * scale); }} />)}
      </svg><span className={styles.high}>{high.toFixed(2)}</span><span className={styles.low}>{low.toFixed(2)}</span>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.segmented}>{(["linear", "smooth"] as const).map(ease => <button type="button" key={ease} aria-pressed={curve.ease === ease} onClick={() => onChange({ keys: curve.keys, ease })}>{ease}</button>)}</div>
      <div className={styles.pointInspector}><strong>K{selected + 1}</strong>
      <label>Time<input type="number" min="0" max="1" step="0.01" value={curve.keys[selected][0]} onChange={event => updatePoint(selected, event.target.valueAsNumber, curve.keys[selected][1])} /></label>
      <label>Value<input type="number" min="-20" max="20" step="0.01" value={curve.keys[selected][1]} onChange={event => updatePoint(selected, curve.keys[selected][0], event.target.valueAsNumber)} /></label>
      <button type="button" className={styles.delete} disabled={curve.keys.length <= 2} onClick={removePoint} aria-label={`Delete key ${selected + 1}`}>×</button></div>
    </div>
  </div>, document.body);
}

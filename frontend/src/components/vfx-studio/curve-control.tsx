"use client";

import { useState } from "react";
import { compileCurveFormula, type Curve, type CurveFormula } from "@/lib/vfx-lab/schema-v2";
import styles from "./emitter-controls.module.css";

export default function CurveControl({ label, domain, value, onChange }: {
  label: string; domain: string; value: Curve; onChange: (curve: Curve) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flat = value.keys.every(key => key[1] === value.keys[0][1]);
  const formula: CurveFormula = value.formula ?? {
    kind: flat ? "constant" : "ramp", start: value.keys[0][1],
    end: value.keys[value.keys.length - 1][1], peak: Math.max(...value.keys.map(key => key[1])), attack: 0.15, release: 0.65,
  };
  const update = (patch: Partial<CurveFormula>) => {
    const next = { ...formula, ...patch };
    onChange({ formula: next, ...compileCurveFormula(next) });
  };
  const sample = (t: number) => {
    const keys = value.keys;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
      let u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      if (value.ease === "smooth") u = u * u * (3 - 2 * u);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u;
    }
    return keys[keys.length - 1][1];
  };
  const low = Math.min(0, ...value.keys.map(key => key[1]));
  const high = Math.max(low + 1, ...value.keys.map(key => key[1]));
  const points = Array.from({ length: 81 }, (_, i) => `${i * 3},${58 - (sample(i / 80) - low) / (high - low) * 52}`).join(" ");
  return <div className={styles.parameter}>
    <div className={styles.parameterHeading}><span>{label}</span><button type="button" className={styles.curveToggle} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{flat ? `Constant · ${Number(value.keys[0][1].toFixed(2))}` : "Curve"}</button></div>
    {flat && !expanded && <input className={styles.range} type="range" aria-label={`${label} constant`} min={-20} max={20} step={0.01} value={formula.start} onChange={event => update({ kind: "constant", start: Number(event.target.value) })} />}
    {expanded && <div className={styles.curveEditor}>
      <span className={styles.timing}>{domain} · 0–100%</span>
      <svg viewBox="0 0 240 64" role="img" aria-label={`${label} curve preview, range ${low} to ${high}`}><path d="M0 58H240 M0 6V58 M120 6V58 M240 6V58" stroke="#ffffff18" fill="none" /><polyline points={points} fill="none" stroke="#c9b184" strokeWidth="2" /></svg>
      <select aria-label={`${label} curve preset`} value={value.formula?.kind ?? (flat ? "constant" : "keys")} onChange={event => update({ kind: event.target.value as CurveFormula["kind"] })}>
        {!value.formula && !flat && <option value="keys" disabled>Authored keyframes</option>}
        <option value="constant">Constant</option><option value="ramp">Linear ramp</option><option value="smooth">Smooth ramp</option><option value="envelope">Attack / hold / release</option>
      </select>
      {(value.formula || flat) && (formula.kind === "constant" ? ["start"] as const : formula.kind === "envelope" ? ["start", "peak", "end", "attack", "release"] as const : ["start", "end"] as const).map(field => <label className={styles.parameterHeading} key={field}><span>{field === "start" && formula.kind === "constant" ? "Value" : field}</span><input className={styles.number} aria-label={`${label} ${field}`} type="number" min={field === "attack" ? 0.001 : field === "release" ? 0.501 : -20} max={field === "attack" ? 0.499 : field === "release" ? 0.999 : 20} step={0.01} value={formula[field]} onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n) && event.target.validity.valid) update({ [field]: n }); }} /></label>)}
    </div>}
  </div>;
}

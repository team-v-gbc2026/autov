"use client";

import { useState } from "react";
import type { ParameterName, VfxLayer } from "./ui-model";
import styles from "./emitter-controls.module.css";

function ParameterControl({ name, value, onChange }: { name: ParameterName; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className={styles.parameter}>
    <div className={styles.parameterHeading}>
      <label htmlFor={`emitter-parameter-${name}`}>{name}</label>
      <input
        className={styles.number}
        type="number"
        aria-label={`Emitter ${name.toLowerCase()} value`}
        min={0}
        max={100}
        step="any"
        value={draft ?? Number(value.toFixed(2))}
        onFocus={event => { setDraft(String(value)); event.currentTarget.select(); }}
        onChange={event => setDraft(event.target.value)}
        onBlur={event => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.max(0, Math.min(100, next)));
          setDraft(null);
        }}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.currentTarget.value = String(value);
            event.currentTarget.blur();
          } else if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
    <input
      id={`emitter-parameter-${name}`}
      className={styles.range}
      type="range"
      aria-label={`Emitter ${name.toLowerCase()}`}
      min={0}
      max={100}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      style={{ backgroundImage: `linear-gradient(to right, #c9b184 ${value}%, #ffffff12 ${value}%)` }}
    />
  </div>;
}

export default function EmitterControls({ layer, onChange }: { layer: VfxLayer; onChange: (patch: Partial<VfxLayer>) => void }) {
  const groups: { title: string; parameters: ParameterName[] }[] = [
    { title: "Shape & presence", parameters: ["Intensity", "Radius", "Opacity"] },
    { title: "Motion & detail", parameters: ["Speed", "Turbulence", "Erosion"] },
  ];
  return <div className={styles.inspector}>
    <div className={styles.metadata}>
      <span className={styles.kind}>{layer.kind}</span>
      <span className={styles.timing} title="Emission start and end">{layer.start.toFixed(2)} <span>→</span> {layer.end.toFixed(2)} s</span>
    </div>
    <section className={styles.section} aria-label="Emitter appearance">
      <h3>Appearance</h3>
      <div className={styles.colors}>
        {([['color', 'Primary'], ['secondaryColor', 'Secondary']] as const).map(([property, label]) => (
          <label className={styles.color} key={property}>
            <span className={styles.swatch} style={{ background: layer[property] }} />
            <span className={styles.colorText}><span>{label}</span><code>{layer[property].toUpperCase()}</code></span>
            <input type="color" aria-label={`Emitter ${label.toLowerCase()} color`} value={layer[property]} onChange={event => onChange({ [property]: event.target.value })} />
          </label>
        ))}
      </div>
      <div className={styles.blendRow}>
        <span>Blend mode</span>
        <div className={styles.segmented} role="group" aria-label="Emitter blend mode">
          {(['normal', 'additive'] as const).map(blend => <button key={blend} type="button" aria-pressed={layer.blend === blend} onClick={() => onChange({ blend })}>{blend === 'normal' ? 'Normal' : 'Additive'}</button>)}
        </div>
      </div>
    </section>
    {groups.map(group => <section className={styles.section} key={group.title} aria-label={group.title}>
      <h3>{group.title}</h3>
      <div className={styles.parameters}>
        {group.parameters.map(name => <ParameterControl key={`${layer.id}-${name}`} name={name} value={layer.parameters[name]} onChange={value => onChange({ parameters: { ...layer.parameters, [name]: value } })} />)}
      </div>
    </section>)}
  </div>;
}

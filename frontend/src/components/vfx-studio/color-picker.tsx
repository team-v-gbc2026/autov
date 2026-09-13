"use client";

import { useState } from "react";
import styles from "./emitter-controls.module.css";

export default function ColorPicker({ label, value, onChange, onBack }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const channels = [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16));
  const hex = (values: number[]) => `#${values.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
  const commit = () => {
    const next = draft?.trim().replace(/^#/, "");
    if (next && /^[\da-f]{6}$/i.test(next)) onChange(`#${next.toLowerCase()}`);
    else if (next && /^[\da-f]{3}$/i.test(next)) onChange(`#${[...next].map(char => char + char).join("").toLowerCase()}`);
    setDraft(null);
  };
  return <section className={styles.picker} aria-label={`${label} color picker`}>
    <div className={styles.pickerHeading}>
      <button type="button" onClick={onBack} aria-label="Back to appearance">← {label}</button>
      <span className={styles.pickerPreview} style={{ background: value }} aria-hidden="true" />
      <input className={styles.hex} aria-label={`${label} hex color`} value={draft ?? value.toUpperCase()} spellCheck={false} maxLength={7}
        onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { event.stopPropagation(); setDraft(null); }
        }} />
    </div>
    {['Red', 'Green', 'Blue'].map((name, index) => <label className={styles.channel} key={name}>
      <span>{name}</span>
      <input type="range" className={styles.range} aria-label={`${label} ${name.toLowerCase()}`} min={0} max={255} value={channels[index]}
        style={{ backgroundImage: `linear-gradient(to right, ${hex(channels.map((channel, i) => i === index ? 0 : channel))}, ${hex(channels.map((channel, i) => i === index ? 255 : channel))})` }}
        onChange={event => { setDraft(null); onChange(hex(channels.map((channel, i) => i === index ? Number(event.target.value) : channel))); }} />
      <output>{channels[index]}</output>
    </label>)}
  </section>;
}

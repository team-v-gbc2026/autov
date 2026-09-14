"use client";

import { useMemo, useRef, useState } from "react";
import {
  MESH_KINDS_V2,
  validateWorkspaceDocumentV2,
  type LayerV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";
import styles from "./authoring-panel.module.css";
import CurveRampEditor, { type CurveRampTarget } from "./curve-ramp-editor";
import ColorEditorPanel from "./color-editor-panel";

type PathPart = string | number;
type JsonObject = Record<string, unknown>;
type PanelEntry = { name: string; value: unknown; path: PathPart[] };
type TabName = "Appearance" | "Shape" | "Motion";

const READ_ONLY_KEYS = new Set(["id", "kind", "type"]);
const COLOR_KEY = /(?:color|tint|shadow|body|highlight|fill|ink|cold|hot)$/i;

const ENUMS: Record<string, readonly string[]> = {
  role: ["anticipation", "primary", "impact", "secondary", "residue"],
  "material.blend": ["additive", "alpha", "premultiplied", "screen"],
  "material.shading": ["unlit", "litSmoke"],
  "material.ramp.space": ["life", "layerTime", "surface", "height", "radial", "sprite"],
  "material.ramp.blend.space": ["life", "layerTime", "surface", "height", "radial", "sprite"],
  "material.mask.flipbook.mode": ["life", "fps"],
  "emitter.spawn.mode": ["burst", "rate", "path", "frontAnchored"],
  "emitter.render.anchor": ["center", "head"],
  frame: ["camera"],
};

const LABELS: Record<string, string> = {
  uv: "UV",
  fps: "FPS",
  aa: "Antialiasing",
  sdf: "SDF",
  rgb: "RGB",
};

function labelFor(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .split(" ")
    .map((word) => LABELS[word.toLowerCase()] ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function present(value: unknown) {
  return value !== null && value !== undefined &&
    (!Array.isArray(value) || value.length > 0);
}

function entry(name: string, value: unknown, ...path: PathPart[]): PanelEntry[] {
  return present(value) ? [{ name, value, path }] : [];
}

function withoutKeys(value: object, keys: readonly string[]): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

/**
 * The document schema is broad, but an individual layer is not. Build the
 * inspector from the slots the selected layer actually carries and put each
 * slot where an artist expects to find it.
 */
export function layerPanelTabs(layer: LayerV2): Record<TabName, PanelEntry[]> {
  const material = layer.material;
  const emitter = layer.emitter;
  const materialDetail = material ? (() => {
    const fields = withoutKeys(material, ["blend", "shading"]);
    return {
      ...fields,
      ramp: {
        ...material.ramp,
        // Keep complete stops in this view: ValueEditor recognizes the object
        // as a ramp and replaces it with one compact graph-editor affordance.
        stops: material.ramp.stops,
      },
    };
  })() : null;
  const lightDetail = layer.light ? withoutKeys(layer.light, ["color"]) : null;
  const appearance: PanelEntry[] = [
    ...entry("Material detail", materialDetail, "material"),
    ...entry("Light detail", lightDetail, "light"),
    ...entry("Reflection opacity", layer.reflection?.opacity, "reflection", "opacity"),
    ...entry("Reflection blur", layer.reflection?.blur, "reflection", "blur"),
  ];
  const shape: PanelEntry[] = [
    ...entry("Transform", layer.transform, "transform"),
    ...entry("Geometry", layer.geometry, "geometry"),
    ...entry("Particle count", emitter?.count, "emitter", "count"),
    ...entry("Emitter shape", emitter?.shape, "emitter", "shape"),
    ...entry("Particle render", emitter?.render, "emitter", "render"),
    ...entry("Blob", layer.blob, "blob"),
    ...entry("Splash", layer.splash, "splash"),
    ...entry("Ribbon", layer.ribbon, "ribbon"),
    ...entry("Wire burst", layer.wireBurst, "wireBurst"),
    ...entry("Crystals", layer.crystals, "crystals"),
    ...entry("Arcs", layer.arcs, "arcs"),
    ...entry("Streak burst", layer.streakBurst, "streakBurst"),
    ...entry("Sheets", layer.sheets, "sheets"),
    ...entry("Crescent", layer.crescent, "crescent"),
    ...entry("Licks", layer.licks, "licks"),
    ...entry("Reflection shape", layer.reflection ? {
      sourceLayerId: layer.reflection.sourceLayerId,
      axis: layer.reflection.axis,
      scale: layer.reflection.scale,
    } : null, "reflection"),
  ];
  const motion: PanelEntry[] = [
    ...entry("Start", layer.start, "start"),
    ...entry("End", layer.end, "end"),
    ...entry("Motion", layer.motion, "motion"),
    ...entry("Jitter", layer.jitter, "jitter"),
    ...entry("Collapse", layer.collapse, "collapse"),
    ...entry("Event window", layer.window, "window"),
    ...entry("Spawn", emitter?.spawn, "emitter", "spawn"),
    ...entry("Velocity", emitter?.velocity, "emitter", "velocity"),
    ...entry("Forces", emitter?.forces, "emitter", "forces"),
    ...entry("Particle trail", emitter?.trail, "emitter", "trail"),
    ...entry("Tracks", layer.tracks, "tracks"),
    ...entry("Scoped overrides", layer.overrides, "overrides"),
  ];
  return { Appearance: appearance, Shape: shape, Motion: motion };
}

function SegmentedControl({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return <div className={styles.controlRow}>
    <span>{label}</span>
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  </div>;
}

function AppearanceBasics({ layer, commit }: {
  layer: LayerV2;
  commit: (path: PathPart[], value: unknown) => void;
}) {
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const stops = layer.material?.ramp.stops ?? [];
  const colors = stops.length
    ? [
        { label: "Primary", value: stops[0].color, path: ["material", "ramp", "stops", 0, "color"] as PathPart[] },
        ...(stops.length > 1 ? [{ label: "Secondary", value: stops[stops.length - 1].color, path: ["material", "ramp", "stops", stops.length - 1, "color"] as PathPart[] }] : []),
      ]
    : layer.light
      ? [{ label: "Light", value: layer.light.color, path: ["light", "color"] as PathPart[] }]
      : layer.reflection
        ? [{ label: "Tint", value: layer.reflection.tint, path: ["reflection", "tint"] as PathPart[] }]
        : [];
  const supportsLitSmoke = layer.kind === "particles" ||
    (MESH_KINDS_V2 as readonly string[]).includes(layer.kind);

  return <section className={styles.basics} aria-label="Appearance essentials">
    {!!colors.length && <div className={styles.palette}>
      {colors.map((color, index) => <button type="button" key={color.label} className={styles.swatchField} aria-expanded={selectedColor === index} onClick={() => setSelectedColor(index)}>
        <i style={{ background: color.value }} aria-hidden="true" />
        <span><b>{color.label}</b><code>{color.value.toUpperCase()}</code></span>
      </button>)}
    </div>}
    {selectedColor !== null && colors[selectedColor] && <ColorEditorPanel
      label={colors[selectedColor].label}
      value={colors[selectedColor].value}
      onClose={() => setSelectedColor(null)}
      onChange={value => commit(colors[selectedColor].path, value)}
    />}
    {layer.material && supportsLitSmoke && <SegmentedControl
      label="Shading"
      value={layer.material.shading}
      options={[{ value: "unlit", label: "Unlit" }, { value: "litSmoke", label: "Lit smoke" }]}
      onChange={value => commit(["material", "shading"], value)}
    />}
    {layer.material && <SegmentedControl
      label="Blend"
      value={layer.material.blend}
      options={[
        { value: "additive", label: "Add" },
        { value: "alpha", label: "Alpha" },
        { value: "premultiplied", label: "Premult" },
        { value: "screen", label: "Screen" },
      ]}
      onChange={value => commit(["material", "blend"], value)}
    />}
  </section>;
}

function cloneWithValue<T>(source: T, path: PathPart[], value: unknown): T {
  const copy = structuredClone(source);
  let cursor: unknown = copy;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = (cursor as JsonObject)[path[index] as string];
  }
  (cursor as JsonObject)[path[path.length - 1] as string] = value;
  return copy;
}

function pathName(path: PathPart[]) {
  return path.filter((part) => typeof part === "string").join(".");
}

function curveOrRamp(value: unknown): "curve" | "ramp" | null {
  if (!isObject(value)) return null;
  if (Array.isArray(value.keys) && (value.ease === "linear" || value.ease === "smooth")) return "curve";
  if (Array.isArray(value.stops) && value.stops.every(stop => isObject(stop) && typeof stop.t === "number" && typeof stop.color === "string" && typeof stop.intensity === "number")) return "ramp";
  return null;
}

function InlineRampField({ name, value, path, commit }: {
  name: string;
  value: RampLike;
  path: PathPart[];
  commit: (path: PathPart[], value: unknown) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const chooseNearest = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const t = bounds.width ? (event.clientX - bounds.left) / bounds.width : 0;
    let nearest = 0;
    for (let index = 1; index < value.stops.length; index += 1)
      if (Math.abs(value.stops[index].t - t) < Math.abs(value.stops[nearest].t - t)) nearest = index;
    setSelected(nearest);
  };
  const setStopPosition = (index: number, proposed: number) => {
    const before = index ? value.stops[index - 1].t + 0.001 : 0;
    const after = index < value.stops.length - 1 ? value.stops[index + 1].t - 0.001 : 1;
    const t = Math.max(before, Math.min(after, proposed));
    commit(path, {
      ...value,
      stops: value.stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, t } : stop),
    });
  };
  const moveStop = (index: number, clientX: number) => {
    const bounds = bar.current?.getBoundingClientRect();
    if (bounds?.width) setStopPosition(index, (clientX - bounds.left) / bounds.width);
  };
  const gradient = `linear-gradient(to right, ${value.stops.map(stop => `${stop.color} ${stop.t * 100}%`).join(", ")})`;
  return <div className={styles.inlineRamp}>
    <div className={styles.rampHeading}><span>{labelFor(name)}</span><small>{value.stops.length} colors</small></div>
    <div ref={bar} className={styles.rampBar} style={{ background: gradient }} onClick={chooseNearest} role="group" aria-label={`Edit ${labelFor(name)} color ramp`}>
      {value.stops.map((stop, index) => <button
        type="button"
        key={index}
        className={styles.rampHandle}
        style={{ left: `${stop.t * 100}%`, background: stop.color }}
        aria-label={`Color ${index + 1} at ${Math.round(stop.t * 100)} percent`}
        aria-pressed={selected === index}
        onClick={event => { event.stopPropagation(); setSelected(index); }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.stopPropagation();
          dragging.current = index;
          setSelected(index);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (dragging.current === index) {
            event.stopPropagation();
            moveStop(index, event.clientX);
          }
        }}
        onPointerUp={event => {
          dragging.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragging.current = null; }}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.shiftKey ? 0.05 : 0.01;
          setStopPosition(index, stop.t + (event.key === "ArrowRight" ? step : -step));
        }}
      />)}
    </div>
    {selected !== null && <ColorEditorPanel
      label={`Color ${selected + 1}`}
      value={value.stops[selected].color}
      onClose={() => setSelected(null)}
      onChange={color => commit(path, {
        ...value,
        stops: value.stops.map((stop, index) => index === selected ? { ...stop, color } : stop),
      })}
    />}
  </div>;
}

type RampLike = {
  stops: { t: number; color: string; intensity: number }[];
  [key: string]: unknown;
};

function PrimitiveField({
  name,
  value,
  path,
  readOnly,
  commit,
}: {
  name: string;
  value: string | number | boolean;
  path: PathPart[];
  readOnly: boolean;
  commit: (path: PathPart[], value: unknown) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const dotted = pathName(path);
  const choices = ENUMS[dotted];
  const id = `layer-${path.map(String).join("-")}`;

  if (typeof value === "boolean")
    return (
      <label className={styles.toggle} htmlFor={id}>
        <span>{labelFor(name)}</span>
        <input id={id} type="checkbox" checked={value} disabled={readOnly} onChange={(event) => commit(path, event.target.checked)} />
      </label>
    );

  if (choices)
    return (
      <label className={styles.field} htmlFor={id}>
        <span>{labelFor(name)}</span>
        <select id={id} value={String(value)} disabled={readOnly} onChange={(event) => commit(path, event.target.value)}>
          {choices.map((choice) => <option key={choice}>{choice}</option>)}
        </select>
      </label>
    );

  const isColor = typeof value === "string" && COLOR_KEY.test(name) && /^#[0-9a-f]{6}$/i.test(value);
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{labelFor(name)}</span>
      <span className={styles.inputRow}>
        {isColor && <input className={styles.color} aria-label={`${labelFor(name)} color`} type="color" value={value} disabled={readOnly} onChange={(event) => commit(path, event.target.value)} />}
        <input
          id={id}
          className={styles.input}
          type={typeof value === "number" ? "number" : "text"}
          step={typeof value === "number" ? "any" : undefined}
          value={draft}
          readOnly={readOnly}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (readOnly) return;
            const next = typeof value === "number" ? Number(draft) : draft;
            if ((typeof next === "number" && !Number.isFinite(next)) || next === value) {
              setDraft(String(value));
              return;
            }
            commit(path, next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(String(value));
              event.currentTarget.blur();
            }
          }}
        />
      </span>
    </label>
  );
}

function ValueEditor({
  name,
  value,
  path,
  depth,
  commit,
  openGraph,
}: {
  name: string;
  value: unknown;
  path: PathPart[];
  depth: number;
  commit: (path: PathPart[], value: unknown) => void;
  openGraph: (target: CurveRampTarget, path: PathPart[]) => void;
}) {
  if (value === null)
    return null;
  if (["string", "number", "boolean"].includes(typeof value))
    return <PrimitiveField key={String(value)} name={name} value={value as string | number | boolean} path={path} readOnly={READ_ONLY_KEYS.has(name)} commit={commit} />;

  const graphKind = curveOrRamp(value);
  if (graphKind === "ramp")
    return <InlineRampField name={name} value={value as RampLike} path={path} commit={commit} />;
  if (graphKind === "curve") {
    const count = ((value as JsonObject).keys as unknown[]).length;
    return <button type="button" className={styles.graphField} onClick={() => openGraph({ kind: "curve", label: labelFor(name), value } as CurveRampTarget, path)}>
      <span>{labelFor(name)}</span><b>{count} keys · Edit ↗</b>
    </button>;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : isObject(value)
      ? Object.entries(value)
      : [];
  if (!entries.length) return <div className={styles.nullField}><span>{labelFor(name)}</span><em>Empty</em></div>;

  return (
    <details className={depth === 0 ? styles.section : styles.group} open={depth < 2}>
      <summary>
        <span>{Array.isArray(value) ? `${labelFor(name)} · ${value.length}` : labelFor(name)}</span>
        <small>{Array.isArray(value) ? "array" : "group"}</small>
      </summary>
      <div className={styles.fields}>
        {entries.map(([key, child]) => (
          <ValueEditor key={key} name={Array.isArray(value) ? `Item ${Number(key) + 1}` : key} value={child} path={[...path, Array.isArray(value) ? Number(key) : key]} depth={depth + 1} commit={commit} openGraph={openGraph} />
        ))}
      </div>
    </details>
  );
}

export default function AuthoringPanel({
  document,
  layer,
  onChange,
}: {
  document: VfxDocumentV2;
  layer: LayerV2;
  onChange: (layer: LayerV2) => void;
}) {
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabName>("Appearance");
  const [graph, setGraph] = useState<{ target: CurveRampTarget; path: PathPart[] } | null>(null);
  const tabs = useMemo(() => layerPanelTabs(layer), [layer]);
  const commit = (path: PathPart[], value: unknown) => {
    const next = cloneWithValue(layer, path, value);
    try {
      validateWorkspaceDocumentV2({
        ...document,
        layers: document.layers.map((item) => item.id === layer.id ? next : item),
      });
      setError("");
      onChange(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That value is not valid for this layer.");
      return false;
    }
    return true;
  };

  return (
    <section className={styles.inspector} aria-label={`Edit ${layer.name}`}>
      <header className={styles.header}>
        <div><strong>{layer.name}</strong><span>{layer.kind}</span></div>
        <p>{tabs[tab].length} applicable {tab.toLowerCase()} groups</p>
      </header>
      <nav className={styles.tabs} aria-label="Layer settings section">
        {(Object.keys(tabs) as TabName[]).map((name) => (
          <button key={name} type="button" aria-pressed={tab === name} onClick={() => { setTab(name); setError(""); }}>
            {name}<small>{tabs[name].length}</small>
          </button>
        ))}
      </nav>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.scroll}>
        {tab === "Appearance" && <AppearanceBasics layer={layer} commit={commit} />}
        {tabs[tab].map(({ name, value, path }) => (
          <ValueEditor key={path.join(".")} name={name} value={value} path={path} depth={0} commit={commit} openGraph={(target, targetPath) => setGraph({ target, path: targetPath })} />
        ))}
        {!tabs[tab].length && <p className={styles.empty}>This layer has no {tab.toLowerCase()} parameters.</p>}
      </div>
      {graph && <CurveRampEditor
        target={graph.target}
        onClose={() => setGraph(null)}
        onChange={value => {
          if (commit(graph.path, value))
            setGraph(current => current ? { ...current, target: { ...current.target, value } as CurveRampTarget } : null);
        }}
      />}
    </section>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import {
  RENDER_MODES,
  SPAWN_MODES,
  TRAIL_RAMP_SPACES,
  VELOCITY_MODES,
  MESH_KINDS_V2,
  PROCEDURALS_V2,
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
type AppearanceTabName = "Main" | "Texture" | "Noise" | "Effects";

const READ_ONLY_KEYS = new Set(["id", "kind", "type"]);
const COLOR_KEY = /(?:color|tint|shadow|body|highlight|fill|ink|cold|hot)$/i;

const ENUMS: Record<string, readonly string[]> = {
  role: ["anticipation", "primary", "impact", "secondary", "residue"],
  "material.blend": ["additive", "alpha", "premultiplied", "screen"],
  "material.shading": ["unlit", "litSmoke"],
  "material.ramp.space": ["life", "layerTime", "surface", "height", "radial", "sprite"],
  "material.ramp.blend.space": ["life", "layerTime", "surface", "height", "radial", "sprite"],
  "material.mask.flipbook.mode": ["life", "fps"],
  "emitter.spawn.mode": SPAWN_MODES,
  "emitter.velocity.mode": VELOCITY_MODES,
  "emitter.render.mode": RENDER_MODES,
  "emitter.render.sortMode": ["none", "byDistance"],
  "emitter.render.anchor": ["center", "head"],
  "emitter.render.retract.from": ["root", "tip"],
  "emitter.trail.ramp.space": TRAIL_RAMP_SPACES,
  "material.reveal.mode": ["radial", "scan", "perimeter"],
  "material.toon.colorSource": ["fixed", "ramp"],
  "material.screentone.space": ["world", "uv"],
  frame: ["camera"],
};

const LABELS: Record<string, string> = {
  uv: "UV",
  fps: "FPS",
  aa: "Antialiasing",
  sdf: "SDF",
  rgb: "RGB",
};

const MATERIAL_EFFECTS = [
  ["erosion", "Dissolve"], ["fresnel", "Edge glow"],
  ["toon", "Toon shading"], ["outline", "Outline"],
  ["opaqueUntil", "Solid phase"], ["rgbSplit", "RGB split"],
  ["reveal", "Reveal"], ["lattice", "Lattice"],
  ["planeGlow", "Ground glow"], ["ripples", "Ripples"],
  ["stripes", "Stripes"], ["flicker", "Flicker"],
  ["sdfLine", "Line detail"], ["beads", "Beads"],
  ["flow", "Flow"], ["swirl", "Swirl"],
  ["streaks", "Streaks"], ["creases", "Creases"],
  ["screentone", "Screentone"], ["symbol", "Symbol"],
] as const;

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

function orderedObjectEntries(value: JsonObject) {
  return Object.entries(value)
    .filter(([key, child]) => !READ_ONLY_KEYS.has(key) && child !== null)
    .sort(([, a], [, b]) => {
      const aGroup = (Array.isArray(a) || isObject(a)) && curveOrRamp(a) === null;
      const bGroup = (Array.isArray(b) || isObject(b)) && curveOrRamp(b) === null;
      return Number(aGroup) - Number(bGroup);
    });
}

/**
 * The document schema is broad, but an individual layer is not. Build the
 * inspector from the slots the selected layer actually carries and put each
 * slot where an artist expects to find it.
 */
export function layerPanelTabs(layer: LayerV2): Record<TabName, PanelEntry[]> {
  const emitter = layer.emitter;
  const lightDetail = layer.light ? withoutKeys(layer.light, ["color"]) : null;
  const appearance: PanelEntry[] = [
    ...entry("Light detail", lightDetail, "light"),
    ...entry("Reflection opacity", layer.reflection?.opacity, "reflection", "opacity"),
    ...entry("Reflection blur", layer.reflection?.blur, "reflection", "blur"),
  ];
  const shape: PanelEntry[] = [
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
  const motion: PanelEntry[] = emitter ? [
    ...entry("Lifetime", emitter.life, "emitter", "life"),
    ...entry("Spawn", withoutKeys(emitter.spawn, ["bursts", "headCurve", "originsFromPath", "sourceLayerId"]), "emitter", "spawn"),
    ...entry("Velocity", withoutKeys(emitter.velocity, ["speedCurve"]), "emitter", "velocity"),
    ...entry("Forces", {
      ...emitter.forces,
      curl: emitter.forces.curl
        ? withoutKeys(emitter.forces.curl, ["envelope"])
        : null,
    }, "emitter", "forces"),
    ...entry("Particle trail", emitter.trail
      ? withoutKeys(emitter.trail, ["widthCurve", "textureId"])
      : null, "emitter", "trail"),
  ] : [];
  return { Appearance: appearance, Shape: shape, Motion: motion };
}

function appearancePanelTabs(document: VfxDocumentV2, layer: LayerV2): Record<AppearanceTabName, PanelEntry[]> {
  const material = layer.material;
  const hasTexture = !!material?.mask.textureId &&
    !!document.textures?.some(asset => asset.id === material.mask.textureId);
  const hasProcedural = !!material && material.procedural !== "none";
  const effects: PanelEntry[] = material ? [
    ...(material.softParticle > 0
      ? entry("Intersection softness", material.softParticle, "material", "softParticle")
      : []),
    ...MATERIAL_EFFECTS.flatMap(([key, name]) =>
      entry(name, material[key], "material", key)),
  ] : [];
  return {
    Main: layerPanelTabs(layer).Appearance,
    Texture: material && (hasTexture || hasProcedural)
      ? [{ name: "Texture", value: material.mask, path: ["material", "mask"] }]
      : [],
    Noise: entry("Noise", material?.noise, "material", "noise"),
    Effects: effects,
  };
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
  const supportsLitSmoke = layer.kind === "particles" ||
    (MESH_KINDS_V2 as readonly string[]).includes(layer.kind);

  return <section className={styles.basics} aria-label="Appearance essentials">
    {layer.material && <InlineRampField
      name="Color"
      value={layer.material.ramp}
      path={["material", "ramp"]}
      commit={commit}
    />}
    {layer.material && <label className={styles.compactSlider}>
      <span>Opacity</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={layer.material.opacity}
        onChange={event => commit(["material", "opacity"], Number(event.target.value))}
      />
      <output>{layer.material.opacity.toFixed(2)}</output>
    </label>}
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

function MaskPreview({ document, layer }: {
  document: VfxDocumentV2;
  layer: LayerV2;
}) {
  const mask = layer.material?.mask;
  const texture = document.textures?.find(asset => asset.id === mask?.textureId);
  if (!mask?.textureId) return null;
  if (!texture) return <div className={styles.maskMissing}>Texture “{mask.textureId}” is unavailable.</div>;

  const scaleX = 100 / mask.uvScale[0];
  const scaleY = 100 / mask.uvScale[1];
  return <figure className={styles.maskPreview}>
    <div className={styles.maskViewport}>
      <div
        className={styles.maskTexture}
        style={{
          backgroundImage: `url(${texture.data})`,
          backgroundSize: `${scaleX}% ${scaleY}%`,
          backgroundPosition: `${-mask.uvPan[0] * scaleX}% ${mask.uvPan[1] * scaleY}%`,
          transform: `rotate(${mask.rotation}rad)`,
        }}
      />
    </div>
    <figcaption>{mask.textureId}</figcaption>
  </figure>;
}

function TextureSourceEditor({ document, layer, commit }: {
  document: VfxDocumentV2;
  layer: LayerV2;
  commit: (path: PathPart[], value: unknown) => void;
}) {
  const material = layer.material;
  if (!material) return null;
  const texture = document.textures?.find(asset => asset.id === material.mask.textureId);
  if (texture) {
    const controls = withoutKeys(material.mask, ["textureId"]);
    return <>
      <MaskPreview document={document} layer={layer} />
      <ValueEditor name="Texture controls" value={controls} path={["material", "mask"]} depth={0} commit={commit} openGraph={() => {}} />
    </>;
  }
  if (material.procedural === "none") return null;
  return <section className={styles.shapeSource} aria-label="Generated shape">
    <label className={styles.field}>
      <span>Shape</span>
      <select value={material.procedural} onChange={event => commit(["material", "procedural"], event.target.value)}>
        {PROCEDURALS_V2.map(value => <option key={value} value={value}>{labelFor(value)}</option>)}
      </select>
    </label>
  </section>;
}

function EffectsEditor({ effects, commit, openGraph }: {
  effects: PanelEntry[];
  commit: (path: PathPart[], value: unknown) => void;
  openGraph: (target: CurveRampTarget, path: PathPart[]) => void;
}) {
  const [selected, setSelected] = useState(effects[0]?.name ?? "");
  const effect = effects.find(item => item.name === selected) ?? effects[0];
  if (!effect) return null;
  const fields = isObject(effect.value)
    ? orderedObjectEntries(effect.value)
    : null;
  return <section className={styles.effectsEditor} aria-label="Material effects">
    {effects.length > 1 && <nav className={styles.effectChips} aria-label="Choose effect">
      {effects.map(item => <button key={item.name} type="button" aria-pressed={item.name === effect.name} onClick={() => setSelected(item.name)}>{item.name}</button>)}
    </nav>}
    <div className={styles.effectBody}>
      <header><strong>{effect.name}</strong></header>
      {effect.path.at(-1) === "softParticle" ? <label className={`${styles.compactSlider} ${styles.wideSlider}`}>
        <span>Softness</span>
        <input type="range" min="0" max="2" step="0.01" value={effect.value as number} onChange={event => commit(effect.path, Number(event.target.value))} />
        <output>{(effect.value as number).toFixed(2)}</output>
      </label> : fields ? fields.map(([name, value]) => (
        <ValueEditor key={name} name={name} value={value} path={[...effect.path, name]} depth={0} commit={commit} openGraph={openGraph} />
      )) : <ValueEditor name={effect.name} value={effect.value} path={effect.path} depth={0} commit={commit} openGraph={openGraph} />}
    </div>
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

function vectorLabels(name: string, path: PathPart[], length: number) {
  const dotted = pathName(path).toLowerCase();
  if (/uv|pan|offset/.test(dotted)) return length === 2 ? ["U", "V"] : ["X", "Y", "Z"];
  if (length === 3) return ["X", "Y", "Z"];
  if (/threshold/.test(name.toLowerCase())) return ["Low", "High"];
  return ["Min", "Max"];
}

function VectorField({ name, value, path, commit }: {
  name: string;
  value: number[];
  path: PathPart[];
  commit: (path: PathPart[], value: unknown) => void;
}) {
  const [drafts, setDrafts] = useState(() => value.map(String));
  const labels = vectorLabels(name, path, value.length);
  const save = (index: number) => {
    const number = Number(drafts[index]);
    if (!Number.isFinite(number) || number === value[index]) {
      setDrafts(value.map(String));
      return;
    }
    commit(path, value.map((component, componentIndex) =>
      componentIndex === index ? number : component));
  };
  return <div className={styles.vectorField}>
    <span>{labelFor(name)}</span>
    <div className={styles.vectorInputs}>
      {value.map((component, index) => <label key={labels[index] ?? index}>
        <span>{labels[index] ?? index + 1}</span>
        <input
          type="number"
          step="any"
          value={drafts[index]}
          aria-label={`${labelFor(name)} ${labels[index] ?? index + 1}`}
          onChange={event => setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
          onBlur={() => save(index)}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDrafts(value.map(String));
              event.currentTarget.blur();
            }
          }}
        />
      </label>)}
    </div>
  </div>;
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
  const [editingColor, setEditingColor] = useState(false);
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
  if (isColor)
    return <>
      <div className={styles.field}>
        <span>{labelFor(name)}</span>
        <span className={styles.inputRow}>
          <button
            type="button"
            className={styles.color}
            style={{ background: value }}
            aria-label={`Edit ${labelFor(name)} color`}
            aria-expanded={editingColor}
            disabled={readOnly}
            onClick={() => setEditingColor(true)}
          />
          <button
            type="button"
            className={`${styles.input} ${styles.colorValue}`}
            disabled={readOnly}
            onClick={() => setEditingColor(true)}
          >{value.toUpperCase()}</button>
        </span>
      </div>
      {editingColor && <ColorEditorPanel
        label={labelFor(name)}
        value={value}
        onClose={() => setEditingColor(false)}
        onChange={color => commit(path, color)}
      />}
    </>;
  // Unknown string fields are contract identifiers or unsupported enums.
  // Hiding them is safer than allowing free text that validation will reject.
  if (typeof value === "string") return null;
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{labelFor(name)}</span>
      <span className={styles.inputRow}>
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
  if (READ_ONLY_KEYS.has(name)) return null;
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

  if (Array.isArray(value) && value.length >= 2 && value.length <= 3 &&
      value.every(component => typeof component === "number"))
    return <VectorField key={(value as number[]).join(",")} name={name} value={value as number[]} path={path} commit={commit} />;

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : isObject(value)
      ? orderedObjectEntries(value)
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

function EntryBody({ entry: item, commit, openGraph }: {
  entry: PanelEntry;
  commit: (path: PathPart[], value: unknown) => void;
  openGraph: (target: CurveRampTarget, path: PathPart[]) => void;
}) {
  if (!isObject(item.value))
    return <ValueEditor name={item.name} value={item.value} path={item.path} depth={0} commit={commit} openGraph={openGraph} />;
  return <div className={styles.subTabBody}>
    {orderedObjectEntries(item.value)
      .map(([name, value]) => <ValueEditor key={name} name={name} value={value} path={[...item.path, name]} depth={0} commit={commit} openGraph={openGraph} />)}
  </div>;
}

function GroupedTabEditor({ label, entries, commit, openGraph }: {
  label: string;
  entries: PanelEntry[];
  commit: (path: PathPart[], value: unknown) => void;
  openGraph: (target: CurveRampTarget, path: PathPart[]) => void;
}) {
  const [selected, setSelected] = useState(entries[0]?.name ?? "");
  const active = entries.find(item => item.name === selected) ?? entries[0];
  if (!active) return null;
  return <>
    {entries.length > 1 && <nav className={styles.subTabs} aria-label={`${label} settings section`}>
      {entries.map(item => <button key={item.name} type="button" aria-pressed={active.name === item.name} onClick={() => setSelected(item.name)}>{item.name}</button>)}
    </nav>}
    <EntryBody entry={active} commit={commit} openGraph={openGraph} />
  </>;
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
  const [appearanceTab, setAppearanceTab] = useState<AppearanceTabName>("Main");
  const [graph, setGraph] = useState<{ target: CurveRampTarget; path: PathPart[] } | null>(null);
  const tabs = useMemo(() => layerPanelTabs(layer), [layer]);
  const appearanceTabs = useMemo(() => appearancePanelTabs(document, layer), [document, layer]);
  const visibleAppearanceTabs = (Object.keys(appearanceTabs) as AppearanceTabName[])
    .filter(name => appearanceTabs[name].length > 0 || (name === "Main" && !!layer.material));
  const tabCount = (name: TabName) => name === "Appearance"
    ? visibleAppearanceTabs.length
    : tabs[name].length;
  const visibleTabs = (Object.keys(tabs) as TabName[]).filter(name => tabCount(name) > 0);
  const activeTab = visibleTabs.includes(tab) ? tab : (visibleTabs[0] ?? "Appearance");
  const activeAppearanceTab = visibleAppearanceTabs.includes(appearanceTab)
    ? appearanceTab
    : "Main";
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
      <nav className={styles.tabs} aria-label="Layer settings section">
        {visibleTabs.map((name) => (
          <button key={name} type="button" aria-pressed={activeTab === name} onClick={() => { setTab(name); setError(""); }}>
            {name}<small>{name === "Appearance" ? visibleAppearanceTabs.length : tabs[name].length}</small>
          </button>
        ))}
      </nav>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.scroll}>
        {activeTab === "Appearance" && visibleAppearanceTabs.length > 1 && <nav className={styles.subTabs} aria-label="Appearance settings section">
          {visibleAppearanceTabs.map(name => <button key={name} type="button" aria-pressed={activeAppearanceTab === name} onClick={() => { setAppearanceTab(name); setError(""); }}>{name}</button>)}
        </nav>}
        {activeTab === "Appearance" && activeAppearanceTab === "Main" && <AppearanceBasics layer={layer} commit={commit} />}
        {activeTab === "Appearance" && activeAppearanceTab === "Texture" && <TextureSourceEditor document={document} layer={layer} commit={commit} />}
        {activeTab === "Appearance" && activeAppearanceTab === "Effects" && <EffectsEditor effects={appearanceTabs.Effects} commit={commit} openGraph={(target, targetPath) => setGraph({ target, path: targetPath })} />}
        {activeTab !== "Appearance" && <GroupedTabEditor label={activeTab} entries={tabs[activeTab]} commit={commit} openGraph={(target, targetPath) => setGraph({ target, path: targetPath })} />}
        {(activeTab !== "Appearance" || ["Texture", "Effects"].includes(activeAppearanceTab) ? [] : appearanceTabs[activeAppearanceTab]).map(({ name, value, path }) => (
          <ValueEditor key={path.join(".")} name={name} value={value} path={path} depth={0} commit={commit} openGraph={(target, targetPath) => setGraph({ target, path: targetPath })} />
        ))}
        {activeTab !== "Appearance" && !tabs[activeTab].length && <p className={styles.empty}>This layer has no {activeTab.toLowerCase()} parameters.</p>}
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

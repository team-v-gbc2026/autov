"use client";

import { Fragment, useState, type PointerEvent, type ReactNode } from "react";
import EmitterRow from "./emitter-row";
import Icon from "../studio/icon";
import type { VfxLayer } from "./ui-model";

export type PreviewLayer = VfxLayer;

export default function EmitterTimeline({
  layers,
  duration,
  time,
  onSeek,
  selected,
  solo,
  onSelect,
  onSolo,
  onToggle,
  onAdd,
  onDelete,
  onTimingChange,
  onTag,
  editorControls,
  focusRequest,
}: {
  focusRequest?: { id: string; sequence: number };
  layers: PreviewLayer[];
  duration: number;
  time: number;
  onSeek: (time: number) => void;
  selected: string;
  solo?: string;
  onSelect: (id: string) => void;
  onSolo: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onTag: (id: string) => void;
  editorControls: ReactNode;
  onTimingChange: (id: string, edge: "start" | "end", value: number) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastFocus, setLastFocus] = useState(focusRequest);
  if (focusRequest !== lastFocus) { setLastFocus(focusRequest); if (focusRequest) setEditingId(focusRequest.id); }
  const selectLayer = (id: string) => {
    if (id !== selected) setEditingId(null);
    onSelect(id);
  };
  const seekFromPointer = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0) {
      onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration);
    }
  };
  return (
    <div className="lab-emitter-timeline">
      <div className="lab-timeline-scroll">
        <div className="lab-timeline-body">
          <div className="lab-ruler-row">
            <div className="lab-emitter-heading">
              <span>Emitters <span className="lab-emitter-count">{layers.length}</span></span>
              <button type="button" className="lab-add-emitter" aria-label="Add emitter" title="Add emitter" onClick={onAdd}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="time-ruler">
              {[0, duration / 4, duration / 2, duration * 0.75, duration].map(value => (
                <span key={value}>{value.toFixed(2)}</span>
              ))}
              <input
                aria-label="Playback position"
                aria-valuetext={`${time.toFixed(2)} of ${duration.toFixed(2)} seconds`}
                type="range"
                min={0}
                max={duration}
                step="0.01"
                value={time}
                onChange={event => onSeek(Number(event.target.value))}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  seekFromPointer(event);
                }}
                onPointerMove={event => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);
                }}
                onPointerUp={event => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    seekFromPointer(event);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
              />
            </div>
          </div>
          <div className="lab-emitter-tracks" aria-label="Emitter timeline">
            {layers.map((layer) => <Fragment key={layer.id}>
            <EmitterRow
              name={layer.name}
              selected={selected === layer.id}
              editing={editingId === layer.id && selected === layer.id}
              onEdit={() => { selectLayer(layer.id); setEditingId(layer.id); }}
              onClose={() => setEditingId(current => current === layer.id ? null : current)}
              onTag={() => onTag(layer.id)}
              onDelete={() => onDelete(layer.id)}
              controls={editorControls}
            >
              {barProps => <>
              <div className="lab-emitter-label" data-enabled={layer.enabled} style={{ borderLeftColor: selected === layer.id ? layer.color : "transparent" }}>
                <button
                  type="button"
                  className="lab-emitter-visibility"
                  aria-label={`${layer.enabled ? "Hide" : "Show"} ${layer.name}`}
                  title={`${layer.enabled ? "Hide" : "Show"} ${layer.name}`}
                  aria-pressed={layer.enabled}
                  onClick={() => onToggle(layer.id)}
                >
                  <Icon name={layer.enabled ? "eye" : "eye-off"} size={13} />
                </button>
                <span className="lab-layer-dot" aria-hidden="true" style={{ background: layer.color }} />
                <button
                  type="button"
                  className="lab-emitter-name"
                  aria-label={`Select ${layer.name}`}
                  aria-pressed={selected === layer.id}
                  onClick={() => selectLayer(layer.id)}
                  title={layer.name}
                >
                  {layer.name}
                </button>
                <button
                  type="button"
                  className="lab-emitter-solo"
                  aria-label={`Solo ${layer.name}`}
                  title={solo === layer.id ? `Stop soloing ${layer.name}` : `Solo ${layer.name}`}
                  aria-pressed={solo === layer.id}
                  onClick={() => onSolo(layer.id)}
                >
                  <Icon name="solo" size={13} />
                </button>
                {!!layer.keyframes?.length && <button
                  type="button"
                  className="lab-keyframe-expand"
                  aria-label={`${expandedId === layer.id ? "Collapse" : "Expand"} keyframes for ${layer.name}`}
                  aria-expanded={expandedId === layer.id}
                  onClick={() => setExpandedId(current => current === layer.id ? null : layer.id)}
                >
                  <Icon name="chevron" size={12} />
                </button>}
              </div>
              <div className="lab-emitter-lane">
                <button
                  type="button"
                  {...barProps}
                  className="lab-emitter-bar"
                  aria-label={`${layer.name}: ${layer.start.toFixed(2)} to ${layer.end.toFixed(2)} seconds`}
                  title={`Primary ${layer.color} · Secondary ${layer.secondaryColor}`}
                  aria-pressed={selected === layer.id}
                  onClick={() => selectLayer(layer.id)}
                  style={{
                    left: `${(layer.start / duration) * 100}%`,
                    width: `${((layer.end - layer.start) / duration) * 100}%`,
                    borderColor: layer.color,
                    borderBottomColor: layer.secondaryColor,
                    opacity:
                      !layer.enabled || (solo !== undefined && solo !== layer.id)
                        ? 0.3
                        : 1,
                  }}
                >
                  <span>
                    {layer.start.toFixed(2)}–{layer.end.toFixed(2)} s
                  </span>
                </button>
                {(["start", "end"] as const).map(edge => {
                  const gap = Math.min(0.01, layer.end - layer.start);
                  const min = edge === "start" ? 0 : layer.start + gap;
                  const max = edge === "start" ? layer.end - gap : duration;
                  const change = (value: number) => onTimingChange(layer.id, edge, Math.max(min, Math.min(max, value)));
                  const drag = (event: PointerEvent<HTMLButtonElement>) => {
                    const lane = event.currentTarget.parentElement!.getBoundingClientRect();
                    if (lane.width > 0) change(Math.round(((event.clientX - lane.left) / lane.width) * duration * 100) / 100);
                  };
                  return (
                    <button
                      key={edge}
                      type="button"
                      role="slider"
                      className={`lab-emitter-handle lab-emitter-handle-${edge}`}
                      aria-label={`${layer.name} ${edge} time`}
                      aria-valuemin={min}
                      aria-valuemax={max}
                      aria-valuenow={layer[edge]}
                      aria-valuetext={`${layer[edge].toFixed(2)} seconds`}
                      title={`Drag ${edge} · ${layer[edge].toFixed(2)} s`}
                      style={{ left: `${(layer[edge] / duration) * 100}%`, color: layer.color }}
                      onPointerDown={event => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.focus();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        selectLayer(layer.id);
                      }}
                      onPointerMove={event => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event);
                      }}
                      onPointerUp={event => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          drag(event);
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                      onKeyDown={event => {
                        const step = event.shiftKey ? 0.1 : 0.01;
                        const value = event.key === "Home" ? min : event.key === "End" ? max
                          : ["ArrowRight", "ArrowUp"].includes(event.key) ? layer[edge] + step
                          : ["ArrowLeft", "ArrowDown"].includes(event.key) ? layer[edge] - step : undefined;
                        if (value === undefined) return;
                        event.preventDefault();
                        selectLayer(layer.id);
                        change(Math.round(value * 100) / 100);
                      }}
                    />
                  );
                })}
                {layer.edits.map((edit) => (
                  <button
                    key={edit.id}
                    type="button"
                    className="lab-scoped-edit"
                    aria-label={`${layer.name} edit: ${edit.start.toFixed(2)} to ${edit.end.toFixed(2)} seconds, ${edit.prompt}`}
                    title={edit.prompt}
                    onClick={() => selectLayer(layer.id)}
                    style={{
                      left: `${(edit.start / duration) * 100}%`,
                      width: `${((edit.end - edit.start) / duration) * 100}%`,
                    }}
                  />
                ))}
              </div>
              </>}
            </EmitterRow>
            {expandedId === layer.id && keyframeGroups(layer).map(track => (
              <div className="lab-keyframe-row" key={`${layer.id}-${track.target}`}>
                <div className="lab-keyframe-label" title={track.domain ?? track.target}>{track.label ?? keyframeLabel(track.target)}</div>
                <div className="lab-keyframe-lane">
                  {track.keys.map(({ time: localTime, values }, index) => (
                    <button
                      key={`${localTime}-${index}`}
                      type="button"
                      className="lab-keyframe-marker"
                      aria-label={`${keyframeLabel(track.target)} keyframe at ${(layer.start + localTime).toFixed(2)} seconds, ${values.length === 1 ? `value ${values[0]}` : `${values.length} component values`}`}
                      data-keyframe-value={values.length === 1 ? String(values[0]) : `[${values.join(", ")}]`}
                      style={{ left: `${((layer.start + localTime) / duration) * 100}%` }}
                      onClick={() => { selectLayer(layer.id); onSeek(layer.start + localTime); }}
                    />
                  ))}
                </div>
              </div>
            ))}
            </Fragment>)}
          </div>
          <div className="lab-playhead-area" aria-hidden="true">
            <div className="lab-timeline-playhead" style={{ left: `${(time / duration) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function keyframeLabel(target: string) {
  const leaf = target.split(".").at(-1)?.replaceAll("[]", "") ?? target;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, character => character.toUpperCase());
}

function trackValueAt(track: NonNullable<VfxLayer["keyframes"]>[number], time: number) {
  const keys = track.keys;
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  const nextIndex = keys.findIndex(([keyTime]) => keyTime >= time);
  const [fromTime, fromValue] = keys[nextIndex - 1];
  const [toTime, toValue] = keys[nextIndex];
  let t = (time - fromTime) / (toTime - fromTime);
  if (track.ease === "smooth") t = t * t * (3 - 2 * t);
  else if (track.ease === "outCubic") t = 1 - Math.pow(1 - t, 3);
  else if (track.ease === "inQuad") t *= t;
  return fromValue + (toValue - fromValue) * t;
}

function keyframeGroups(layer: VfxLayer) {
  const keyframes = layer.keyframes ?? [];
  const groups = new Map<string, {
    target: string;
    label?: string;
    domain?: string;
    timeScale: "seconds" | "normalized";
    ease: Set<string>;
    keys: Map<number, number[]>;
  }>();
  for (const track of keyframes) {
    const target = track.target.replace(/\[\d+\]/g, "[]");
    const groupKey = `${target}:${track.timeScale ?? "seconds"}:${track.domain ?? ""}`;
    const group = groups.get(groupKey) ?? {
      target,
      label: track.label,
      domain: track.domain,
      timeScale: track.timeScale ?? "seconds",
      ease: new Set<string>(),
      keys: new Map<number, number[]>(),
    };
    group.ease.add(track.ease);
    for (const [time, value] of track.keys)
      group.keys.set(time, [...(group.keys.get(time) ?? []), value]);
    groups.set(groupKey, group);
  }
  return [...groups.values()].map(group => {
    const transformMatch = /^transform\.(position|rotation|scale)\[\]$/.exec(group.target);
    if (!transformMatch) return {
      target: group.target,
      label: group.label,
      domain: group.domain,
      ease: [...group.ease],
      keys: [...group.keys].sort(([a], [b]) => a - b).map(([time, values]) => ({
        time: group.timeScale === "normalized" ? time * (layer.end - layer.start) : time,
        values,
      })),
    };
    const property = transformMatch[1] as "position" | "rotation" | "scale";
    const componentTracks = [0, 1, 2].map(index =>
      keyframes.find(track => track.target === `transform.${property}[${index}]`),
    );
    const times = [...new Set(componentTracks.flatMap(track => track?.keys.map(([time]) => time) ?? []))].sort((a, b) => a - b);
    const base = layer.sourceTransform?.[property] ?? (property === "scale" ? [1, 1, 1] : [0, 0, 0]);
    return {
      target: group.target,
      label: group.label,
      domain: group.domain,
      ease: [...group.ease],
      keys: times.map(time => ({
        time,
        values: componentTracks.map((track, index) => track ? trackValueAt(track, time) : base[index]),
      })),
    };
  });
}

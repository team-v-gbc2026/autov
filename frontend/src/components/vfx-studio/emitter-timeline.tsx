"use client";

import type { VfxLayer } from "./ui-model";

export type PreviewLayer = VfxLayer;

export default function EmitterTimeline({
  layers,
  duration,
  time,
  selected,
  solo,
  onSelect,
  onSolo,
  onToggle,
  onAdd,
}: {
  layers: PreviewLayer[];
  duration: number;
  time: number;
  selected: string;
  solo?: string;
  onSelect: (id: string) => void;
  onSolo: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="lab-emitter-timeline">
      <div className="lab-emitter-heading">
        <span>Emitters · {layers.length}</span>
        <button type="button" className="lab-add-emitter" onClick={onAdd}>
          + Add emitter
        </button>
      </div>
      <div className="lab-emitter-tracks" aria-label="Emitter timeline">
        {layers.map((layer) => (
        <div
          key={layer.id}
          className={`lab-emitter-row ${selected === layer.id ? "selected" : ""}`}
        >
          <div className="lab-emitter-label">
            <button
              type="button"
              aria-label={`${layer.enabled ? "Hide" : "Show"} ${layer.name}`}
              onClick={() => onToggle(layer.id)}
            >
              <span
                className="lab-layer-dot"
                style={{ background: layer.enabled ? layer.color : "#45494b" }}
              />
            </button>
            <button
              type="button"
              className="lab-emitter-name"
              aria-label={`Select ${layer.name}`}
              aria-pressed={selected === layer.id}
              onClick={() => onSelect(layer.id)}
              title={layer.name}
            >
              {layer.name}
            </button>
            <button
              type="button"
              className="lab-tiny"
              aria-label={`Solo ${layer.name}`}
              aria-pressed={solo === layer.id}
              onClick={() => onSolo(layer.id)}
            >
              S
            </button>
          </div>
          <div className="lab-emitter-lane">
            <button
              type="button"
              className="lab-emitter-bar"
              aria-label={`${layer.name}: ${layer.start.toFixed(2)} to ${layer.end.toFixed(2)} seconds`}
              aria-pressed={selected === layer.id}
              onClick={() => onSelect(layer.id)}
              style={{
                left: `${(layer.start / duration) * 100}%`,
                width: `${((layer.end - layer.start) / duration) * 100}%`,
                borderColor: layer.color,
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
            {layer.edits.map((edit) => (
              <button
                key={edit.id}
                type="button"
                className="lab-scoped-edit"
                aria-label={`${layer.name} edit: ${edit.start.toFixed(2)} to ${edit.end.toFixed(2)} seconds, ${edit.prompt}`}
                title={edit.prompt}
                onClick={() => onSelect(layer.id)}
                style={{
                  left: `${(edit.start / duration) * 100}%`,
                  width: `${((edit.end - edit.start) / duration) * 100}%`,
                }}
              />
            ))}
            <div
              className="lab-emitter-playhead"
              style={{ left: `${(time / duration) * 100}%` }}
            />
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

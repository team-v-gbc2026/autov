"use client";
import type { VfxDocument } from "@/lib/vfx-lab/schema";
export default function EmitterTimeline({
  layers,
  duration,
  time,
  selected,
  solo,
  busy,
  onSelect,
  onSolo,
  onToggle,
}: {
  layers: VfxDocument["layers"];
  duration: number;
  time: number;
  selected: string;
  solo?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onSolo: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="lab-emitter-tracks" aria-label="Emitter timeline">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`lab-emitter-row ${selected === layer.id ? "selected" : ""}`}
        >
          <div className="lab-emitter-label">
            <button
              aria-label={`${layer.enabled ? "Hide" : "Show"} ${layer.name}`}
              disabled={busy}
              onClick={() => onToggle(layer.id)}
            >
              <span
                className="lab-layer-dot"
                style={{
                  background: layer.enabled ? layer.params.color : "#45494b",
                }}
              />
            </button>
            <button
              className="lab-emitter-name"
              aria-label={`Select ${layer.name}`}
              aria-pressed={selected === layer.id}
              disabled={busy}
              onClick={() => onSelect(layer.id)}
              title={layer.name}
            >
              {layer.name}
            </button>
            <button
              className="lab-tiny"
              aria-label={`Solo ${layer.name}`}
              aria-pressed={solo === layer.id}
              disabled={busy}
              onClick={() => onSolo(layer.id)}
            >
              S
            </button>
          </div>
          <div className="lab-emitter-lane">
            <button
              className="lab-emitter-bar"
              aria-label={`${layer.name}: ${layer.start.toFixed(2)} to ${layer.end.toFixed(2)} seconds`}
              aria-pressed={selected === layer.id}
              disabled={busy}
              onClick={() => onSelect(layer.id)}
              style={{
                left: `${(layer.start / duration) * 100}%`,
                width: `${((layer.end - layer.start) / duration) * 100}%`,
                borderColor: layer.params.color,
                opacity: layer.enabled ? 1 : 0.35,
              }}
            >
              <span>
                {layer.start.toFixed(2)}–{layer.end.toFixed(2)} s
              </span>
            </button>
            <div
              className="lab-emitter-playhead"
              style={{ left: `${(time / duration) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

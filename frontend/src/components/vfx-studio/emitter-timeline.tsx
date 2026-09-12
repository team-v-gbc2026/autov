"use client";

export type PreviewLayer = {
  id: string;
  name: string;
  kind: string;
  start: number;
  end: number;
  color: string;
  enabled: boolean;
};

export default function EmitterTimeline({
  layers,
  duration,
  time,
  selected,
  solo,
  onSelect,
  onSolo,
  onToggle,
}: {
  layers: PreviewLayer[];
  duration: number;
  time: number;
  selected: string;
  solo?: string;
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

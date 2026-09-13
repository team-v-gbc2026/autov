"use client";

/**
 * Controls for the optional splat backdrop. Purely a view over
 * BackdropController — it holds no Three.js state of its own, so the panel can
 * mount, unmount and re-mount without disturbing what is on screen.
 */
import { useCallback, useRef, useState } from "react";
import type {
  BackdropSnapshot,
  BackdropController,
} from "@/lib/vfx-lab/backdrop-controller";

export interface BackdropPreset {
  label: string;
  url: string;
}

interface Props {
  controller: BackdropController | null;
  snapshot: BackdropSnapshot;
  presets?: BackdropPreset[];
  panelStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
}

const SLIDERS = [
  { key: "scale", label: "scale", min: 0.05, max: 50, step: 0.05 },
  { key: "x", label: "position x", min: -40, max: 40, step: 0.1 },
  { key: "y", label: "position y", min: -40, max: 40, step: 0.1 },
  { key: "z", label: "position z", min: -60, max: 40, step: 0.1 },
  { key: "rx", label: "rotate x", min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: "ry", label: "rotate y", min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: "rz", label: "rotate z", min: -Math.PI, max: Math.PI, step: 0.01 },
] as const;

export function BackdropPanel({
  controller,
  snapshot,
  presets = [],
  panelStyle,
  labelStyle,
  buttonStyle,
}: Props) {
  const [url, setUrl] = useState(presets[0]?.url ?? "");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { state, settings, error, numSplats } = snapshot;
  const busy = state === "loading";

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      /* surfaced through snapshot.error */
    }
  }, []);

  const sliderValue = (key: (typeof SLIDERS)[number]["key"]) => {
    switch (key) {
      case "scale":
        return settings.scale;
      case "x":
        return settings.position[0];
      case "y":
        return settings.position[1];
      case "z":
        return settings.position[2];
      case "rx":
        return settings.rotation[0];
      case "ry":
        return settings.rotation[1];
      case "rz":
        return settings.rotation[2];
    }
  };

  const setSlider = (key: (typeof SLIDERS)[number]["key"], value: number) => {
    if (!controller) return;
    const p = [...settings.position] as [number, number, number];
    const r = [...settings.rotation] as [number, number, number];
    switch (key) {
      case "scale":
        return controller.setTransform({ scale: value });
      case "x":
        p[0] = value;
        return controller.setTransform({ position: p });
      case "y":
        p[1] = value;
        return controller.setTransform({ position: p });
      case "z":
        p[2] = value;
        return controller.setTransform({ position: p });
      case "rx":
        r[0] = value;
        return controller.setTransform({ rotation: r });
      case "ry":
        r[1] = value;
        return controller.setTransform({ rotation: r });
      case "rz":
        r[2] = value;
        return controller.setTransform({ rotation: r });
    }
  };

  const hint = {
    empty: "no backdrop",
    loading: "loading…",
    ready: numSplats ? `${numSplats.toLocaleString()} splats` : "loaded",
    error: "failed",
  }[state];

  return (
    <div style={panelStyle} data-testid="backdrop-panel">
      <span style={labelStyle}>Backdrop</span>

      {presets.length > 0 && (
        <select
          data-testid="backdrop-preset"
          value={presets.some((p) => p.url === url) ? url : ""}
          onChange={(e) => setUrl(e.target.value)}
          disabled={!controller || busy}
          style={{ width: "100%", marginBottom: 6 }}
        >
          <option value="">— sample assets —</option>
          {presets.map((p) => (
            <option key={p.url} value={p.url}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      <input
        data-testid="backdrop-url"
        type="text"
        value={url}
        placeholder="/path/to/splat.ply  ·  .ply .spz .ksplat"
        onChange={(e) => setUrl(e.target.value)}
        disabled={!controller || busy}
        style={{ width: "100%", marginBottom: 6, fontSize: 12, padding: "3px 5px" }}
      />

      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button
          style={{ ...buttonStyle, flex: 1, opacity: busy ? 0.6 : 1 }}
          disabled={!controller || busy || !url}
          data-testid="backdrop-load"
          onClick={() => run(() => controller!.load(url))}
        >
          {settings.url ? "Replace" : "Load"}
        </button>
        <button
          style={{ ...buttonStyle, flex: 1 }}
          disabled={!controller || busy}
          onClick={() => fileRef.current?.click()}
        >
          File…
        </button>
        <button
          style={{ ...buttonStyle, flex: 1 }}
          disabled={!controller || (!settings.url && !busy)}
          data-testid="backdrop-remove"
          onClick={() => controller!.remove()}
        >
          Remove
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".ply,.spz,.ksplat,.splat"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && controller) void run(() => controller.loadFile(f));
        }}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <input
          data-testid="backdrop-visible"
          type="checkbox"
          checked={settings.visible}
          disabled={!controller}
          onChange={(e) => controller?.setVisible(e.target.checked)}
        />
        visible
      </label>

      <fieldset
        disabled={!controller || !settings.url}
        style={{ border: 0, padding: 0, margin: 0, opacity: settings.url ? 1 : 0.45 }}
      >
        {SLIDERS.map(({ key, label, min, max, step }) => (
          <div key={key} style={{ marginTop: 4 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#7d848c",
              }}
            >
              <span>{label}</span>
              <span>{sliderValue(key).toFixed(2)}</span>
            </div>
            <input
              data-testid={`backdrop-slider-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={sliderValue(key)}
              onChange={(e) => setSlider(key, Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        ))}
      </fieldset>

      <p
        data-testid="backdrop-status"
        style={{ fontSize: 11, color: error ? "#e0806f" : "#7d848c", marginTop: 6 }}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

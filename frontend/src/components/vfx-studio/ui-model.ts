import type { Curve } from "@/lib/vfx-lab/schema-v2";
import rawSampleEffect from "./sample-effect.json";

export const PARAMETER_NAMES = [
  "Intensity",
  "Radius",
  "Opacity",
  "Speed",
  "Turbulence",
  "Erosion",
] as const;

export type ParameterName = (typeof PARAMETER_NAMES)[number];
export type ScopedEdit = {
  id: string;
  prompt: string;
  start: number;
  end: number;
};

export type VfxLayer = {
  id: string;
  name: string;
  kind: string;
  start: number;
  end: number;
  color: string;
  secondaryColor: string;
  blend: "additive" | "normal";
  enabled: boolean;
  parameters: Record<ParameterName, number>;
  curves?: { path: string; label: string; domain: string; value: Curve }[];
  edits: ScopedEdit[];
};

export type VfxUiDocument = {
  name: string;
  duration: number;
  layers: VfxLayer[];
  environment: {
    bloom: number;
    exposure: number;
  };
};

const DEFAULT_PARAMETERS: Record<ParameterName, number> = {
  Intensity: 76,
  Radius: 44,
  Opacity: 82,
  Speed: 58,
  Turbulence: 31,
  Erosion: 24,
};

type RawLayer = Partial<VfxLayer> &
  Pick<VfxLayer, "id" | "name" | "kind"> & {
    params?: Record<string, unknown>;
    overrides?: Array<Record<string, unknown>>;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLayer(
  raw: RawLayer,
  index: number,
  duration: number,
): VfxLayer {
  const start = finiteNumber(raw.start, 0);
  const end = finiteNumber(raw.end, duration);
  if (start < 0 || start >= end || end > duration) {
    throw new Error(`${raw.name} has an invalid start or end time.`);
  }
  const hasUiParameters = isRecord(raw.parameters);
  const parameterInput: Record<string, unknown> = hasUiParameters
    ? (raw.parameters as Record<string, unknown>)
    : isRecord(raw.params)
      ? raw.params
      : {};
  const scales: Record<ParameterName, number> = {
    Intensity: 12.5,
    Radius: 12.5,
    Opacity: 100,
    Speed: 12.5,
    Turbulence: 50,
    Erosion: 100,
  };
  const parameters = Object.fromEntries(
    PARAMETER_NAMES.map((name) => [
      name,
      Math.max(
        0,
        Math.min(
          100,
          finiteNumber(
            parameterInput[name] ?? parameterInput[name.toLowerCase()],
            DEFAULT_PARAMETERS[name] / (hasUiParameters ? 1 : scales[name]),
          ) * (hasUiParameters ? 1 : scales[name]),
        ),
      ),
    ]),
  ) as Record<ParameterName, number>;

  const rawEdits = Array.isArray(raw.edits)
    ? raw.edits
    : Array.isArray(raw.overrides)
      ? raw.overrides.map((override, editIndex) => ({
          id: `${raw.id}-imported-edit-${editIndex + 1}`,
          prompt: `${String(override.target || "parameter")} → ${String(override.value || "value")}`,
          start: override.start,
          end: override.end,
        }))
      : [];

  return {
    id: raw.id || `emitter-${index + 1}`,
    name: raw.name || `Emitter ${index + 1}`,
    kind: raw.kind || "particles",
    start,
    end,
    color:
      raw.color ||
      (typeof raw.params?.color === "string" ? raw.params.color : "#ffb23e"),
    secondaryColor:
      raw.secondaryColor ||
      (typeof raw.params?.secondaryColor === "string"
        ? raw.params.secondaryColor
        : raw.color || "#ff7352"),
    blend:
      raw.blend === "normal" || raw.params?.blend === "normal"
        ? "normal"
        : "additive",
    enabled: raw.enabled !== false,
    parameters,
    edits: rawEdits.filter(
          (edit): edit is ScopedEdit =>
            isRecord(edit) &&
            typeof edit.id === "string" &&
            typeof edit.prompt === "string" &&
            typeof edit.start === "number" &&
            typeof edit.end === "number",
        ),
  };
}

export function normalizeVfxDocument(input: unknown): VfxUiDocument {
  if (!isRecord(input)) throw new Error("The JSON structure is invalid.");
  const duration = finiteNumber(input.duration, 0);
  if (duration <= 0 || duration > 60) {
    throw new Error("Duration must be greater than 0 and no more than 60 seconds.");
  }
  if (!Array.isArray(input.layers) || input.layers.length === 0) {
    throw new Error("The JSON must contain at least one emitter in layers.");
  }
  const rawLayers = input.layers.filter(
    (layer): layer is RawLayer =>
      isRecord(layer) &&
      typeof layer.id === "string" &&
      typeof layer.name === "string" &&
      typeof layer.kind === "string",
  );
  if (rawLayers.length !== input.layers.length) {
    throw new Error("Every emitter must include id, name, and kind.");
  }
  if (new Set(rawLayers.map(layer => layer.id)).size !== rawLayers.length) {
    throw new Error("Emitter ids must be unique.");
  }
  const environment = isRecord(input.environment)
    ? input.environment
    : isRecord(input.post)
      ? input.post
      : {};
  const environmentUsesRuntimeScale = !isRecord(input.environment) && isRecord(input.post);
  return {
    name: typeof input.name === "string" && input.name.trim() ? input.name : "Imported effect",
    duration,
    layers: rawLayers.map((layer, index) => normalizeLayer(layer, index, duration)),
    environment: {
      bloom: Math.max(0, Math.min(100, finiteNumber(environment.bloom, 64) * (environmentUsesRuntimeScale ? 50 : 1))),
      exposure: Math.max(0, Math.min(100, finiteNumber(environment.exposure, 48) * (environmentUsesRuntimeScale ? 50 : 1))),
    },
  };
}

const base = normalizeVfxDocument(rawSampleEffect);

function sample(
  name: string,
  colors: [string, string, string, string],
  duration = base.duration,
): VfxUiDocument {
  return {
    ...base,
    name,
    duration,
    layers: base.layers.map((layer, index) => ({
      ...layer,
      id: `${layer.id}-${name.toLowerCase().replaceAll(" ", "-")}`,
      color: colors[index],
      secondaryColor: colors[(index + 1) % colors.length],
      edits: [],
    })),
    environment: { ...base.environment },
  };
}

export const VFX_SAMPLES = {
  amber: sample("Amber rupture", ["#fff3c4", "#ffb23e", "#ff7352", "#8d99a3"]),
  plasma: sample("Plasma bloom", ["#eff8ff", "#5ee7ff", "#8b5cff", "#42506d"], 3.2),
  ember: sample("Ember trail", ["#fff4d6", "#ffca55", "#ff633b", "#786a62"], 4),
} satisfies Record<string, VfxUiDocument>;

export type VfxSampleId = keyof typeof VFX_SAMPLES;

export function cloneSample(id: VfxSampleId) {
  return structuredClone(VFX_SAMPLES[id]);
}

export function createEmitter(index: number, duration: number): VfxLayer {
  const start = Math.min(duration * 0.25, Math.max(0, (index - 1) * 0.12));
  return normalizeLayer(
    {
      id: `emitter-${crypto.randomUUID()}`,
      name: `Emitter ${index}`,
      kind: "particles",
      start,
      end: Math.min(duration, start + Math.max(0.4, duration * 0.45)),
      color: "#f5c26b",
      secondaryColor: "#ff795c",
      enabled: true,
    },
    index - 1,
    duration,
  );
}

export type Numeric = number | number[] | number[][];
export type GeometryData = {
  baseGeometry: number; attributeIndex: number[];
  positions: number[]; normals: number[]; uv: number[]; indices: number[];
  attributes: Record<string, { size: number; values: number[] }>;
  primitive: "triangles" | "lines";
};
export type DrawSample = { time: number; visible: boolean; depthWrite: boolean; matrix: number[];
  uniforms: Record<string, Numeric>; geometry: number };
export type DrawData = {
  id: string; layerId: string; program: string; blend: string; order: number;
  depthTest: boolean; depthWrite: boolean; side: "front" | "back" | "double";
  uniformTypes: Record<string, { type: string; size?: number }>;
  textures: Record<string, string>; samples: DrawSample[];
};
export type AvfxBundle = {
  format: "avfx/0.1"; name: string; duration: number; fps: number;
  coordinates: "right-handed-y-up-metres";
  reference: { background: string; exposure: number; time: number };
  camera: { position: number[]; target: number[]; fov: number; aspect: number; near: number; far: number };
  draws: DrawData[]; geometries: GeometryData[]; warnings: string[];
};
export function sampleTimes(duration: number, fps: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
    throw new Error("Export duration must be between 0 and 60 seconds.");
  if (![15, 30, 60].includes(fps)) throw new Error("Choose 15, 30 or 60 samples per second.");
  return Array.from({ length: Math.ceil(duration * fps) + 1 }, (_, i) => Math.min(i / fps, duration));
}

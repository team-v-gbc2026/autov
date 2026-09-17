import * as s from "../../frontend/src/lib/vfx-lab/shaders-v2";
export const kernels: Record<string, [string, string]> = {
  particle: [s.particleVertexSource(false, true, true), s.particleFragmentV2],
  subParticle: [s.particleVertexSource(true, true, true), s.particleFragmentV2],
  trail: [s.trailVertexSource(false, true, true), s.trailFragmentV2],
  subTrail: [s.trailVertexSource(true, true, true), s.trailFragmentV2],
  strip: [s.stripVertexSource(true, true), s.stripFragmentV2],
  sliver: [s.sliverVertexSource(true, true), s.sliverFragmentV2],
  surface: [s.surfaceVertexV2, s.surfaceFragmentV2],
  blob: [s.blobVertexV2, s.blobFragmentV2],
  crystal: [s.crystalVertexV2, s.crystalFragmentV2],
  splash: [s.splashVertexV2, s.splashFragmentV2],
  ribbon: [s.ribbonVertexV2, s.ribbonFragmentV2],
  wireBurst: [s.wireBurstVertexV2, s.wireBurstFragmentV2],
  arc: [s.arcVertexV2, s.arcFragmentV2],
  streak: [s.streakVertexV2, s.streakFragmentV2],
  sheet: [s.sheetVertexV2, s.sheetFragmentV2],
  crescent: [s.crescentVertexV2, s.crescentFragmentV2],
  lick: [s.lickVertexV2, s.lickFragmentV2],
};
export type Binding = { name: string; type: string; kind: string; size: number };
export function parseKernel(source: string) {
  const bindings: Binding[] = [];
  const body = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").replace(/\bprecision\s+\w+\s+\w+;/g, "").replace(
    /\b(uniform|attribute|varying)\s+(\w+)\s+([^;]+);/g,
    (_all, kind: string, type: string, names: string) => {
      for (const name of names.split(",")) {
        const m = /^(\w+)(?:\[(\d+)\])?$/.exec(name.trim());
        if (!m) throw new Error(`Unsupported shader binding: ${name}`);
        bindings.push({ name: m[1], type, kind, size: Number(m[2] || 0) });
      }
      return "";
    });
  return { bindings, body };
}

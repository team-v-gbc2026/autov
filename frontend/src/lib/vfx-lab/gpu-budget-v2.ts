import type { LayerV2, VfxDocumentV2 } from "./schema-v2";

/**
 * What a document costs the GPU, counted from the document alone.
 *
 * The renderer's cost is not "how many layers": it is how many draw calls the
 * frame submits, how many distinct programs the device has to compile, and how
 * many instances those draws cover. A generated document combines kinds in ways
 * no exemplar does, so the estimate is checked before a candidate ships rather
 * than discovered as a stalled first play.
 *
 * These are exact counts of what the layer factories build, not a heuristic:
 * every number below matches a `createXLayer` in runtime-v2.ts.
 */
/**
 * Ceilings, set above every exemplar with headroom so the repair never touches
 * one. The busiest exemplars are water-projectile (52 draws), ice-blast (11
 * programs, 1308 instances) and meteor-rain/smoke-burst (29/34 draws); these
 * are those maxima roughly doubled and rounded.
 */
export const GPU_BUDGET_V2 = {
  draws: 120,
  pipelines: 24,
  instances: 3000,
} as const;

export interface GpuCostV2 {
  /** Draw calls one frame submits, with every layer alive. */
  draws: number;
  /** Distinct programs, which is what the device compiles. */
  pipelines: number;
  /** Instances across every instanced draw. */
  instances: number;
}

/** The program a layer draws with, including the variants it draws twice in. */
function programsOf(layer: LayerV2): string[] {
  const material = layer.material;
  // The baked structural values are part of the generated shader text, so two
  // layers only share a program when these agree. See WEBGPU_PORT.md.
  const structural = material
    ? `${material.procedural}:${material.ramp.stops.length}:${material.erosion ? material.erosion.curve.keys.length : 0}`
    : "";
  const of = (kind: string) => `${kind}:${structural}`;
  switch (layer.kind) {
    case "light":
      return [];
    case "particles": {
      const emitter = layer.emitter!;
      const base =
        emitter.render.mode === "flatStrip"
          ? "strip"
          : emitter.render.mode === "sliver"
            ? "sliver"
            : emitter.sub
              ? "subParticle"
              : "particle";
      const programs = [of(base)];
      if (emitter.trail) programs.push(of(emitter.sub ? "subTrail" : "trail"));
      if (emitter.render.mode === "sliver" && emitter.render.secondary)
        programs.push(of("sliver"));
      return programs;
    }
    case "blob":
      // Fill and hull, each in an opaque and a transparent build.
      return [of("blob"), of("blob-hull")];
    case "crystals":
      return [of("crystal"), of("crystal-hull")];
    case "splash":
      return [of("splash")];
    case "ribbon":
      return [of("ribbon")];
    case "wireBurst":
      return [of("wireBurst")];
    case "arcs":
      return [of("arc")];
    case "streakBurst":
      return [of("streak")];
    case "sheets":
      return [of("sheet")];
    case "crescent":
      return [of("crescent")];
    case "licks":
      return [of("lick")];
    default:
      return [of("surface")];
  }
}

/** Draw calls and instances for one layer. */
function drawsOf(layer: LayerV2): { draws: number; instances: number } {
  // material.rgbSplit draws the surface twice more, once per shifted channel.
  const split = layer.material?.rgbSplit ? 3 : 1;
  switch (layer.kind) {
    case "light":
      return { draws: 0, instances: 0 };
    case "particles": {
      const emitter = layer.emitter!;
      const secondary =
        emitter.render.mode === "sliver" && emitter.render.secondary
          ? emitter.render.secondary.perInstance
          : 0;
      return {
        draws: 1 + (emitter.trail ? 1 : 0) + (secondary ? 1 : 0),
        instances:
          emitter.count * (1 + (emitter.trail ? 1 : 0) + secondary),
      };
    }
    case "blob":
      return { draws: 2, instances: layer.blob!.count * 2 };
    case "crystals":
      return { draws: 2, instances: layer.crystals!.count * 2 };
    // One ribbon per sliver, backing and fill: each sliver is its own geometry.
    case "splash":
      return { draws: layer.splash!.count * 2, instances: 0 };
    // Each sheet is its own ribbon geometry, all through one material.
    case "sheets":
      return { draws: layer.sheets!.count, instances: 0 };
    case "crescent":
      return { draws: layer.crescent!.tonal.length, instances: 0 };
    case "wireBurst":
      return { draws: split, instances: 0 };
    default:
      return { draws: split, instances: 0 };
  }
}

/** The instance-bearing count of a layer, and how to write it back. */
export function instanceCountOf(
  layer: LayerV2,
): { get: number; set: (value: number) => void } | null {
  if (layer.kind === "particles" && layer.emitter)
    return {
      get: layer.emitter.count,
      set: (value) => {
        layer.emitter!.count = value;
      },
    };
  if (layer.blob)
    return {
      get: layer.blob.count,
      set: (value) => {
        layer.blob!.count = value;
      },
    };
  if (layer.crystals)
    return {
      get: layer.crystals.count,
      set: (value) => {
        layer.crystals!.count = value;
      },
    };
  if (layer.splash)
    return {
      get: layer.splash.count,
      set: (value) => {
        layer.splash!.count = value;
      },
    };
  if (layer.sheets)
    return {
      get: layer.sheets.count,
      set: (value) => {
        layer.sheets!.count = value;
      },
    };
  return null;
}

export function gpuCostV2(doc: VfxDocumentV2): GpuCostV2 {
  const programs = new Set<string>();
  let draws = 0;
  let instances = 0;
  for (const layer of doc.layers) {
    if (!layer.enabled) continue;
    for (const program of programsOf(layer)) programs.add(program);
    const cost = drawsOf(layer);
    draws += cost.draws;
    instances += cost.instances;
  }
  return { draws, pipelines: programs.size, instances };
}

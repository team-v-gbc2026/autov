import { z } from "zod";
import {
  DocumentV2Schema,
  LayerV2Schema,
  validateWorkspaceDocumentV2,
  type VfxDocumentV2,
} from "../vfx-lab/schema-v2";

const patch = z.record(z.string(), z.json());
export const EditSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operations: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({ type: z.literal("update_effect"), changes: patch })
            .strict(),
          z
            .object({
              type: z.literal("update_layer"),
              layerId: z.string(),
              changes: patch,
            })
            .strict(),
          z
            .object({ type: z.literal("add_layer"), layer: LayerV2Schema })
            .strict(),
          z
            .object({
              type: z.literal("duplicate_layer"),
              layerId: z.string(),
              newId: z.string(),
              name: z.string().max(80),
            })
            .strict(),
          z
            .object({ type: z.literal("remove_layer"), layerId: z.string() })
            .strict(),
        ]),
      )
      .min(1)
      .max(32),
  })
  .strict();
export const GenerationSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    prompt: z.string().trim().min(1).max(10000),
    requirements: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
    avoid: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
    textureIds: z.array(z.string().max(48)).max(4).default([]),
    referenceIds: z.array(z.string().uuid()).max(8),
    mode: z.enum(["replace", "add"]),
  })
  .strict();
export const ViewSchema = z
  .object({
    layerId: z.string().optional(),
    solo: z.boolean().optional(),
    playing: z.boolean().optional(),
    time: z.number().min(0).max(12).optional(),
  })
  .strict();
export const PreviewSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    layerId: z.string().optional(),
    times: z.array(z.number().min(0).max(12)).min(1).optional(),
  })
  .strict();
export class OperationError extends Error {
  constructor(
    public code:
      "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE" | "CANCELLED",
    message: string,
  ) {
    super(message);
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** Object-only merge. Arrays replace, null clears nullable fields, no prototype traversal. */
export function mergePatch(
  base: unknown,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = record(base)
    ? structuredClone(base)
    : {};
  for (const [key, value] of Object.entries(changes)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new OperationError("INVALID_INPUT", "Unsupported property.");
    result[key] = record(value)
      ? mergePatch(result[key], value)
      : structuredClone(value);
  }
  return result;
}
export function editDocument(
  document: VfxDocumentV2,
  input: z.infer<typeof EditSchema>,
) {
  const parsed = EditSchema.parse(input);
  let next = structuredClone(document);
  for (const operation of parsed.operations) {
    if (operation.type === "update_effect") {
      if (["layers", "schemaVersion"].some((key) => key in operation.changes))
        throw new OperationError(
          "INVALID_INPUT",
          "Use layer operations; schemaVersion cannot change.",
        );
      next = mergePatch(next, operation.changes) as VfxDocumentV2;
    } else if (operation.type === "add_layer")
      next.layers.push(structuredClone(operation.layer));
    else {
      const index = next.layers.findIndex(
        (layer) => layer.id === operation.layerId,
      );
      if (index < 0)
        throw new OperationError(
          "NOT_FOUND",
          `Layer ${operation.layerId} is unavailable. Read the effect again.`,
        );
      if (operation.type === "remove_layer") next.layers.splice(index, 1);
      if (operation.type === "duplicate_layer")
        next.layers.push({
          ...structuredClone(next.layers[index]),
          id: operation.newId,
          name: operation.name,
        });
      if (operation.type === "update_layer") {
        if ("id" in operation.changes)
          throw new OperationError("INVALID_INPUT", "Layer IDs cannot change.");
        next.layers[index] = mergePatch(
          next.layers[index],
          operation.changes,
        ) as (typeof next.layers)[number];
      }
    }
  }
  return validateWorkspaceDocumentV2(next);
}
/** Append only the generated layers; scale second-based timing, never normalized life curves. */
export function appendGenerated(
  base: VfxDocumentV2,
  generated: VfxDocumentV2,
): VfxDocumentV2 {
  const ratio = base.duration / generated.duration;
  const ids = new Set(base.layers.map((layer) => layer.id));
  const layers = structuredClone(generated.layers);
  const paths = structuredClone(generated.paths ?? []);
  const pathIds = new Set((base.paths ?? []).map(path => path.id));
  const renamedPaths = new Map<string, string>();
  for (const path of paths) {
    const stem = path.id.slice(0, 26);
    let id = stem;
    let suffix = 2;
    while (pathIds.has(id)) id = `${stem}-${suffix++}`;
    renamedPaths.set(path.id, id);
    path.id = id;
    pathIds.add(id);
  }
  const generatedIds = new Map<string, string>();
  for (const layer of layers) {
    const stem = layer.id.slice(0, 40);
    let id = stem;
    let suffix = 2;
    while (ids.has(id)) id = `${stem}-${suffix++}`;
    generatedIds.set(layer.id, id);
    layer.id = id;
    ids.add(id);
  }
  // Resolve references after allocating every ID, including parents listed after children.
  function remapReferences(value: unknown) {
    if (Array.isArray(value)) { value.forEach(remapReferences); return; }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && key === "pathId")
        value[key] = renamedPaths.get(child) ?? child;
      else if (typeof child === "string" && ["sourceLayerId", "parentLayerId", "followsLayerId"].includes(key))
        value[key] = generatedIds.get(child) ?? child;
      else remapReferences(child);
    }
  }
  for (const layer of layers) {
    remapReferences(layer);
    layer.start *= ratio;
    layer.end *= ratio;
    if (layer.motion)
      layer.motion.keys.forEach((key) => {
        key[0] *= ratio;
      });
    layer.tracks.forEach((track) =>
      track.keys.forEach((key) => {
        key[0] *= ratio;
      }),
    );
    layer.overrides.forEach((value) => {
      value.start *= ratio;
      value.end *= ratio;
    });
    if (layer.emitter) {
      layer.emitter.spawn.rate /= ratio;
      layer.emitter.spawn.window *= ratio;
      layer.emitter.spawn.duration *= ratio;
      layer.emitter.spawn.bursts.forEach((burst) => {
        burst.t *= ratio;
      });
      layer.emitter.life = layer.emitter.life.map((value) => value * ratio) as [
        number,
        number,
      ];
      if (layer.emitter.trail) layer.emitter.trail.spacing *= ratio;
      if (layer.emitter.sub) layer.emitter.sub.offset = layer.emitter.sub.offset.map(value => value * ratio) as [number, number];
    }
    if (layer.collapse) { layer.collapse.start *= ratio; layer.collapse.duration *= ratio; }
    if (layer.sheets) for (const group of layer.sheets.classes) { group.life *= ratio; group.period *= ratio; }
    if (layer.arcs) {
      layer.arcs.blink.period = layer.arcs.blink.period.map(value => value * ratio) as [number, number];
      layer.arcs.blink.onTime = layer.arcs.blink.onTime.map(value => value * ratio) as [number, number];
    }
  }
  const textures = new Map(
    (base.textures ?? []).map((asset) => [asset.id, asset]),
  );
  for (const asset of generated.textures ?? []) {
    if (
      textures.has(asset.id) &&
      textures.get(asset.id)!.sha256 !== asset.sha256
    )
      throw new OperationError(
        "INVALID_INPUT",
        "Generated texture conflicts with an existing asset.",
      );
    textures.set(asset.id, asset);
  }
  return validateWorkspaceDocumentV2({
    ...structuredClone(base),
    textures: [...textures.values()],
    paths: [...(base.paths ?? []), ...paths],
    layers: [...base.layers, ...layers],
  });
}
export function summarize(document: VfxDocumentV2, layerIds: string[] = []) {
  for (const id of layerIds)
    if (!document.layers.some((layer) => layer.id === id))
      throw new OperationError("NOT_FOUND", `Layer ${id} is unavailable.`);
  return {
    name: document.name,
    textures: (document.textures ?? []).map(
      ({ data: _data, ...metadata }) => metadata,
    ),
    duration: document.duration,
    impact: document.impact,
    camera: document.camera,
    environment: document.environment,
    post: document.post,
    paths: document.paths,
    layers: document.layers.map((layer) =>
      layerIds.includes(layer.id)
        ? layer
        : {
            id: layer.id,
            name: layer.name,
            kind: layer.kind,
            role: layer.role,
            start: layer.start,
            end: layer.end,
            enabled: layer.enabled,
          },
    ),
  };
}
export const EffectSettingsSchema = DocumentV2Schema.omit({ layers: true });

import { applyExemplarCameraV2 } from "./refine";
import {
  GPU_BUDGET_V2,
  gpuCostV2,
  instanceCountOf,
} from "./gpu-budget-v2";
import { TECHNICAL_GUIDE_V2 } from "./protocol-v2";
import {
  createPresetV2,
  exampleScaleSummary,
  RECIPES_V2,
  type RecipeV2Id,
} from "./recipes-v2";
import { techniqueBrief } from "./techniques-v2";
import {
  BUILTIN_TEXTURE_IDS,
  GROUND_CHANNEL_MIN,
  lintDocumentV2,
  validateDocumentV2,
  type LayerV2,
  type VfxDocumentV2,
} from "./schema-v2";

/**
 * The local benchmark pipeline uses exemplar-anchored candidate generation.
 * Studio uses Eve's explicit art direction through author-candidate.ts and
 * shares the schema, technique source, renderer and GPU repair below.
 */
export const CANDIDATE_V2_SYSTEM = `${TECHNICAL_GUIDE_V2}\nParameterize the plan into a complete autov.lab/2 document. The example is the scale reference: match its particle counts, sizes, light intensity and silhouette extent, and change the shapes, colors and timing to fit the plan.`;

/**
 * What the model is given to parameterize a plan: the routed family, that
 * family's construction knowledge, the technique cards the family and the
 * prompt select, and the exemplar document as the scale reference.
 *
 * `intent` is the user's own words when the prompt sent to the model carries
 * extra context (the "add" mode appends the existing document), so keyword
 * routing never reads a serialized document as if it were the request.
 */
export function candidatePayloadV2(input: {
  prompt: string;
  intent?: string;
  plan: unknown;
  family: RecipeV2Id;
  /** Add the measured exemplar scale beside the exemplar document itself. */
  scale?: boolean;
}) {
  return {
    prompt: input.prompt,
    plan: input.plan,
    family: input.family,
    recipe: RECIPES_V2[input.family].knowledge,
    technique: techniqueBrief(input.family, input.intent ?? input.prompt),
    ...(input.scale ? { scale: exampleScaleSummary(input.family) } : {}),
    example: createPresetV2(input.family),
  };
}

/**
 * The repairs a candidate gets without asking the model again. The one lint
 * warning no prompt reliably fixes is a mesh-hero document framed in the
 * particle band: it is a two-number correction against a measured reference,
 * so it is applied here rather than paid for a second time.
 */
/**
 * Bring a candidate under the GPU budget without changing what it is.
 *
 * Counts come down; layers do not. A burst with half the debris is still the
 * same burst, where a burst missing its debris layer is a different effect —
 * and the budget is generous enough that no exemplar is ever touched. Programs
 * are not repaired: the only way to use fewer is to make layers share a palette
 * or a procedural, which changes the look, so that one is reported instead.
 */
export function fitGpuBudget(doc: VfxDocumentV2): string[] {
  const changes: string[] = [];
  const scaleCounts = (factor: number, reason: string) => {
    for (const layer of doc.layers) {
      const count = instanceCountOf(layer);
      if (!count) continue;
      const next = Math.max(1, Math.floor(count.get * factor));
      if (next === count.get) continue;
      count.set(next);
      changes.push(`${layer.id}: ${count.get} -> ${next} (${reason})`);
    }
  };
  let cost = gpuCostV2(doc);
  if (cost.instances > GPU_BUDGET_V2.instances) {
    scaleCounts(GPU_BUDGET_V2.instances / cost.instances, "instance budget");
    cost = gpuCostV2(doc);
  }
  if (cost.draws > GPU_BUDGET_V2.draws) {
    scaleCounts(GPU_BUDGET_V2.draws / cost.draws, "draw budget");
    cost = gpuCostV2(doc);
  }
  return changes;
}

// --- grounding repair ------------------------------------------------------
//
// Two lint warnings describe the same failure from opposite ends: "No light
// layer: nothing lights the ground, so the contact reads as a decal on black."
// and "Ground color ... is near-black". A generated effect that trips either
// one reads as a sticker floating on black however well its layers are built,
// and neither is a judgement call — the family exemplar already holds the
// answer, so the repair is taken from it here instead of paid for with a
// second model call.

/** Metres above `environment.groundY` a decal may sit and still read as contact. */
const GROUND_CONTACT_Y = 0.25;

/** The ground colour a lift falls back to: the darkest the lint accepts. */
const GROUND_COLOR_FLOOR = "#3a3a44";

/** Brightest sRGB channel of a `#rrggbb` colour, the way the lint reads one. */
function groundChannelMax(color: string): number {
  return Math.max(...[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)));
}

/** A decal lying on the floor — the thing the lint calls the contact. */
function isGroundContactDecal(doc: VfxDocumentV2, layer: LayerV2): boolean {
  return (
    layer.kind === "decal" &&
    layer.enabled &&
    layer.transform.position[1] - doc.environment.groundY <= GROUND_CONTACT_Y
  );
}

/** Every texture a layer names, so a copy is never made against a missing one. */
function texturesOf(layer: LayerV2): string[] {
  return [
    layer.material?.mask.textureId,
    layer.material?.noise?.textureId,
    layer.emitter?.trail?.textureId,
  ].filter((id): id is string => Boolean(id));
}

/**
 * An exemplar layer rewritten to fit the candidate: an id nothing else owns and
 * a window inside the candidate's own duration. The event window goes: it names
 * a path of the exemplar's that the candidate has no reason to carry, and the
 * clock window says the same thing for a light or a floor decal.
 */
function adoptLayer(doc: VfxDocumentV2, layer: LayerV2): LayerV2 {
  const taken = new Set(doc.layers.map((l) => l.id));
  let id = layer.id;
  for (let n = 2; taken.has(id) && n < 100; n++) id = `${layer.id}-${n}`;
  const end = Math.min(layer.end, doc.duration);
  const start = Math.min(layer.start, Math.max(0, end - 0.01));
  return { ...structuredClone(layer), id, start, end, window: null };
}

/** The brightest ramp colour the document actually draws. */
function dominantRampColor(doc: VfxDocumentV2): string {
  let best: { color: string; intensity: number } | null = null;
  for (const layer of doc.layers) {
    if (!layer.enabled || layer.kind === "light") continue;
    for (const stop of layer.material?.ramp?.stops ?? [])
      if (!best || stop.intensity > best.intensity) best = stop;
  }
  return best?.color ?? "#ffd2a0";
}

/**
 * The light a family whose exemplar carries none still needs: one point light
 * in the document's own dominant colour, with its intensity peak and radius
 * inside the anchors every exemplar light sits between (8-30 and 6-16).
 */
function synthesiseLight(doc: VfxDocumentV2): LayerV2 {
  return {
    id: "grounding-light",
    name: "Grounding light",
    role: "secondary",
    kind: "light",
    start: 0,
    end: doc.duration,
    enabled: true,
    transform: {
      position: [0, doc.environment.groundY + 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      squash: null,
    },
    motion: null,
    jitter: null,
    collapse: null,
    window: null,
    frame: null,
    light: {
      color: dominantRampColor(doc),
      intensity: {
        keys: [
          [0, 0],
          [0.15, 14],
          [0.7, 9],
          [1, 0],
        ],
        ease: "smooth",
      },
      radius: 10,
      decay: 2,
    },
    tracks: [],
    overrides: [],
  };
}

/**
 * Give the effect a floor to stand on: a light to throw, a ground bright enough
 * to catch it, and — where the effect declares a contact — the exemplar's own
 * floor decal. Every change comes from the family exemplar, so nothing here
 * invents a look; a change the schema would reject is dropped rather than
 * forced, which leaves the lint warning standing instead of a broken document.
 */
export function groundingRepairV2(
  doc: VfxDocumentV2,
  family: RecipeV2Id,
  /** The reference to repair against; the family's own exemplar by default. */
  exemplar: VfxDocumentV2 = createPresetV2(family),
): { document: VfxDocumentV2; warnings: string[] } {
  let document = doc;
  const warnings: string[] = [];
  // A document with no ground has nothing to light, which is what the lint's
  // own ground rules say as well.
  if (document.environment.ground === "none") return { document, warnings };
  const commit = (next: VfxDocumentV2, note: string) => {
    try {
      document = validateDocumentV2(next);
      warnings.push(`Grounding repair: ${note}`);
    } catch {
      // A repair the schema rejects is no repair: leave the lint warning up.
    }
  };

  if (!document.layers.some((l) => l.enabled && l.kind === "light")) {
    const donors = exemplar.layers.filter(
      (l) => l.enabled && l.kind === "light",
    );
    const layers = [...document.layers];
    for (const donor of donors)
      layers.push(adoptLayer({ ...document, layers }, donor));
    if (!donors.length) layers.push(synthesiseLight(document));
    const added = layers.slice(document.layers.length);
    commit(
      { ...document, layers },
      donors.length
        ? `no light layer; copied the ${family} exemplar's light ${donors.length === 1 ? "layer" : "layers"} (${added.map((l) => l.id).join(", ")}) so something lights the ground.`
        : `no light layer; added a synthesised ${added[0].light?.color} point light so something lights the ground.`,
    );
  }

  if (groundChannelMax(document.environment.groundColor) < GROUND_CHANNEL_MIN) {
    const lifted =
      groundChannelMax(exemplar.environment.groundColor) >= GROUND_CHANNEL_MIN
        ? exemplar.environment.groundColor
        : GROUND_COLOR_FLOOR;
    commit(
      {
        ...document,
        environment: { ...document.environment, groundColor: lifted },
      },
      `ground color ${document.environment.groundColor} is near-black; lifted to ${lifted}.`,
    );
  }

  // Only an effect that declares a contact has a contact to dress: a portal or
  // a standing aura is not missing a scorch mark.
  if (
    document.layers.some((l) => l.enabled && l.role === "impact") &&
    !document.layers.some((l) => isGroundContactDecal(document, l))
  ) {
    const embedded = new Set((document.textures ?? []).map((t) => t.id));
    const donor = exemplar.layers
      .filter(
        (l) =>
          isGroundContactDecal(exemplar, l) &&
          texturesOf(l).every(
            (id) => embedded.has(id) || BUILTIN_TEXTURE_IDS.has(id),
          ),
      )
      .sort(
        (a, b) => Number(b.role === "impact") - Number(a.role === "impact"),
      )[0];
    if (donor) {
      const adopted = adoptLayer(document, donor);
      commit(
        { ...document, layers: [...document.layers, adopted] },
        `no ground-contact decal; copied the ${family} exemplar's ${donor.id} decal as ${adopted.id}.`,
      );
    }
  }
  return { document, warnings };
}

export function repairCandidateV2(
  doc: VfxDocumentV2,
  family: RecipeV2Id,
): { document: VfxDocumentV2; warnings: string[] } {
  const framed = applyExemplarCameraV2(doc, createPresetV2(family));
  // Grounding runs before the budget so whatever it adds is costed with the
  // rest of the document instead of pushing it over afterwards.
  const grounded = groundingRepairV2(framed, family);
  const document = grounded.document;
  const trimmed = fitGpuBudget(document);
  return {
    document,
    warnings: [
      ...grounded.warnings,
      ...trimmed.map((change) => `GPU budget: ${change}`),
      ...lintDocumentV2(document),
    ],
  };
}

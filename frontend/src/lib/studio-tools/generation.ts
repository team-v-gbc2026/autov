import { z } from "zod";
import {
  callStructuredModel,
  modelCost,
  structuredInput,
} from "../vfx-lab/model-provider";
import { GenerationSchema, OperationError } from "./operations";
import { transition, readState, type Identity, type Operation } from "./server";
import { inspectReferences } from "./references";
import { inspectLibraryTextures } from "../vfx-lab/inspect-library-textures";
import { generationBrief, type GenerationContext } from "./generation-context";

/** Stage result persistence is separate from the model transport and from rendering. */
export async function modelStage<T extends z.ZodType>(
  identity: Identity,
  operation: Operation,
  stage: string,
  schema: T,
  system: string,
  text: string,
  images: string[],
  signal: AbortSignal,
  maxOutput: number,
  provider: typeof callStructuredModel = callStructuredModel,
) {
  // Same ceiling as vfx-lab/budget.ts MAX_SPEND_LIMIT_USD, read here rather
  // than imported: a bad configuration must surface as an OperationError on
  // the request, not as a module-load throw in the product path.
  const limit = Number(process.env.OPENAI_VFX_BUDGET_USD || 30);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 80)
    throw new OperationError(
      "UNAVAILABLE",
      "Configure a generation budget between $0 and $80.",
    );
  signal.throwIfAborted();
  if (!process.env.OPENAI_API_KEY)
    throw new OperationError(
      "UNAVAILABLE",
      "Configure OPENAI_API_KEY on the server before generating.",
    );
  if (
    process.env.OPENAI_VFX_MODEL &&
    process.env.OPENAI_VFX_MODEL !== "gpt-6-astra"
  )
    throw new OperationError(
      "UNAVAILABLE",
      "Generation model is incompatible with the configured spending guard.",
    );
  let inputBound: number;
  try {
    ({ inputBound } = structuredInput(schema, system, text, images));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Input is too large for the generation budget guard."
    )
      throw new OperationError(
        "INVALID_INPUT",
        `${stage}: input exceeds the generation budget guard. Reduce reference images or effect complexity.`,
      );
    throw error;
  }
  let usageCost: number | undefined;
  const reserved = await transition(identity, "reserve", {
    id: operation.id,
    stage,
    usd: modelCost(inputBound, maxOutput),
    limit,
  });
  if (!reserved?.call)
    throw new OperationError(
      "UNAVAILABLE",
      reserved?.result?.message ||
        `Generation ${reserved?.status || "stopped"}.`,
    );
  if (reserved.replayed) {
    if (!reserved.call.result)
      throw new OperationError(
        "UNAVAILABLE",
        "An earlier provider call has an unknown outcome. It will not be charged again automatically.",
      );
    return schema.parse(reserved.call.result);
  }
  // Missing usage or ambiguous failures retain the conservative reservation.
  const abort = new AbortController();
  const timer = setInterval(() => {
    void transition(identity, "poll", { id: operation.id })
      .then((op) => {
        if (!["pending", "running"].includes(op.status)) abort.abort();
      })
      .catch(() => abort.abort());
  }, 1000);
  try {
    const response = await provider(
      schema,
      system,
      text,
      images,
      AbortSignal.any([signal, abort.signal]),
      maxOutput,
      "medium",
      600000,
      {
        apiKey: process.env.OPENAI_API_KEY,
        reserve: async () => reserved.call.id,
        settle: async (_id, input, output) => {
          usageCost = modelCost(input, output);
        },
      },
    );
    await transition(identity, "settle", {
      id: operation.id,
      stage,
      usd: usageCost ?? reserved.call.reserved_usd,
      result: response.value,
    });
    return response.value;
  } finally {
    clearInterval(timer);
  }
}
export async function resolveGenerationContext(
  identity: Identity,
  input: z.infer<typeof GenerationSchema>,
): Promise<GenerationContext> {
  const state = await readState(identity);
  if (state.revision !== input.expectedRevision)
    throw new OperationError(
      "CONFLICT",
      "The effect changed before generation.",
    );
  const parts = await inspectReferences(identity, input.referenceIds);
  const images = parts.flatMap((part) =>
    part.type === "file" && typeof part.data === "string" ? [part.data] : [],
  );
  const textures = input.textureIds.length
    ? await inspectLibraryTextures({ textureIds: input.textureIds })
    : [];
  const brief = generationBrief(input, state.document);
  return {
    input,
    base: state.document,
    brief: `${brief}\nImage order: first ${images.length} images are board references in referenceIds order; remaining images are library atlases in textureIds order. Library metadata: ${JSON.stringify(textures.map((t) => t.texture))}`,
    images: [
      ...images,
      ...textures.map((t) => `data:image/png;base64,${t.image}`),
    ],
    criteria: [
      "Matches the requested effect, timing and explicit exclusions.",
      ...input.requirements,
    ],
  };
}

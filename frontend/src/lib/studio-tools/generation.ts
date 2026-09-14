import { z } from "zod";
import { callStructuredModel, modelCost, structuredInput } from "../vfx-lab/model-provider";
import { PlanSchema } from "../vfx-lab/protocol";
import { TECHNICAL_GUIDE_V2 } from "../vfx-lab/protocol-v2";
import { recipeV2For } from "../vfx-lab/recipes-v2";
import {
  CANDIDATE_V2_SYSTEM,
  candidatePayloadV2,
  repairCandidateV2,
} from "../vfx-lab/candidate-v2";
import {
  DocumentV2WireSchema,
  fromWireV2,
  type VfxDocumentV2,
} from "../vfx-lab/schema-v2";
import {
  GenerationSchema,
  appendGenerated,
  OperationError,
} from "./operations";
import { transition, readState, type Identity, type Operation } from "./server";
import { inspectReferences } from "./references";

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
  if (!process.env.OPENAI_API_KEY) throw new OperationError("UNAVAILABLE", "Configure OPENAI_API_KEY on the server before generating.");
  if (process.env.OPENAI_VFX_MODEL && process.env.OPENAI_VFX_MODEL !== "gpt-6-astra") throw new OperationError("UNAVAILABLE", "Generation model is incompatible with the configured spending guard.");
  const { inputBound } = structuredInput(schema, system, text, images);
  let usageCost: number | undefined;
  const reserved = await transition(identity, "reserve", {
    id: operation.id,
    stage,
    usd: modelCost(inputBound, maxOutput),
    limit,
  });
  if (!reserved?.call)
    throw new OperationError("CANCELLED", "Generation stopped.");
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
export async function generateCandidate(
  identity: Identity,
  operation: Operation,
  input: z.infer<typeof GenerationSchema>,
  signal: AbortSignal,
  provider: typeof callStructuredModel = callStructuredModel,
): Promise<VfxDocumentV2> {
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
  const prompt =
    input.mode === "add"
      ? `${input.prompt}\nGenerate ONLY additional layers. Fit them within ${state.document.duration} seconds. Existing effect for context: ${JSON.stringify(state.document)}`
      : input.prompt;
  const plan = await modelStage(
    identity,
    operation,
    "plan",
    PlanSchema,
    `${TECHNICAL_GUIDE_V2}\nPlan the composition and motion. Use only library textures; textures must be [].`,
    prompt,
    images,
    signal,
    12000,
    provider,
  );
  // Routing reads the user's own words, never the serialized document that
  // "add" mode appends to the prompt for context.
  const family = recipeV2For(plan.recipe, input.prompt);
  const wire = await modelStage(
    identity,
    operation,
    "candidate",
    DocumentV2WireSchema,
    CANDIDATE_V2_SYSTEM,
    JSON.stringify(
      candidatePayloadV2({
        prompt,
        intent: input.prompt,
        plan: { ...plan, textures: [] },
        family,
        scale: true,
      }),
    ),
    images,
    signal,
    32000,
    provider,
  );
  const generated = fromWireV2(wire, []);
  // "add" contributes layers to a scene that already has its own camera:
  // re-framing it against an exemplar would move a shot nobody asked about.
  if (input.mode === "add") return appendGenerated(state.document, generated);
  const { document } = repairCandidateV2(generated, family);
  return {
    ...document,
    environment: structuredClone(state.document.environment),
  };
}

import { generateTexture, IMAGE_RESERVATION_USD } from "../vfx-lab/textures";
import { TextureAssetSchema } from "../vfx-lab/schema";
import { transition, type Identity, type Operation } from "./server";
import { OperationError } from "./operations";

/** Durable image generation; callers register the same pixels on the board. */
export async function generateEffectTexture(
  identity: Identity,
  operation: Operation,
  index: number,
  prompt: string,
  references: string[],
  signal: AbortSignal,
  provider: typeof generateTexture = generateTexture,
) {
  signal.throwIfAborted();
  const limit = Number(process.env.OPENAI_VFX_BUDGET_USD || 30);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 60)
    throw new OperationError(
      "UNAVAILABLE",
      "Configure a generation budget between $0 and $60.",
    );
  const stage = `effect-texture-${index}`;
  const reserved = await transition(identity, "reserve", {
    id: operation.id,
    stage,
    usd: IMAGE_RESERVATION_USD,
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
        "An earlier texture call has an unknown outcome. It will not be repeated automatically.",
      );
    return TextureAssetSchema.parse(reserved.call.result);
  }
  let charge = IMAGE_RESERVATION_USD;
  const abort = new AbortController();
  const timer = setInterval(() => {
    void transition(identity, "poll", { id: operation.id })
      .then((op) => {
        if (!["pending", "running"].includes(op.status)) abort.abort();
      })
      .catch(() => abort.abort());
  }, 1000);
  try {
    const result = await provider(
      {
        id: `fx-${operation.id.slice(0, 32)}-${index}`,
        prompt,
        layerIds: ["effect"],
        libraryAssetId: null,
      },
      references,
      AbortSignal.any([signal, abort.signal]),
      {
        apiKey: process.env.OPENAI_API_KEY,
        cacheScope: `${identity.userId}/${identity.projectId}`,
        reserve: async () => reserved.call.id,
        settle: async (_id, usd) => {
          charge = usd;
        },
      },
    );
    const asset = TextureAssetSchema.parse(result.asset);
    await transition(identity, "settle", {
      id: operation.id,
      stage,
      usd: result.cached ? 0 : charge,
      result: asset,
    });
    return asset;
  } finally {
    clearInterval(timer);
  }
}

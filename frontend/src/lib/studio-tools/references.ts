import sharp from "sharp";
import { createHash } from "node:crypto";
import { TextureAssetSchema, type TextureAsset } from "../vfx-lab/schema";
import { type Identity, verifyIdentity, type Operation } from "./server";
import { OperationError } from "./operations";
import { referenceParts } from "../../../agent/lib/references";
import { productionBoardAssets } from "./board-assets";
export async function listReferences(
  identity: Identity,
  attached: string[] = [],
) {
  const client = await verifyIdentity(identity);
  const { data, error } = await client
    .from("assets")
    .select("id,name,mime_type")
    .eq("project_id", identity.projectId)
    .eq("archived", false)
    .order("created_at");
  if (error)
    throw new OperationError("UNAVAILABLE", "Could not read reference board.");
  return (await productionBoardAssets(data)).map((asset) => ({
    id: asset.id,
    name: asset.name,
    mediaType: asset.mime_type,
    attached: attached.includes(asset.id),
    tag: `@[${asset.name.replace(/[\[\]\r\n]/g, " ")}](reference:${asset.id})`,
  }));
}
export async function inspectReferences(identity: Identity, ids: string[]) {
  if (new Set(ids).size !== ids.length || ids.length > 8)
    throw new OperationError(
      "INVALID_INPUT",
      "Choose at most eight distinct board images.",
    );
  return referenceParts(
    await verifyIdentity(identity),
    identity.projectId,
    ids,
  );
}

/** Stable board identity for an immutable, operation-created runtime texture. */
export async function registerEffectTexture(
  identity: Identity,
  operation: Operation,
  input: TextureAsset,
  role: string,
) {
  const asset = TextureAssetSchema.parse(input);
  const bytes = Buffer.from(asset.data.split(",")[1], "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new OperationError("INVALID_INPUT", "Texture content hash mismatch.");
  const digest = createHash("sha256")
    .update(
      `${identity.projectId}/${asset.model === "reusable-v2-library" ? "library" : operation.id}/${asset.id}/${asset.sha256}`,
    )
    .digest("hex");
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const client = await verifyIdentity(identity);
  const path = `${identity.userId}/${identity.projectId}/${id}`;
  const { error: uploadError } = await client.storage
    .from("references")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (uploadError)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not save effect texture to the reference board.",
    );
  const name = `Effect texture · ${role.replace(/[\[\]\r\n]/g, " ").slice(0, 60)}`;
  const { error } = await client.from("assets").upsert(
    {
      id,
      project_id: identity.projectId,
      name,
      storage_path: path,
      mime_type: "image/png",
      size_bytes: bytes.length,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not register effect texture on the board.",
    );
  const { error: provenanceError } = await client
    .from("studio_reference_provenance")
    .upsert({
      asset_id: id,
      operation_id: operation.id,
      source_revision: operation.expected_revision,
      timestamps: [],
    });
  if (provenanceError)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not record effect texture provenance.",
    );
  return {
    referenceId: id,
    textureId: asset.id,
    role,
    sha256: asset.sha256,
    tag: `@[${name}](reference:${id})`,
  };
}
/** Shared asset-registration boundary. IDs are operation-derived for replay safety. */
export async function registerCapture(
  identity: Identity,
  operation: Operation,
  sheet: string,
  times: number[],
) {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(sheet);
  if (!match || sheet.length > 12_000_000)
    throw new OperationError("INVALID_INPUT", "Invalid preview image.");
  const client = await verifyIdentity(identity);
  const id = operation.lease_id || operation.id;
  const path = `${identity.userId}/${identity.projectId}/${id}`;
  const png = await sharp(Buffer.from(match[2], "base64"), {
    limitInputPixels: 16_000_000,
    pages: 1,
  })
    .png()
    .toBuffer();
  const { error: uploadError } = await client.storage
    .from("references")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (uploadError)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not save preview to the board.",
    );
  const { error } = await client.from("assets").upsert(
    {
      id,
      project_id: identity.projectId,
      name: `Preview · revision ${operation.expected_revision}`,
      storage_path: path,
      mime_type: "image/png",
      size_bytes: png.length,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not register preview on the board.",
    );
  const { error: provenanceError } = await client
    .from("studio_reference_provenance")
    .upsert({
      asset_id: id,
      operation_id: operation.id,
      source_revision: operation.expected_revision,
      timestamps: times,
    });
  if (provenanceError)
    throw new OperationError(
      "UNAVAILABLE",
      "Could not record preview provenance.",
    );
  return { referenceId: id, tag: `@[Preview](reference:${id})` };
}

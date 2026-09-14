import sharp from "sharp";
import { type Identity, verifyIdentity, type Operation } from "./server";
import { OperationError } from "./operations";
import { referenceParts } from "../../../agent/lib/references";
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
  return data.map((asset) => ({
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
  const { error } = await client
    .from("assets")
    .upsert(
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

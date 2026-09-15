import { verifyIdentity, type Identity } from "./server";
import { OperationError } from "./operations";

/** A capture can be opened from chat without putting it on the mood board. */
export async function capturePreview(identity: Identity, referenceId: string) {
  const client = await verifyIdentity(identity);
  const { data: asset, error } = await client.from("assets")
    .select("id,name,storage_path,mime_type")
    .eq("project_id", identity.projectId).eq("id", referenceId)
    .eq("archived", false).maybeSingle();
  if (error) throw new OperationError("UNAVAILABLE", "Could not load the saved preview. Try again.");
  if (!asset || asset.storage_path !== `${identity.userId}/${identity.projectId}/${referenceId}`)
    throw new OperationError("NOT_FOUND", "Saved preview not found in this project.");
  const { data: provenance, error: provenanceError } = await client
    .from("studio_reference_provenance").select("timestamps")
    .eq("asset_id", referenceId).maybeSingle();
  if (provenanceError) throw new OperationError("UNAVAILABLE", "Could not load preview details. Try again.");
  if (!Array.isArray(provenance?.timestamps) || !provenance.timestamps.length)
    throw new OperationError("NOT_FOUND", "This reference is not a saved capture.");
  const { data, error: signError } = await client.storage.from("references")
    .createSignedUrl(asset.storage_path, 300);
  if (signError || !data) throw new OperationError("UNAVAILABLE", "Could not open the saved preview. Try again.");
  return { id: asset.id, name: asset.name, url: data.signedUrl };
}

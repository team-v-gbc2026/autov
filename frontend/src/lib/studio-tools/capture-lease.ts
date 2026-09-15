import { verifyIdentity, type Identity, type Operation } from "./server";
import { OperationError } from "./operations";

// Longer than a GPU compile/upload stall, but abandoned work still expires.
export const CAPTURE_LEASE_MS = 120_000;
export const CAPTURE_MAX_MS = 600_000;

export async function renewCaptureLease(
  identity: Identity,
  id: string,
  leaseId: string,
) {
  const client = await verifyIdentity(identity);
  const { data: operation, error } = await client
    .from("studio_operations")
    .select("created_at")
    .eq("project_id", identity.projectId)
    .eq("id", id)
    .single();
  if (error) throw new OperationError("UNAVAILABLE", "Capture storage could not be read. Check the connection and recover the saved candidate.");
  if (!operation) throw new OperationError("NOT_FOUND", "Capture ID not found in this project.");
  const now = Date.now();
  const deadline = Math.min(
    now + CAPTURE_LEASE_MS,
    Date.parse(operation.created_at) + CAPTURE_MAX_MS,
  );
  if (!Number.isFinite(deadline) || deadline <= now)
    throw new OperationError(
      "CONFLICT",
      "Capture exceeded its ten-minute limit. Recover the saved candidate instead of regenerating.",
    );
  // All guards are evaluated on the UPDATE: a concurrent cancellation, expiry
  // or lease takeover must win. Never revive terminal work or a lost lease.
  const { data, error: updateError } = await client
    .from("studio_operations")
    .update({
      expires_at: new Date(deadline).toISOString(),
      lease_until: new Date(deadline).toISOString(),
    })
    .eq("project_id", identity.projectId)
    .eq("id", id)
    .eq("lease_id", leaseId)
    .eq("status", "running")
    .in("kind", ["preview", "capture_candidate"])
    .gt("lease_until", new Date(now).toISOString())
    .gt("expires_at", new Date(now).toISOString())
    .select("*")
    .maybeSingle();
  if (updateError) throw new OperationError("UNAVAILABLE", "Capture lease could not be renewed because storage is unavailable. Recover the saved candidate when the connection returns.");
  if (!data)
    throw new OperationError(
      "CONFLICT",
      "Capture lease expired or changed. Recover the saved candidate instead of regenerating.",
    );
  return data as Operation;
}

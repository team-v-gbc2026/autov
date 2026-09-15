/** Distinguish an absent worker from a worker which stopped renewing its lease. */
export function browserExpiry(operation: {
  kind: string; lease_id?: string | null; created_at?: string; expires_at?: string | null;
}) {
  const capture = ["preview", "capture_candidate"].includes(operation.kind);
  const recovery = operation.kind === "capture_candidate"
    ? "recover the saved candidate without regenerating"
    : "retry the preview of the saved effect";
  const elapsed = Date.parse(operation.expires_at || "") - Date.parse(operation.created_at || "");
  if (!operation.lease_id) return {
    reason: "worker_not_connected",
    message: capture
      ? `No Studio tab picked up the capture before its deadline. Keep this project's Studio open and ${recovery}.`
      : "No Studio tab picked up this action before its deadline. Open this project's Studio and retry the action.",
  };
  if (capture && elapsed >= 600_000) return {
    reason: "capture_deadline",
    message: `Capture reached its ten-minute limit. Keep the tab active and ${recovery}.`,
  };
  return {
    reason: "worker_lease_expired",
    message: capture
      ? `The Studio capture stopped renewing its lease. Keep the tab active and ${recovery}.`
      : "The Studio action stopped renewing its lease. Keep the tab active and retry the action.",
  };
}

export function ownsBrowserLease(claimed: { status?: string; lease_id?: string } | null, leaseId: string) {
  return claimed?.status === "running" && claimed.lease_id === leaseId;
}

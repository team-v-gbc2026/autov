import { test } from "node:test";
import assert from "node:assert/strict";
import { browserExpiry, ownsBrowserLease } from "../src/lib/studio-tools/browser-operation";
test("expiry distinguishes an unclaimed tab from an interrupted capture and hard deadline", () => {
  assert.equal(browserExpiry({ kind: "capture_candidate" }).reason, "worker_not_connected");
  assert.equal(browserExpiry({ kind: "capture_candidate", lease_id: "lease" }).reason, "worker_lease_expired");
  assert.equal(browserExpiry({ kind: "capture_candidate", lease_id: "lease", created_at: "2026-09-15T00:00:00Z", expires_at: "2026-09-15T00:10:00Z" }).reason, "capture_deadline");
});
test("only the browser owning the returned running lease executes a capture", () => {
  assert.equal(ownsBrowserLease(null, "mine"), false);
  assert.equal(ownsBrowserLease({ status: "running", lease_id: "other" }, "mine"), false);
  assert.equal(ownsBrowserLease({ status: "completed", lease_id: "mine" }, "mine"), false);
  assert.equal(ownsBrowserLease({ status: "running", lease_id: "mine" }, "mine"), true);
});

test("expired operation diagnostics survive the server transition used by workflow polling", async () => {
  const { transition } = await import("../src/lib/studio-tools/server");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: "capture", kind: "capture_candidate", status: "expired", lease_id: "lease", result: { message: "Open the studio and try again." } });
  try {
    const result = await transition({ userId: "u", projectId: "p" }, "poll", { id: "capture" });
    assert.equal(result.result.reason, "worker_lease_expired");
    assert.match(result.result.message, /stopped renewing/);
  } finally { globalThis.fetch = original; }
});


test("ordinary preview expiry does not offer candidate-only recovery", () => {
  assert.match(browserExpiry({ kind: "preview", lease_id: "lease" }).message, /retry the preview/);
  assert.doesNotMatch(browserExpiry({ kind: "preview" }).message, /recover the saved candidate/);
});

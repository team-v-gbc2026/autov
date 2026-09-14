import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  renewCaptureLease,
  CAPTURE_MAX_MS,
} from "../src/lib/studio-tools/capture-lease";
import { startHeartbeat } from "../src/lib/studio-tools/heartbeat";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const identity = { userId: "user", projectId: "project" };

function mock(createdAt: number, updated: boolean) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const updates: { url: URL; body: Record<string, string> }[] = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/projects"))
      return Response.json({ id: identity.projectId });
    assert.equal(url.searchParams.get("project_id"), "eq.project");
    assert.equal(url.searchParams.get("id"), "eq.capture");
    if (init?.method === "PATCH") {
      updates.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json(
        updated ? { id: "capture", status: "running" } : null,
      );
    }
    return Response.json({ created_at: new Date(createdAt).toISOString() });
  };
  return updates;
}

test("capture renewal is bounded and atomically guards lease ownership and live status", async () => {
  const created = Date.now() - CAPTURE_MAX_MS + 30_000;
  const updates = mock(created, true);
  await renewCaptureLease(identity, "capture", "lease");
  assert.equal(updates.length, 1);
  const { url, body } = updates[0];
  assert.equal(url.searchParams.get("lease_id"), "eq.lease");
  assert.equal(url.searchParams.get("status"), "eq.running");
  assert.equal(url.searchParams.get("kind"), "in.(preview,capture_candidate)");
  assert.match(url.searchParams.get("expires_at")!, /^gt\./);
  assert.match(url.searchParams.get("lease_until")!, /^gt\./);
  assert.equal(Date.parse(body.expires_at), created + CAPTURE_MAX_MS);
  assert.equal(body.lease_until, body.expires_at);
});

test("lost/terminal leases are never revived", async () => {
  mock(Date.now(), false);
  await assert.rejects(
    renewCaptureLease(identity, "capture", "lease"),
    /expired or changed/,
  );
});

test("hard deadline cannot be extended", async () => {
  const updates = mock(Date.now() - CAPTURE_MAX_MS - 1, true);
  await assert.rejects(
    renewCaptureLease(identity, "capture", "lease"),
    /ten-minute/,
  );
  assert.equal(updates.length, 0);
});

test("heartbeat serializes renewals and stops cleanly", async () => {
  let calls = 0;
  let release!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stop = startHeartbeat(async () => {
    calls++;
    started();
    await inFlight;
  }, 1);
  await first;
  const stopped = stop();
  release();
  await stopped;
  assert.equal(calls, 1);
});

test("heartbeat reports renewal failure at handoff", async () => {
  let started!: () => void;
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stop = startHeartbeat(async () => {
    started();
    throw Error("Lease lost");
  }, 1);
  await first;
  await assert.rejects(stop(), /Lease lost/);
});

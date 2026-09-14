import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../../src/app/api/studio/route";
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const projectId = "10000000-0000-4000-8000-000000000001";
test("studio read and mutation require authentication before accessing storage", async () => {
  globalThis.fetch = async () => { throw new Error("No external request expected"); };
  for (const handler of [GET, POST]) {
    const response = await handler(new Request("http://localhost/api/studio", { headers: { "x-autov-project-id": projectId } }));
    assert.equal(response.status, 401);
  }
});
test("forged project identity is rejected before trusted transitions", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable";
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ id: projectId });
    if (url.includes("/rest/v1/projects")) return Response.json(null);
    throw new Error("Trusted service should not be reached");
  };
  const response = await GET(new Request("http://localhost/api/studio", { headers: { "x-autov-project-id": projectId, Authorization: "Bearer user-token" } }));
  assert.equal(response.status, 404);
});

test("studio polling checks ownership once and returns current state", async () => {
  const { createPresetV2 } = await import("../../src/lib/vfx-lab/recipes-v2");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  let ownershipReads = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: projectId });
    if (url.pathname === "/rest/v1/projects") {
      ownershipReads++;
      return Response.json({ id: projectId });
    }
    assert.equal(url.searchParams.get("project_id"), `eq.${projectId}`);
    if (url.pathname === "/rest/v1/studio_documents") return Response.json({ revision: 3, document: createPresetV2("fire-projectile") });
    if (["/rest/v1/studio_operations", "/rest/v1/assets"].includes(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const response = await GET(new Request("http://localhost/api/studio", { headers: { "x-autov-project-id": projectId, Authorization: "Bearer user-token" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 3);
  assert.equal(ownershipReads, 1);
});

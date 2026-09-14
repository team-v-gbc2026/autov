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

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../src/app/api/projects/[id]/conversation/route";

const projectId = "10000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });

// Next's request wrapper need not be an instance of the native Request constructor.
function frameworkRequest(token?: string): Request {
  return {
    url: `http://localhost/api/projects/${projectId}/conversation`,
    headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}),
    signal: new AbortController().signal,
  } as Request;
}
test("framework request without credentials returns 401 instead of a constructor error", async () => {
  const response = await GET(frameworkRequest(), { params: Promise.resolve({ id: projectId }) });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "UNAUTHENTICATED");
});
test("framework request reaches the actionable missing Gateway response after authentication", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test";
  delete process.env.AI_GATEWAY_API_KEY;
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer user-token");
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: projectId });
    if (url.pathname === "/rest/v1/projects") return Response.json({ id: projectId, name: "Project" });
    throw new Error("Unexpected request");
  };
  const response = await GET(frameworkRequest("user-token"), { params: Promise.resolve({ id: projectId }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /AI_GATEWAY_API_KEY/);
});

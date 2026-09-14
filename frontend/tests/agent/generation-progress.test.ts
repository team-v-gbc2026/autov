import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../src/app/api/studio/progress/route";
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const id = "10000000-0000-4000-8000-000000000001";
test("generation progress requires authentication", async () => {
  assert.equal((await GET(new Request("http://localhost/api/studio/progress?callId=test", { headers: { "x-autov-project-id": id } }))).status, 401);
});
test("progress reports provider stage and restricts operation reads to the current conversation", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user" || url.pathname === "/rest/v1/projects") return Response.json({ id });
    if (url.pathname === "/rest/v1/project_conversations") return init?.method === "POST" ? new Response(null, { status: 201 }) : Response.json({ session_id: "owned" });
    assert.equal(url.searchParams.get("project_id"), `eq.${id}`);
    if (url.pathname === "/rest/v1/studio_provider_calls") return Response.json([{ stage: "plan", charged_usd: 0.01 }, { stage: "candidate", charged_usd: null }]);
    if (url.pathname === "/rest/v1/studio_operations") {
      assert.equal(url.searchParams.get("session_id"), "eq.owned");
      return Response.json(url.searchParams.get("call_id") === "eq.test:capture" ? null : { id, status: "pending", created_at: "2026-09-14T00:00:00Z", result: null });
    }
    throw new Error("Unexpected request");
  };
  const response = await GET(new Request("http://localhost/api/studio/progress?callId=test", { headers: { "x-autov-project-id": id, Authorization: "Bearer test" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stage, 2);
});

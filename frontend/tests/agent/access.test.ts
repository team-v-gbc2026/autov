import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import channel from "../../agent/channels/eve";
import type { RouteHandlerArgs } from "eve/channels";
import { authorizeProject, assertSession, type Conversation } from "../../agent/lib/database";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const projectId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
function mockDatabase(options: { owner?: boolean; expired?: boolean; sessionId?: string } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test";
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "publishable-test");
    assert.equal(headers.get("authorization"), "Bearer user-token");
    if (url.pathname === "/auth/v1/user") return Response.json(options.expired ? { message: "expired" } : { id: userId, aud: "authenticated", role: "authenticated", email: "test@example.com" }, { status: options.expired ? 401 : 200 });
    if (url.pathname === "/rest/v1/projects") {
      assert.equal(url.searchParams.get("id"), `eq.${projectId}`);
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      return Response.json(options.owner === false ? null : { id: projectId, name: "Project" });
    }
    if (url.pathname === "/rest/v1/project_conversations") {
      if (init?.method === "POST") return new Response(null, { status: 201 });
      return Response.json({ project_id: projectId, session_id: options.sessionId ?? "owned-session", lease_id: null, lease_until: null });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
}
function request(path: string, method = "GET", token = "user-token") {
  return new Request(`http://localhost${path}`, { method, headers: { "x-autov-project-id": projectId, ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ message: "fire" }) } : {}) });
}
function route(path: string, method: string) {
  const value = channel.routes.find(route => route.path === path && route.method === method);
  assert.ok(value && value.transport !== "websocket");
  return value;
}
test("reject missing and expired tokens", async () => {
  mockDatabase({ expired: true });
  await assert.rejects(authorizeProject(request("/", "GET", "")), { status: 401 });
  await assert.rejects(authorizeProject(request("/")), { status: 401 });
});
test("reject a project not owned by the verified user", async () => {
  mockDatabase({ owner: false });
  await assert.rejects(authorizeProject(request("/")), { status: 404 });
});
test("a known session ID is not permission to use another conversation", () => {
  const binding = { session_id: "owned-session" } as Conversation;
  assert.throws(() => assertSession(binding, "stolen-session"), { status: 404 });
  assert.doesNotThrow(() => assertSession(binding, "owned-session"));
});
test("messages, streams, and cancellation enforce the server binding before runtime access", async () => {
  mockDatabase();
  for (const [method, suffix] of [["POST", ""], ["GET", "/stream"], ["POST", "/cancel"]]) {
    const value = route(`/eve/v1/session/:sessionId${suffix}`, method);
    const response = await value.handler(request(`/eve/v1/session/stolen-session${suffix}`, method), { params: { sessionId: "stolen-session" } } as unknown as RouteHandlerArgs);
    assert.equal(response.status, 404);
  }
});
test("session resets are denied even to the owner", async () => {
  mockDatabase();
  const response = await route("/eve/v1/session/:sessionId/reset", "POST").handler(request("/eve/v1/session/owned-session/reset", "POST"), { params: { sessionId: "owned-session" }, resolveSession: async () => ({ id: "owned-session" }) } as unknown as RouteHandlerArgs);
  assert.equal(response.status, 403);
});
test("missing Gateway configuration returns an actionable failure before a model call", async () => {
  mockDatabase();
  delete process.env.AI_GATEWAY_API_KEY;
  const response = await route("/eve/v1/session/:sessionId", "POST").handler(request("/eve/v1/session/owned-session", "POST"), { params: { sessionId: "owned-session" }, resolveSession: async () => ({ id: "owned-session" }) } as unknown as RouteHandlerArgs);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /AI_GATEWAY_API_KEY/);
});

test("forging the database pointer cannot grant access to another eve session", async () => {
  mockDatabase({ sessionId: "stolen-session" });
  for (const [method, suffix] of [["POST", ""], ["GET", "/stream"], ["POST", "/cancel"]]) {
    let resolvedAddress = "";
    const response = await route(`/eve/v1/session/:sessionId${suffix}`, method).handler(
      request(`/eve/v1/session/stolen-session${suffix}`, method),
      { params: { sessionId: "stolen-session" }, resolveSession: async (address: string) => { resolvedAddress = address; return { id: "owned-session" }; } } as unknown as RouteHandlerArgs,
    );
    assert.equal(response.status, 404);
    assert.equal(resolvedAddress, `studio:${userId}:${projectId}`);
  }
});

test("an idle owned session accepts a follow-up and preserves Eve delivery metadata", async () => {
  mockDatabase();
  process.env.AI_GATEWAY_API_KEY = "test-key";
  const databaseFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/claim_project_conversation") return Response.json(true);
    if (url.pathname === "/rest/v1/project_conversations" && init?.method === "PATCH") return new Response(null, { status: 204 });
    return databaseFetch(input, init);
  };
  let deliveries = 0;
  const session = {
    id: "owned-session",
    getStreamTailIndex: async () => 10,
    getEventStream: async () => new ReadableStream({ start(controller) { controller.enqueue({ type: "session.waiting" }); controller.close(); } }),
    send: async (message: unknown, options: { auth: { principalId: string } }) => {
      assert.deepEqual(message, [{ type: "text", text: "fire" }]);
      assert.equal(options.auth.principalId, userId);
      deliveries++;
      return { status: "accepted", sessionId: "owned-session", deliveryId: "delivery-2" };
    },
  };
  const response = await route("/eve/v1/session/:sessionId", "POST").handler(request("/eve/v1/session/owned-session", "POST"), {
    params: { sessionId: "owned-session" }, resolveSession: async () => session, attachSession: () => session,
  } as unknown as RouteHandlerArgs);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).deliveryId, "delivery-2");
  assert.equal(deliveries, 1);
});

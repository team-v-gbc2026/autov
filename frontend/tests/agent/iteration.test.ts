import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../src/app/api/studio/iteration/route";
import { prepareRefinement } from "../../agent/lib/refinement";
import { finishFirstPass } from "../../agent/lib/generation";
import { createDocument } from "../../src/lib/vfx-lab/ui-bridge";
import { parseTurn } from "../../agent/lib/contracts";
import type { Operation } from "../../src/lib/studio-tools/server";
const originalFetch = globalThis.fetch,
  originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});
const project = "10000000-0000-4000-8000-000000000001",
  user = "20000000-0000-4000-8000-000000000001",
  operationId = "30000000-0000-4000-8000-000000000001";
function env() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test";
  process.env.SUPABASE_SECRET_KEY = "test";
}
const request = () =>
  new Request("http://localhost/api/studio/iteration", {
    headers: { "x-autov-project-id": project, Authorization: "Bearer test" },
  });
test("iteration offers require authentication", async () => {
  assert.equal(
    (
      await GET(
        new Request("http://localhost/api/studio/iteration", {
          headers: { "x-autov-project-id": project },
        }),
      )
    ).status,
    401,
  );
});
test("only the current revision from this conversation gets a Continue offer", async () => {
  env();
  let revision = 4;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
    if (url.pathname === "/rest/v1/projects")
      return Response.json({ id: project });
    if (url.pathname === "/rest/v1/project_conversations")
      return init?.method === "POST"
        ? new Response(null, { status: 201 })
        : Response.json({ session_id: "owned" });
    assert.equal(url.searchParams.get("project_id"), `eq.${project}`);
    if (url.pathname === "/rest/v1/studio_operations") {
      assert.equal(url.searchParams.get("session_id"), "eq.owned");
      assert.equal(url.searchParams.get("status"), "eq.completed");
      return Response.json({
        id: operationId,
        status: "completed",
        after_revision: 4,
      });
    }
    return Response.json({ revision });
  };
  assert.deepEqual(await (await GET(request())).json(), {
    operationId,
    revision: 4,
  });
  revision = 5;
  assert.equal(await (await GET(request())).json(), null);
});
test("refinement cannot run from an unapproved agent call", async () => {
  globalThis.fetch = async () => {
    throw Error("No network before approval");
  };
  await assert.rejects(
    prepareRefinement(
      { session: { auth: { current: { attributes: {} } } } } as never,
      4,
    ),
    /Choose Continue/,
  );
});
test("approval survives parsing without accepting malformed IDs", () => {
  assert.equal(
    parseTurn({
      message: "Continue",
      clientContext: { refineOperationId: operationId },
    }).context.refineOperationId,
    operationId,
  );
  assert.equal(
    parseTurn({ message: "Other request" }).context.refineOperationId,
    null,
  );
  assert.throws(() =>
    parseTurn({
      message: "Continue",
      clientContext: { refineOperationId: "bad" },
    }),
  );
});
test("first pass commits directly without a reviewer or model call", async () => {
  env();
  const document = createDocument();
  let commits = 0;
  globalThis.fetch = async (_url, init) => {
    const args = JSON.parse(String(init?.body));
    assert.equal(args.p_action, "commit");
    commits++;
    assert.deepEqual(args.p_args.document, document);
    assert.match(args.p_args.summary, /Not yet visually reviewed/);
    return Response.json({
      status: "completed",
      result: { revision: 4, operationId },
    });
  };
  const result = await finishFirstPass(
    { userId: user, projectId: project },
    { id: operationId } as Operation,
    {
      status: "completed",
      result: { renderedPixels: 10 },
      input: { document },
    } as unknown as Operation,
  );
  assert.equal((result as Record<string, unknown>).revision, 4);
  assert.equal(commits, 1);
});

test("approved iteration rejects an edited revision before creating operations", async () => {
  env();
  const ctx = { callId: "next", session: { id: "owned", turn: { id: "turn" }, auth: { current: { authenticator: "supabase", principalType: "user", principalId: user, attributes: { projectId: project, refineOperationId: operationId } } } } };
  globalThis.fetch = async (input, init) => {
    assert.notEqual(init?.method, "POST");
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/projects") return Response.json({ id: project });
    if (url.pathname === "/rest/v1/studio_operations") {
      assert.equal(url.searchParams.get("session_id"), "eq.owned");
      assert.equal(url.searchParams.get("project_id"), `eq.${project}`);
      return Response.json({ id: operationId, status: "completed", after_revision: 4 });
    }
    return Response.json({ revision: 5, document: createDocument() });
  };
  await assert.rejects(prepareRefinement(ctx as never, 4), /effect changed/);
});

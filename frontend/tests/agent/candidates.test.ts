import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowToolContext } from "eve/tools";
import {
  commitCandidate,
  editCandidate,
  candidateReceipt,
} from "../../agent/lib/candidates";
import { createDocument } from "../../src/lib/vfx-lab/ui-bridge";
import type { Operation } from "../../src/lib/studio-tools/server";

const fetchBefore = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchBefore;
});
const userId = "20000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const captureId = "40000000-0000-4000-8000-000000000001";
const referenceId = "50000000-0000-4000-8000-000000000001";
const ctx = {
  callId: "call",
  session: {
    id: "session",
    turn: { id: "turn" },
    auth: {
      current: {
        authenticator: "supabase",
        principalType: "user",
        principalId: userId,
        attributes: { projectId },
      },
    },
  },
} as unknown as WorkflowToolContext;

function mock(
  options: {
    inspected?: boolean;
    revision?: number;
    foreign?: boolean;
    mode?: string;
  } = {},
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  const document = createDocument();
  const operation = {
    id: operationId,
    kind: "generate",
    status: "pending",
    expected_revision: 7,
    input: { mode: options.mode ?? "replace" },
    session_id: "session",
  } as unknown as Operation;
  const capture = {
    id: captureId,
    kind: "capture_candidate",
    status: "completed",
    expected_revision: 7,
    input: {
      candidateOperationId: options.foreign ? "other" : operationId,
      document,
    },
    result: { renderedPixels: 100, referenceId, times: [0.1, 0.5, 1] },
  } as unknown as Operation;
  const writes: string[] = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/projects"))
      return Response.json({ id: projectId });
    if (url.pathname.endsWith("/studio_documents"))
      return Response.json({ revision: options.revision ?? 7, document });
    if (url.pathname.endsWith("/studio_operations")) {
      assert.equal(url.searchParams.get("session_id"), "eq.session");
      assert.equal(url.searchParams.get("project_id"), `eq.${projectId}`);
      if (url.searchParams.get("kind") === "eq.reference_inspection")
        return Response.json(options.inspected ? [{ id: "inspection" }] : []);
      return Response.json(
        url.searchParams.get("id") === `eq.${operationId}`
          ? operation
          : capture,
      );
    }
    if (url.pathname.endsWith("/rpc/studio_transition")) {
      const args = JSON.parse(String(init?.body));
      writes.push(args.p_action);
      return Response.json({
        ...operation,
        status: "completed",
        result: { revision: 8, operationId },
      });
    }
    throw Error(`Unexpected request ${url.pathname}`);
  };
  return { document, operation, capture, writes };
}

test("candidate receipt is uncommitted and includes every layer's editable data", async () => {
  const { capture, document } = mock();
  const result = await candidateReceipt(operationId, capture);
  assert.equal(result.committed, false);
  assert.equal(result.referenceId, referenceId);
  assert.deepEqual(result.document.layers, document.layers);
});
test("commit rejects a capture belonging to another operation", async () => {
  const { writes } = mock({ foreign: true, inspected: true });
  await assert.rejects(
    commitCandidate(ctx, {
      operationId,
      captureId,
      inspectedReferenceId: referenceId,
      review: "Looks correct",
    }),
    /does not belong/,
  );
  assert.deepEqual(writes, []);
});
test("knowing the reference ID does not bypass pixel inspection", async () => {
  const { writes } = mock();
  await assert.rejects(
    commitCandidate(ctx, {
      operationId,
      captureId,
      inspectedReferenceId: referenceId,
      review: "Looks correct",
    }),
    /Inspect.*pixels/,
  );
  assert.deepEqual(writes, []);
});
test("stale candidate cannot overwrite a newer document", async () => {
  const { writes } = mock({ inspected: true, revision: 8 });
  await assert.rejects(
    commitCandidate(ctx, {
      operationId,
      captureId,
      inspectedReferenceId: referenceId,
      review: "Looks correct",
    }),
    /effect changed/,
  );
  assert.deepEqual(writes, []);
});
test("add-mode candidate editing cannot change original layers", async () => {
  const { document, writes } = mock({ mode: "add" });
  await assert.rejects(
    editCandidate(ctx, {
      operationId,
      captureId,
      operations: [
        {
          type: "update_layer",
          layerId: document.layers[0].id,
          changes: { enabled: false },
        },
      ],
    }),
    /preserve original layers/,
  );
  assert.deepEqual(writes, []);
});
test("valid inspected candidate commits through the revisioned operation", async () => {
  const { writes } = mock({ inspected: true });
  const result = await commitCandidate(ctx, {
    operationId,
    captureId,
    inspectedReferenceId: referenceId,
    review: "Visible silhouette matches the requested simple emitter.",
  });
  assert.equal(result?.revision, 8);
  assert.deepEqual(writes, ["commit"]);
});

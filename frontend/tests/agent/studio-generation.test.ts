import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { modelStage } from "../../src/lib/studio-tools/generation";
import type { Operation } from "../../src/lib/studio-tools/server";
import type { callStructuredModel } from "../../src/lib/vfx-lab/model-provider";
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
const identity = {
  userId: "20000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000001",
};
const operation = { id: "30000000-0000-4000-8000-000000000001" } as Operation;
process.env.OPENAI_API_KEY = "test-key-not-sent";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
process.env.SUPABASE_SECRET_KEY = "test-only";
const schema = z.object({ name: z.string() });
const signal = new AbortController().signal;
test("completed provider stages replay persisted results without a second call", async () => {
  let record: { result: unknown; reserved_usd: number; id: string } | null =
    null;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const args = JSON.parse(String(init?.body));
    if (args.p_action === "reserve") {
      const replayed = record !== null;
      record ??= { result: null, reserved_usd: 3, id: "reserve-1" };
      return Response.json({ replayed, call: record });
    }
    if (args.p_action === "settle") {
      record!.result = args.p_args.result;
      return Response.json({});
    }
    throw new Error("Unexpected transition");
  };
  const provider = (async (...args: Parameters<typeof callStructuredModel>) => {
    calls++;
    await args[8].settle("reserve-1", 100, 50);
    return { value: { name: "Generated" }, usage: {}, elapsedSeconds: 0 };
  }) as typeof callStructuredModel;
  assert.deepEqual(
    await modelStage(
      identity,
      operation,
      "plan",
      schema,
      "system",
      "prompt",
      [],
      signal,
      100,
      provider,
    ),
    { name: "Generated" },
  );
  assert.deepEqual(
    await modelStage(
      identity,
      operation,
      "plan",
      schema,
      "system",
      "prompt",
      [],
      signal,
      100,
      provider,
    ),
    { name: "Generated" },
  );
  assert.equal(calls, 1);
});
test("ambiguous provider outcomes retain reservations and cannot silently run again", async () => {
  let reserved = false,
    calls = 0;
  globalThis.fetch = async () => {
    const replayed = reserved;
    reserved = true;
    return Response.json({
      replayed,
      call: { id: "reserve-1", result: null, reserved_usd: 3 },
    });
  };
  const provider = (async () => {
    calls++;
    throw new Error("Disconnected after submission");
  }) as typeof callStructuredModel;
  await assert.rejects(
    modelStage(
      identity,
      operation,
      "candidate",
      schema,
      "s",
      "p",
      [],
      signal,
      100,
      provider,
    ),
    /Disconnected/,
  );
  await assert.rejects(
    modelStage(
      identity,
      operation,
      "candidate",
      schema,
      "s",
      "p",
      [],
      signal,
      100,
      provider,
    ),
    /unknown outcome/,
  );
  assert.equal(calls, 1);
});
test("budget rejection happens before invoking the provider", async () => {
  globalThis.fetch = async () =>
    Response.json({ message: "Generation budget exceeded" }, { status: 400 });
  const provider = (async () => {
    throw new Error("Provider must not run");
  }) as typeof callStructuredModel;
  await assert.rejects(
    modelStage(
      identity,
      operation,
      "plan",
      schema,
      "s",
      "p",
      [],
      signal,
      100,
      provider,
    ),
    /budget exceeded/,
  );
});

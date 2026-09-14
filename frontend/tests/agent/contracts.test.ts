import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatError, parseTurn, readBody, responseError } from "../../agent/lib/contracts";
import { boundedCalls } from "../../agent/lib/model";

const id = "10000000-0000-4000-8000-000000000001";
test("valid turn includes only studio context and ordered reference IDs", () => {
  const value = parseTurn({ message: "  blue fire  ", clientContext: { referenceIds: [id], selectedEmitterId: "fire", document: { name: "Fire" }, userId: "forged" }, forwardedPrincipal: { principalId: "forged" } });
  assert.equal(value.prompt, "blue fire");
  assert.deepEqual(value.referenceIds, [id]);
  assert.equal("userId" in value.context, false);
});
test("reject malformed prompts and reference selections", () => {
  for (const message of [null, [], {}, " ", "a".repeat(10001)]) assert.throws(() => parseTurn({ message }), ChatError);
  for (const referenceIds of ["x", [id, id], ["bad"], Array(9).fill(id)]) assert.throws(() => parseTurn({ message: "fire", clientContext: { referenceIds } }), ChatError);
});
test("limit streamed body size even without Content-Length", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(129 * 1024)); controller.close(); } });
  const request = new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  await assert.rejects(readBody(request), (error: unknown) => error instanceof ChatError && error.status === 413);
});
test("malformed JSON and wrong content types are rejected", async () => {
  await assert.rejects(readBody(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), ChatError);
  await assert.rejects(readBody(new Request("http://localhost", { method: "POST", body: "{}" })), ChatError);
});
test("unexpected errors do not expose provider or credential details", async () => {
  const response = responseError(new Error("secret-token-value"));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes("secret-token-value"), false);
});
test("model calls have an output bound and preserve cancellation", async () => {
  const controller = new AbortController();
  const result = await boundedCalls.transformParams!({ params: { prompt: [], abortSignal: controller.signal }, type: "stream", model: {} as never });
  assert.equal(result.maxOutputTokens, 4096);
  controller.abort();
  assert.equal(result.abortSignal?.aborted, true);
});

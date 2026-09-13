import test from "node:test";
import assert from "node:assert/strict";
import { createChunks, combineChunks } from "@supabase/ssr";
import { filterSupabaseCookies } from "../src/lib/supabase/auth-cookies";
test("filtered Supabase cookies still reconstruct an SDK-chunked session", async () => {
  const key = "sb-current-auth-token",
    value = "large-session-payload-".repeat(1000),
    chunks = createChunks(key, value);
  assert.ok(chunks.length > 1);
  const filtered = filterSupabaseCookies(
    [
      ...chunks,
      { name: "analytics", value: "large-unrelated-cookie" },
      { name: "sb-other-auth-token", value: "other-project" },
    ],
    "https://current.supabase.co",
  );
  assert.equal(
    await combineChunks(
      key,
      (name) => filtered.find((c) => c.name === name)?.value,
    ),
    value,
  );
  assert.equal(filtered.length, chunks.length);
});
test("fixed, per-flow, index and chunked PKCE cookies survive filtering", () => {
  const names = [
    "sb-current-auth-token-code-verifier",
    "sb-current-auth-token-code-verifier.0",
    "sb-current-auth-token-flow-abcdefgh_123-code-verifier",
    "sb-current-auth-token-flows-code-verifier",
    "sb-auth-token.0",
  ];
  const cookies = names.map((name) => ({ name, value: "v" }));
  assert.deepEqual(
    filterSupabaseCookies(
      [
        ...cookies,
        { name: "sb-current-auth-token-unrelated", value: "v" },
        { name: "sb-other-auth-token.0", value: "v" },
      ],
      "https://current.supabase.co",
    ),
    cookies,
  );
});
test("custom Supabase domain follows the SDK storage-key convention", () => {
  const cookies = [{ name: "sb-auth-auth-token.0", value: "v" }];
  assert.deepEqual(
    filterSupabaseCookies(cookies, "https://auth.example.com"),
    cookies,
  );
});

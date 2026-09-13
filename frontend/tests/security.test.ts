import test from "node:test";
import assert from "node:assert/strict";
import { isLocalRequest } from "../src/lib/vfx-lab/server";
for (const [name, url, headers, expected] of [
  [
    "local",
    "http://localhost:3000/api/local-vfx",
    {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
    },
    true,
  ],
  [
    "cross-site",
    "http://localhost:3000/api/local-vfx",
    {
      host: "localhost:3000",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    false,
  ],
  [
    "no origin",
    "http://localhost:3000/api/local-vfx",
    { host: "localhost:3000" },
    false,
  ],
  [
    "rebound host",
    "http://localhost:3000/api/local-vfx",
    { host: "evil.example:3000", origin: "http://evil.example:3000" },
    false,
  ],
  [
    "public",
    "https://autov.example/api/local-vfx",
    { host: "autov.example", origin: "https://autov.example" },
    false,
  ],
] as const)
  test(`API guard: ${name}`, () => {
    assert.equal(
      isLocalRequest(
        new Request(url, {
          method: "POST",
          headers: headers as Record<string, string>,
        }),
      ),
      expected,
    );
  });

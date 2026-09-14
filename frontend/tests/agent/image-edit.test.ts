import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../../src/app/api/references/edit/route";
const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const id = "10000000-0000-4000-8000-000000000001";
test("image edits reject unavailable references before calling the provider", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test";
  process.env.OPENAI_API_KEY = "test";
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ id });
    if (url.includes("/rest/v1/projects")) return Response.json({ id });
    if (url.includes("/rest/v1/assets")) return Response.json(null);
    throw new Error("Must not call provider or storage");
  };
  const request = new Request("http://localhost/api/references/edit", { method: "POST", headers: { Authorization: "Bearer test", "x-autov-project-id": id, "Content-Type": "application/json" }, body: JSON.stringify({ referenceId: id, prompt: "Make it blue" }) });
  assert.equal((await POST(request)).status, 404);
});

test("successful provider edit registers a new reference", async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test";
  process.env.OPENAI_API_KEY = "test";
  let saved = false, calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user") || url.includes("/rest/v1/projects")) return Response.json({ id });
    if (url.includes("/rest/v1/assets")) {
      if (init?.method === "POST") {
        const asset = JSON.parse(String(init.body));
        assert.notEqual(asset.id, id); assert.equal(asset.project_id, id); saved = true;
        return new Response(null, { status: 201 });
      }
      return Response.json({ id, name: "Source", storage_path: `${id}/${id}/${id}` });
    }
    if (new URL(url).hostname === "api.openai.com") { calls++; return Response.json({ data: [{ b64_json: png.toString("base64") }] }); }
    if (url.includes("/object/sign/")) return Response.json({ signedURL: "/signed/image" });
    if (url.includes("/storage/")) return init?.method === "POST" ? Response.json({ Key: "saved" }) : new Response(png);
    throw new Error("Unexpected request");
  };
  const response = await POST(new Request("http://localhost/api/references/edit", { method: "POST", headers: { Authorization: "Bearer test", "x-autov-project-id": id, "Content-Type": "application/json" }, body: JSON.stringify({ referenceId: id, prompt: "Make it blue" }) }));
  assert.equal(response.status, 200); assert.equal(saved, true); assert.equal(calls, 1);
});

test("text-only image generation saves a new board reference", async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test";
  process.env.OPENAI_API_KEY = "test";
  let saved = false, calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user") || url.includes("/rest/v1/projects")) return Response.json({ id });
    if (url.includes("/rest/v1/assets")) {
      if (init?.method === "POST") {
        const asset = JSON.parse(String(init.body));
        assert.notEqual(asset.id, id); assert.equal(asset.project_id, id); saved = true;
        return new Response(null, { status: 201 });
      }
      return Response.json({ id, name: "Source", storage_path: `${id}/${id}/${id}` });
    }
    if (new URL(url).hostname === "api.openai.com") { calls++; return Response.json({ data: [{ b64_json: png.toString("base64") }] }); }
    if (url.includes("/object/sign/")) return Response.json({ signedURL: "/signed/image" });
    if (url.includes("/storage/")) return init?.method === "POST" ? Response.json({ Key: "saved" }) : new Response(png);
    throw new Error("Unexpected request");
  };
  const { POST: generate } = await import("../../src/app/api/references/generate/route");
  const response = await generate(new Request("http://localhost/api/references/edit", { method: "POST", headers: { Authorization: "Bearer test", "x-autov-project-id": id, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Blue magical sparks" }) }));
  assert.equal(response.status, 200); assert.equal(saved, true); assert.equal(calls, 1);
});

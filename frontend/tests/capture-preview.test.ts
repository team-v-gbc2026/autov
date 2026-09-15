import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { capturePreview } from "../src/lib/studio-tools/capture-preview";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const identity = { userId: "user", projectId: "project" };
function mock(mode: "ok" | "missing" | "foreign-path" | "texture" | "storage-error") {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.SUPABASE_SECRET_KEY = "test-only";
  let signed = 0;
  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/projects")) return Response.json({ id: "project" });
    if (url.pathname.endsWith("/assets")) {
      assert.equal(url.searchParams.get("project_id"), "eq.project");
      assert.equal(url.searchParams.get("id"), "eq.capture");
      assert.equal(url.searchParams.get("archived"), "eq.false");
      return Response.json(mode === "missing" ? null : { id: "capture", name: "Preview", storage_path: mode === "foreign-path" ? "other/project/capture" : "user/project/capture" });
    }
    if (url.pathname.endsWith("/studio_reference_provenance")) {
      assert.equal(url.searchParams.get("asset_id"), "eq.capture");
      return Response.json({ timestamps: mode === "texture" ? [] : [1.5] });
    }
    if (url.pathname.includes("/storage/v1/object/sign/")) {
      signed++;
      return mode === "storage-error" ? Response.json({ message: "offline" }, { status: 503 }) : Response.json({ signedURL: "/signed-preview" });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  return () => signed;
}
test("authorized capture resolves independently of production board visibility", async () => {
  const signed = mock("ok");
  const result = await capturePreview(identity, "capture");
  assert.equal(result.name, "Preview");
  assert.match(result.url, /signed-preview/);
  assert.equal(signed(), 1);
});
for (const mode of ["missing", "foreign-path", "texture"] as const) test(`capture preview refuses ${mode} before signing`, async () => {
  const signed = mock(mode);
  await assert.rejects(capturePreview(identity, "capture"));
  assert.equal(signed(), 0);
});
test("capture signing failure stays recoverable", async () => {
  mock("storage-error");
  await assert.rejects(capturePreview(identity, "capture"), /Could not open the saved preview/);
});

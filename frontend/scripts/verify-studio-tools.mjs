import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const fixture = JSON.parse(await readFile("fixtures/v2/fire-projectile/document.json", "utf8"));
const bundle = await build({ entryPoints: ["scripts/studio-tools-test/harness.tsx"], bundle: true, write: false, outdir: "/tmp/studio-browser", format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "test-transport", setup(api) {
  api.onResolve({ filter: /lib\/agent\/client$/ }, () => ({ path: "agent", namespace: "test" }));
  api.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: "database", namespace: "test" }));
  api.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "agent" ? 'export async function agentHeaders(){return {Authorization:"Bearer test"}}' : 'export function createClient(){ const channel={on(){return channel},subscribe(){return channel}};return {channel(){return channel},removeChannel(){return Promise.resolve()}} }', loader: "js" }));
} }] });
let state = null, revision = 0, reference = null, beforeEdit = null, pending = null, preview = null, delayedConflict = false;
const calls = new Map();
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString(); const body = raw ? JSON.parse(raw) : {};
  const json = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
  if (req.url === "/") { res.setHeader("content-type", "text/html"); return res.end('<html><head><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
  if (req.url === "/bundle.js" || req.url === "/bundle.css") { res.setHeader("content-type", req.url.endsWith("js") ? "text/javascript" : "text/css"); return res.end(bundle.outputFiles.find(file => file.path.endsWith(req.url.endsWith("js") ? ".js" : ".css"))?.text); }
  if (req.url === "/api/studio") {
    if (req.method === "GET") return json({ document: state, revision, operations: pending && pending.status !== "completed" ? [pending] : [], assets: [reference, preview].filter(Boolean).map(ref => ({ id: ref.id, name: ref.name, storage_path: ref.url, mime_type: ref.type })) });
    if (body.action === "initialize") { state ??= body.document; return json({ document: state, revision }); }
    if (body.action === "claim") { pending.status = "running"; pending.lease_id = body.leaseId; return json(pending); }
    if (body.action === "ack") { assert.equal(body.error, undefined); assert.ok(body.sheet); pending.status = "completed"; preview = { id: pending.id, name: "Preview", url: body.sheet, type: "image/png" }; return json(pending); }
    if (body.action === "save") {
      if (calls.has(body.callId)) return json(calls.get(body.callId));
      if (body.expectedRevision !== revision) { res.statusCode = 409; return json({ error: "The effect changed. Read it again." }); }
      state = body.document; const result = { revision: ++revision }; calls.set(body.callId, result); return json(result);
    }
  }
  if (req.url === "/test/reference") { reference = body; return json({}); }
  if (req.url === "/test/generate") { assert.ok(reference); state = structuredClone(fixture); revision++; return json({ message: `Generated #[Smoke plume](emitter:smoke-puffs) using @[Smoke reference](reference:${reference.id}).` }); }
  if (req.url === "/test/edit") { beforeEdit = structuredClone(state); state.layers[0].emitter.velocity.speed = [0.15, 0.4]; revision++; return json({ message: "Slowed #[Smoke plume](emitter:smoke-puffs)." }); }
  if (req.url === "/test/undo") { state = beforeEdit; revision++; return json({}); }
  if (req.url === "/test/preview") { pending = { id: "30000000-0000-4000-8000-000000000001", kind: "preview", status: "pending", expected_revision: revision, input: {}, expires_at: new Date(Date.now() + 60000).toISOString() }; return json({ message: "See @[Preview](reference:30000000-0000-4000-8000-000000000001)." }); }
  if (req.url === "/test/conflict") { const expected = revision; setTimeout(() => { delayedConflict = revision !== expected; if (!delayedConflict) { state = structuredClone(fixture); revision++; } }, 500); return json({}); }
  res.statusCode = 404; res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.AUTOV_CHROME_PATH ? { executablePath: process.env.AUTOV_CHROME_PATH } : {}) });
try {
 const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } }); const errors = [];
 page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
 page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(() => document.querySelector('[data-testid="ready"]')?.textContent === "true").catch(async error => { console.error(await page.locator("body").innerText()); throw error; });
 await page.getByLabel("Upload reference").setInputFiles({ name: "smoke.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64") });
 await page.getByRole("button", { name: "Generate from reference" }).click();
 await page.getByRole("button", { name: "@Smoke reference", exact: true }).click();
 assert.equal(await page.getByTestId("reference-focus").textContent(), reference.id);
 await page.getByRole("button", { name: "#Smoke plume — dense puffs", exact: true }).waitFor();
 await page.getByRole("button", { name: "#Smoke plume — dense puffs", exact: true }).click();
 await page.getByRole("dialog", { name: "Edit Smoke plume — dense puffs" }).waitFor();
 await page.keyboard.press("Escape");
 await page.getByRole("button", { name: "Edit smoke", exact: true }).click();
 await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="document"]').textContent).layers[0].emitter.velocity.speed[0] === .15);
 await page.getByRole("button", { name: "Preview effect", exact: true }).click();
 await page.getByRole("button", { name: "@Preview", exact: true }).click();
 assert.equal(pending.status, "completed");
 assert.equal(await page.getByTestId("reference-focus").textContent(), pending.id);
 await page.getByRole("button", { name: "Undo agent edit" }).click();
 await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="document"]').textContent).layers[0].emitter.velocity.speed[0] !== .15);
 await page.getByRole("button", { name: "Delayed generation", exact: true }).click();
 await page.getByRole("button", { name: "Manual edit", exact: true }).click();
 await page.getByRole("button", { name: "Save edits", exact: true }).click();
 await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="document"]').textContent).name === "Manual edit");
 await new Promise(resolve => setTimeout(resolve, 600));
 assert.equal(delayedConflict, true);
 assert.equal(state.name, "Manual edit");
 assert.deepEqual(errors, []);
 await mkdir("test-results/studio-tools", { recursive: true });
 await page.screenshot({ path: "test-results/studio-tools/integration.png", fullPage: true });
 console.log("PASS: browser document synchronization, board upload, generated document, clickable reference/emitter chips, editor opening, targeted edit, undo, and manual save (stubbed server/provider).");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

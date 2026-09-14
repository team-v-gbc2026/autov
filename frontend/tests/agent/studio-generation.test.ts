import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  generateCandidate,
  modelStage,
} from "../../src/lib/studio-tools/generation";
import type { Operation } from "../../src/lib/studio-tools/server";
import type { callStructuredModel } from "../../src/lib/vfx-lab/model-provider";
import { CANDIDATE_V2_SYSTEM } from "../../src/lib/vfx-lab/candidate-v2";
import {
  createPresetV2,
  exampleScaleSummary,
  RECIPES_V2,
} from "../../src/lib/vfx-lab/recipes-v2";
import { techniqueBrief } from "../../src/lib/vfx-lab/techniques-v2";
import {
  lintDocumentV2,
  validateDocumentV2,
  type VfxDocumentV2,
} from "../../src/lib/vfx-lab/schema-v2";
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

// --- the candidate prompt and its deterministic repairs --------------------

/** The wire contract asks for every kind slot explicitly; runtime documents omit them. */
function toWire(doc: VfxDocumentV2) {
  const wire: Record<string, unknown> = {
    ...structuredClone(doc),
    layers: doc.layers.map((layer) => ({
      ...structuredClone(layer),
      material: layer.material ?? null,
      emitter: layer.emitter ?? null,
      geometry: layer.geometry ?? null,
      light: layer.light ?? null,
      blob: layer.blob ?? null,
      splash: layer.splash ?? null,
      ribbon: layer.ribbon ?? null,
      wireBurst: layer.wireBurst ?? null,
      crystals: layer.crystals ?? null,
      arcs: layer.arcs ?? null,
      streakBurst: layer.streakBurst ?? null,
      reflection: layer.reflection ?? null,
      sheets: layer.sheets ?? null,
      crescent: layer.crescent ?? null,
      licks: layer.licks ?? null,
    })),
  };
  delete wire.textures;
  return wire;
}
/**
 * A blob-hero candidate framed in the particle band: the lint's one repairable
 * defect. Reduced to the hero layer so "add" mode stays inside the layer budget.
 */
function lowFramedSmoke() {
  const preset = createPresetV2("smoke-burst");
  return validateDocumentV2({
    ...structuredClone(preset),
    layers: [structuredClone(preset.layers.find((l) => l.id === "pink-ring")!)],
    paths: [],
    camera: { ...preset.camera, framing: 0.65 },
  });
}
const plan = {
  name: "Smoke burst",
  recipe: "smoke",
  intent: "A billowing burst of smoke",
  palette: ["#c8c4bd", "#7a7670", "#3a3835"],
  duration: 2,
  textures: [],
  impact: 0.4,
  motion: { emissionShape: "sphere", trajectory: "rising", timing: "fast" },
  layers: [{ id: "pink-ring", kind: "blob", responsibility: "hero" }],
  criteria: ["a", "b", "c"],
};
/** Drives generateCandidate end to end: state, reservations and both stages. */
function stubGeneration(candidate: unknown, base: VfxDocumentV2) {
  const seen: { system: string; text: string }[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(typeof url === "string" ? url : (url as URL).toString());
    if (href.includes("/rpc/studio_transition"))
      return Response.json({
        replayed: false,
        status: "running",
        call: { id: "reserve-1", result: null, reserved_usd: 1 },
      });
    if (href.includes("/studio_documents"))
      return Response.json({ revision: 7, document: base });
    if (href.includes("/projects"))
      return Response.json({ id: identity.projectId });
    throw new Error(`Unexpected request ${href}`);
  }) as typeof globalThis.fetch;
  const provider = (async (...args: Parameters<typeof callStructuredModel>) => {
    seen.push({ system: args[1], text: args[2] });
    return {
      value: seen.length === 1 ? plan : candidate,
      usage: {},
      elapsedSeconds: 0,
    };
  }) as unknown as typeof callStructuredModel;
  return { seen, provider };
}
test("the candidate prompt carries the routed family's knowledge and technique cards", async () => {
  const base = lowFramedSmoke();
  const { seen, provider } = stubGeneration(toWire(lowFramedSmoke()), base);
  await generateCandidate(
    identity,
    operation,
    {
      expectedRevision: 7,
      prompt: "A billowing burst of smoke",
      referenceIds: [],
      mode: "replace",
    },
    signal,
    provider,
  );
  const candidate = seen[1];
  const payload = JSON.parse(candidate.text);
  assert.equal(payload.family, "smoke-burst");
  assert.equal(payload.recipe, RECIPES_V2["smoke-burst"].knowledge);
  assert.equal(
    payload.technique,
    techniqueBrief("smoke-burst", "A billowing burst of smoke"),
  );
  assert.ok(payload.technique.length > 0);
  assert.deepEqual(payload.scale, exampleScaleSummary("smoke-burst"));
  assert.deepEqual(payload.example, createPresetV2("smoke-burst"));
  assert.equal(candidate.system, CANDIDATE_V2_SYSTEM);
});
test("a mesh hero framed in the particle band comes back with the exemplar camera", async () => {
  const base = lowFramedSmoke();
  const { provider } = stubGeneration(toWire(lowFramedSmoke()), base);
  const document = await generateCandidate(
    identity,
    operation,
    {
      expectedRevision: 7,
      prompt: "A billowing burst of smoke",
      referenceIds: [],
      mode: "replace",
    },
    signal,
    provider,
  );
  assert.ok(document.camera.framing >= 0.8);
  assert.equal(
    document.camera.framing,
    createPresetV2("smoke-burst").camera.framing,
  );
  assert.deepEqual(lintDocumentV2(document), []);
});
test("add mode appends layers and leaves the existing camera alone", async () => {
  const base = lowFramedSmoke();
  const { provider } = stubGeneration(toWire(lowFramedSmoke()), base);
  const document = await generateCandidate(
    identity,
    operation,
    {
      expectedRevision: 7,
      prompt: "Add a billowing burst of smoke",
      referenceIds: [],
      mode: "add",
    },
    signal,
    provider,
  );
  assert.equal(document.camera.framing, 0.65);
  assert.equal(document.layers.length, base.layers.length * 2);
});

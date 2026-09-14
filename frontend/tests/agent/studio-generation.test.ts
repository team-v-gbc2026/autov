import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { modelStage } from "../../src/lib/studio-tools/generation";
import type { Operation } from "../../src/lib/studio-tools/server";
import type { callStructuredModel } from "../../src/lib/vfx-lab/model-provider";
import { createPresetV2 } from "../../src/lib/vfx-lab/recipes-v2";
import {
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
import {
  authorCandidate,
  AuthorCandidateSchema,
} from "../../src/lib/studio-tools/author-candidate";

for (const mode of ["replace", "add"] as const) {
  test(
    "Eve authoring preserves explicit framing and host constraints in " + mode,
    async () => {
      const base = lowFramedSmoke();
      const input = AuthorCandidateSchema.parse({
        expectedRevision: 7,
        prompt: "A billowing burst of smoke",
        referenceIds: [],
        mode,
        direction: {
          silhouette: "Billowing ring",
          layering: [{ role: "primary", appearance: "Purple lobes" }],
          palette: "Purple",
          timing: "Short burst",
          motionDirection: "Outward",
          uncertainties: [],
          textureNeeds: [],
        },
        textures: { bindings: [] },
        family: "smoke-burst",
        techniqueIds: ["cauliflower-blob-cluster"],
      });
      const calls: Parameters<typeof modelStage>[] = [];
      const stage = (async (...args: Parameters<typeof modelStage>) => {
        calls.push(args);
        return toWire(lowFramedSmoke());
      }) as typeof modelStage;
      const result = await authorCandidate(
        identity,
        operation,
        input,
        signal,
        { input, base, brief: input.prompt, images: [], criteria: [] },
        stage,
      );
      assert.equal(
        calls.length,
        1,
        "no hidden art-direction, planning or review calls",
      );
      assert.equal(calls[0][2], "candidate");
      const payload = JSON.parse(calls[0][5]);
      assert.deepEqual(payload.direction, input.direction);
      assert.equal(payload.techniques[0].id, "cauliflower-blob-cluster");
      assert.equal(
        result.document.camera.framing,
        0.65,
        "authored framing wins over exemplar",
      );
      assert.deepEqual(result.document.environment, base.environment);
      assert.equal(result.document.layers.length, mode === "add" ? 2 : 1);
      if (mode === "add")
        assert.deepEqual(result.document.layers[0], base.layers[0]);
    },
  );
}
import { generateEffectTexture } from "../../src/lib/studio-tools/effect-textures";
import type { generateTexture } from "../../src/lib/vfx-lab/textures";
import { registerEffectTexture } from "../../src/lib/studio-tools/references";
import { createHash } from "node:crypto";
const bytes = Buffer.from("test-texture-pixels");
const texture = {
  id: "fx-test-0",
  data: `data:image/png;base64,${bytes.toString("base64")}`,
  prompt: "Effect alpha mask",
  model: "test",
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

test("effect image calls share the operation ledger and replay without generating twice", async () => {
  let saved: unknown = null;
  let reserved = false;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    const args = JSON.parse(String(init?.body));
    assert.equal(args.p_args.stage, "effect-texture-0");
    if (args.p_action === "reserve") {
      const replayed = reserved;
      reserved = true;
      assert.equal(args.p_args.usd, 2);
      return Response.json({
        replayed,
        call: { id: "image-call", result: saved },
      });
    }
    assert.equal(args.p_action, "settle");
    assert.equal(args.p_args.usd, 0.25);
    saved = args.p_args.result;
    return Response.json({});
  };
  const provider = (async (...args: Parameters<typeof generateTexture>) => {
    count++;
    assert.equal(
      args[3]!.cacheScope,
      `${identity.userId}/${identity.projectId}`,
    );
    await args[3]!.settle("image-call", 0.25);
    return { asset: texture, cached: false };
  }) as typeof generateTexture;
  assert.deepEqual(
    await generateEffectTexture(
      identity,
      operation,
      0,
      "Effect mask",
      [],
      signal,
      provider,
    ),
    texture,
  );
  assert.deepEqual(
    await generateEffectTexture(
      identity,
      operation,
      0,
      "Effect mask",
      [],
      signal,
      provider,
    ),
    texture,
  );
  assert.equal(count, 1);
  saved = null;
  await assert.rejects(
    generateEffectTexture(
      identity,
      operation,
      0,
      "Effect mask",
      [],
      signal,
      provider,
    ),
    /unknown outcome/,
  );
  assert.equal(count, 1);
});

test("effect masks register stable board IDs, exact pixels and operation provenance", async () => {
  const ids: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/projects") {
      assert.equal(url.searchParams.get("user_id"), `eq.${identity.userId}`);
      assert.equal(url.searchParams.get("id"), `eq.${identity.projectId}`);
      return Response.json({ id: identity.projectId });
    }
    if (url.pathname.startsWith("/storage/v1/object/references/")) {
      assert.ok(
        url.pathname.includes(`${identity.userId}/${identity.projectId}/`),
      );
      assert.deepEqual(Buffer.from(init!.body as Uint8Array), bytes);
      return Response.json({ Key: "saved" });
    }
    const row = JSON.parse(String(init?.body));
    if (url.pathname === "/rest/v1/assets") {
      ids.push(row.id);
      assert.equal(row.project_id, identity.projectId);
      assert.match(row.name, /^Effect texture/);
      assert.equal(row.size_bytes, bytes.length);
      return new Response(null, { status: 201 });
    }
    assert.equal(url.pathname, "/rest/v1/studio_reference_provenance");
    assert.equal(row.operation_id, operation.id);
    assert.deepEqual(row.timestamps, []);
    return new Response(null, { status: 201 });
  };
  const first = await registerEffectTexture(
    identity,
    operation,
    texture,
    "Smoke",
  );
  const again = await registerEffectTexture(
    identity,
    operation,
    texture,
    "Smoke",
  );
  assert.deepEqual(first, again);
  assert.equal(first.textureId, texture.id);
  assert.equal(ids[0], ids[1]);
  await assert.rejects(
    registerEffectTexture(
      identity,
      operation,
      { ...texture, sha256: "0".repeat(64) },
      "Smoke",
    ),
    /hash mismatch/,
  );
});

import { buildCandidate } from "../../agent/lib/generation";
import { createDocument } from "../../src/lib/vfx-lab/ui-bridge";
test("a terminal candidate failure is not retried by the workflow", async () => {
  let failures = 0;
  globalThis.fetch = async (_url, init) => {
    const args = JSON.parse(String(init?.body));
    assert.equal(args.p_action, "fail");
    failures++;
    return Response.json({ status: "failed", result: args.p_args.result });
  };
  const input = {
    prompt: "",
    mode: "replace",
    expectedRevision: 0,
    referenceIds: [],
    textureIds: [],
    requirements: [],
    avoid: [],
  } as const;
  const ctx = {} as Parameters<typeof buildCandidate>[0];
  const invalid = input as unknown as Parameters<typeof buildCandidate>[3];
  await assert.rejects(
    buildCandidate(ctx, identity, operation, invalid, {
      input: invalid,
      base: createDocument(),
      brief: "",
      images: [],
      criteria: [],
    }),
    (error: unknown) => {
      assert.equal((error as { fatal: boolean }).fatal, true);
      return true;
    },
  );
  assert.equal(failures, 1);
});

test("reserve on a failed operation preserves the original reason", async () => {
  globalThis.fetch = async () =>
    Response.json({
      status: "failed",
      result: {
        message: "candidate: input exceeds the generation budget guard.",
      },
    });
  await assert.rejects(
    modelStage(
      identity,
      operation,
      "candidate",
      schema,
      "system",
      "text",
      [],
      signal,
      100,
    ),
    /candidate: input exceeds/,
  );
});

test("library board cards reuse their identity across generation operations", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/projects")
      return Response.json({ id: identity.projectId });
    if (url.pathname.startsWith("/storage/"))
      return Response.json({ Key: "saved" });
    return new Response(null, { status: 201 });
  };
  const library = { ...texture, model: "reusable-v2-library" };
  const first = await registerEffectTexture(
    identity,
    operation,
    library,
    "Library mask",
  );
  const next = await registerEffectTexture(
    identity,
    { ...operation, id: "40000000-0000-4000-8000-000000000001" },
    library,
    "Library mask",
  );
  assert.equal(first.referenceId, next.referenceId);
});

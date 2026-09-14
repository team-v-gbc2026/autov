import test from "node:test";
import assert from "node:assert/strict";
import { GenerationSchema } from "../src/lib/studio-tools/operations";
import {
  generationBrief,
  composeGeneration,
  generationAccepted,
  selectReviewedCandidate,
} from "../src/lib/studio-tools/generation-context";
import { createDocument } from "../src/lib/vfx-lab/ui-bridge";
import {
  REVIEW_V2_DEFECTS,
  ReviewV2Schema,
} from "../src/lib/vfx-lab/protocol-v2";

const review = (score = 4.5) =>
  ReviewV2Schema.parse({
    sufficientEvidence: true,
    semantic: score,
    motion: score,
    hierarchy: score,
    detail: score,
    smoothness: score,
    beauty: score,
    defects: Object.fromEntries(REVIEW_V2_DEFECTS.map((d) => [d, false])),
    observations: [
      {
        criterion: "requested blue aura",
        result: "pass",
        evidence: "Visible in the sheet",
      },
    ],
    verdict: "Reviewed",
    directorNotes: [],
  });

test("legacy generation inputs normalize into a bounded structured brief", () => {
  const input = GenerationSchema.parse({
    prompt: "Aura",
    mode: "replace",
    expectedRevision: 2,
    referenceIds: [],
  });
  assert.deepEqual(input.requirements, []);
  assert.deepEqual(input.textureIds, []);
  assert.equal(
    GenerationSchema.safeParse({ ...input, requirements: Array(6).fill("x") })
      .success,
    false,
  );
});

test("replace brief includes preserved scene and explicit constraints", () => {
  const base = createDocument();
  const input = GenerationSchema.parse({
    prompt: "Blue aura",
    requirements: ["sustained"],
    avoid: ["sparks"],
    textureIds: ["flipbook-smoke-8x8"],
    mode: "replace",
    expectedRevision: 1,
    referenceIds: [],
  });
  const brief = JSON.parse(generationBrief(input, base));
  assert.deepEqual(brief.preservedEnvironment, base.environment);
  assert.deepEqual(brief.requirements, ["sustained"]);
  assert.deepEqual(brief.avoid, ["sparks"]);
  assert.deepEqual(brief.textureIds, input.textureIds);
  assert.equal(brief.existingDocument, undefined);
  const candidate = createDocument();
  candidate.environment.background = "#ffffff";
  const result = composeGeneration(base, candidate, "replace");
  assert.deepEqual(result.environment, base.environment);
  assert.notEqual(result.environment, base.environment);
});

test("add and repair composition preserve original layers and all global settings", () => {
  const base = createDocument();
  const before = structuredClone(base);
  const input = GenerationSchema.parse({
    prompt: "Add wisps",
    mode: "add",
    expectedRevision: 1,
    referenceIds: [],
  });
  assert.deepEqual(
    JSON.parse(generationBrief(input, base)).existingDocument,
    base,
  );
  const generated = createDocument();
  generated.environment.background = "#ffffff";
  generated.post.exposure = 2;
  const combined = composeGeneration(base, generated, "add");
  assert.deepEqual(combined.layers.slice(0, base.layers.length), base.layers);
  assert.equal(combined.layers.length, 2);
  assert.notEqual(combined.layers[0].id, combined.layers[1].id);
  assert.deepEqual({ ...combined, layers: [] }, { ...base, layers: [] });
  assert.deepEqual(base, before);
});

test("quality gate rejects failed requirements even with high visual scores", () => {
  const good = review();
  assert.equal(generationAccepted(good), true);
  good.observations[0].result = "fail";
  assert.equal(generationAccepted(good), false);
  good.observations[0].result = "uncertain";
  assert.equal(generationAccepted(good), false);
});

test("selection retains the best evidence-backed candidate without new defects", () => {
  const first = { id: "first", review: review(3.5) };
  const better = { id: "better", review: review(4.5) };
  assert.equal(selectReviewedCandidate(null, first), first);
  assert.equal(selectReviewedCandidate(first, better), better);
  const regressed = { id: "regressed", review: review(5) };
  regressed.review.defects.washout = true;
  assert.equal(selectReviewedCandidate(better, regressed), better);
  const unreadable = { id: "unreadable", review: review(5) };
  unreadable.review.sufficientEvidence = false;
  assert.equal(selectReviewedCandidate(null, unreadable), null);
  assert.equal(selectReviewedCandidate(better, unreadable), better);
});

import {
  generateCandidate,
  reviewGeneration,
  modelStage,
} from "../src/lib/studio-tools/generation";
import type { GenerationContext } from "../src/lib/studio-tools/generation-context";
import type { Operation } from "../src/lib/studio-tools/server";
import { inspectReferences } from "../src/lib/studio-tools/references";
const identity = { userId: "user", projectId: "project" };
const operation = { id: "op" } as Operation;
const signal = new AbortController().signal;

function context(): GenerationContext {
  const base = createDocument();
  const input = GenerationSchema.parse({
    prompt: "Aura",
    mode: "replace",
    expectedRevision: 1,
    referenceIds: [],
    requirements: ["Blue"],
  });
  return {
    input,
    base,
    brief: generationBrief(input, base),
    images: ["data:image/png;base64,reference", "data:image/png;base64,atlas"],
    criteria: ["Blue"],
  };
}

test("both generation calls receive the same server-resolved brief and image evidence", async () => {
  const ctx = context();
  const candidate = createDocument();
  candidate.environment.background = "#ffffff";
  const { textures: _textures, ...doc } = candidate;
  const wire = {
    ...doc,
    layers: doc.layers.map((l) => ({
      ...l,
      geometry: l.geometry ?? null,
      emitter: l.emitter ?? null,
      material: l.material ?? null,
      light: l.light ?? null,
    })),
  };
  const calls: Parameters<typeof modelStage>[] = [];
  const art = {
    silhouette: "Tall plume",
    layering: [{ role: "body", appearance: "Soft curls" }],
    palette: "Grey",
    timing: "Four seconds",
    motionDirection: "Upward",
    uncertainties: [],
    textureNeeds: [
      {
        role: "body",
        appearance: "Soft smoke",
        channel: "alpha",
        animation: "flipbook",
        candidateTextureId: "flipbook-smoke-8x8",
        generationPrompt: null,
      },
    ],
  };
  const textures = {
    bindings: [
      {
        role: "body",
        textureId: "flipbook-smoke-8x8",
        treatment: "Alpha blend and animate the atlas",
        rationale: "Soft curls match",
        unmetNeed: null,
      },
    ],
  };
  const stage = (async (...args: Parameters<typeof modelStage>) => {
    calls.push(args);
    if (args[2] === "art-direction") return art;
    if (args[2] === "texture-direction") return textures;
    return args[2] === "plan" ? { recipe: "magic", textures: [] } : wire;
  }) as typeof modelStage;
  const originalBrief = ctx.brief;
  const originalImages = [...ctx.images];
  const output = await generateCandidate(
    identity,
    operation,
    ctx.input,
    signal,
    ctx,
    stage,
    (async (input) => {
      assert.deepEqual(input, { textureIds: ["flipbook-smoke-8x8"] });
      return [{ texture: { id: "flipbook-smoke-8x8" }, image: "smoke-pixels" }];
    }) as typeof import("../src/lib/vfx-lab/inspect-library-textures").inspectLibraryTextures,
  );
  assert.deepEqual(
    calls.map((c) => c[2]),
    ["art-direction", "texture-direction", "plan", "candidate"],
  );
  assert.equal(JSON.parse(calls[0][5]).brief, originalBrief);
  assert.deepEqual(calls[0][6], originalImages);
  for (const call of calls.slice(1))
    assert.deepEqual(call[6], [
      ...originalImages,
      "data:image/png;base64,smoke-pixels",
    ]);
  assert.deepEqual(JSON.parse(calls[2][5]).authoring, { art, textures });
  assert.deepEqual(JSON.parse(calls[3][5]).authoring, { art, textures });
  assert.deepEqual(ctx.authoring, { art, textures });
  assert.deepEqual(output.environment, ctx.base.environment);
});

test("review receives actual candidate pixels last, with timestamps and original criteria", async () => {
  const ctx = context();
  const capture = {
    status: "completed",
    result: {
      renderedPixels: 123,
      referenceId: "capture-ref",
      times: [0, 0.5, 1],
    },
    input: { document: ctx.base },
  } as unknown as Operation;
  let requested: string[] = [];
  const deps = {
    inspectReferences: (async (_identity, ids) => {
      requested = ids;
      return [
        {
          type: "file",
          mediaType: "image/png",
          data: "data:image/png;base64,output",
        },
      ];
    }) as typeof inspectReferences,
    modelStage: (async (...args: Parameters<typeof modelStage>) => {
      assert.equal(args[2], "review-1");
      assert.deepEqual(args[6], [
        ...ctx.images,
        "data:image/png;base64,output",
      ]);
      assert.match(args[4], /No consecutive motion strip/);
      assert.deepEqual(JSON.parse(args[5]).times, [0, 0.5, 1]);
      const answer = review();
      answer.observations[0].criterion = "Blue";
      assert.equal(
        args[3].safeParse({ ...answer, observations: [] }).success,
        false,
      );
      assert.equal(args[3].safeParse(answer).success, true);
      return answer;
    }) as typeof modelStage,
  };
  await reviewGeneration(identity, operation, ctx, capture, 1, signal, deps);
  assert.deepEqual(requested, ["capture-ref"]);
  await assert.rejects(
    reviewGeneration(
      identity,
      operation,
      ctx,
      { ...capture, result: { referenceId: "capture-ref" } },
      1,
      signal,
      deps,
    ),
    /capture unavailable/,
  );
});

import { repairGeneration } from "../src/lib/studio-tools/generation";
import type { TextureAsset } from "../src/lib/vfx-lab/schema";

test("generated effect masks are registered before texture review and survive document repair", async () => {
  const ctx = context();
  const asset: TextureAsset = {
    id: "fx-test-0",
    data: "data:image/png;base64,cG5n",
    prompt: "Soft spiral mask",
    model: "test",
    sha256: "a".repeat(64),
  };
  const reference = {
    referenceId: "board-mask",
    textureId: asset.id,
    role: "body",
    sha256: asset.sha256,
    tag: "@[Mask](reference:board-mask)",
  };
  const art = {
    silhouette: "Spiral",
    layering: [{ role: "body", appearance: "Soft spiral" }],
    palette: "Blue",
    timing: "Sustained",
    motionDirection: "Up",
    uncertainties: [],
    textureNeeds: [
      {
        role: "body",
        appearance: "Soft spiral",
        channel: "alpha",
        animation: "static",
        candidateTextureId: null,
        generationPrompt: "A soft spiral alpha mask",
      },
    ],
  };
  const bindings = {
    bindings: [
      {
        role: "body",
        textureId: asset.id,
        treatment: "Tint blue, no atlas",
        rationale: "Matches spiral",
        unmetNeed: null,
      },
    ],
  };
  const candidate = createDocument();
  candidate.layers[0].material!.mask.textureId = asset.id;
  const { textures: _textures, ...doc } = candidate;
  const wire = {
    ...doc,
    layers: doc.layers.map((l) => ({
      ...l,
      geometry: l.geometry ?? null,
      emitter: l.emitter ?? null,
      material: l.material ?? null,
      light: l.light ?? null,
    })),
  };
  const order: string[] = [];
  const stage = (async (...args: Parameters<typeof modelStage>) => {
    order.push(args[2]);
    if (args[2] === "art-direction") return art;
    if (args[2] === "texture-direction") {
      assert.deepEqual(JSON.parse(args[5]).generated, [reference]);
      assert.equal(args[6].at(-1), asset.data);
      return bindings;
    }
    if (args[2] === "plan") return { recipe: "magic", textures: [] };
    if (args[2].startsWith("repair")) {
      const prompt = JSON.parse(args[5]);
      assert.equal(prompt.document.textures[0].id, asset.id);
      assert.equal(prompt.document.textures[0].data, undefined);
      assert.ok(prompt.brief.includes(reference.referenceId));
      assert.deepEqual(prompt.authoring, { art, textures: bindings });
    }
    return wire;
  }) as typeof modelStage;
  const output = await generateCandidate(
    identity,
    operation,
    ctx.input,
    signal,
    ctx,
    stage,
    async () => {
      throw Error("No library fetch expected");
    },
    {
      generateEffectTexture: async () => {
        order.push("generate-mask");
        return asset;
      },
      registerEffectTexture: async (_identity, _operation, saved) => {
        assert.equal(saved, asset);
        order.push("register-mask");
        return reference;
      },
    },
  );
  assert.deepEqual(order, [
    "art-direction",
    "generate-mask",
    "register-mask",
    "texture-direction",
    "plan",
    "candidate",
  ]);
  assert.deepEqual(output.textures, [asset]);
  assert.deepEqual(ctx.textureReferences, [reference]);
  const capture = {
    input: { document: output },
    result: { referenceId: "preview" },
  } as unknown as Operation;
  const repaired = await repairGeneration(
    identity,
    operation,
    ctx,
    capture,
    review(),
    1,
    signal,
    {
      modelStage: stage,
      inspectReferences: (async () => [
        {
          type: "file",
          mediaType: "image/png",
          data: "data:image/png;base64,capture",
        },
      ]) as typeof inspectReferences,
    },
  );
  assert.deepEqual(repaired.textures, [asset]);
  const composed = composeGeneration(createDocument(), output, "add");
  assert.deepEqual(composed.textures, [asset]);
});

test("preselected texture pixels are not fetched or appended again", async () => {
  const ctx = context();
  ctx.input.textureIds = ["mask-soft-01"];
  ctx.images = ["data:image/png;base64,existing-atlas"];
  const art = {
    silhouette: "Glow",
    layering: [{ role: "body", appearance: "Soft" }],
    palette: "Blue",
    timing: "Sustained",
    motionDirection: "Up",
    uncertainties: [],
    textureNeeds: [
      {
        role: "body",
        appearance: "Soft glow",
        channel: "alpha",
        animation: "static",
        candidateTextureId: "mask-soft-01",
        generationPrompt: null,
      },
    ],
  };
  const stage = (async (...args: Parameters<typeof modelStage>) => {
    assert.deepEqual(args[6], ["data:image/png;base64,existing-atlas"]);
    if (args[2] === "art-direction") return art;
    if (args[2] === "texture-direction") {
      assert.equal(JSON.parse(args[5]).inspected[0].id, "mask-soft-01");
      return {
        bindings: [
          {
            role: "body",
            textureId: "mask-soft-01",
            treatment: "Tint blue",
            rationale: "Soft",
            unmetNeed: null,
          },
        ],
      };
    }
    if (args[2] === "plan") return { recipe: "magic", textures: [] };
    throw Error("Reached candidate with one image");
  }) as typeof modelStage;
  await assert.rejects(
    generateCandidate(
      identity,
      operation,
      ctx.input,
      signal,
      ctx,
      stage,
      async () => {
        throw Error("Unexpected duplicate atlas fetch");
      },
    ),
    /Reached candidate with one image/,
  );
});

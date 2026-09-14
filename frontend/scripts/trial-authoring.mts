/** Local, billable studio-generation trials. No project mutation or database ledger. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  generateCandidate,
  reviewGeneration,
  repairGeneration,
  modelStage,
} from "../src/lib/studio-tools/generation";
import { callStructuredModel } from "../src/lib/vfx-lab/model-provider";
import {
  budgetStatus,
  reserve,
  settle,
  DATA_DIR,
} from "../src/lib/vfx-lab/budget";
import { GenerationSchema } from "../src/lib/studio-tools/operations";
import {
  generationBrief,
  generationAccepted,
  selectReviewedCandidate,
  type GenerationContext,
} from "../src/lib/studio-tools/generation-context";
import { createDocument } from "../src/lib/vfx-lab/ui-bridge";
import type { Operation } from "../src/lib/studio-tools/server";
import type { inspectReferences } from "../src/lib/studio-tools/references";
import type { ReviewV2 } from "../src/lib/vfx-lab/protocol-v2";
import { webgpuBrowserOptions } from "./browser-options.mjs";
if (process.env.AUTOV_LIVE_TRIALS !== "1")
  throw Error("Set AUTOV_LIVE_TRIALS=1 for billable trials.");
const output = path.join(DATA_DIR, "authoring-trials");
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export {captureV2} from "./src/lib/vfx-lab/capture-v2";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
});
const server = createServer((req, res) =>
  res.end(
    req.url === "/probe.js" ? bundle.outputFiles[0].text : "<body></body>",
  ),
);
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(webgpuBrowserOptions());
const page = await browser.newPage();
const gpuErrors: string[] = [];
page.on("pageerror", (e) => gpuErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") gpuErrors.push(m.text());
});
const results: unknown[] = [];
try {
  await page.goto(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  );
  await page.addScriptTag({ url: "/probe.js" });
  for (const [id, prompt] of [
    [
      "smoke",
      "A sustained grey smoke plume rising gently with curling wisps, illuminated by a warm light near its base. Four seconds. No explosion or sparks.",
    ],
    [
      "slash",
      "A thin cyan energy slash sweeping through a curved arc, with a short fading ribbon. No smoke, ground decal or explosion.",
    ],
    [
      "aura",
      "A quiet monochrome violet ambient aura: a slowly pulsing ring and sparse rising motes. Four seconds, no flash or impact.",
    ],
  ]) {
    const directory = path.join(output, id);
    await mkdir(directory, { recursive: true });
    const input = GenerationSchema.parse({
      prompt,
      mode: "replace",
      expectedRevision: 0,
      referenceIds: [],
    });
    const base = createDocument();
    const context: GenerationContext = {
      input,
      base,
      brief: generationBrief(input, base),
      images: [],
      criteria: [
        "Matches the requested effect and timing.",
        "Respects all exclusions in the request.",
      ],
    };
    const identity = { userId: "local", projectId: "local" };
    const operation = { id } as Operation;
    const stage = (async (...args: Parameters<typeof modelStage>) => {
      const file = path.join(directory, `${args[2]}.json`);
      try {
        const saved = JSON.parse(await readFile(file, "utf8"));
        if (saved.status !== "complete")
          throw Error(`Unknown prior outcome: ${args[2]}`);
        return saved.value;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      console.log(`${id}: ${args[2]}`);
      await writeFile(file, JSON.stringify({ status: "started" }));
      const began = Date.now();
      const response = await callStructuredModel(
        args[3],
        args[4],
        args[5],
        args[6],
        args[7],
        args[8],
        "medium",
        600000,
        { apiKey: process.env.OPENAI_API_KEY, reserve, settle },
      );
      await writeFile(
        file,
        JSON.stringify(
          {
            status: "complete",
            value: response.value,
            usage: response.usage,
            seconds: (Date.now() - began) / 1000,
          },
          null,
          2,
        ),
      );
      return response.value;
    }) as typeof modelStage;
    let sheet = "";
    const deps = {
      modelStage: stage,
      inspectReferences: (async () => [
        { type: "file", mediaType: "image/jpeg", data: sheet },
      ]) as typeof inspectReferences,
    };
    try {
      let document = await generateCandidate(
        identity,
        operation,
        input,
        AbortSignal.timeout(900000),
        context,
        stage,
        undefined,
        {
          generateEffectTexture: async () => { throw new Error("This isolated trial has no project board. Run generated-texture trials through a project-bound workflow."); },
          registerEffectTexture: async () => { throw new Error("Local trials cannot register project assets."); },
        },
      );
      let best: { capture: Operation; review: ReviewV2; round: number } | null =
        null;
      for (let round = 0; round <= 2; round++) {
        console.log(`${id}: capture-${round}`);
        const evidence = await page.evaluate(async (doc) => {
          // @ts-expect-error browser bundle global
          return Probe.captureV2(doc);
        }, document);
        if (gpuErrors.length) throw Error(gpuErrors.join("\n"));
        sheet = evidence.sheet;
        await writeFile(
          path.join(directory, `capture-${round}.jpg`),
          Buffer.from(sheet.split(",")[1], "base64"),
        );
        await writeFile(
          path.join(directory, `document-${round}.json`),
          JSON.stringify(document, null, 2),
        );
        const capture = {
          status: "completed",
          input: { document },
          result: {
            referenceId: `local-${round}`,
            times: evidence.times,
            renderedPixels: evidence.renderedPixels,
          },
        } as unknown as Operation;
        const review = await reviewGeneration(
          identity,
          operation,
          context,
          capture,
          round,
          AbortSignal.timeout(600000),
          deps,
        );
        best = selectReviewedCandidate(best, { capture, review, round });
        if ((best && generationAccepted(best.review)) || round === 2) break;
        if (!best) throw Error("Unreadable capture");
        sheet = `data:image/jpeg;base64,${(await readFile(path.join(directory, `capture-${best.round}.jpg`))).toString("base64")}`;
        document = await repairGeneration(
          identity,
          operation,
          context,
          best.capture,
          best.review,
          round + 1,
          AbortSignal.timeout(900000),
          deps,
        );
      }
      results.push({
        id,
        selectedRound: best?.round,
        quality:
          best && generationAccepted(best.review)
            ? "accepted"
            : "needs-refinement",
        review: best?.review,
      });
    } catch (error) {
      results.push({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(
        `${id}: stopped`,
        error instanceof Error ? error.message : String(error),
      );
      break;
    }
    await writeFile(
      path.join(output, "results.json"),
      JSON.stringify({ results, budget: await budgetStatus() }, null, 2),
    );
  }
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ results, budget: await budgetStatus() }, null, 2),
  );
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
}

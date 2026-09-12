import { z } from "zod";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DocumentSchema, validateDocument } from "./schema";
import { ReviewSchema } from "./protocol";
export const TRIALS_DIR = path.join(process.cwd(), ".autov-local", "trials");
export const TrialInputSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    prompt: z.string().max(10000),
    caseId: z.string().max(100).optional(),
    source: z.enum(["openai-live", "authored-demo"]),
    origin: z.enum(["generated", "refined"]),
    selected: z.boolean(),
    document: DocumentSchema,
    references: z
      .array(
        z
          .string()
          .max(2_000_000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
      )
      .max(8),
    sheet: z
      .string()
      .max(3_000_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
    review: ReviewSchema.optional(),
    usageUsd: z.number().min(0).max(60).optional(),
  })
  .strict();
export type TrialSummary = {
  id: string;
  name: string;
  created: string;
  caseId?: string;
  source: string;
  origin: string;
  selected: boolean;
  duration: number;
  layers: number;
  references: number;
  prompt: string;
  review?: z.infer<typeof ReviewSchema>;
  usageUsd?: number;
  video: boolean;
  player: boolean;
};
export function trialDirectory(id: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error("Invalid trial ID");
  return path.join(TRIALS_DIR, id);
}
export async function saveTrial(input: unknown) {
  const value = TrialInputSchema.parse(input);
  validateDocument(value.document);
  const dir = trialDirectory(value.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const existing = await readFile(path.join(dir, "summary.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (existing) {
    const previous = await readFile(path.join(dir, "document.json"), "utf8");
    if (
      JSON.stringify(JSON.parse(previous)) !== JSON.stringify(value.document) ||
      existing.prompt !== value.prompt
    )
      throw Error(
        "A saved trial is immutable. Save edited effects with a new ID.",
      );
  }
  const summary: TrialSummary = {
    id: value.id,
    name: value.document.name,
    created: existing?.created || new Date().toISOString(),
    caseId: value.caseId,
    source: value.source,
    origin: value.origin,
    selected: value.selected,
    duration: value.document.duration,
    layers: value.document.layers.length,
    references: value.references.length,
    prompt: value.prompt,
    review: value.review,
    usageUsd: value.usageUsd,
    video: existing?.video || false,
    player: existing?.player || false,
  };
  const binary = (data: string) =>
    Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
  await writeFile(
    path.join(dir, "document.json"),
    JSON.stringify(value.document),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(dir, "input.json"),
    JSON.stringify({ prompt: value.prompt, references: value.references }),
    { mode: 0o600 },
  );
  await writeFile(path.join(dir, "sheet.jpg"), binary(value.sheet), {
    mode: 0o600,
  });
  for (let i = 0; i < value.references.length; i++)
    await writeFile(
      path.join(dir, `reference-${i}`),
      binary(value.references[i]),
      { mode: 0o600 },
    );
  await writeSummary(dir, summary);
  return summary;
}
export async function writeSummary(dir: string, summary: TrialSummary) {
  const tmp = path.join(dir, `summary.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(summary, null, 2), { mode: 0o600 });
  await rename(tmp, path.join(dir, "summary.json"));
}
export async function listTrials() {
  await mkdir(TRIALS_DIR, { recursive: true, mode: 0o700 });
  const entries = await readdir(TRIALS_DIR, { withFileTypes: true });
  const results = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && /^[a-zA-Z0-9-]{1,100}$/.test(e.name))
      .map(async (e) => {
        try {
          return JSON.parse(
            await readFile(
              path.join(TRIALS_DIR, e.name, "summary.json"),
              "utf8",
            ),
          ) as TrialSummary;
        } catch {
          return null;
        }
      }),
  );
  return results
    .filter((r): r is TrialSummary => r !== null)
    .sort((a, b) => b.created.localeCompare(a.created));
}

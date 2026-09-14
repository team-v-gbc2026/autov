import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Usage } from "./protocol";
export const modelCost = (input: number, output: number) =>
  (input * 12.5 + output * 50) / 1_000_000;
export type ModelRuntime = {
  apiKey: string | undefined;
  reserve(input: number, output: number): Promise<string>;
  settle(id: string, input: number, output: number): Promise<unknown>;
};
export function structuredInput(schema: z.ZodType, system: string, text: string, images: string[]) {
  const format = zodTextFormat(schema, "vfx_result");
  const inputBound =
    Buffer.byteLength(system + text + JSON.stringify(format), "utf8") +
    4000 +
    images.length * 20000;
  if (inputBound > 200000)
    throw new Error("Input is too large for the generation budget guard.");
  return { format, inputBound };
}
export async function callStructuredModel<T extends z.ZodType>(
  schema: T,
  system: string,
  text: string,
  images: string[],
  signal: AbortSignal,
  maxOutput = 6000,
  effort: "low" | "medium" | "high" = "medium",
  // A large structured document at high effort can outlast the default client
  // timeout; callers that ask for one raise this deliberately.
  timeoutMs = 240000,
  runtime: ModelRuntime,
): Promise<{ value: z.infer<T>; usage: Usage; elapsedSeconds: number }> {
  const apiKey = runtime.apiKey;
  if (!apiKey)
    throw new Error(
      "OpenAI API key is not configured.",
    );
  const model = process.env.OPENAI_VFX_MODEL || "gpt-6-astra";
  if (model !== "gpt-6-astra")
    throw new Error(
      "The generation budget uses verified gpt-6-astra rates. Revalidate pricing before changing models.",
    );
  const { format, inputBound } = structuredInput(schema, system, text, images);
  const reservation = await runtime.reserve(inputBound, maxOutput);
  // On timeout, disconnection or failed parsing, retain the reservation: a remote call may still be billable.
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0 });
  const startedAt = Date.now();
  // Stream so response headers arrive at once. Long v2 document calls otherwise
  // exceed Node's undici headersTimeout (300 s) before the SDK timeout, because a
  // non-streamed Responses call sends no headers until the whole answer is ready.
  const stream = client.responses.stream(
    {
      model,
      store: false,
      service_tier: "default",
      max_output_tokens: maxOutput,
      reasoning: { effort },
      text: { format },
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "input_text", text },
            ...images.map((image_url) => ({
              type: "input_image" as const,
              image_url,
              detail: "high" as const,
            })),
          ],
        },
      ],
    },
    { signal },
  );
  const response = await stream.finalResponse();
  const usage: Usage = {
    input: response.usage?.input_tokens || 0,
    output: response.usage?.output_tokens || 0,
    usd: modelCost(
      response.usage?.input_tokens || 0,
      response.usage?.output_tokens || 0,
    ),
    model,
    responseId: response.id,
  };
  if (response.usage)
    await runtime.settle(reservation, usage.input, usage.output);
  if (response.status !== "completed")
    throw new Error(
      `OpenAI response ${response.status}${response.incomplete_details?.reason ? ` (${response.incomplete_details.reason})` : ""}. Previous effect preserved.`,
    );
  if (!response.output_text)
    throw new Error(
      "OpenAI returned no effect data. Previous effect preserved.",
    );
  return {
    value: schema.parse(JSON.parse(response.output_text)),
    usage,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  };
}

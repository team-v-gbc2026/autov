import { gateway, wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { agentModel } from "./config";

export const boundedCalls: LanguageModelMiddleware = {
  specificationVersion: "v4",
  async transformParams({ params }) {
    const deadline = AbortSignal.timeout(90_000);
    return { ...params, maxOutputTokens: 4096, abortSignal: params.abortSignal ? AbortSignal.any([params.abortSignal, deadline]) : deadline };
  },
};
export function studioModel() { return wrapLanguageModel({ model: gateway(agentModel()), middleware: boundedCalls }); }

export const DEFAULT_MODEL = "openai/gpt-5.6-luna-fast";
export function agentModel() { return process.env.VFX_AGENT_MODEL?.trim() || DEFAULT_MODEL; }
export function configurationError(): string | undefined {
  if (!process.env.AI_GATEWAY_API_KEY) return "Set AI_GATEWAY_API_KEY on the server to enable the assistant.";
}

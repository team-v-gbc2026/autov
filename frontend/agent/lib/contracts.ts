export class ChatError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function projectIdFrom(request: Request) {
  const id = request.headers.get("x-autov-project-id");
  if (!id || !UUID.test(id)) throw new ChatError("INVALID_PROJECT", "Open a project to chat.");
  return id;
}
export async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ChatError("INVALID_BODY", "Use application/json.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("INVALID_BODY", "Provide a message.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) { await reader.cancel(); throw new ChatError("BODY_TOO_LARGE", "Studio context is too large.", 413); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChatError("INVALID_BODY", "Invalid JSON."); }
  if (!isRecord(body)) throw new ChatError("INVALID_BODY", "Provide a JSON object.");
  return body;
}
export function parseTurn(body: Record<string, unknown>) {
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 10000) throw new ChatError("INVALID_PROMPT", "Use a prompt between 1 and 10,000 characters.");
  const context = isRecord(body.clientContext) ? body.clientContext : {};
  const references = context.referenceIds ?? [];
  if (!Array.isArray(references) || references.length > 8 || references.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(references).size !== references.length) throw new ChatError("INVALID_REFERENCES", "Use at most eight unique project references.");
  // Only these fields can become model context. None are authorization inputs.
  return { prompt: body.message.trim(), referenceIds: references as string[], context: { document: context.document ?? null, selectedEmitterId: context.selectedEmitterId ?? null } };
}
export function responseError(error: unknown) {
  const known = error instanceof ChatError;
  return Response.json({ ok: false, code: known ? error.code : "CHAT_ERROR", error: known ? error.message : "The assistant could not complete the request. Reconnect before retrying." }, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

// Construct from the URL so framework Request wrappers work across runtimes.
// The replacement body has a different length from the incoming request.
export function jsonRequest(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Request(request.url, {
    method: request.method, headers, signal: request.signal, body: JSON.stringify(body),
  });
}

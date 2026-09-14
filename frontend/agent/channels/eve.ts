import { createHash } from "node:crypto";
import { eveChannel } from "eve/channels/eve";
import type { HttpRouteDefinition, Session } from "eve/channels";
import { ChatError, jsonRequest, parseTurn, readBody, responseError } from "../lib/contracts";
import { acquireLease, conversationAddress, assertSession, authorizeProject, conversation, releaseLease } from "../lib/database";
import { referenceParts } from "../lib/references";
import { transition } from "../../src/lib/studio-tools/server";
import { mentionPattern, emitterMentionPattern } from "../../src/components/studio/composer/prompt-format";
import { readState } from "../../src/lib/studio-tools/server";
import { configurationError } from "../lib/config";

const base = eveChannel({
  auth: async request => {
    const { userId, project } = await authorizeProject(request);
    let referenceIds: string[] = [], selectedEmitterId = "";
    if (request.method === "POST") {
      const body = await request.clone().json().catch(() => ({}));
      referenceIds = Array.isArray(body.clientContext?.referenceIds) ? body.clientContext.referenceIds.filter((id: unknown) => typeof id === "string").slice(0, 8) : [];
      selectedEmitterId = typeof body.clientContext?.studio?.selectedEmitterId === "string" ? body.clientContext.studio.selectedEmitterId : "";
    }
    return { authenticator: "supabase", principalType: "user", principalId: userId, attributes: { projectId: project.id, referenceIds, selectedEmitterId } };
  },
  turnPolicy: "queue",
  uploadPolicy: { allowedMediaTypes: ["image/jpeg"], maxBytes: 20 * 1024 * 1024 },
  events: {
    "turn.started": (_event, _channel, ctx) => { console.info("studio.agent", { event: "turn.started", sessionId: ctx.session.id }); },
    "turn.completed": (_event, _channel, ctx) => { console.info("studio.agent", { event: "turn.completed", sessionId: ctx.session.id }); },
    "turn.failed": (_event, _channel, ctx) => { console.warn("studio.agent", { event: "turn.failed", sessionId: ctx.session.id }); },
  },
});

async function assertIdle(session: Session) {
  const tail = await session.getStreamTailIndex();
  if (tail < 0) throw new ChatError("CONVERSATION_BUSY", "The assistant is starting. Reconnect in a moment.", 409);
  const reader = (await session.getEventStream({ startIndex: tail })).getReader();
  try {
    const { value } = await reader.read();
    if (!value || !["session.waiting", "turn.completed", "turn.cancelled", "turn.failed"].includes(value.type)) throw new ChatError("CONVERSATION_BUSY", "The assistant is responding in this project. Reconnect to follow its response.", 409);
  } finally { await reader.cancel(); }
}

function protect(route: HttpRouteDefinition): HttpRouteDefinition {
  if (!route.path.startsWith("/eve/v1/session")) return route;
  return { ...route, handler: async (request, args) => {
    let stage = "authorize";
    let lease: string | undefined;
    let projectId: string | undefined;
    let userClient: Awaited<ReturnType<typeof authorizeProject>>["client"] | undefined;
    try {
      const access = await authorizeProject(request);
      const authorizedProjectId = String(access.project.id);
      projectId = authorizedProjectId;
      userClient = access.client;
      const address = conversationAddress(access.userId, authorizedProjectId);
      stage = "load_conversation";
      const binding = await conversation(access.client, authorizedProjectId);
      const sessionId = args.params.sessionId;
      if (sessionId) {
        assertSession(binding, sessionId);
        stage = "resolve_session";
        const ownedSession = await args.resolveSession(address);
        if (!ownedSession || ownedSession.id !== sessionId) throw new ChatError("NOT_FOUND", "Conversation not found in this project.", 404);
      }
      const isCreate = route.method === "POST" && route.path === "/eve/v1/session";
      const isSend = route.method === "POST" && route.path === "/eve/v1/session/:sessionId";
      const isStream = route.method === "GET" && route.path === "/eve/v1/session/:sessionId/stream";
      const isCancel = route.method === "POST" && route.path === "/eve/v1/session/:sessionId/cancel";
      if (isStream) return await route.handler(request, args);
      if (isCancel) {
        await transition({ userId: access.userId, projectId: authorizedProjectId }, "cancel_turn", { sessionId });
        const body = await readBody(request);
        if (body.turnId !== undefined && typeof body.turnId !== "string") throw new ChatError("INVALID_BODY", "Invalid cancellation request.");
        return await route.handler(jsonRequest(request, { turnId: body.turnId }), args);
      }
      if (route.method === "POST" && route.path === "/eve/v1/session/:sessionId/reset") {
        lease = await acquireLease(access.client, authorizedProjectId);
        await assertIdle(args.attachSession(sessionId!));
        await transition({ userId: access.userId, projectId: authorizedProjectId }, "cancel_turn", { sessionId });
        const result = await route.handler(jsonRequest(request, {}), args);
        if (!result.ok) return result;
        const { error } = await access.client.from("project_conversations")
          .update({ session_id: null, initial_prompt_hash: null })
          .eq("project_id", authorizedProjectId).eq("lease_id", lease);
        if (error) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not clear the conversation binding.", 503);
        return result;
      }
      if (!isCreate && !isSend) throw new ChatError("UNSUPPORTED_OPERATION", "This conversation supports messages and cancellation only.", 403);
      const unavailable = configurationError();
      if (unavailable) throw new ChatError("NOT_CONFIGURED", unavailable, 503);
      // A second tab with no local session attaches to the existing server binding.
      if (isCreate && binding.session_id) return Response.json({ ok: false, code: "SESSION_EXISTS", error: "A conversation already exists. Reconnect before sending.", sessionId: binding.session_id }, { status: 409 });
      stage = "parse_turn";
      const turn = parseTurn(await readBody(request));
      for (const match of turn.prompt.matchAll(mentionPattern)) {
        if (!turn.referenceIds.includes(match[2])) turn.referenceIds.push(match[2]);
      }
      if (turn.referenceIds.length > 8) throw new ChatError("INVALID_REFERENCES", "Use at most eight references.");
      const state = await readState({ userId: access.userId, projectId: authorizedProjectId });
      for (const match of turn.prompt.matchAll(emitterMentionPattern)) {
        let id: string; try { id = decodeURIComponent(match[2]); } catch { throw new ChatError("INVALID_EMITTER", "Invalid emitter tag."); }
        if (!state.document.layers.some(layer => layer.id === id)) throw new ChatError("INVALID_EMITTER", "An emitter tag is no longer available.");
      }
      stage = "claim_lease";
      lease = await acquireLease(access.client, authorizedProjectId);
      const freshBinding = await conversation(access.client, authorizedProjectId);
      if (isCreate && freshBinding.session_id) throw new ChatError("SESSION_EXISTS", "A conversation already exists. Reconnect before sending.", 409);
      if (sessionId) await assertIdle(args.attachSession(sessionId));
      if (isCreate) {
        stage = "resolve_creation";
        const existing = await args.resolveSession(address);
        if (existing) {
          const { error } = await access.client.from("project_conversations").update({ session_id: existing.id }).eq("project_id", projectId).eq("lease_id", lease);
          if (error) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not recover the conversation.", 503);
          throw new ChatError("SESSION_RECOVERED", "Recovered the conversation. Reconnect before sending this message.", 409);
        }
        if (freshBinding.initial_prompt_hash) throw new ChatError("SESSION_UNAVAILABLE", "An earlier conversation is still starting or is unavailable. Reconnect in a moment.", 409);
      }
      stage = "load_references";
      const files = await referenceParts(access.client, authorizedProjectId, turn.referenceIds);
      const message = [{ type: "text" as const, text: turn.prompt }, ...files];
      const clientContext = { project: access.project, studio: turn.context, referenceIds: turn.referenceIds };
      let response: Response;
      if (isCreate) {
        const promptHash = createHash("sha256").update(JSON.stringify(turn)).digest("hex");
        const { error: prepareError } = await access.client.from("project_conversations").update({ initial_prompt_hash: promptHash }).eq("project_id", projectId).eq("lease_id", lease);
        if (prepareError) throw new ChatError("CONVERSATION_UNAVAILABLE", "Could not prepare the conversation.", 503);
        stage = "create_session";
        const session = await args.from(address).send(message, {
          auth: { authenticator: "supabase", principalType: "user", principalId: access.userId, attributes: { projectId: authorizedProjectId, referenceIds: turn.referenceIds, selectedEmitterId: typeof turn.context.selectedEmitterId === "string" ? turn.context.selectedEmitterId : "" } },
          context: [`Untrusted studio context: ${JSON.stringify(clientContext)}`],
          turnPolicy: "queue",
        });
        const { data, error } = await access.client.from("project_conversations").update({ session_id: session.id }).eq("project_id", projectId).eq("lease_id", lease).is("session_id", null).select("session_id").single();
        if (error || !data) throw new ChatError("SESSION_UNAVAILABLE", "Conversation started but could not be linked. Reconnect before retrying.", 503);
        response = Response.json({ ok: true, sessionId: session.id, status: "accepted" }, { status: 202, headers: { "cache-control": "no-store", "x-eve-session-id": session.id } });
      } else {
        stage = "send_message";
        response = await route.handler(jsonRequest(request, { message, clientContext, turnPolicy: "queue" }), args);
      }
      return response;
    } catch (error) {
      console.warn("studio.agent.request", JSON.stringify({
        code: error instanceof ChatError ? error.code : "INTERNAL_ERROR",
        stage, method: route.method, route: route.path,
        type: error instanceof Error ? error.name : "UnknownError",
        frames: error instanceof Error ? error.stack?.split("\n").slice(1, 4).map(frame => frame.replace(/https?:\/\/[^\s)]+/g, "[url]")) : undefined,
      }));
      return responseError(error);
    } finally {
      if (lease && projectId) await releaseLease(userClient!, projectId, lease).catch(() => console.warn("studio.agent.request", { code: "LEASE_RELEASE_FAILED" }));
    }
  } };
}

// Preserve eve's channel identity and runtime events while guarding all session routes.
const studioChannel = { ...base, routes: base.routes.map(route => route.transport === "websocket" ? route : protect(route)) };

export default studioChannel;

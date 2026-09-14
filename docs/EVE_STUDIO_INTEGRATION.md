# Studio agent integration

The existing studio chat uses eve 0.54.3 and AI Gateway. It supports text and reference-image discussions with one durable conversation per project. It does not edit emitters or invoke the renderer.

## Setup

Use Node 24 or later and run `npm ci` in `frontend`.

Set these in `frontend/.env.local` and, when deploying, in the Vercel project:

- Existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `AI_GATEWAY_API_KEY`, a Vercel AI Gateway key with billing configured.
- Optional `VFX_AGENT_MODEL`. The default is `openai/gpt-5.6-luna-fast`; its Gateway catalog entry lists image input and tool use. Model availability still depends on the account.

Apply `supabase/migrations/20260913154657_project_conversations.sql` through the normal database migration workflow before opening chat. This migration is applied to the connected Supabase project. Owner access, duplicate-lease rejection, cross-user isolation, and anonymous denial were verified there in a transaction with all test writes rolled back. Apply it separately when setting up another database; the app does not apply migrations.

Run `npm run dev` for local development. Run `npm run build` followed by `npm start` for local production. `withEve` integrates the runtime into the same Vercel project. The local production config explicitly evaluates eve's rewrites to start its service on port 4274 because Next 16 otherwise reads compiled rewrites without invoking the startup callback. The main app continues to use port 3000 unless overridden.

Reference images are resized to a maximum dimension of 1280 pixels and JPEG encoded; GIFs use their first frame. The original uploads remain unchanged. eve stages these attachments into its session storage/sandbox, so normal follow-ups use saved bytes rather than expiring Supabase signed URLs. Hosted image sessions use eve's Vercel Sandbox backend and require the corresponding Vercel runtime access. Local eve chooses an available sandbox backend, falling back to just-bash.

## Boundaries and data flow

The browser obtains fresh Supabase user tokens for each request. `GET /api/projects/:id/conversation` verifies ownership and creates or reads the project binding before the first send. `useEveAgent` communicates with same-origin `/eve/v1/session` routes using `x-autov-project-id` plus bearer authentication.

Every database read, write, storage request, and lease RPC uses the verified user's Supabase token and publishable key. No service-role client or Supabase secret key is used. RLS restricts operations to projects owned by that user. The eve channel also resolves an internal continuation address derived from the verified user ID and project ID before allowing messages, replay streams, or cancellation. The database session pointer is only a lookup cache: changing it cannot authorize access to another eve session. Other controls such as reset/clear and subagent streams are rejected. Framework-internal signed callback endpoints retain eve's built-in validation.

The first send acquires a user-scoped database lease, resolves the framework-owned user/project address, and creates a conversation through eve's channel operations only if none exists. The accepted session ID is cached in the user's project row. If a prior create was accepted but its database write failed, the next request recovers the address's existing session instead of resending the prompt. Conflicting tabs receive a reconnect response. An uncertain creation with no resolvable session fails closed rather than creating a duplicate. Continuations check the durable stream for an idle boundary. The UI guards duplicate sends immediately and never automatically resubmits a failed message.

The current document and emitter selection are ephemeral, untrusted turn context. Reference IDs are checked against active assets in the authorized project and loaded server-side. Clients cannot submit arbitrary file URLs or override the runtime's model, callbacks, auth principal, or tool capabilities.

The model has no optional default tools, connections, or subagents. Model calls are capped at 4096 output tokens and a 90-second deadline, while retaining user cancellation. One ordinary response ends each tool-free turn. eve's default session usage policies still apply; if its lifetime input budget is exhausted the session will stop accepting model work and requires operator attention. Automatic session rotation is intentionally not implemented.

Supabase stores only the session mapping and admission metadata. eve owns the transcript. Existing draft generation records remain visible as history, and new messages do not create generation records. Deleting a project removes its binding and revokes app access to its conversation; it does not explicitly purge eve's stored transcript or sandbox. Transcript retention follows the configured Workflow world and Vercel plan. Missing/expired runtime history is surfaced as an error rather than silently creating a replacement conversation.

App logs contain event names, session identifiers, and error categories. No app logging includes tokens, image bytes, signed URLs, or prompts. eve's own trace/content retention is governed separately by its runtime configuration.

## Verification

- `npm run test:agent`: request validation, model bounds/cancellation, route ownership, references, and configuration failures, using controlled SDK responses.
- `npx tsc --noEmit` and `npm run lint`.
- `npm run build`: builds both eve and Next.js.
- `supabase/tests/conversations.sql`: owner isolation, denied cross-user writes and lease claims, denied anonymous access, lease recovery, and project-deletion cleanup. Use a disposable migrated database; fixtures roll back.
- Local smoke: `/eve/v1/health` returns 200; an unauthenticated session request returns 401.

Live acceptance requires the configured credentials and migrated database: send text and an image, ask a follow-up about that image, refresh while streaming, reopen on another device, try two tabs, cancel a response, and verify reference upload and studio controls. These steps incur model/runtime usage. Do not treat mocked tests as evidence of live model quality or hosted durability.

The renderer/toolbox branch is not merged. Future tools should adapt a shared studio command layer; keep studio validation and mutations outside eve-specific files.

## Latest verification (2026-09-13)

The hosted migration is `20260913154657_project_conversations`. Its RLS and lease isolation checks passed through Supabase MCP; test writes were rolled back. Agent tests and TypeScript checks passed; lint has only the existing unused variable warning in the project deletion route. Eve builds successfully. The latest Next production build is blocked by the environment denying Turbopack worker port binding; a webpack fallback also fails while reading TypeScript configuration. Earlier production smoke checks do not substitute for a successful build of this final state. `AI_GATEWAY_API_KEY` is absent locally, so live chat, image follow-ups, streaming recovery, and cross-device acceptance remain unverified.

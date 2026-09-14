# Eve studio tools

Eve can inspect, edit, generate, preview and undo v2 effects in authenticated project
chats. References and emitters use clickable `@[name](reference:uuid)` and
`#[name](emitter:encoded-id)` tags. References focus the board; emitters select and
open their editor. Generation can reuse library assets or create effect masks,
save them to the reference board, and inspect them before building a candidate.
Reference image generation/editing is available through `generate_reference_image`.
Automatic image cleanup and custom parameter metadata are not included.

## Enable locally or on the deployed server

1. Apply `supabase/migrations/20260914090000_studio_tools.sql` after existing migrations.
2. Configure server-only `SUPABASE_SECRET_KEY`, `AI_GATEWAY_API_KEY` and
   `OPENAI_API_KEY`, along with the existing public Supabase URL/publishable key.
   Create the `sb_secret_...` key under Supabase Settings → API Keys → Secret keys;
   save it as `SUPABASE_SECRET_KEY` in `frontend/.env.local` and restart the dev server.
3. Studio tools are always enabled and require the storage configuration and migration above.
4. Keep `OPENAI_VFX_MODEL=gpt-6-astra`; the inherited conservative cost formula is
   tied to that model. `OPENAI_VFX_BUDGET_USD` defaults to 30, accepts positive values
   up to 60, and applies cumulatively per project to generation provider calls.
5. Build Eve (`npm run build:agent`) and the app. Keep a WebGPU-capable studio tab
   open for previews and generation validation. Server credentials never go to it.

The migration adds document state, durable operations, provider reservations and
reference provenance. Browser roles have ownership-filtered read access to state
and operations only. Server transitions perform a project-owner check and serialize
on that project before committing a revision. Existing local generation endpoints
and their local spending ledger remain independent.

## Usage

- “Read the current effect and explain which layers control the smoke.”
- “Slow #[Smoke](emitter:smoke-puffs), preserving the flame and spark layers.”
- “Generate a fire projectile using @[Reference](reference:VALID-BOARD-UUID).”
- “Add a smoke trail, keeping the current environment and camera.”
- “Preview the impact, then show me the smoke emitter settings.”
- “Undo that agent edit.”

`read_vfx` supplies the current revision and optional full layer settings plus the
shared renderer guide. `edit_vfx` accepts an atomic operations array; nested objects
merge and arrays replace. Invalid values/unknown fields fail before any write.
`generate_vfx` accepts `replace` or `add`; additive generation keeps globals and
existing layers, renames colliding IDs and scales layer timing to the duration.
Generation accepts a self-contained `prompt`, up to five `requirements`, eight
`avoid` items, four library `textureIds`, and the existing board `referenceIds`.
Legacy inputs default the new lists to empty. A durable context step resolves
reference pixels, selected library pixels, and the exact revision's host settings.
Art direction, texture refinement, planning and candidate calls receive this context. Replace mode
preserves the existing environment; add mode preserves all globals and old layers.

The studio workflow validates the first candidate with a contact sheet and immediately
commits it to the scene, with quality `unreviewed`. It does not review or repair
automatically. Chat displays “Continue iterating on this effect?” and a **Continue**
chip for the current generation revision.

Clicking Continue sends an explicit iteration approval with the source operation
ID. `refine_vfx` verifies the authenticated project, conversation and unchanged
revision, restores the original brief/art direction and existing textures, then
reviews the current effect and runs up to two repairs. The first pass stays visible
until the best reviewed candidate is committed. Unrelated edits invalidate the chip.
The offer is recovered from persisted operations after reload; no browser-only
approval state is needed. Review scoring uses the existing no-regression policy.

Stages `art-direction`, `effect-texture-0..1`, `texture-direction`, `plan`,
`candidate`, `review-0..2`, and `repair-1..2` use the existing
per-project provider reservation/settlement guard. Captures have distinct operation
IDs. Provider, capture, cancellation, or revision errors preserve the prior effect;
no ambiguous paid call is automatically retried. The lab runner retains its
specialized measurement pipeline; review scoring/selection policy is shared.
`preview_vfx` accepts up to eight requested times and an optional solo layer.
`set_vfx_view`, `set_reference_view` acknowledge browser actions. `undo_vfx_edit`
requires the exact revision produced by the selected agent edit. Reference listing
and inspection accept only current project board IDs.

All returned preview contact sheets are saved to the board with operation/revision
and timestamp provenance before pixels are sent to Eve. They are not automatically
added to later generation inputs. Original references remain unchanged.

## Failures and recovery

- Manual edits flush before sending a prompt. A conflicting save retains the local
  document; export it before reloading to adopt the server revision.
- Network-ambiguous manual saves retain their call ID and exact payload for replay.
- Replayed tools return their recorded results. A stale revision never overwrites
  newer work. Generation is committed only after a successful browser capture.
- Browser requests expire after 60 seconds, with a 30-second claim lease. An expired
  claim cannot acknowledge a result. Disconnected requests can be claimed by another
  tab while still within the deadline.
- Cancel stops pending operations for the conversation. In-flight provider requests
  are aborted where supported, and cancelled operations cannot commit.
- A provider stage with an unknown result retains its spending reservation and is
  not automatically retried. Completed stage results are reusable without another
  charge. No credentials or raw provider errors are returned in API error bodies.

## Validation

From `frontend`:

```sh
npm run typecheck
npm run test:agent
npm test
node scripts/verify-studio-tools.mjs
npm run build
```

The browser script uses real components with a stubbed server/provider and simulated
capture evidence; it does not assert image fidelity or perform paid generation.
Set `AUTOV_CHROME_PATH` when a system Chrome is needed. Database assertions live in
`supabase/tests/studio_tools.sql`; run them against a disposable migrated database.
The repository's renderer verification scripts separately exercise WebGPU capture.

For an explicitly authorized live provider test, set `STUDIO_LIVE_SMOKE=1`,
`STUDIO_SMOKE_USER_ID` and `STUDIO_SMOKE_PROJECT_ID`, then run
`node --import tsx scripts/studio-generation-smoke.ts`. It spends from the configured
project's ledger and validates a generated document without committing it.

## Extension points

Keep Eve adapters thin. Add new preparation/review stages to the generation service,
not to chat components. Share the provider transport with local generation, but
inject project-backed persistence and spending. New image-producing steps must use
the board asset registration boundary before returning image pixels or referencing
those images in later generation calls.

Prepared reference JPEGs use a process-local cache capped at 32 MiB with a five-minute
TTL and least-recently-used eviction. Every inspection still checks project ownership
and current asset availability. Keys include project, asset ID, storage path, MIME type,
and file size; names are read fresh. Board uploads use unique paths. An external overwrite
at the same path with unchanged metadata can remain cached until expiry. Restarts clear
the cache, and instances do not share it. Documents and generation results are not cached.

## Reference image editing

Open an image on the project board, open its Generate prompt, describe an edit, and
submit. The server uses `OPENAI_API_KEY` with `gpt-image-1.5` (one medium-quality
1024×1024 image) and adds a new board asset; the source stays unchanged. Image edits
use a separate provider call and are not included in the VFX generation spending
ledger. Provider retries are disabled. Image-model access is required. This action
is available in authenticated project boards; standalone local boards are not connected. The board’s Generate Images dialog also
supports creating an image from a text prompt using the same model and settings.

Chat examples: “Generate a reference image of blue magical sparks” or
“Make @[Smoke](reference:UUID) purple and save a new version.” Eve uses
`generate_reference_image` with a prompt and an optional board reference ID.

# Eric’s handoff

## What’s ready

- Email/password signup, login, sign-out, and protected workspace routes.
- Project creation and renaming, with a project library.
- Private image-reference uploads (PNG, JPEG, WebP, GIF; up to 20 MB each, eight per prompt).
- Saved prompts and reference links that survive refresh. Removing an image from the workspace preserves earlier prompt history.
- Supabase tables: `projects`, `assets`, `generations`, `generation_inputs`, and `effect_versions`, with per-user access rules. Migrations are applied to the hosted project.
- Authenticated JSON downloads from `/api/effects/<version-id>`.

The studio now sends new chat messages to Eve and displays a **sample particle scene**. Existing saved drafts remain historical entries. It does not call a generation model or render saved effect JSON yet.

## What’s left for Eric

1. **Connect generation.** Add an explicit generation tool; the old prompt-saving action and RPC have been retired. Have that tool create a generation and its inputs transactionally, then invoke your backend with its generation ID. Read the prompt and ordered `generation_inputs`; resolve the private reference images through `assets` and signed URLs.
2. **Define and validate the effect JSON.** The database accepts a JSON object without prescribing its internal VFX format. Your generator and renderer should agree on the schema and version.
3. **Save results and status.** From trusted backend code, update the generation’s status and insert an `effect_versions` row containing `project_id`, `generation_id`, `schema_version`, and `definition`. Keep privileged Supabase keys server-side and verify project ownership.
4. **Connect the preview.** Load the selected effect definition into your Three.js runtime through `frontend/src/components/particle-scene.tsx`. Wire result selection and progress updates into `frontend/src/components/studio.tsx`; results currently appear after a refresh.
5. **Test the complete flow.** Image + prompt → generation → interactive VFX → saved JSON → reopen/download. Define storage for any generated textures or models your effects require.

## Before the demo

## Reference image regeneration handoff

- Text notes can be added from the board header, edited inline, dragged by their header, and deleted. They persist per project in browser storage (`autov.board-notes.<projectId>`), are included in Fit board, and are not currently sent as generation context or synced to Supabase.

- The board header's Generate images action opens `ReferencePreview` with `reference={null}`: a blank preview and an expanded text-to-image prompt. Wire this mode to create a new reference asset and add it to the board; no asset is created merely by opening the modal. Existing-reference mode remains image-to-image editing. Both submit actions are intentionally unwired.

- The expanded image modal now has a bottom-left Generate button that opens an edit-prompt textarea. The draft is local UI state; the submit arrow is intentionally inactive. Wire `editPrompt` and the selected reference asset ID in `frontend/src/components/studio/board/reference-preview.tsx` to the image-edit backend, including pending, failure, and result handling. Closing the prompt preserves the draft while the modal remains mounted.

- Board images have a top-right sparkle button for image editing/regeneration. It is intentionally inactive and labeled "coming soon"; no model request is made.
- Wire this action in `frontend/src/components/studio/board/board-card.tsx` through the mood board. Open an image-edit prompt using the selected reference's stable asset ID, then connect the image-generation backend with loading, error, and retry states.
- Decide whether regeneration replaces the reference or creates a new version before writing results; preserve references used by saved prompts. Authenticate ownership and keep private image access server-authorized.
- The adjacent pencil edits the reference tag inline, saving on blur or Enter; Escape cancels. Tag aliases and board layout currently persist in browser storage, not the database.

## Demo checklist

- Deploy the app with its Supabase environment variables and verify email confirmation and callback URLs on the deployed domain.
- Test the renderer in a browser with WebGPU support; the headless test environment had no adapter.
- Billing, teams, video references, and Niagara/other engine exporters remain outside the hackathon scope.

Build, lint, TypeScript, database isolation tests, and browser login/persistence/download checks passed. See [APP_DATABASE.md](APP_DATABASE.md) for setup and the detailed database contract.

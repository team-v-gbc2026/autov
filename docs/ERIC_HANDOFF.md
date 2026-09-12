# Eric’s handoff

## What’s ready

- Email/password signup, login, sign-out, and protected workspace routes.
- Project creation and renaming, with a project library.
- Private image-reference uploads (PNG, JPEG, WebP, GIF; up to 20 MB each, eight per prompt).
- Saved prompts and reference links that survive refresh. Removing an image from the workspace preserves earlier prompt history.
- Supabase tables: `projects`, `assets`, `generations`, `generation_inputs`, and `effect_versions`, with per-user access rules. Migrations are applied to the hosted project.
- Authenticated JSON downloads from `/api/effects/<version-id>`.

The studio currently saves prompts as **drafts** and displays a **sample particle scene**. It does not call a generation model or render saved effect JSON yet.

## What’s left for Eric

1. **Connect generation.** After `savePrompt()` in `web/src/app/workspace/actions.ts` saves a draft, invoke your backend with its generation ID. Read the prompt and ordered `generation_inputs`; resolve the private reference images through `assets` and signed URLs.
2. **Define and validate the effect JSON.** The database accepts a JSON object without prescribing its internal VFX format. Your generator and renderer should agree on the schema and version.
3. **Save results and status.** From trusted backend code, update the generation’s status and insert an `effect_versions` row containing `project_id`, `generation_id`, `schema_version`, and `definition`. Keep privileged Supabase keys server-side and verify project ownership.
4. **Connect the preview.** Load the selected effect definition into your Three.js runtime through `web/src/components/particle-scene.tsx`. Wire result selection and progress updates into `web/src/components/studio.tsx`; results currently appear after a refresh.
5. **Test the complete flow.** Image + prompt → generation → interactive VFX → saved JSON → reopen/download. Define storage for any generated textures or models your effects require.

## Before the demo

- Deploy the app with its Supabase environment variables and verify email confirmation and callback URLs on the deployed domain.
- Test the renderer in a browser with WebGPU support; the headless test environment had no adapter.
- Billing, teams, video references, and Niagara/other engine exporters remain outside the hackathon scope.

Build, lint, TypeScript, database isolation tests, and browser login/persistence/download checks passed. See [APP_DATABASE.md](APP_DATABASE.md) for setup and the detailed database contract.

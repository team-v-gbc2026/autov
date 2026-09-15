# App and database integration

The app owns authentication, projects, image uploads, prompt history, and saved effect JSON. The generation implementation and renderer belong to the generation team.

## Local app

```bash
cd frontend
npm ci
cp .env.example .env.local # only when no local environment file exists
# Fill NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from Supabase → Settings → API.
npm run dev
```

Use `/login` to create an account or sign in, `/workspace` to create/open projects, and `/workspace/<project-id>` for the studio. Email/password authentication uses Supabase SSR cookies. Private routes verify the user on the server; RLS also protects direct API access. The frontend never needs a secret key.

In Supabase Auth URL configuration, allow `http://localhost:3000/auth/callback` and the deployed app's `/auth/callback` URL. Configure Site URL to the app origin. For separate marketing/app domains, login and the studio should run on the app origin. Signup uses the project's email-confirmation setting; email delivery is provided by the project's configured mail service.

## Tables

| Table | Role |
| --- | --- |
| `projects` | User-owned project name and creation time |
| `assets` | Image metadata and private storage path; `archived` removes a reference from the current workspace without breaking earlier prompts |
| `project_conversations` | Binds a project to its Eve session |
| `studio_documents` | The current `autov.lab/2` document and its revision |
| `studio_operations` | Every agent operation, with its tool input (including the board `referenceIds` a generation drew on) and result |
| `studio_provider_calls` | Per-operation provider spend reservations and charges |
| `studio_reference_provenance` | Links a generated asset back to the operation and source references that produced it |

Reference files live in the private `references` bucket at `<user-id>/<project-id>/<asset-id>`. PNG, JPEG, WebP and GIF are accepted, up to 20 MiB each, with at most eight inputs per prompt. Failed metadata saves attempt to remove the unregistered object. Removing a reference archives it and retains its file for generation history. There is no project deletion UI in this version.

## Generation pipeline

Generation runs through Eve; see [the agent integration](EVE_STUDIO_INTEGRATION.md). The
pre-Eve `generations`, `generation_inputs` and `effect_versions` tables, and the
`save_generation` RPC that wrote them, have been dropped.

1. A chat turn resolves `@[name](reference:UUID)` mentions into `referenceIds` and passes them to `generate_vfx`.
2. `studio_transition` records the call as a `studio_operations` row, storing those `referenceIds` in its `input`. This is the durable record of which board images an effect was built from — the agent handoff export reads it back from there.
3. A committed operation advances `studio_documents.revision` and writes the new document.
4. Provider spend is reserved and charged per operation in `studio_provider_calls`.
5. Assets an operation generates are linked back to their sources in `studio_reference_provenance`.

No billing, queues, engine adapters, or third-party model calls beyond the configured
providers are implemented here. Texture/model assets need an explicit storage contract
before adding them; the reference bucket is images only.

## Database changes and validation

Migrations are in `supabase/migrations`. Review before applying:

```bash
npx supabase db push --linked --project-ref tkjstnitmfwgmedipcvs --dry-run
npx supabase db push --linked --project-ref tkjstnitmfwgmedipcvs
npx supabase db query --linked --project-ref tkjstnitmfwgmedipcvs --file supabase/tests/access.sql
npx supabase db advisors --linked --project-ref tkjstnitmfwgmedipcvs
```

The SQL test creates two temporary users inside a transaction and rolls back all fixtures. It checks project isolation, reference ownership, storage-path binding, client write restrictions on studio state, archived reference behavior, anonymous denial, and that the retired generation tables and RPC are gone.

App checks: `cd frontend && npm run build && npm run lint`.

## Verification notes

The hosted migration and transaction-based RLS/storage tests were run on 2026-09-12. Browser checks covered password login, project creation/rename, private image upload, prompt/reference persistence after reload, archiving without losing inputs, authenticated JSON download, and sign-out. Temporary test data was removed. Build, TypeScript, and lint passed.

Email confirmation delivery and production redirect URLs still need checking on the deployment domain. The headless test browser had no WebGPU adapter, so renderer validation remains with the rendering team. Supabase's advisor reports the existing Auth setting “Leaked Password Protection Disabled”; no application-table RLS findings remained after the migrations.

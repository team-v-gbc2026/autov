# Local VFX studio

From `frontend/`:

```sh
npm ci
npm run dev:local
```

Open http://127.0.0.1:3000/local. This uses the existing studio layout and needs no Supabase account. Use References to load a preset or attach up to three images. Chat generates a new editable effect. Quick builds one direction; Quality builds three, reviews their rendered frames and tries one bounded improvement.

Open `/local/settings` to save a dedicated OpenAI key locally, or set `OPENAI_API_KEY` in `frontend/.env.local`. Never use `NEXT_PUBLIC_` for the key. The repository-root `.env.local` is not loaded by the frontend server. The current approved setup uses a restricted key expiring 2026-09-19.

The UI shows conservative cumulative spend against $30. It includes outstanding reservations. Restarting does not reset the ledger. If a call times out after reaching OpenAI, its maximum reservation stays charged until manually reconciled with the provider; the app never silently releases uncertain spend. A stale `.autov-local/budget.lock` fails closed: verify no server process is running before recovering a stale lock. Keep `budget.json`.

## Use

- Pick a preset to test the renderer without an API charge.
- Write appearance AND motion, then choose Quick or Quality and press the arrow.
- Compare the timestamped candidate sheets. Click a direction to preview it.
- Switch References → Layers for visibility, solo and appearance controls.
- Choose “Edit selected layer” in Chat; select layer and From/To seconds. Describe a color, size, brightness or opacity change. Review and apply the proposal.
- Expand Effect controls in Timeline for bloom, exposure, camera reset, Undo/Redo and evidence capture.
- JSON downloads the current editable effect. Import restores a validated JSON document.
- Three.js downloads a self-contained HTML player. Open it locally or serve it with any static web server; playback does not use OpenAI credits.
- The last valid document is autosaved in browser localStorage. Generation runs and token accounting are stored privately in `frontend/.autov-local/`. Download generation evidence before closing the tab to retain the complete comparison report.

## Verification

```sh
npm run test
npm run typecheck
npm run lint
npm run build
npm run verify:runtime
```

The test suite covers deterministic seeks, stable particle birth identities, protected edit windows, invalid document rejection, candidate failure and rollback, local API origin checks, and the $30 ledger across process restarts.

See [DESIGN.md](DESIGN.md) for research adaptation, supported capabilities, tradeoffs and limitations. A passing unit test or VLM score is not an AAA-quality claim; judge the actual motion and appearance in your target game context.

See [VERIFICATION.md](VERIFICATION.md) for actual test results, known visual weaknesses, and the standalone-file browser verification limitation.

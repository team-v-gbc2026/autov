# Shared generated presets (draft)

Branch: `codex/vfx-integrated-benchmark` (draft PR #27).

The branch includes 88 actual generated effect documents across 17 cases. Open `/dev/vfx-lab`, then **Presets → DRAFT · fx…** to select a candidate and play/scrub it in the existing 3D view. Each case marks its latest trial selection with ★. Loading and playback do not call a generation API or require an API key. Generated textures remain embedded in the effect JSON.

For a searchable-by-case list and aggregate token/usage details, use **Shared trials ↗** or `/trial-presets/index.html`. Each item opens in the studio. These are draft experiments, not accepted production assets; scores refer to generation-time automated reviews. Playback uses the current renderer and can differ from the original review frames.

## Run locally

```sh
git switch codex/vfx-integrated-benchmark
cd frontend
npm ci
npm run bundle:runtime
npm run dev -- --hostname 127.0.0.1 --port 3031
```

Open `http://127.0.0.1:3031/dev/vfx-lab`. Stop another local server on port 3031 first, or choose a free port. Each teammate's localhost URL refers to their own computer. `/dev/**` is a dev-only route and is never part of a hosted branch preview.

Only JSON effect data, aggregate usage metadata and lightweight index code are shared (about 8 MB uncompressed). **No videos, standalone per-candidate HTML players, screenshots, input reference media, raw input prompts, API keys or raw usage ledger are included.** The token totals are a snapshot of cumulative project usage, including other runs; unsettled reservations are included in the cost estimate. They are not an invoice or a per-preset price.

The original local archive remains unchanged. Future refreshes are explicit: from `frontend`, run `node --import tsx scripts/publish-trial-presets.mjs --publish --ledger /path/to/the/existing/budget.json`, then inspect the generated changes before committing. This script publishes only an allowlist of generated documents and aggregate metadata. It makes no paid requests.

Verification: `node --import tsx scripts/verify-shared-trials.mjs` checks document hashes/schema, all shared preset options, each case's latest candidate in the real studio, direct links and list filtering while blocking the private trial API. Set `AUTOV_TEST_URL` to the running server if it is not on port 3033.

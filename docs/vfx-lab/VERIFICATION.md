# Verification record — 2026-09-12

Local branch: `codex/vfx-generation-studio`. No push or deployment.

## Automated checks

- `npm run test`: **32 passing tests**. Includes 1,000 randomized protected-window samples, deterministic seek evaluation, stable particle birth IDs, invalid schema rejection, transparent generated-placeholder rejection, candidate failure/cancellation/rollback, HTML data escaping, tiny-base animated refinement regression, local origin checks, and cumulative budget persistence across processes. A token-accounting overrun now latches generation off until reviewed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; includes runtime bundling.
- `npm run verify:runtime`: passed. The exported renderer is approximately 1 MiB, contains no API key or OpenAI endpoint, and requires no remote module imports.
- Dependency installation reported zero known vulnerabilities. Node 22.12 emitted an engine warning for an ESLint transitive dependency; all checks passed. Prefer Node 22.13 or newer in this major release.

## Chrome acceptance evidence

The actual local `/workspace` studio was exercised with WebGL2 in Chrome, through the existing References / Chat / Timeline layout.

| Operation | Observed result |
|---|---|
| Slash, magic and shockwave presets | Real GPU preview, layered procedural materials, bloom, particle streaks, orbit and playback available. |
| Deterministic seeking | Magic preset explicitly sought 1.78 → 0.50 → 1.78 s. The two same-camera cropped PNGs at 1.78 s were byte-identical (28,863 bytes each). This is same-machine evidence, not cross-GPU identity. |
| Real paid generation | Multiple runs made successful Responses API calls using the dedicated project key. JSON documents rendered in the studio; visual reviews used actual event-timed contact sheets. |
| Diagnostic refinement | Run `9ec5c6c6-3973-48cc-8ebc-8d8f4b8c404b` produced and re-rendered a bounded correction. Its review did not clearly improve, so the prior best document was retained. |
| Scoped chat edit | OpenAI proposed `shock-0`, color `#3399FF`, 0.70–1.20 s. Apply showed the changed ring. JSON exports before/after Undo/Redo proved exactly one override and identical unrelated document paths. Redo restored the full edited document. |
| Persistence | The current document survived route changes and server restart through browser localStorage. Server spend/run files survived restart. |
| JSON and HTML export | Browser downloads succeeded. JSON round trips were inspected structurally. A self-contained `Celestial gate.html` was downloaded. |
| Standalone HTML playback | **Not independently verified**: browser automation blocked the `file://` URL even after the user opened the file. No alternate browser surface or URL-policy workaround was used. User confirmation was requested. The embedded runtime itself was exercised in the local studio. |

## Actual quality and limitations

The latest complete amber-shockwave comparison contains three generated documents and one refinement. One generated document was visually empty after a structural repair; its critic returned insufficient evidence. Another critic exceeded its token cap; the pipeline retained the render without pretending it was scored. The best rated direction was approximately **2.1/5**, and the bounded refinement did not improve enough to replace it. This establishes a working review-and-rollback process, **not AAA-quality acceptance**. Sparseness, smoke readability and excessive spark concentration remain visible art-direction weaknesses for this prompt.

The observed failures led to a generation-only visible-energy validation gate, an animated-peak refinement correction, and a larger visual-review output allowance. The new validation and accounting regressions are covered by the final tests; a further full paid comparison after those last guard changes was not run. The scoped edit used the updated server successfully.

Reproducible artifacts: [editable generated example](examples/amber-rupture.json), [render contact sheet](examples/amber-contact-sheet.jpg), [plan, reviews and pipeline trace](examples/amber-review.json). These are test outputs, not curated AAA assets. They contain no reference uploads or API keys.

## Credit configuration

The Chrome project Limits screen confirmed a **$30 monthly hard limit** for `autoV - GBC 2026 (Team V!)`. The app additionally enforces a conservative **$30 cumulative** disk-backed preflight cap. At completion, the local counter was approximately **$4.45**, including a **$0.31 unresolved reservation** retained after a disconnected request; this is a conservative accounting figure, not an exact provider invoice.

The dedicated `autov-local-taiki` key has restricted Responses access, expires **2026-09-19**, and is stored only in ignored `frontend/.env.local` with mode `0600`. No key is included in JSON, HTML, evidence, logs or Git. The provider states hard-limit enforcement may lag slightly. Restarting the app never resets the local ledger.

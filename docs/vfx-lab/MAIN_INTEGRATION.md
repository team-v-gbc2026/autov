# Main integration — 2026-09-13

Upstream: `0b97b55` (Feature/reference canvas implement #22), fetched from origin/main. Local feature base: `817814a`. No remote push or deployment.

## User decisions implemented

- Reuse main's MoodBoard and ReferenceComposer in the actual local generation screen. Preserve the drag/resize/zoom/notes/preview/@mention components; remove the old References/Layers tab layout.
- List emitters vertically in the bottom timeline with global start/end bars, shared playhead, selection, visibility and solo. Effect-level looping remains available. Bars are currently display/select controls rather than draggable retiming handles.
- Effect controls follows the selected emitter. Primary/secondary color, additive/normal blend, intensity, radius, width, opacity, length, speed, turbulence, erosion and spin are editable. The chat shortcut and From/To editing remain.
- Environment settings is adjacent to Effect controls. Bloom, Exposure, Reset camera, Undo, Redo and evidence capture are retained.
- Keep generation candidates and image reviews in Chat; persist chronological request/result/edit/undo/redo history. Main's stable @reference IDs select only the attached images, with eight references and 10,000 characters per prompt.

## Integration boundary

This is a local-first generation integration: the integrated VFX screen lives at the dev-only route `/dev/vfx-lab` (present in `next dev`, absent from every production build). `/workspace` is main's authenticated Supabase project route and preserves main's project/asset/draft workflow unchanged. Its generation backend is still not connected; local API keys are never enabled on the public deployment. Board image generation remains the upstream, unconnected UI. Board notes are not implicitly included in VFX prompts.

The local adapter stores original board images in IndexedDB without Supabase credentials. Generation sends resized JPEG copies (GIF still frames). Existing VFX document storage is retained. The existing $30 cumulative budget ledger, atomic reservations and local-origin API checks are unchanged. The request body bound increases to 17 MB to accommodate eight bounded images.

## Validation

- 34 tests pass, including reference order, omitted references, eight-image/10,000-character boundaries, removed reference rejection, protected time windows, deterministic rendering, candidate rollback and budget enforcement.
- TypeScript, ESLint, production build and standalone runtime verification passed. The measured timeline height reserves a visible preview area, even with a control panel open.
- Chrome: main Board displayed inside the local studio (then `/local`, now `/dev/vfx-lab`); timeline selection updates controls and chat target; From/To updates; real OpenAI edit for Fine white edge 0.80–1.10 s produced #ff8844, applied successfully, Undo/Redo exercised and the test edit undone. Local budget displayed about $4.46 including previous reservations.
- Browser file chooser permissions blocked uploads in the earlier comparison. A new upload test is not claimed in this merge; the unchanged main composer workflow and reference selection policy are covered separately.
